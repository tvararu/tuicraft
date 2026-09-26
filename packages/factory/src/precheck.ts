import { mkdir } from "node:fs/promises";
import { runReason } from "#factory/attempts";
import { setStatus } from "#factory/board";
import { applyBounces, landableHead, movedHeads } from "#factory/bounce";
import {
  factoryStateDir,
  levelOf,
  maintainerApproval,
  type Role,
  readPace,
  repoSlug,
} from "#factory/config";
import { must } from "#factory/exec";
import { factoryPr, fetchIssues, type Issue, type Pr } from "#factory/github";
import { sharedIssues } from "#factory/issue-cache";
import { liveLandings, reviewerClaimed, workerClaimed } from "#factory/markers";
import { strayMessage, strayWorktree } from "#factory/repo-guard";

export type Decision =
  | { ok: true; out: Record<string, number | string> }
  | { ok: false; why: string };

const sha = /^[0-9a-f]{40}$/;

function qaShaFile(): string {
  return `${factoryStateDir()}/qa-main-sha`;
}

const pickHoldMs = 3 * 60_000;

function picksFile(): string {
  return `${factoryStateDir()}/worker-picks.json`;
}

export type Picks = Record<string, number>;

export function heldPicks(picks: Picks, now: number): number[] {
  return Object.entries(picks)
    .filter(([, at]) => now - at < pickHoldMs)
    .map(([issue]) => Number(issue));
}

async function readPicks(): Promise<Picks> {
  const file = Bun.file(picksFile());
  return (await file.exists()) ? ((await file.json()) as Picks) : {};
}

async function recordPick(picks: Picks, issue: number, now: number) {
  const live = Object.fromEntries(
    heldPicks(picks, now).map((n) => [n, picks[n] ?? now]),
  );
  await mkdir(factoryStateDir(), { recursive: true });
  await Bun.write(picksFile(), JSON.stringify({ ...live, [issue]: now }));
}

function unblocked(issue: Issue): boolean {
  return issue.blockers.every((state) => state !== "OPEN");
}

function oldestFirst(issues: Issue[]): Issue[] {
  return issues.toSorted((a, b) => a.number - b.number);
}

function reviewable(pr: Pr): boolean {
  return pr.state === "OPEN" && !pr.draft;
}

function lacksReview(pr: Pr): boolean {
  return !(
    pr.checked === pr.head &&
    pr.statuses.some((s) => s.name === "factory/review")
  );
}

export function decideWorker(
  issues: Issue[],
  wip: number,
  now: number,
  held: number[] = [],
): Decision {
  const pending = (i: Issue) => i.status === "ready" && held.includes(i.number);
  const working = issues.filter(
    (i) => i.status === "in-progress" || pending(i),
  ).length;
  if (working >= wip) return { ok: false, why: `wip ${working}/${wip}` };
  const [pick] = oldestFirst(
    issues.filter(
      (i) =>
        i.status === "ready" &&
        !pending(i) &&
        unblocked(i) &&
        !workerClaimed(i, now),
    ),
  );
  if (!pick) return { ok: false, why: "no eligible Ready card" };
  const pr = factoryPr(pick.number, pick.prs);
  const reason = runReason(pr);
  return {
    ok: true,
    out: pr
      ? { issue: pick.number, mode: "rework", pr: pr.number, reason }
      : { issue: pick.number, mode: "fresh", reason },
  };
}

export function decideReviewer(
  issues: Issue[],
  cap: number,
  now: number,
): Decision {
  const landing = liveLandings(issues, now).map((l) => l.issue);
  const pairs = oldestFirst(
    issues.filter(
      (i) => i.status === "in-review" && !landing.includes(i.number),
    ),
  ).flatMap((issue) => {
    const pr = issue.prs.find(reviewable);
    return pr
      ? [{ claimed: reviewerClaimed(issue, pr.head, now), issue, pr }]
      : [];
  });
  const reviewing = pairs.filter((p) => p.claimed).length;
  if (reviewing >= cap)
    return { ok: false, why: `reviewing ${reviewing}/${cap}` };
  const pick = pairs.find((p) => !p.claimed && lacksReview(p.pr));
  if (!pick) return { ok: false, why: "no PR awaiting review" };
  return { ok: true, out: { issue: pick.issue.number, pr: pick.pr.number } };
}

export function decideMerger(
  issues: Issue[],
  now: number,
  approval = maintainerApproval,
): Decision {
  const [landing] = liveLandings(issues, now);
  if (landing) return { ok: false, why: `#${landing.issue} is landing` };
  const pick = oldestFirst(
    issues.filter((i) => i.status === "in-review" && unblocked(i)),
  )
    .map((issue) => ({
      issue,
      pr: issue.prs.find((pr) => landable(pr, approval)),
    }))
    .find((pair) => pair.pr);
  if (!pick?.pr)
    return { ok: false, why: "no landable PR with passing statuses" };
  return {
    ok: true,
    out: {
      approval: approval ? "required" : "not-required",
      issue: pick.issue.number,
      pr: pick.pr.number,
    },
  };
}

export function decideQa(remote: string, stored: string | null): Decision {
  if (remote === stored)
    return { ok: false, why: `main ${remote} already tested` };
  return { ok: true, out: { sha: remote } };
}

function landable(pr: Pr, approval: boolean): boolean {
  return (
    reviewable(pr) &&
    pr.base === "main" &&
    (!approval || pr.decision === "APPROVED") &&
    landableHead(pr)
  );
}

async function qa(): Promise<Decision> {
  const refs = await must([
    "git",
    "ls-remote",
    `https://github.com/${repoSlug}`,
    "refs/heads/main",
  ]);
  const remote = refs.split("\t")[0]?.trim() ?? "";
  if (!sha.test(remote))
    throw new Error(`git ls-remote: unexpected output ${refs}`);
  const file = Bun.file(qaShaFile());
  const stored = (await file.exists()) ? (await file.text()).trim() : null;
  return decideQa(remote, stored);
}

const deciders: Record<Role, (dryRun: boolean) => Promise<Decision>> = {
  merger: async (dryRun) => {
    const issues = await sharedIssues();
    await applyBounces(movedHeads(issues, Date.now()), dryRun, setStatus);
    return decideMerger(issues, Date.now());
  },
  qa,
  reviewer: async () => {
    const { reviewing } = levelOf(await readPace());
    return decideReviewer(await sharedIssues(), reviewing, Date.now());
  },
  worker: async (dryRun) => {
    const { wip } = levelOf(await readPace());
    const now = Date.now();
    const picks = await readPicks();
    const decision = decideWorker(
      await sharedIssues(),
      wip,
      now,
      heldPicks(picks, now),
    );
    if (decision.ok && !dryRun)
      await recordPick(picks, Number(decision.out["issue"]), now);
    return decision;
  },
};

export async function runLandings(): Promise<number> {
  console.log(JSON.stringify(liveLandings(await fetchIssues(), Date.now())));
  return 0;
}

export async function runPrecheck(args: string[]): Promise<number> {
  const role = args[0];
  if (!(role && Object.hasOwn(deciders, role))) {
    console.error(
      `usage: precheck <${Object.keys(deciders).join("|")}> [--dry-run]`,
    );
    return 2;
  }
  try {
    const stray = await strayWorktree();
    if (stray !== null) {
      console.error(`precheck ${role}: ${strayMessage(stray)}`);
      return 1;
    }
    const decision = await deciders[role as Role](args.includes("--dry-run"));
    if (decision.ok) console.log(JSON.stringify(decision.out));
    else console.error(`precheck ${role}: ${decision.why}`);
    return decision.ok ? 0 : 1;
  } catch (error) {
    console.error(
      `precheck ${role}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 2;
  }
}
