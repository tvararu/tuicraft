import { labels, repoSlug } from "factory/config";
import { must } from "factory/exec";
import type { Issue, Pr } from "factory/github";

export type Moved = { issue: number; pr: number; head: string };
export type Bounce = { add: string; comment: string | null };

export const maxBounces = 2;
const marker = /^<!-- factory:bounce ([0-9a-f]{40}) -->/;

export function reviewedHead(pr: Pr): boolean {
  const passed = (name: string) =>
    pr.statuses.some((s) => s.name === name && s.state === "SUCCESS");
  return (
    pr.checked === pr.head && passed("factory/ci") && passed("factory/review")
  );
}

export function movedHeads(issues: Issue[]): Moved[] {
  if (issues.some((issue) => issue.labels.includes(labels.landing))) return [];
  return issues.flatMap((issue) => {
    if (!issue.labels.includes(labels.merging)) return [];
    if (issue.labels.includes(labels.pm)) return [];
    const pr = issue.prs.find((p) => p.state === "OPEN" && !p.draft);
    if (!pr || reviewedHead(pr)) return [];
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
  const pm = count > maxBounces;
  const short = moved.head.slice(0, 7);
  const lines = [
    `<!-- factory:bounce ${moved.head} -->`,
    `Head changed since review: PR #${moved.pr} is now at \`${short}\`, which lacks green \`factory/ci\` and \`factory/review\` statuses.`,
    pm
      ? `Bounce ${count} of at most ${maxBounces}: moved to \`needs:pm\`. Settle the branch, then swap \`needs:pm\` for \`agent:review\`.`
      : `Bounce ${count}/${maxBounces}: back to \`agent:review\` so the new head is reviewed.`,
  ];
  return {
    add: pm ? labels.pm : labels.review,
    comment: earlier.includes(moved.head) ? null : lines.join("\n\n"),
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
): Promise<void> {
  for (const m of moved) {
    const action = bounce(m, await earlierBounces(m.issue));
    const verb = dryRun ? "would bounce" : "bounce";
    console.error(
      `precheck merger: ${verb} #${m.issue} (PR #${m.pr} head ${m.head.slice(0, 7)}) to ${action.add}`,
    );
    if (dryRun) continue;
    const issue = String(m.issue);
    if (action.comment !== null)
      await must([
        "gh",
        "issue",
        "comment",
        issue,
        "-R",
        repoSlug,
        "--body",
        action.comment,
      ]);
    await must([
      "gh",
      "issue",
      "edit",
      issue,
      "-R",
      repoSlug,
      "--remove-label",
      labels.merging,
      "--add-label",
      action.add,
    ]);
  }
}
