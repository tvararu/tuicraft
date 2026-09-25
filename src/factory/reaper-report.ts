import { bot, labels, pm, repoSlug } from "factory/config";
import { json, must } from "factory/exec";

export type Reason = "dirty" | "unlanded-commits" | "over-cap-dirty";
export type Held = {
  name: string;
  owner: string;
  ageHours: number;
  reason: Reason;
  archive: string | null;
};
export type ReportIssue = { number: number; title: string; body: string };
export type ReportPlan = {
  create: { title: string; body: string }[];
  update: ReportIssue[];
  close: { number: number; comment: string }[];
};

const titlePattern = /^Reaper: (\S+) held \(/;

export function heldName(title: string): string | null {
  return title.match(titlePattern)?.[1] ?? null;
}

export function reportTitle(h: Held): string {
  return `Reaper: ${h.name} held (${h.reason})`;
}

function fixFor(h: Held): string {
  const rm = `\`orca-ide worktree rm --worktree name:${h.name} --force\``;
  if (h.reason === "unlanded-commits")
    return `The branch has commits that are not on \`main\`. Land them through a PR, or, if they are not wanted, remove the worktree with ${rm} and delete the branch.`;
  const restore = h.archive
    ? ` The archive restores it with \`git apply --binary ${h.archive}\` on the base SHA from \`MANIFEST.txt\`.`
    : "";
  return `The worktree has uncommitted work. Commit and land it, or discard it; the reaper removes the tree once it is clean and landed. If the work is not wanted, remove it with ${rm}.${restore}`;
}

export function reportBody(h: Held): string {
  return [
    `@${pm}: the reaper will not remove the worktree \`${h.name}\`.`,
    "",
    `- Owner: ${h.owner}`,
    `- Reason: ${h.reason}`,
    `- Archive: ${h.archive ? `\`${h.archive}\`` : "none"}`,
    "",
    `What to do: ${fixFor(h)}`,
    "",
    "The reaper closes this issue on its first pass after the worktree is gone or no longer held.",
    "",
  ].join("\n");
}

export function planReport(held: Held[], issues: ReportIssue[]): ReportPlan {
  const open = new Map<string, ReportIssue>();
  for (const issue of issues) {
    const name = heldName(issue.title);
    if (name && !open.has(name)) open.set(name, issue);
  }
  const plan: ReportPlan = { close: [], create: [], update: [] };
  for (const h of held) {
    const want = { body: reportBody(h), title: reportTitle(h) };
    const issue = open.get(h.name);
    if (!issue) plan.create.push(want);
    else if (issue.title !== want.title || issue.body !== want.body)
      plan.update.push({ ...want, number: issue.number });
  }
  const names = new Set(held.map((h) => h.name));
  for (const [name, issue] of open)
    if (!names.has(name))
      plan.close.push({
        comment: `\`${name}\` is no longer held: the worktree was removed or the reaper no longer needs to keep it.`,
        number: issue.number,
      });
  return plan;
}

async function openReports(): Promise<ReportIssue[]> {
  const list = await json<(ReportIssue & { author: { login: string } })[]>([
    "gh",
    "issue",
    "list",
    "-R",
    repoSlug,
    "--state",
    "open",
    "--limit",
    "1000",
    "--json",
    "number,title,body,author",
  ]);
  return list
    .filter((i) => i.author.login === bot && heldName(i.title))
    .map(({ number, title, body }) => ({ body, number, title }));
}

export async function report(held: Held[]): Promise<void> {
  const plan = planReport(held, await openReports());
  for (const { title, body } of plan.create)
    await must([
      "gh",
      "issue",
      "create",
      "-R",
      repoSlug,
      "--title",
      title,
      "--body",
      body,
      "--label",
      labels.pm,
    ]);
  for (const { number, title, body } of plan.update)
    await must([
      "gh",
      "issue",
      "edit",
      String(number),
      "-R",
      repoSlug,
      "--title",
      title,
      "--body",
      body,
    ]);
  for (const { number, comment } of plan.close)
    await must([
      "gh",
      "issue",
      "close",
      String(number),
      "-R",
      repoSlug,
      "--comment",
      comment,
    ]);
}
