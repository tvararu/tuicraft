import { basename } from "node:path";
import { setItemStatus } from "factory/board";
import type { BoardItem, OpenIssue } from "factory/board-items";
import {
  type BoardStatus,
  board,
  bot,
  mainCheckout,
  repoSlug,
} from "factory/config";
import { must } from "factory/exec";
import { graphql, obj, str } from "factory/gql";
import { strayFix } from "factory/repo-guard";

export type Reason = "dirty" | "unlanded-commits" | "over-cap-dirty";
export type Held = {
  name: string;
  owner: string;
  ageHours: number;
  reason: Reason;
  archive: string | null;
  issue: number | null;
};
export type Draft = {
  item: string;
  id: string;
  title: string;
  body: string;
  status: BoardStatus | null;
};
export type DraftText = { title: string; body: string };
export type DraftUpdate = DraftText & {
  item: string;
  id: string;
  content: boolean;
  status: boolean;
};
export type DraftPlan = {
  create: DraftText[];
  update: DraftUpdate[];
  delete: { item: string; title: string }[];
};

const titlePattern = /^Reaper: (\S+) held \(/;
const issuePattern = /factory\/(\d+)-/;

const createMutation = `mutation($project:ID!,$title:String!,$body:String!){
  created:addProjectV2DraftIssue(input:{projectId:$project,title:$title,body:$body}){projectItem{id}}}`;

const updateMutation = `mutation($id:ID!,$title:String!,$body:String!){
  updateProjectV2DraftIssue(input:{draftIssueId:$id,title:$title,body:$body}){draftIssue{id}}}`;

const deleteMutation = `mutation($project:ID!,$item:ID!){
  deleteProjectV2Item(input:{projectId:$project,itemId:$item}){deletedItemId}}`;

export function heldName(title: string): string | null {
  return title.match(titlePattern)?.[1] ?? null;
}

export function issueOf(branch: string): number | null {
  const match = branch.match(issuePattern);
  return match ? Number(match[1]) : null;
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
    `The reaper will not remove the worktree \`${h.name}\`.`,
    "",
    `- Owner: ${h.owner}`,
    `- Reason: ${h.reason}`,
    `- Archive: ${h.archive ? `\`${h.archive}\`` : "none"}`,
    ...(h.issue === null ? [] : [`- Issue: #${h.issue}`]),
    "",
    `What to do: ${fixFor(h)}`,
    "",
    "The reaper deletes this card on its first pass after the worktree is gone or no longer held.",
  ].join("\n");
}

export const strayName = basename(mainCheckout);

export function strayTitle(): string {
  return `Reaper: ${strayName} held (core-worktree)`;
}

export function strayBody(value: string): string {
  return [
    "The reaper did nothing, because the main repository's shared config sets `core.worktree`.",
    "",
    `- Repository: \`${mainCheckout}\``,
    `- Value: \`${value}\``,
    "",
    "Every git command in the main checkout runs against that tree instead, so the reaper's status, ref and patch-id checks would be wrong, and every factory precheck refuses to start a run. A `git init` or `git worktree` run with `GIT_DIR` or `GIT_WORK_TREE` exported usually causes it.",
    "",
    `What to do: check that tree for work you want, then run \`${strayFix()}\`. The reaper never fixes it itself.`,
    "",
    "The reaper deletes this card on its first pass after the setting is gone.",
  ].join("\n");
}

function updateFor(draft: Draft, text: DraftText): DraftUpdate | null {
  const body = draft.body.replaceAll("\r\n", "\n").trimEnd();
  const content = draft.title !== text.title || body !== text.body;
  const status = draft.status !== "blocked";
  if (!(content || status)) return null;
  return { ...text, content, id: draft.id, item: draft.item, status };
}

function reconcile(
  want: Map<string, DraftText>,
  drafts: Draft[],
  keepOthers: boolean,
): DraftPlan {
  const plan: DraftPlan = { create: [], delete: [], update: [] };
  const matched = new Set<string>();
  for (const draft of drafts) {
    const name = heldName(draft.title);
    if (name === null) continue;
    const text = want.get(name);
    if (text === undefined || matched.has(name)) {
      if (text !== undefined || !keepOthers)
        plan.delete.push({ item: draft.item, title: draft.title });
      continue;
    }
    matched.add(name);
    const update = updateFor(draft, text);
    if (update) plan.update.push(update);
  }
  for (const [name, text] of want)
    if (!matched.has(name)) plan.create.push(text);
  return plan;
}

export function planDrafts(held: Held[], drafts: Draft[]): DraftPlan {
  const want = new Map<string, DraftText>();
  for (const h of held)
    if (!want.has(h.name))
      want.set(h.name, { body: reportBody(h), title: reportTitle(h) });
  return reconcile(want, drafts, false);
}

export function planStray(value: string, drafts: Draft[]): DraftPlan {
  const text = { body: strayBody(value), title: strayTitle() };
  return reconcile(new Map([[strayName, text]]), drafts, true);
}

export function reaperDrafts(items: BoardItem[]): Draft[] {
  return items.flatMap(({ item, status, draft }) =>
    draft && heldName(draft.title) !== null ? [{ ...draft, item, status }] : [],
  );
}

export function legacyReports(issues: OpenIssue[]): number[] {
  return issues
    .filter((i) => i.author === bot && heldName(i.title) !== null)
    .map((i) => i.number);
}

export async function closeReports(numbers: number[]): Promise<void> {
  for (const number of numbers)
    await must([
      "gh",
      "issue",
      "close",
      String(number),
      "-R",
      repoSlug,
      "--comment",
      "Reaper holds are now draft cards on the project board; this issue is no longer used.",
    ]);
}

export async function applyDrafts(plan: DraftPlan): Promise<void> {
  for (const { title, body } of plan.create) {
    const data = await graphql(createMutation, {
      body,
      project: board.project,
      title,
    });
    const item = obj(obj(data["created"])["projectItem"]);
    await setItemStatus(str(item["id"]), "blocked");
  }
  for (const { id, item, title, body, content, status } of plan.update) {
    if (content) await graphql(updateMutation, { body, id, title });
    if (status) await setItemStatus(item, "blocked");
  }
  for (const { item } of plan.delete)
    await graphql(deleteMutation, { item, project: board.project });
}
