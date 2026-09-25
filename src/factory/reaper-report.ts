import { bot, labels, repoSlug } from "factory/config";
import { json, must } from "factory/exec";

export type Reason = "dirty" | "unlanded-commits" | "over-cap-dirty";
export type Held = {
  name: string;
  owner: string;
  ageHours: number;
  reason: Reason;
  archive: string | null;
};
export type ReportIssue = { number: number; body: string; labels: string[] };
export type ReportInput = {
  held: Held[];
  issue: ReportIssue | null;
  lastCommentDay: string | null;
  today: string;
};
export type ReportPlan = {
  body: string;
  edit: boolean;
  create: boolean;
  comment: string | null;
  label: "add" | "remove" | null;
};

export const reportTitle = "Factory: reaper report";
const heldRow = /^\| `([^`]+)` \|/gm;

export function heldNames(body: string): string[] {
  return [...body.matchAll(heldRow)].map((m) => m[1] ?? "");
}

export function reportBody(held: Held[]): string {
  if (held.length === 0)
    return "Nothing held. The reaper removes this label when the list is empty.\n";
  const rows = held.map(
    (h) =>
      `| \`${h.name}\` | ${h.owner} | ${h.ageHours} | ${h.reason} | ${h.archive ?? "-"} |`,
  );
  return `Worktrees the reaper will not remove.\n\n| Worktree | Owner | Age (h) | Reason | Archive |\n|---|---|---|---|---|\n${rows.join("\n")}\n`;
}

export function planReport({
  held,
  issue,
  lastCommentDay,
  today,
}: ReportInput): ReportPlan | null {
  if (!issue && held.length === 0) return null;
  const body = reportBody(held);
  if (!issue)
    return { body, comment: null, create: true, edit: false, label: null };
  const fresh = held.filter((h) => !heldNames(issue.body).includes(h.name));
  const daily = held.length > 0 && lastCommentDay !== today;
  const flagged = issue.labels.includes(labels.pm);
  const want = held.length > 0;
  let label: ReportPlan["label"] = null;
  if (want !== flagged) label = want ? "add" : "remove";
  return {
    body,
    comment: fresh.length > 0 || daily ? commentFor(held, fresh) : null,
    create: false,
    edit: body !== issue.body,
    label,
  };
}

function commentFor(held: Held[], fresh: Held[]): string {
  if (fresh.length === 0)
    return `Daily summary: ${held.length} worktree(s) held. See the table above.`;
  return `New held worktree(s): ${fresh.map((h) => `\`${h.name}\` (${h.reason})`).join(", ")}.`;
}
async function findIssue(): Promise<ReportIssue | null> {
  const cmd = [
    "gh",
    "issue",
    "list",
    "-R",
    repoSlug,
    "--author",
    bot,
    "--state",
    "open",
    "--search",
    `"${reportTitle}" in:title`,
  ];
  const list = await json<
    {
      number: number;
      title: string;
      body: string;
      labels: { name: string }[];
    }[]
  >([...cmd, "--json", "number,title,body,labels"]);
  const found = list.find((i) => i.title === reportTitle);
  return found
    ? {
        body: found.body,
        labels: found.labels.map((l) => l.name),
        number: found.number,
      }
    : null;
}

async function fetchLastCommentDay(
  issue: ReportIssue | null,
): Promise<string | null> {
  if (!issue) return null;
  const view = await json<{
    comments: { author: { login: string }; createdAt: string }[];
  }>([
    "gh",
    "issue",
    "view",
    String(issue.number),
    "-R",
    repoSlug,
    "--json",
    "comments",
  ]);
  const mine = view.comments.filter((c) => c.author.login === bot);
  return mine.at(-1)?.createdAt.slice(0, 10) ?? null;
}

export async function report(held: Held[]): Promise<void> {
  const issue = await findIssue();
  const plan = planReport({
    held,
    issue,
    lastCommentDay: await fetchLastCommentDay(issue),
    today: new Date().toISOString().slice(0, 10),
  });
  if (!plan) return;
  if (plan.create)
    return void (await must([
      "gh",
      "issue",
      "create",
      "-R",
      repoSlug,
      "--title",
      reportTitle,
      "--body",
      plan.body,
      "--label",
      labels.pm,
    ]));
  const edit = ["gh", "issue", "edit", String(issue?.number), "-R", repoSlug];
  if (plan.edit) await must([...edit, "--body", plan.body]);
  if (plan.label)
    await must([
      ...edit,
      plan.label === "add" ? "--add-label" : "--remove-label",
      labels.pm,
    ]);
  if (plan.comment)
    await must([
      "gh",
      "issue",
      "comment",
      String(issue?.number),
      "-R",
      repoSlug,
      "--body",
      plan.comment,
    ]);
}
