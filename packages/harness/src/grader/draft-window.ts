import type { MeasureContext } from "#harness/grader/draft-anchors";
import type { GameLogRow } from "#harness/grader/draft-gamelog";
import { isRecord } from "#harness/grader/exec";
import type { CheckWindow } from "#harness/grader/scenarios";

export type WindowBound = { start: number; end?: number };

const timeOf = (row: GameLogRow): number =>
  typeof row.ts === "number" ? row.ts : 0;

const field = (row: GameLogRow, key: string): unknown =>
  isRecord(row.data) ? row.data[key] : undefined;

export function steerRow(
  rows: readonly GameLogRow[],
  texts: readonly string[],
  index: number | undefined,
): GameLogRow | undefined {
  if (index === undefined) return undefined;
  const wanted = texts[index];
  if (wanted === undefined) return undefined;
  return rows.find(
    (row) => row.event === "human/input" && field(row, "text") === wanted,
  );
}

function anchorRow(
  rows: readonly GameLogRow[],
  anchor: { event: string; data?: Record<string, unknown> } | undefined,
): GameLogRow | undefined {
  if (anchor === undefined) return undefined;
  return rows.find(
    (row) =>
      row.event === anchor.event &&
      Object.entries(anchor.data ?? {}).every(
        ([key, value]) => field(row, key) === value,
      ),
  );
}

export function windowOf(
  rows: readonly GameLogRow[],
  window: CheckWindow,
  context: MeasureContext,
): WindowBound | undefined {
  const anchored = window.steer === undefined && window.after !== undefined;
  const start = anchored
    ? anchorRow(rows, window.after)
    : steerRow(rows, context.steers, window.steer);
  if (start === undefined) return undefined;
  const from = anchored
    ? timeOf(start) + 1
    : timeOf(start) + (window.afterMs ?? 0);
  const endRow = steerRow(rows, context.steers, window.untilSteer);
  let end: number | undefined;
  if (endRow !== undefined) end = timeOf(endRow);
  else if (window.forMs !== undefined) end = from + window.forMs;
  if (end === undefined || end > from) return { end, start: from };
  return { end: from, start: from };
}

export function rowsIn(
  rows: readonly GameLogRow[],
  bound: WindowBound,
  exceptNames: readonly string[] = [],
): GameLogRow[] {
  return rows.filter((row) => {
    const ts = timeOf(row);
    return (
      ts >= bound.start &&
      (bound.end === undefined || ts < bound.end) &&
      !exceptNames.includes(field(row, "name") as string)
    );
  });
}
