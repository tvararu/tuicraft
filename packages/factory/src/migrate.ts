import { setItemStatus, setStatus } from "#factory/board";
import type { BoardItem, OpenIssue } from "#factory/board-items";
import { type BoardStatus, repoSlug } from "#factory/config";
import { must } from "#factory/exec";

export const legacyLabels = [
  "ready",
  "agent:working",
  "agent:review",
  "agent:reviewing",
  "agent:rework",
  "agent:merging",
  "agent:landing",
  "needs:pm",
  "qa:found",
  "p1",
];

const reviewLabels = [
  "agent:review",
  "agent:reviewing",
  "agent:merging",
  "agent:landing",
];

export type LegacyIssue = {
  number: number;
  labels: string[];
  card: { item: string; status: BoardStatus | null } | null;
};

export type MigrationStep =
  | { kind: "status"; issue: number; item: string | null; status: BoardStatus }
  | { kind: "unlabel"; issue: number; labels: string[] }
  | { kind: "delete-label"; label: string };

export function statusForLabels(labels: string[]): BoardStatus | null {
  const has = new Set(labels);
  if (has.has("agent:working")) return "in-progress";
  if (has.has("needs:pm") && !has.has("ready")) return "blocked";
  if (reviewLabels.some((l) => has.has(l))) return "in-review";
  if (has.has("agent:rework") || has.has("ready")) return "ready";
  return null;
}

export function planMigration(
  issues: LegacyIssue[],
  repoLabels: string[],
): MigrationStep[] {
  const steps: MigrationStep[] = [];
  for (const { number, labels, card } of issues) {
    const status =
      statusForLabels(labels) ?? (card === null ? "backlog" : null);
    if (status !== null && card?.status !== status)
      steps.push({
        issue: number,
        item: card?.item ?? null,
        kind: "status",
        status,
      });
    const legacy = labels.filter((l) => legacyLabels.includes(l));
    if (legacy.length > 0)
      steps.push({ issue: number, kind: "unlabel", labels: legacy });
  }
  for (const label of legacyLabels)
    if (repoLabels.includes(label)) steps.push({ kind: "delete-label", label });
  return steps;
}

export function labelNames(listed: string): string[] {
  if (listed.trim() === "") return [];
  return (JSON.parse(listed) as { name: string }[]).map(({ name }) => name);
}

function describeStep(step: MigrationStep): string {
  if (step.kind === "status") return `set #${step.issue} to ${step.status}`;
  if (step.kind === "unlabel")
    return `remove ${step.labels.join(",")} from #${step.issue}`;
  return `delete label ${step.label}`;
}

async function applyStep(step: MigrationStep): Promise<void> {
  if (step.kind === "status") {
    if (step.item === null) await setStatus(step.issue, step.status);
    else await setItemStatus(step.item, step.status);
    return;
  }
  if (step.kind === "unlabel") {
    await must([
      ...["gh", "issue", "edit", String(step.issue), "-R", repoSlug],
      ...["--remove-label", step.labels.join(",")],
    ]);
    return;
  }
  await must(["gh", "label", "delete", step.label, "-R", repoSlug, "--yes"]);
}

export async function migrate(
  dryRun: boolean,
  issues: OpenIssue[],
  items: BoardItem[],
): Promise<void> {
  const cards = new Map(
    items.flatMap(({ issue, item, status }) =>
      issue === null ? [] : [[issue, { item, status }] as const],
    ),
  );
  const listed = await must([
    ...["gh", "label", "list", "-R", repoSlug],
    ...["--json", "name", "--limit", "500"],
  ]);
  const steps = planMigration(
    issues.map(({ number, labels }) => ({
      card: cards.get(number) ?? null,
      labels,
      number,
    })),
    labelNames(listed),
  );
  for (const step of steps) {
    console.error(
      `reap: migrate ${dryRun ? "would " : ""}${describeStep(step)}`,
    );
    if (!dryRun) await applyStep(step);
  }
}
