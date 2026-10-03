import type { EngageAfter } from "#harness/contract/details";
import type { ToolResult } from "#harness/contract/result";
import type { RunControl } from "#harness/contract/runs";
import type { OpsCtx, ToolCtx, ViewCtx } from "#harness/contract/services";
import type { UnitView } from "#harness/contract/views";
import { grayLevel } from "#harness/loops/combat-actions-credit";
import { MIN_HP_PCT, MIN_MANA_PCT } from "#harness/loops/cycle-gate";
import { dangerView, type InterruptCause } from "#harness/ops/danger";
import { compassWord, explore } from "#harness/ops/explore";
import { critter, exploreWanted } from "#harness/ops/explore-wanted";
import { Refusal } from "#harness/ops/refusal";
import { type Resolved, resolveUnit, unitRefusal } from "#harness/ops/resolve";
import { travelLeg } from "#harness/ops/travel-leg";
import {
  knownUnits,
  manaText,
  selfView,
  unitViews,
  vitalsView,
} from "#harness/ops/views";
import { askHuman, nextCall } from "#harness/tools/next-call";
import type { EngageArgs } from "#harness/tools/params-engage";

export type EngageMode = EngageAfter["mode"];
export type Choice = {
  mode: EngageMode;
  unit: UnitView | undefined;
  guid: bigint | undefined;
  named: boolean;
  questId: number | undefined;
  sources: number[];
  wanted: number;
};

export type FightInit = {
  ops: OpsCtx;
  choice: Choice;
  args: EngageArgs;
  control: RunControl;
  cause: () => InterruptCause | undefined;
  progress: (after: EngageAfter) => void;
};
export type FightRun = (init: FightInit) => Promise<ToolResult<EngageAfter>>;

export const LEVEL_CAP_ABOVE = 3;
export const EXPLORE_TRIES = 3;
const REMEMBERED_WITHIN_YD = 10;
const QUEST_ID = /^#?(\d+)$/;

function unitGuid(ctx: ViewCtx, unit: UnitView): bigint {
  const guid = ctx.rt.refs.guidOf(unit.ref);
  if (guid === undefined) throw new Error(`unknown ref ${unit.ref}`);
  return guid;
}

export function sameArgs(args: EngageArgs): string {
  const init: Record<string, string | number | boolean> = {};
  if (args.target !== undefined) init["target"] = args.target;
  if (args.count !== undefined) init["count"] = args.count;
  if (args.quest !== undefined) init["quest"] = args.quest;
  if (args.how !== undefined) init["how"] = args.how;
  if (args.loot !== undefined) init["loot"] = args.loot;
  return nextCall("engage", init);
}

function questTitles(ctx: ViewCtx): Map<number, string> {
  const titles = new Map<number, string>();
  for (const query of ctx.handle.getQuestState().queries)
    if (query.status === "known") titles.set(query.questId, query.data.title);
  return titles;
}

export function parseQuest(ctx: ViewCtx, text: string): number {
  const inLog = ctx.handle
    .getQuestState()
    .log.slots.flatMap((slot) =>
      slot.questId === undefined || slot.questId === 0 ? [] : [slot.questId],
    );
  const titles = questTitles(ctx);
  const id = QUEST_ID.exec(text.trim())?.[1];
  const wanted = text.trim().toLowerCase();
  const found =
    id === undefined
      ? inLog.find((questId) =>
          titles.get(questId)?.toLowerCase().includes(wanted),
        )
      : inLog.find((questId) => questId === Number(id));
  if (found !== undefined) return found;
  throw new Refusal({
    body: inLog.map(
      (questId) => `#${questId} ${titles.get(questId) ?? "(title not loaded)"}`,
    ),
    detail: `no quest "${text}" in your quest log.`,
    next: nextCall("journal", { about: "quests" }),
    reason: "unknown_quest",
  });
}

function tooStrong(unit: UnitView, level: number): Refusal {
  return new Refusal({
    detail: `${unit.name} ${unit.ref} is L${unit.level}, ${unit.level - level} levels above you. If the human asked for this fight: ${nextCall("engage", { target: unit.ref })}.`,
    reason: "too_strong",
  });
}

function hostiles(ctx: ViewCtx): UnitView[] {
  return unitViews(ctx).filter(
    (unit) =>
      unit.inView &&
      unit.alive &&
      unit.attackable &&
      unit.relation === "hostile" &&
      !unit.tappedByOther,
  );
}

async function findUnnamed(ops: OpsCtx): Promise<UnitView> {
  const { level } = selfView(ops);
  const wanted = exploreWanted(ops, "hostile");
  for (
    let tries = 0;
    tries < EXPLORE_TRIES && !hostiles(ops).some(wanted);
    tries += 1
  )
    await explore(ops, {
      direction: undefined,
      wanted: (unit) => wanted(unit) && unit.relation === "hostile",
    });
  const eligible = hostiles(ops).filter(wanted);
  const fit = eligible.find((unit) => unit.level <= level + LEVEL_CAP_ABOVE);
  if (fit) return fit;
  const [strong] = eligible;
  if (strong) throw tooStrong(strong, level);
  const passed = hostiles(ops)
    .filter((unit) => !critter(unit))
    .map((unit) => `${unit.name} ${unit.ref} L${unit.level}`);
  if (passed.length > 0) {
    const floor = grayLevel(level) + 1;
    throw new Refusal({
      detail: `only gray units in view (${passed.join(", ")}); they give no XP or kill credit. Fight L${floor}-${level + LEVEL_CAP_ABOVE} instead.`,
      next: nextCall("travel", { to: "explore" }),
      reason: "not_seen",
    });
  }
  throw new Refusal({
    detail: `no hostile unit you can attack came into view after ${EXPLORE_TRIES} explore walks.`,
    next: askHuman("Where should I look for enemies?"),
    reason: "not_seen",
  });
}

function tappedByOther(ctx: ViewCtx, unit: UnitView): Refusal {
  const cap = selfView(ctx).level + LEVEL_CAP_ABOVE;
  const others = hostiles(ctx).filter(
    (view) => view.ref !== unit.ref && view.level <= cap,
  );
  const free = others.find((view) => view.name === unit.name) ?? others.at(0);
  return new Refusal({
    detail: `${unit.name} ${unit.ref} is tapped by another player; killing it gives you no loot, experience or quest credit.`,
    next: free ? nextCall("engage", { target: free.ref }) : nextCall("engage"),
    reason: "tapped_by_other",
  });
}

function inView(ops: OpsCtx, text: string): Resolved {
  const resolved = resolveUnit(ops, { alive: true, inView: true, text });
  return resolved.kind === "unit" && !resolved.unit.inView
    ? { kind: "not_seen", text }
    : resolved;
}

function notInView(unit: UnitView): Refusal {
  const where =
    unit.distance === undefined
      ? ""
      : ` ${Math.round(unit.distance)} yd${unit.compass ? ` ${compassWord(unit.compass)}` : ""} of you`;
  return new Refusal({
    detail: `${unit.name} ${unit.ref} is not in view; it was last seen${where}.`,
    next: nextCall("travel", {
      to: unit.compass ? `explore ${compassWord(unit.compass)}` : "explore",
    }),
    reason: "not_in_view",
  });
}

async function seekRemembered(
  ops: OpsCtx,
  text: string,
  unit: UnitView,
): Promise<Resolved> {
  if (unit.x !== undefined && unit.y !== undefined && unit.z !== undefined)
    await travelLeg(ops, {
      goal: { kind: "point", x: unit.x, y: unit.y, z: unit.z },
      within: REMEMBERED_WITHIN_YD,
    });
  const resolved = inView(ops, text);
  if (resolved.kind === "not_seen") {
    const [last] = knownUnits(ops).filter((view) => view.guid === unit.guid);
    throw notInView(last ?? unit);
  }
  return resolved;
}

async function exploreFor(ops: OpsCtx, text: string): Promise<Resolved> {
  const lower = text.toLowerCase();
  let resolved = inView(ops, text);
  for (
    let tries = 0;
    resolved.kind === "not_seen" && tries < EXPLORE_TRIES;
    tries += 1
  ) {
    await explore(ops, {
      direction: undefined,
      wanted: (unit) => unit.name.toLowerCase().includes(lower),
    });
    resolved = inView(ops, text);
  }
  return resolved;
}

async function findNamed(ops: OpsCtx, text: string): Promise<UnitView> {
  let resolved = inView(ops, text);
  if (resolved.kind === "not_seen") {
    const known = resolveUnit(ops, { alive: true, text });
    if (known.kind === "ambiguous")
      throw unitRefusal({ param: "target", resolved: known, tool: "engage" });
    resolved =
      known.kind === "unit"
        ? await seekRemembered(ops, text, known.unit)
        : await exploreFor(ops, text);
  }
  if (resolved.kind !== "unit")
    throw unitRefusal({ param: "target", resolved, tool: "engage" });
  if (resolved.unit.tappedByOther) throw tappedByOther(ops, resolved.unit);
  return resolved.unit;
}

function checkRelation(unit: UnitView): void {
  if (unit.relation === "friendly")
    throw new Refusal({
      detail: `${unit.name} ${unit.ref} is friendly.`,
      next: nextCall("look", { find: "hostile" }),
      reason: "friendly",
    });
}

function modeOf(questId: number | undefined, count: number): EngageMode {
  if (questId !== undefined) return "quest";
  return count > 1 ? "cycle" : "single";
}

export async function chooseTarget(
  ops: OpsCtx,
  args: EngageArgs,
): Promise<Choice> {
  const questId =
    args.quest === undefined ? undefined : parseQuest(ops, args.quest);
  if (questId !== undefined && args.target === undefined)
    return {
      guid: undefined,
      mode: "quest",
      named: false,
      questId,
      sources: [],
      unit: undefined,
      wanted: args.count ?? 0,
    };
  const [attacker] = dangerView(ops).attackers;
  const attacking = attacker
    ? unitViews(ops).find((view) => view.ref === attacker.ref)
    : undefined;
  const unit =
    args.target === undefined
      ? (attacking ?? (await findUnnamed(ops)))
      : await findNamed(ops, args.target);
  checkRelation(unit);
  const count = args.count ?? 1;
  return {
    guid: unitGuid(ops, unit),
    mode: modeOf(questId, count),
    named: args.target !== undefined,
    questId,
    sources: questId === undefined ? [] : [unit.entry],
    unit,
    wanted: questId === undefined ? count : (args.count ?? 0),
  };
}

export function guardPull(ctx: ToolCtx<EngageAfter>, args: EngageArgs): void {
  const self = selfView(ctx);
  if (self.life !== "alive")
    throw new Refusal({
      detail: "you are dead.",
      next: nextCall("recover"),
      reason: "dead",
    });
  const [attacker] = dangerView(ctx).attackers;
  const target = args.target?.toLowerCase();
  const defending =
    attacker !== undefined &&
    (target === undefined ||
      attacker.ref === target ||
      attacker.name.toLowerCase().includes(target));
  if (attacker && !defending)
    throw new Refusal({
      detail: `${attacker.name} ${attacker.ref} is attacking you; fight it first.`,
      next: nextCall("engage", { target: attacker.ref }),
      reason: "other_attacker",
    });
  if (defending) return;
  const vitals = vitalsView(ctx);
  const rest = `${nextCall("rest")}, then ${sameArgs(args)}`;
  if (vitals.maxHp > 0 && (vitals.hp / vitals.maxHp) * 100 < MIN_HP_PCT)
    throw new Refusal({
      detail: `you are at ${Math.round((vitals.hp / vitals.maxHp) * 100)}% HP; pull at ${MIN_HP_PCT}% or more.`,
      next: rest,
      reason: "low_health",
    });
  if (
    vitals.powerKind === "mana" &&
    vitals.maxPower > 0 &&
    (vitals.power / vitals.maxPower) * 100 < MIN_MANA_PCT
  )
    throw new Refusal({
      detail: `you have ${manaText(vitals)}; pull at ${MIN_MANA_PCT}% or more.`,
      next: rest,
      reason: "low_mana",
    });
}

export function checkHelper(ctx: ToolCtx<EngageAfter>): void {
  const jev = (() => {
    try {
      return ctx.handle.capabilities().jev;
    } catch {
      return true;
    }
  })();
  if (!jev)
    throw new Refusal({
      detail: "TYPESAFE_API_KEY is not set.",
      next: "ask the human to set it.",
      reason: "no_combat_helper",
    });
}
