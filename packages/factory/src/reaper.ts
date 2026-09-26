import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { boardItems, openIssues } from "#factory/board-items";
import {
  automationNames,
  bot,
  idleHours,
  mainCheckout,
  type Role,
  roleCapHours,
  stalledRunQuietHours,
} from "#factory/config";
import { json, must, run } from "#factory/exec";
import { fetchIssues, type Issue } from "#factory/github";
import { migrate } from "#factory/migrate";
import { landed, landFacts } from "#factory/reaper-land";
import { deathOf, recoverRun } from "#factory/reaper-recover";
import {
  applyDrafts,
  closeReports,
  type Held,
  issueOf,
  legacyReports,
  planDrafts,
  planStray,
  type Reason,
  reaperDrafts,
} from "#factory/reaper-report";
import { supersededBy } from "#factory/reaper-supersede";
import { strayMessage, strayWorktree } from "#factory/repo-guard";
import { syncPrompts } from "#factory/setup";
import { sweep } from "#factory/soap";

type Stamp = number | string | null | undefined;
type Provenance = { kind: string; createdAt?: number } | null;

export type Worktree = {
  id: string;
  repoId: string;
  displayName: string;
  path: string;
  branch: string;
  isMainWorktree: boolean;
  parentWorktreeId: string | null;
  cliProvenance: Provenance;
  lastActivityAt: number;
};
export type Terminal = { worktreeId: string; lastOutputAt: number | null };
export type AutoRun = {
  workspaceId: string | null;
  status: string;
  error?: string | null;
  startedAt?: Stamp;
  dispatchedAt?: Stamp;
};
export type Owner =
  | { kind: "reaper"; automation: string; role: Role }
  | { kind: "owner"; name: string };
export type Hold = {
  kind: "hold";
  reason: Reason;
  archive: boolean;
  close: boolean;
};
export type Action =
  | { kind: "skip"; why: string }
  | { kind: "remove"; why?: string }
  | Hold;
export type AutoState = {
  done: boolean;
  over: boolean;
  clean: boolean;
  pushed: boolean;
  merged: boolean;
};
export type OtherState = { idle: boolean; landed: boolean; clean: boolean };
export type ReapOptions = {
  dryRun: boolean;
  idleHours: number;
  only?: (name: string) => boolean;
  now?: number;
};

type Inventory = {
  all: Worktree[];
  worktrees: Worktree[];
  terminals: Terminal[];
  runs: AutoRun[];
};
type Ctx = {
  wt: Worktree;
  inv: Inventory;
  opts: ReapOptions;
  now: number;
  issues: () => Promise<Issue[]>;
};
type Decision = {
  owner: Owner;
  action: Action;
  ageHours: number;
  status: string[];
  death: string | null;
};

const hour = 3_600_000;
const roles: Role[] = ["worker", "qa", "reviewer", "merger"];
const allowlist = ["node_modules", "dist", "coverage"];

const autoName = /^auto-(.+)-run-\d+-.+$/;
const headsPrefix = /^refs\/heads\//;

export function roleOf(automation: string): Role {
  const role = roles.find(
    (r) =>
      automation === automationNames[r] ||
      automation.startsWith(`${automationNames[r]}-`),
  );
  return (
    role ?? roles.reduce((a, b) => (roleCapHours[b] > roleCapHours[a] ? b : a))
  );
}

export function ownerOf(wt: Worktree, all: Worktree[]): Owner {
  const automation = wt.displayName.match(autoName)?.[1];
  if (automation)
    return { automation, kind: "reaper", role: roleOf(automation) };
  if (!wt.cliProvenance) return { kind: "owner", name: "maintainer" };
  const parent = all.find((p) => p.id === wt.parentWorktreeId);
  return { kind: "owner", name: parent?.displayName ?? "unknown" };
}

function ownerName(owner: Owner): string {
  return owner.kind === "reaper" ? `reaper:${owner.role}` : owner.name;
}

function toMs(stamp: Stamp): number | undefined {
  if (stamp === null || stamp === undefined) return undefined;
  return typeof stamp === "number" ? stamp : Date.parse(stamp);
}

export function idleFor(
  wt: Worktree,
  terminals: Terminal[],
  now: number,
): number {
  const outputs = terminals
    .filter((t) => t.worktreeId === wt.id)
    .map((t) => t.lastOutputAt ?? 0);
  return (now - Math.max(wt.lastActivityAt, ...outputs)) / hour;
}

function runOf(wt: Worktree, runs: AutoRun[]): AutoRun | undefined {
  return runs.find((r) => r.workspaceId === wt.id || r.workspaceId === wt.path);
}

export function runDone(
  autoRun: AutoRun | undefined,
  quietHours: number,
): boolean {
  if (autoRun?.status === "dispatch_failed")
    return quietHours >= stalledRunQuietHours;
  return autoRun?.status === "completed" || autoRun?.status === "failed";
}

export function runAge(
  autoRun: AutoRun | undefined,
  wt: Worktree,
  now: number,
): number {
  const start =
    toMs(autoRun?.dispatchedAt) ??
    toMs(autoRun?.startedAt) ??
    wt.cliProvenance?.createdAt ??
    wt.lastActivityAt;
  return (now - start) / hour;
}

export function overCap(ageHours: number, role: Role): boolean {
  return ageHours > roleCapHours[role];
}

export function strayIgnored(status: string[]): string[] {
  const ignored = status
    .filter((e) => e.startsWith("!! "))
    .map((e) => e.slice(3));
  return ignored.filter(
    (p) =>
      !p
        .split("/")
        .slice(0, -1)
        .some((s) => allowlist.includes(s)),
  );
}

export function isClean(status: string[], scratchOk = false): boolean {
  const changed = status.filter((e) => !e.startsWith("!! "));
  if (changed.length > 0) return false;
  return scratchOk || strayIgnored(status).length === 0;
}

function hold(reason: Reason, archive: boolean, close: boolean): Hold {
  return { archive, close, kind: "hold", reason };
}

export function autoAction({
  done,
  over,
  clean,
  pushed,
  merged,
}: AutoState): Action {
  if (!(done || over)) return { kind: "skip", why: "running" };
  if (clean && (pushed || merged)) return { kind: "remove" };
  if (!clean) return hold(over ? "over-cap-dirty" : "dirty", true, true);
  return hold("unlanded-commits", false, true);
}

export function otherAction({
  idle,
  landed: merged,
  clean,
}: OtherState): Action {
  if (!idle) return { kind: "skip", why: "not idle" };
  if (!clean) return hold("dirty", true, false);
  if (!merged) return hold("unlanded-commits", false, false);
  return { kind: "remove" };
}

function short(ref: string): string {
  return ref.replace(headsPrefix, "");
}

function day(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

async function inventory(): Promise<Inventory> {
  const wts = await json<{ result: { worktrees: Worktree[] } }>([
    "orca-ide",
    "worktree",
    "list",
    "--json",
  ]);
  const terms = await json<{ result: { terminals: Terminal[] } }>([
    "orca-ide",
    "terminal",
    "list",
    "--json",
  ]);
  const runs = await json<{ result: { runs?: AutoRun[] } | AutoRun[] }>([
    "orca-ide",
    "automations",
    "runs",
    "--json",
  ]);
  const all = wts.result.worktrees;
  const repoId = all.find((w) => w.path === mainCheckout)?.repoId;
  const worktrees = all.filter(
    (w) => w.repoId === repoId && !w.isMainWorktree && w.path !== mainCheckout,
  );
  const list = Array.isArray(runs.result)
    ? runs.result
    : (runs.result.runs ?? []);
  return { all, runs: list, terminals: terms.result.terminals, worktrees };
}

async function git(args: string[], cwd = mainCheckout): Promise<string> {
  return (await must(["git", ...args], { cwd })).trim();
}

async function branchExists(branch: string): Promise<boolean> {
  const ref = [
    "git",
    "rev-parse",
    "--verify",
    "--quiet",
    `refs/heads/${branch}`,
  ];
  return (await run(ref, { cwd: mainCheckout })).code === 0;
}

async function statusOf(wt: Worktree): Promise<string[]> {
  const raw = await must(["git", "status", "--porcelain", "-z", "--ignored"], {
    cwd: wt.path,
  });
  return raw.split("\0").filter(Boolean);
}

function runBranch(wt: Worktree): string {
  return `${bot}/${wt.displayName}`;
}

async function runRefs(wt: Worktree): Promise<string[]> {
  const refs = [await git(["rev-parse", "--abbrev-ref", "HEAD"], wt.path)];
  for (const branch of [short(wt.branch), runBranch(wt)])
    if (branch && (await branchExists(branch))) refs.push(branch);
  return [...new Set(refs)];
}

async function unpushed(wt: Worktree): Promise<string[]> {
  const refs = await runRefs(wt);
  const out = await Promise.all(
    refs.map((r) => git(["rev-list", r, "--not", "--remotes"], wt.path)),
  );
  return refs.filter((_, i) => out[i] !== "");
}

async function refLanded(wt: Worktree, ref: string): Promise<boolean> {
  const tip = await git(["rev-parse", ref], wt.path);
  return landed(await landFacts(tip, ref === "HEAD" ? null : ref));
}

async function refGone(wt: Worktree, ref: string): Promise<string | null> {
  return (await refLanded(wt, ref)) ? "" : supersededBy(ref, wt.path);
}

async function decideAuto(
  { wt, inv, now }: Ctx,
  owner: Owner & { kind: "reaper" },
): Promise<Decision> {
  const autoRun = runOf(wt, inv.runs);
  const ageHours = runAge(autoRun, wt, now);
  const done = runDone(autoRun, idleFor(wt, inv.terminals, now));
  const over = overCap(ageHours, owner.role);
  const status = done || over ? await statusOf(wt) : [];
  const clean = isClean(status, true);
  const open = (done || over) && clean ? await unpushed(wt) : null;
  const pushed = open !== null && open.length === 0;
  let merged = false;
  let why = "";
  if (open !== null && !pushed) {
    const each = await Promise.all(open.map((ref) => refGone(wt, ref)));
    merged = each.every((w) => w !== null);
    why = each.filter(Boolean).join("; ");
  }
  const action = autoAction({ clean, done, merged, over, pushed });
  return {
    action:
      action.kind === "remove" && why
        ? { kind: "remove", why: `superseded: ${why}` }
        : action,
    ageHours,
    death: deathOf(autoRun, { done, over, role: owner.role }),
    owner,
    status,
  };
}

async function decideOther(
  { wt, inv, opts, now }: Ctx,
  owner: Owner,
): Promise<Decision> {
  const ageHours = idleFor(wt, inv.terminals, now);
  const idle = ageHours > opts.idleHours;
  const status = idle ? await statusOf(wt) : [];
  const done = idle && (await refLanded(wt, short(wt.branch) || "HEAD"));
  return {
    action: otherAction({ clean: isClean(status), idle, landed: done }),
    ageHours,
    death: null,
    owner,
    status,
  };
}

async function writeArchive(
  wt: Worktree,
  status: string[],
  reason: Reason,
): Promise<string> {
  const dir = `${mainCheckout}/tmp/worktree-archive-${day(Date.now())}`;
  const name = wt.displayName;
  const index = `${tmpdir()}/reaper-${name}-${process.pid}.index`;
  const gitDir = await git(["rev-parse", "--absolute-git-dir"], wt.path);
  await mkdir(dir, { recursive: true });
  if (await Bun.file(`${gitDir}/index`).exists())
    await Bun.write(index, Bun.file(`${gitDir}/index`));
  await must(["git", "add", "-A"], {
    cwd: wt.path,
    env: { GIT_INDEX_FILE: index },
  });
  const patch = await must(["git", "diff", "--cached", "--binary", "HEAD"], {
    cwd: wt.path,
    env: { GIT_INDEX_FILE: index },
  });
  await rm(index, { force: true });
  await Bun.write(`${dir}/${name}.patch`, patch);
  const stray = strayIgnored(status);
  if (stray.length > 0)
    await must([
      "tar",
      "-cf",
      `${dir}/${name}.ignored.tar`,
      "-C",
      wt.path,
      "--",
      ...stray,
    ]);
  await manifest(
    dir,
    `${name} base=${await git(["rev-parse", "HEAD"], wt.path)} branch=${short(wt.branch)} reason=${reason}`,
  );
  return `${dir}/${name}.patch`;
}

async function manifest(dir: string, line: string): Promise<void> {
  const file = Bun.file(`${dir}/MANIFEST.txt`);
  const text = (await file.exists()) ? await file.text() : "";
  const name = line.split(" ")[0] ?? "";
  if (text.split("\n").some((l) => l.startsWith(`${name} `))) return;
  await Bun.write(file, `${text}${line}\n`);
}

async function recovered(
  { wt, opts, issues }: Ctx,
  d: Decision,
): Promise<boolean> {
  if (d.owner.kind !== "reaper" || d.death === null) return true;
  const end = {
    death: d.death,
    ref: wt.branch,
    role: d.owner.role,
    run: runBranch(wt),
  };
  return await recoverRun({ dryRun: opts.dryRun, end, issues });
}

async function remove({ wt, opts }: Ctx, owner: Owner): Promise<void> {
  if (opts.dryRun) return;
  const branch = owner.kind === "reaper" ? runBranch(wt) : short(wt.branch);
  const res = await run([
    "orca-ide",
    "worktree",
    "rm",
    "--worktree",
    `path:${wt.path}`,
    "--json",
  ]);
  if (res.code !== 0)
    return void console.error(
      `reap: rm ${wt.displayName} failed: ${res.stdout}${res.stderr}`,
    );
  if (await branchExists(branch)) await git(["branch", "-D", branch]);
}

async function holdTree(ctx: Ctx, d: Decision, action: Hold): Promise<Held> {
  const { wt, inv, opts } = ctx;
  const hasTerminals = inv.terminals.some((t) => t.worktreeId === wt.id);
  let path: string | null = null;
  if (action.archive)
    path = opts.dryRun
      ? `${mainCheckout}/tmp/worktree-archive-${day(ctx.now)}/${wt.displayName}.patch`
      : await writeArchive(wt, d.status, action.reason);
  if (action.close && hasTerminals && !opts.dryRun)
    await run([
      "orca-ide",
      "terminal",
      "close",
      "--worktree",
      `path:${wt.path}`,
      "--all",
      "--json",
    ]);
  const ageHours = Math.round(d.ageHours * 10) / 10;
  return {
    ageHours,
    archive: path,
    issue: issueOf(wt.branch),
    name: wt.displayName,
    owner: ownerName(d.owner),
    reason: action.reason,
  };
}

async function handle(ctx: Ctx): Promise<Held | null> {
  const owner = ownerOf(ctx.wt, ctx.inv.all);
  const d =
    owner.kind === "reaper"
      ? await decideAuto(ctx, owner)
      : await decideOther(ctx, owner);
  const detail =
    d.action.kind === "hold" ? d.action.reason : (d.action.why ?? "");
  console.error(
    `reap: ${ctx.wt.displayName} owner=${ownerName(owner)} ${d.action.kind} ${detail}`.trim(),
  );
  if (d.action.kind === "remove" && (await recovered(ctx, d)))
    await remove(ctx, owner);
  return d.action.kind === "hold" ? holdTree(ctx, d, d.action) : null;
}

async function reap(opts: ReapOptions): Promise<Held[]> {
  const inv = await inventory();
  const now = opts.now ?? Date.now();
  let fetched: Promise<Issue[]> | undefined;
  const issues = () => (fetched ??= fetchIssues());
  await git(["fetch", "--quiet", "origin", "main"]);
  const held: Held[] = [];
  for (const wt of inv.worktrees.filter(
    (w) => !opts.only || opts.only(w.displayName),
  )) {
    const item = await handle({ inv, issues, now, opts, wt });
    if (item) held.push(item);
  }
  return held;
}

export async function runReap(args: string[]): Promise<number> {
  const dryRun = args.includes("--dry-run");
  await syncPrompts(dryRun, (line) => console.error(`reap: ${line}`));
  const [issues, items] = await Promise.all([openIssues(), boardItems()]);
  const reports = legacyReports(issues);
  if (!dryRun) await closeReports(reports);
  await migrate(
    dryRun,
    issues.filter((i) => !reports.includes(i.number)),
    items,
  );
  const drafts = reaperDrafts(items);
  const stray = await strayWorktree();
  if (stray !== null) {
    console.error(`reap: ${strayMessage(stray)}`);
    const plan = planStray(stray, drafts);
    if (dryRun)
      console.log(JSON.stringify({ close: reports, drafts: plan }, null, 2));
    else await applyDrafts(plan);
    return 1;
  }
  const held = await reap({ dryRun, idleHours });
  console.log(JSON.stringify(held, null, 2));
  const plan = planDrafts(held, drafts);
  if (dryRun) {
    console.log(JSON.stringify({ close: reports, drafts: plan }, null, 2));
    return 0;
  }
  await applyDrafts(plan);
  const swept = await sweep(Math.max(...Object.values(roleCapHours)));
  if (swept.length > 0)
    console.error(`reap: swept SOAP accounts ${swept.join(", ")}`);
  return 0;
}
