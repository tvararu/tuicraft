import {
  factoryStateDir,
  labels,
  pm,
  type Role,
  repoSlug,
  wip,
} from "factory/config";
import { must } from "factory/exec";
import { fetchIssues, type Issue, type Pr } from "factory/github";

export type Decision =
  | { ok: true; out: Record<string, number | string> }
  | { ok: false; why: string };

const busy: string[] = [
  labels.working,
  labels.review,
  labels.reviewing,
  labels.merging,
  labels.landing,
  labels.pm,
];
const priorities = ["p1", "p2", "p3"];
const sha = /^[0-9a-f]{40}$/;

export function qaShaFile(): string {
  return `${factoryStateDir()}/qa-main-sha`;
}

export function inScope(issue: Issue): boolean {
  if (
    !issue.labels.some(
      (label) => label === labels.ready || label === labels.rework,
    )
  )
    return false;
  const readies = issue.events.filter((event) => event.label === labels.ready);
  return readies.at(-1)?.actor === pm;
}

export function unblocked(issue: Issue): boolean {
  return issue.blockers.every((state) => state !== "OPEN");
}

export function byPriority(issues: Issue[]): Issue[] {
  const rank = (issue: Issue) => {
    const index = priorities.findIndex((p) => issue.labels.includes(p));
    return index === -1 ? priorities.length : index;
  };
  return issues.toSorted((a, b) => rank(a) - rank(b) || a.number - b.number);
}

export function decideWorker(issues: Issue[]): Decision {
  const working = issues.filter((issue) =>
    issue.labels.includes(labels.working),
  ).length;
  if (working >= wip) return { ok: false, why: `wip ${working}/${wip}` };
  const free = issues.filter(
    (issue) => !issue.labels.some((label) => busy.includes(label)),
  );
  const [pick] = byPriority(
    free.filter((issue) => inScope(issue) && unblocked(issue)),
  );
  return pick
    ? { ok: true, out: { issue: pick.number } }
    : { ok: false, why: "no eligible issue" };
}

export function decideReviewer(issues: Issue[]): Decision {
  const waiting = issues.filter(
    (i) =>
      i.labels.includes(labels.review) && !i.labels.includes(labels.reviewing),
  );
  const pairs = byPriority(waiting).map((issue) => ({
    issue,
    pr: issue.prs.find(reviewable),
  }));
  const pick = pairs.find((pair) => pair.pr);
  if (!pick?.pr) return { ok: false, why: "no PR awaiting review" };
  return { ok: true, out: { issue: pick.issue.number, pr: pick.pr.number } };
}

export function decideMerger(issues: Issue[]): Decision {
  const landing = issues.find((issue) => issue.labels.includes(labels.landing));
  if (landing) return { ok: false, why: `#${landing.number} is landing` };
  const merging = byPriority(
    issues.filter((issue) => issue.labels.includes(labels.merging)),
  );
  const pairs = merging.map((issue) => ({
    issue,
    pr: issue.prs.find(landable),
  }));
  const pick = pairs.find((pair) => pair.pr);
  if (!pick?.pr)
    return { ok: false, why: "no approved PR with passing statuses" };
  return { ok: true, out: { issue: pick.issue.number, pr: pick.pr.number } };
}

export function decideQa(remote: string, stored: string | null): Decision {
  if (remote === stored)
    return { ok: false, why: `main ${remote} already tested` };
  return { ok: true, out: { sha: remote } };
}

function reviewable(pr: Pr): boolean {
  return pr.state === "OPEN" && !pr.draft;
}

function landable(pr: Pr): boolean {
  const passed = (name: string) =>
    pr.statuses.some((s) => s.name === name && s.state === "SUCCESS");
  return (
    reviewable(pr) &&
    pr.decision === "APPROVED" &&
    passed("factory/ci") &&
    passed("factory/review")
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

const deciders: Record<Role, () => Promise<Decision>> = {
  merger: async () => decideMerger(await fetchIssues()),
  qa,
  reviewer: async () => decideReviewer(await fetchIssues()),
  worker: async () => decideWorker(await fetchIssues()),
};

export async function runPrecheck(args: string[]): Promise<number> {
  const role = args[0];
  if (!(role && Object.hasOwn(deciders, role))) {
    console.error(`usage: precheck <${Object.keys(deciders).join("|")}>`);
    return 2;
  }
  try {
    const decision = await deciders[role as Role]();
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
