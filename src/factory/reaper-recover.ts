import { setStatus } from "factory/board";
import {
  mainCheckout,
  type Role,
  repoSlug,
  roleCapHours,
} from "factory/config";
import { must } from "factory/exec";
import { factoryPr, type Issue, type Pr } from "factory/github";
import { claimOf, lastWorkerClaim } from "factory/markers";

export type Branch = { name: string; sha: string };
export type DeadRun = {
  run: string;
  role: Role;
  death: string;
  branch: Branch | null;
};
export type Recovery =
  | { kind: "ready"; issue: number; body: string }
  | { kind: "unclaim"; issue: number; comment: number };
export type RunEnd = { status: string; error?: string | null };
export type RunState = { done: boolean; over: boolean; role: Role };
export type Ended = Omit<DeadRun, "branch"> & { ref: string };
export type RecoverOptions = {
  end: Ended;
  issues: () => Promise<Issue[]>;
  dryRun: boolean;
};

const headsPrefix = /^refs\/heads\//;

export function deathOf(
  autoRun: RunEnd | undefined,
  { done, over, role }: RunState,
): string | null {
  if (!(done || over) || autoRun?.status === "completed") return null;
  if (!done) return `it ran past the ${roleCapHours[role]} h ${role} cap`;
  const error = autoRun?.error ? ` (${autoRun.error})` : "";
  return `Orca marked the run ${autoRun?.status}${error}`;
}

function diedBody({ run, death, branch }: DeadRun, pr?: Pr): string {
  const pushed = branch
    ? `branch \`${branch.name}\` at ${branch.sha.slice(0, 7)}`
    : "no pushed branch";
  const open = pr ? `open PR #${pr.number}` : "no open PR";
  return `Factory worker ${run} died with this card In progress: ${death}. It left ${pushed} and ${open}. The reaper moved the card back to Ready.`;
}

function unclaims(run: string, issue: Issue): Recovery[] {
  return issue.markers
    .filter((m) => claimOf(m.body)?.run === run)
    .map((m) => ({ comment: m.id, issue: issue.number, kind: "unclaim" }));
}

function workerRecovery(dead: DeadRun, issue: Issue): Recovery[] {
  const claim = lastWorkerClaim(issue);
  if (claim?.run !== dead.run) return [];
  const unclaim = unclaims(dead.run, issue);
  if (issue.status === "ready") return unclaim;
  if (issue.status !== "in-progress") return [];
  if (Date.parse(issue.statusAt) > Date.parse(claim.at)) return [];
  const body = diedBody(dead, factoryPr(issue.number, issue.prs));
  return [{ body, issue: issue.number, kind: "ready" }, ...unclaim];
}

export function planRecovery(dead: DeadRun, issues: Issue[]): Recovery[] {
  if (dead.role === "worker")
    return issues.flatMap((i) => workerRecovery(dead, i));
  if (dead.role !== "reviewer") return [];
  return issues.flatMap((i) => unclaims(dead.run, i));
}

async function pushedBranch(ref: string): Promise<Branch | null> {
  const name = ref.replace(headsPrefix, "");
  if (!name.startsWith("factory/")) return null;
  const heads = ["git", "ls-remote", "--heads", "origin", `refs/heads/${name}`];
  const sha = (await must(heads, { cwd: mainCheckout })).split("\t")[0];
  return sha ? { name, sha } : null;
}

async function apply(recovery: Recovery): Promise<void> {
  const { issue } = recovery;
  if (recovery.kind === "unclaim") {
    const url = `repos/${repoSlug}/issues/comments/${recovery.comment}`;
    await must(["gh", "api", "-X", "DELETE", url]);
    return;
  }
  const comment = ["gh", "issue", "comment", String(issue), "-R", repoSlug];
  await must([...comment, "--body", recovery.body]);
  await setStatus(issue, "ready");
}

function summary(recovery: Recovery): string {
  return recovery.kind === "ready"
    ? `recover #${recovery.issue}: back to Ready, comment: ${recovery.body}`
    : `recover #${recovery.issue}: delete claim ${recovery.comment}`;
}

export async function recoverRun(opts: RecoverOptions): Promise<boolean> {
  const { end, issues, dryRun } = opts;
  if (end.role !== "worker" && end.role !== "reviewer") return true;
  try {
    const branch = end.role === "worker" ? await pushedBranch(end.ref) : null;
    for (const recovery of planRecovery({ ...end, branch }, await issues())) {
      console.error(`reap: ${end.run} ${summary(recovery)}`);
      if (!dryRun) await apply(recovery);
    }
    return true;
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    console.error(`reap: recover ${end.run} failed: ${why}`);
    return false;
  }
}
