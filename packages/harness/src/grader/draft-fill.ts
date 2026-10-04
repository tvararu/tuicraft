import { withoutRemovedConjured } from "#harness/grader/conjured";
import { fillConsole, readConsoleLog } from "#harness/grader/draft-console";
import { observeGameLog, parseGameLog } from "#harness/grader/draft-gamelog";
import { measureGameLog } from "#harness/grader/draft-measure";
import { windowOf } from "#harness/grader/draft-window";
import { parseJsonOutput } from "#harness/grader/exec";
import { readItemFlags } from "#harness/grader/item-flags";
import type { EvalCheck } from "#harness/grader/result";
import type {
  CheckEvidence,
  ScenarioCheck,
  TruthDelta,
  TruthPick,
  TruthWho,
} from "#harness/grader/scenarios";
import type { Truth, TruthItem } from "#harness/grader/truth";
import { totalXp } from "#harness/grader/xp-table";

export type TruthSummary = Pick<
  Truth,
  | "alive"
  | "deathState"
  | "level"
  | "money"
  | "position"
  | "rewardedQuests"
  | "xp"
> & {
  items: Record<string, number>;
  quests: { quest: number; status: number }[];
};

export function truthSummary(truth: Truth): TruthSummary {
  const items: Record<string, number> = {};
  for (const { item, count } of truth.inventory)
    items[item] = (items[item] ?? 0) + count;
  return {
    alive: truth.alive,
    deathState: truth.deathState,
    items,
    level: truth.level,
    money: truth.money,
    position: truth.position,
    quests: truth.quests.map(({ quest, status }) => ({ quest, status })),
    rewardedQuests: truth.rewardedQuests,
    xp: truth.xp,
  };
}

type Pair = { baseline: Truth | null; final: Truth | null };
type Picked = Record<string, unknown>;
type Picker = (truth: Truth, worn: boolean) => Picked;

const CHARACTER_BAG = 255;
const BANK_BAG = -1;
const EQUIPMENT_SLOTS = { first: 0, last: 18 };
const BANK_SLOTS = { first: 39, last: 73 };

const inSlots = (slot: number, { first, last }: typeof BANK_SLOTS) =>
  slot >= first && slot <= last;

const ROW_PICKS: readonly TruthPick[] = ["bank", "equipment", "inventory"];

const rowsOf = (rows: readonly TruthItem[], worn: boolean) =>
  rows.map(({ bag, count, durability, item, maxDurability, name, slot }) => ({
    bag,
    count,
    item,
    name,
    slot,
    ...(worn ? { durability, maxDurability } : {}),
  }));

const byKey = <T>(rows: readonly T[] | undefined, key: (row: T) => number) =>
  rows?.toSorted((a, b) => key(a) - key(b)) ?? null;

const PICKS: Readonly<Record<TruthPick, Picker>> = {
  alive: ({ alive, deathState }) => ({ alive, deathState }),
  bank: ({ inventory }, worn) => ({
    bank: rowsOf(
      inventory.filter(
        ({ bag, slot }) =>
          bag === BANK_BAG ||
          (bag === CHARACTER_BAG && inSlots(slot, BANK_SLOTS)),
      ),
      worn,
    ),
  }),
  durability: ({ inventory }) => ({
    durability: rowsOf(
      inventory.filter(({ maxDurability = 0 }) => maxDurability > 0),
      true,
    ),
  }),
  equipment: ({ inventory }, worn) => ({
    equipment: rowsOf(
      inventory.filter(
        ({ bag, slot }) =>
          bag === CHARACTER_BAG && inSlots(slot, EQUIPMENT_SLOTS),
      ),
      worn,
    ),
  }),
  hearth: ({ hearth }) => ({ hearth: hearth ?? null }),
  inventory: ({ inventory }, worn) => ({ inventory: rowsOf(inventory, worn) }),
  level: ({ level }) => ({ level }),
  mail: ({ mail }) => ({ mail: byKey(mail, ({ id }) => id) }),
  money: ({ money }) => ({ money }),
  quests: ({ quests, rewardedQuests }) => ({
    quests: quests.map(({ quest, status }) => ({ quest, status })),
    rewardedQuests,
  }),
  reputation: ({ reputation }) => ({
    reputation: byKey(reputation, ({ faction }) => faction),
  }),
  spells: ({ spells }) => ({ spells: spells.toSorted((a, b) => a - b) }),
  totalXp: ({ level, xp }) => ({ level, totalXp: totalXp(level, xp), xp }),
};

const pickAll = (
  truth: Truth | null,
  picks: readonly Picker[],
  worn = false,
) =>
  truth === null
    ? null
    : Object.assign({}, ...picks.map((pick) => pick(truth, worn)));

function pickersOf(fields: readonly TruthPick[]) {
  const worn = fields.includes("durability");
  const onRows = worn && fields.some((field) => ROW_PICKS.includes(field));
  const named = onRows
    ? fields.filter((field) => field !== "durability")
    : fields;
  return { picks: named.map((field) => PICKS[field]), worn };
}

function delta(pair: Pair, fields: readonly TruthDelta[]): Picked | undefined {
  const { baseline, final } = pair;
  if (baseline === null || final === null || fields.length === 0)
    return undefined;
  return Object.fromEntries(
    fields.map((field) => [
      field,
      field === "money"
        ? final.money - baseline.money
        : totalXp(final.level, final.xp) - totalXp(baseline.level, baseline.xp),
    ]),
  );
}

type ItemRow = {
  name?: string;
  baseline: number;
  final: number;
  delta: number;
};

function itemDeltas(
  pair: Pair,
  listed: readonly number[],
): Record<string, ItemRow> {
  const count = (truth: Truth | null): Map<number, number> => {
    const counts = new Map<number, number>();
    for (const { item, count: n } of truth?.inventory ?? [])
      counts.set(item, (counts.get(item) ?? 0) + n);
    return counts;
  };
  const names = new Map<number, string>();
  for (const { item, name } of [
    ...(pair.baseline?.inventory ?? []),
    ...(pair.final?.inventory ?? []),
  ])
    names.set(item, name);
  const before = count(pair.baseline);
  const after = count(pair.final);
  const ids = new Set([...before.keys(), ...after.keys(), ...listed]);
  const out: Record<string, ItemRow> = {};
  for (const id of [...ids].toSorted((a, b) => a - b)) {
    const baseline = before.get(id) ?? 0;
    const final = after.get(id) ?? 0;
    if (baseline === final && !listed.includes(id)) continue;
    out[id] = { baseline, delta: final - baseline, final, name: names.get(id) };
  }
  return out;
}

function positionObserved(pair: Pair, point: { x: number; y: number }): Picked {
  const position = pair.final?.position;
  return {
    distance2d:
      position === undefined
        ? null
        : Math.round(
            Math.hypot(position.x - point.x, position.y - point.y) * 10,
          ) / 10,
    final: position === undefined ? null : { position },
    point,
  };
}

export function observeTruth(
  recorded: Pair,
  evidence: CheckEvidence = {},
  itemFlags: Readonly<Record<string, number>> = {},
): unknown {
  const pair = withoutRemovedConjured(recorded, itemFlags);
  if (pair.baseline === null && pair.final === null) return null;
  if (evidence.point !== undefined)
    return positionObserved(pair, evidence.point);
  const items =
    evidence.items === undefined ? undefined : itemDeltas(pair, evidence.items);
  const { picks, worn } = pickersOf(evidence.truth ?? []);
  if (picks.length === 0 && items !== undefined) return { items };
  const all = picks.length === 0 ? [truthSummary as Picker] : picks;
  return {
    baseline: pickAll(pair.baseline, all, worn),
    delta: delta(pair, evidence.delta ?? []),
    final: pickAll(pair.final, all, worn),
    items,
  };
}

async function readTruthFile(file: string): Promise<Truth | null> {
  const handle = Bun.file(file);
  return (await handle.exists()) ? ((await handle.json()) as Truth) : null;
}

const truthFiles = (who: TruthWho) =>
  who === "agent"
    ? ["baseline.json", "final.json"]
    : [`${who}-baseline.json`, `${who}-final.json`];

type WhoTruth = { pair: Pair; reason?: string };

async function readWho(runDir: string, who: TruthWho): Promise<WhoTruth> {
  const [baseline = "", final = ""] = truthFiles(who);
  const pair = {
    baseline: await readTruthFile(`${runDir}/${baseline}`),
    final: await readTruthFile(`${runDir}/${final}`),
  };
  const missing = [
    ...(pair.baseline === null ? [baseline] : []),
    ...(pair.final === null ? [final] : []),
  ];
  if (who === "agent" || missing.length === 0) return { pair };
  const verb = missing.length === 1 ? "is" : "are";
  return { pair, reason: `${missing.join(" and ")} ${verb} missing` };
}

function observeWho(
  { pair, reason }: WhoTruth,
  evidence?: CheckEvidence,
  itemFlags: Readonly<Record<string, number>> = {},
) {
  const observed = observeTruth(pair, evidence, itemFlags);
  return reason === undefined
    ? observed
    : { ...(observed as Picked | null), reason };
}

async function readGameLog(file: string) {
  const handle = Bun.file(file);
  return (await handle.exists()) ? parseGameLog(await handle.text()) : null;
}

async function readJev(file: string): Promise<unknown[] | null> {
  const handle = Bun.file(file);
  if (!(await handle.exists())) return null;
  return (await handle.text())
    .split("\n")
    .flatMap((line) => (line.length === 0 ? [] : [parseJsonOutput(line)]));
}

export async function observedChecks(
  runDir: string,
  checks: readonly ScenarioCheck[],
  steers: readonly string[] = [],
): Promise<EvalCheck[]> {
  const truths = new Map<TruthWho, WhoTruth>();
  for (const { evidence, source } of checks) {
    const who = evidence?.who ?? "agent";
    if (source === "truth" && !truths.has(who))
      truths.set(who, await readWho(runDir, who));
  }
  const flags = await readItemFlags(runDir);
  const rows = await readGameLog(`${runDir}/gamelog.jsonl`);
  const consoleLog = await readConsoleLog(runDir);
  const context = {
    jev: await readJev(`${runDir}/jev.jsonl`),
    steers: [...steers],
  };
  return checks.map((check) => {
    const { blockedBy, evidence, expect, id, source } = check;
    const base = { blockedBy, expected: expect, id, met: false, source };
    if (source === "truth") {
      const truth = truths.get(evidence?.who ?? "agent");
      return {
        ...base,
        observed:
          truth === undefined ? null : observeWho(truth, evidence, flags),
      };
    }
    if (source === "console")
      return { ...base, ...fillConsole(consoleLog, check) };
    return { ...base, ...observedLog(rows, check, context) };
  });
}

type LogContext = Parameters<typeof measureGameLog>[2];

function observedLog(
  rows: ReturnType<typeof parseGameLog> | null,
  check: ScenarioCheck,
  context: LogContext,
): { met: boolean; observed: unknown; ref?: string } {
  if (rows === null || (check.source !== "game_log" && !check.measure))
    return { met: false, observed: null };
  const { line, met, observed } =
    check.measure === undefined
      ? observedRows(rows, check, context)
      : measureGameLog(rows, check.measure, context);
  const filled = { met: met ?? false, observed };
  return line === undefined
    ? filled
    : { ...filled, ref: `gamelog.jsonl:${line}` };
}

function observedRows(
  rows: ReturnType<typeof parseGameLog>,
  check: ScenarioCheck,
  context: LogContext,
): { line?: number; met?: boolean; observed: unknown } {
  const window = check.evidence?.window;
  if (window === undefined) {
    const observed = observeGameLog(rows, check);
    return { line: observed?.match?.line, observed };
  }
  const bound = windowOf(rows, window, context);
  if (bound === undefined) return { observed: null };
  const observed = observeGameLog(rows, check, bound);
  const max = window.max;
  return {
    line: observed?.match?.line,
    met:
      max === undefined || observed === null
        ? undefined
        : observed.count <= max,
    observed,
  };
}
