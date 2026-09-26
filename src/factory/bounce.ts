import { type BoardStatus, repoSlug } from "factory/config";
import { must } from "factory/exec";
import type { Issue, Pr, Verdict } from "factory/github";
import { liveLandings } from "factory/markers";

export type Moved = { issue: number; pr: number; head: string; since: string };
export type Bounce = { status: BoardStatus | null; comment: string };
export type HeadMark = { kind: "bounce" | "rebase"; head: string; at: string };

export const maxBounces = 2;
const markPattern = /^<!-- factory:(bounce|rebase) ([0-9a-f]{40}) -->/;

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

export function latestVerdict(pr: Pr): Verdict | undefined {
  return pr.verdicts.toSorted((a, b) => Date.parse(b.at) - Date.parse(a.at))[0];
}

function movedAfterPass(pr: Pr): boolean {
  if (reviewedHead(pr) || pr.verdicts.some((v) => v.oid === pr.head))
    return false;
  return latestVerdict(pr)?.state === "SUCCESS";
}

export function movedHeads(issues: Issue[], now: number): Moved[] {
  if (liveLandings(issues, now).length > 0) return [];
  return issues.flatMap((issue) => {
    if (issue.status !== "in-review") return [];
    const pr = issue.prs.find((p) => p.state === "OPEN" && !p.draft);
    if (!(pr && movedAfterPass(pr))) return [];
    return [
      {
        head: pr.head,
        issue: issue.number,
        pr: pr.number,
        since: issue.statusAt,
      },
    ];
  });
}

export function headMarks(
  comments: { at: string; body: string }[],
): HeadMark[] {
  return comments.flatMap(({ at, body }) => {
    const [, kind, head] = markPattern.exec(body) ?? [];
    if (!(kind && head)) return [];
    return [{ at, head, kind: kind === "rebase" ? "rebase" : "bounce" }];
  });
}

export function bounce(moved: Moved, marks: HeadMark[]): Bounce | null {
  if (marks.some((m) => m.head === moved.head)) return null;
  const since = Date.parse(moved.since) || 0;
  const stint = marks.filter(
    (m) => m.kind === "bounce" && Date.parse(m.at) > since,
  );
  const count = new Set([...stint.map((m) => m.head), moved.head]).size;
  const blocked = count > maxBounces;
  const short = moved.head.slice(0, 7);
  const lines = [
    `<!-- factory:bounce ${moved.head} -->`,
    `Head changed since review: PR #${moved.pr} is now at \`${short}\`, which lacks green \`factory/ci\` and \`factory/review\` statuses.`,
    blocked
      ? `Bounce ${count} of at most ${maxBounces}: moved to Blocked. The branch keeps moving after review. Settle it, then move the card to In review so the reviewer checks the final head.`
      : `Bounce ${count}/${maxBounces}: the card stays In review so a reviewer checks the new head.`,
  ];
  return { comment: lines.join("\n\n"), status: blocked ? "blocked" : null };
}

async function headMarksOn(issue: number): Promise<HeadMark[]> {
  const out = await must([
    "gh",
    "api",
    "--paginate",
    `repos/${repoSlug}/issues/${issue}/comments`,
    "--jq",
    ".[] | {at: .created_at, body} | @json",
  ]);
  return headMarks(
    out
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { at: string; body: string }),
  );
}

export async function applyBounces(
  moved: Moved[],
  dryRun: boolean,
  setStatus: (issue: number, status: BoardStatus) => Promise<void>,
): Promise<void> {
  for (const m of moved) {
    const action = bounce(m, await headMarksOn(m.issue));
    if (action === null) continue;
    const verb = dryRun ? "would bounce" : "bounce";
    console.error(
      `precheck merger: ${verb} #${m.issue} (PR #${m.pr} head ${m.head.slice(0, 7)}), status ${action.status ?? "in-review"}`,
    );
    if (dryRun) continue;
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
