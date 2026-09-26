import { type BoardStatus, repoSlug } from "factory/config";
import { must } from "factory/exec";
import type { Issue, Pr } from "factory/github";
import { liveLandings } from "factory/markers";

export type Moved = { issue: number; pr: number; head: string };
export type Bounce = { status: BoardStatus | null; comment: string | null };

export const maxBounces = 2;
const marker = /^<!-- factory:bounce ([0-9a-f]{40}) -->/;

function passed(pr: Pr, name: string): boolean {
  return pr.statuses.some((s) => s.name === name && s.state === "SUCCESS");
}

export function reviewedHead(pr: Pr): boolean {
  return (
    pr.checked === pr.head &&
    passed(pr, "factory/ci") &&
    passed(pr, "factory/review")
  );
}

export function landableHead(pr: Pr): boolean {
  return reviewedHead(pr) && passed(pr, "signoff/ci");
}

function movedAfterPass(pr: Pr): boolean {
  if (reviewedHead(pr) || pr.verdicts.some((v) => v.oid === pr.head))
    return false;
  const [latest] = pr.verdicts.toSorted(
    (a, b) => Date.parse(b.at) - Date.parse(a.at),
  );
  return latest?.state === "SUCCESS";
}

export function movedHeads(issues: Issue[], now: number): Moved[] {
  if (liveLandings(issues, now).length > 0) return [];
  return issues.flatMap((issue) => {
    if (issue.status !== "in-review") return [];
    const pr = issue.prs.find((p) => p.state === "OPEN" && !p.draft);
    if (!(pr && movedAfterPass(pr))) return [];
    return [{ head: pr.head, issue: issue.number, pr: pr.number }];
  });
}

export function bouncedHeads(bodies: string[]): string[] {
  return bodies.flatMap((body) => {
    const head = marker.exec(body)?.[1];
    return head ? [head] : [];
  });
}

export function bounce(moved: Moved, earlier: string[]): Bounce {
  const count = new Set([...earlier, moved.head]).size;
  const blocked = count > maxBounces;
  const short = moved.head.slice(0, 7);
  const lines = [
    `<!-- factory:bounce ${moved.head} -->`,
    `Head changed since review: PR #${moved.pr} is now at \`${short}\`, which lacks green \`factory/ci\` and \`factory/review\` statuses.`,
    blocked
      ? `Bounce ${count} of at most ${maxBounces}: moved to Blocked. The branch keeps moving after review. Settle it, then move the card to In review so the reviewer checks the final head.`
      : `Bounce ${count}/${maxBounces}: the card stays In review so a reviewer checks the new head.`,
  ];
  return {
    comment: earlier.includes(moved.head) ? null : lines.join("\n\n"),
    status: blocked ? "blocked" : null,
  };
}

async function earlierBounces(issue: number): Promise<string[]> {
  const out = await must([
    "gh",
    "api",
    "--paginate",
    `repos/${repoSlug}/issues/${issue}/comments`,
    "--jq",
    ".[].body",
  ]);
  return bouncedHeads(out.split("\n"));
}

export async function applyBounces(
  moved: Moved[],
  dryRun: boolean,
  setStatus: (issue: number, status: BoardStatus) => Promise<void>,
): Promise<void> {
  for (const m of moved) {
    const action = bounce(m, await earlierBounces(m.issue));
    if (action.comment === null && action.status === null) continue;
    const verb = dryRun ? "would bounce" : "bounce";
    console.error(
      `precheck merger: ${verb} #${m.issue} (PR #${m.pr} head ${m.head.slice(0, 7)}), status ${action.status ?? "in-review"}`,
    );
    if (dryRun) continue;
    if (action.comment !== null)
      await must([
        "gh",
        "issue",
        "comment",
        String(m.issue),
        "-R",
        repoSlug,
        "--body",
        action.comment,
      ]);
    if (action.status !== null) await setStatus(m.issue, action.status);
  }
}
