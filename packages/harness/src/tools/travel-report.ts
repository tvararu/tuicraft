import { messageOf } from "@peon/core/lib/errors";
import type { TravelAfter, TravelGoalView } from "#harness/contract/details";
import type { ToolResult } from "#harness/contract/result";
import type { OpsCtx, ViewCtx } from "#harness/contract/services";
import type { Compass, UnitView } from "#harness/contract/views";
import { grayLevel } from "#harness/loops/combat-actions-credit";
import type { InterruptCause } from "#harness/ops/danger";
import { type ExploreResult, SIDE_REASONS } from "#harness/ops/explore";
import type { LegResult } from "#harness/ops/travel-leg";
import { structuralAsk, structuralReach } from "#harness/ops/unreached";
import { manaText, poseView, vitalsView } from "#harness/ops/views";
import { result } from "#harness/tools/define";
import { LEVEL_CAP_ABOVE } from "#harness/tools/engage-choose";
import { askHuman, nextCall } from "#harness/tools/next-call";
import {
  arrivedNext,
  ladderNext,
  notTriedText,
  recoveryFor,
  triedText,
} from "#harness/tools/travel-recovery";

export type Goal =
  | { kind: "unit"; guid: bigint; unit: UnitView }
  | { kind: "point"; x: number; y: number; z: number | undefined }
  | { kind: "corpse" }
  | { kind: "explore"; direction: Compass | undefined }
  | { kind: "unstick" }
  | { kind: "hearth" }
  | { kind: "fly"; destination: string }
  | { kind: "ride"; stop: string };

export type Report = ToolResult<TravelAfter>;

const WORD: Record<Compass, string> = {
  E: "east",
  N: "north",
  NE: "northeast",
  NW: "northwest",
  S: "south",
  SE: "southeast",
  SW: "southwest",
  W: "west",
};
const GROUPS: readonly (readonly [string, (unit: UnitView) => boolean])[] = [
  ["hostile", (unit) => unit.attackable && unit.relation === "hostile"],
  ["neutral", (unit) => unit.attackable && unit.relation === "neutral"],
  ["questgiver", (unit) => unit.roles.includes("questgiver")],
  ["vendor", (unit) => unit.roles.some((role) => role.startsWith("vendor"))],
  ["player", (unit) => unit.kind === "player"],
];

const PASSED_SHOWN = 3;
const CLASS_PREFIX = /^(?:wait|pick_destination|unreachable|stop): /;
const NOT_TRIED_THERE = "Not tried: another destination.";
const NO_MAP_DATA =
  "This map has no navigation data, so no travel can work here.";
const DESTINATION_SIDE = [
  "UNKNOWN_PATH",
  "end snapped off",
  "native path omits destination",
  "ambiguous ground column at destination",
  "destination is not on a ground floor",
];
const PLAIN: readonly (readonly [string, string, string])[] = [
  [
    "UNKNOWN_PATH",
    "no_path",
    "no route on the navigation mesh reaches the destination (UNKNOWN_PATH)",
  ],
];

function plainStep(step: string): string {
  return step
    .replace("Inspect navigation.replan and choose", "Choose")
    .replaceAll("goto", "travel");
}

function sentence(text: string): string {
  const trimmed = text.replace(CLASS_PREFIX, "").trim();
  return trimmed.endsWith(".") ? trimmed.slice(0, -1) : trimmed;
}

function coord(n: number): string {
  return String(Math.round(n * 10) / 10);
}

function byNearest(floors: readonly number[], z: number | undefined): number[] {
  if (z === undefined) return [...floors];
  return [...floors].sort((a, b) => Math.abs(a - z) - Math.abs(b - z));
}

function nearestFloor(
  floors: readonly number[],
  z: number | undefined,
): number | undefined {
  return byNearest(floors, z)[0];
}

function unitFloorsReport(
  goal: Extract<Goal, { kind: "unit" }>,
  leg: LegResult,
  after: TravelAfter,
  tried: string,
): Report | undefined {
  const floors = leg.floors ?? [];
  const { x, y, z } = goal.unit;
  const floor = nearestFloor(floors, z);
  if (x === undefined || y === undefined || floor === undefined) return;
  const at = z === undefined ? "" : ` ${z.toFixed(1)}`;
  const height = `${goal.unit.name} floats ${at} over ${floors.length} ground floors`;
  return result("REFUSED", {
    after,
    detail: `the ground at ${goalName(goal)} has ${floors.length} floors: ${floors.map((one) => one.toFixed(1)).join(", ")}, and ${height}. ${tried} ${NOT_TRIED_THERE}`,
    next: nextCall("travel", {
      to: `${coord(x)}, ${coord(y)}, ${floor.toFixed(1)}`,
    }),
    options: floors,
    reason: "ambiguous_floor",
  });
}

export function yd(n: number): string {
  if (n === 0) return "0";
  return n < 10 ? n.toFixed(1) : Math.round(n).toString();
}

export function secs(ms: number): string {
  return (ms / 1000).toFixed(1);
}

export function goalView(goal: Goal): TravelGoalView {
  if (goal.kind === "unit")
    return { kind: "unit", name: goal.unit.name, ref: goal.unit.ref };
  if (goal.kind === "point")
    return { kind: "point", x: goal.x, y: goal.y, z: goal.z };
  if (goal.kind === "explore")
    return { direction: goal.direction, kind: "explore" };
  if (goal.kind === "unstick")
    return { kind: "unstick", refusedGoal: undefined };
  if (goal.kind === "hearth") return { kind: "hearth" };
  if (goal.kind === "fly")
    return { destination: goal.destination, kind: "fly" };
  if (goal.kind === "ride") return { kind: "ride", name: goal.stop };
  return { kind: "corpse" };
}

export function goalName(goal: Goal): string {
  if (goal.kind === "unit") return `${goal.unit.name} (${goal.unit.ref})`;
  if (goal.kind === "point") return `${goal.x}, ${goal.y}`;
  if (goal.kind === "fly") return `fly ${goal.destination}`;
  if (goal.kind === "ride") return `ride ${goal.stop}`;
  return goal.kind;
}

export function youLine(ctx: ViewCtx): string {
  const vitals = vitalsView(ctx);
  const pose = poseView(ctx);
  const mana = manaText(vitals);
  const at = pose ? `, at ${Math.round(pose.x)}, ${Math.round(pose.y)}` : "";
  return `You: HP ${vitals.hp}/${vitals.maxHp}${mana ? `, ${mana}` : ""}${at}.`;
}

function unitBrief(unit: UnitView): string {
  return `${unit.ref} ${unit.name} L${unit.level} ${yd(unit.distance ?? 0)} yd ${unit.compass ?? ""}`.trim();
}

type Found = ExploreResult & { passed?: readonly UnitView[] };

function passedText(passed: readonly UnitView[]): string {
  if (passed.length === 0) return "";
  const shown = passed
    .slice(0, PASSED_SHOWN)
    .map((unit) => `${unit.ref} ${unit.name} L${unit.level}`);
  const more = passed.length > PASSED_SHOWN ? ", ..." : "";
  return ` Passed: ${passed.length} gray or critter ${passed.length === 1 ? "unit" : "units"} (${shown.join(", ")}${more}).`;
}

function seenText(found: Found): string {
  const passed = found.passed ?? [];
  const skip = new Set(passed.map((unit) => unit.guid));
  const fresh = found.newInView.filter((unit) => !skip.has(unit.guid));
  return `${newInViewText(fresh)}${passedText(passed)}`;
}

export function newInViewText(units: readonly UnitView[]): string {
  const sorted = [...units].sort(
    (a, b) => (a.distance ?? 0) - (b.distance ?? 0),
  );
  const parts = GROUPS.flatMap(([label, test]) => {
    const hits = sorted.filter(test);
    const [first] = hits;
    if (!first) return [];
    const one = `1 ${label} (${unitBrief(first)})`;
    return [
      hits.length === 1
        ? one
        : `${hits.length} ${label} (nearest ${unitBrief(first)})`,
    ];
  });
  return parts.length === 0
    ? "Nothing new in view."
    : `New in view: ${parts.join(", ")}.`;
}

function goalPoint(goal: Goal): {
  x: number | undefined;
  y: number | undefined;
} {
  if (goal.kind === "unit") return { x: goal.unit.x, y: goal.unit.y };
  if (goal.kind === "point") return { x: goal.x, y: goal.y };
  return { x: undefined, y: undefined };
}

function otherRefusal(init: {
  ctx: ViewCtx;
  goal: Goal;
  to: string;
  leg: LegResult;
  after: TravelAfter;
  walked: string;
  planner: string;
}): Report {
  const { ctx, goal, to, leg, after, walked, planner } = init;
  const plain = PLAIN.find(([text]) => leg.detail.includes(text));
  const there = DESTINATION_SIDE.some((text) => leg.detail.includes(text));
  const reason = plain?.[1] ?? leg.reason ?? "failed";
  const recovery = recoveryFor(ctx, to, goalLabel(goal));
  const ask = askHuman(
    `I cannot reach ${recovery.name} from here. Is there another way?`,
  );
  const done = there
    ? `${walked} Tried: ${planner}. ${NOT_TRIED_THERE}`
    : `${walked} ${triedText(recovery, planner)} ${notTriedText(recovery)}`;
  return result("FAILED", {
    after,
    body: leg.nextStep ? [plainStep(leg.nextStep)] : [],
    detail: `${plain?.[2] ?? sentence(leg.detail)}. ${done}`,
    next: there
      ? ask
      : ladderNext({ ask, ctx, goal: goalPoint(goal), reason, recovery }),
    reason,
  });
}

function pointFloorsReport(init: {
  ctx: ViewCtx;
  goal: Extract<Goal, { kind: "point" }>;
  leg: LegResult;
  after: TravelAfter;
  tried: string;
}): Report {
  const { ctx, goal, leg, after, tried } = init;
  const floors = leg.floors ?? [];
  const byHeight = byNearest(floors, poseView(ctx)?.z);
  const offer = (leg.floorRetried ? byHeight[1] : undefined) ?? byHeight[0];
  const retried = leg.floorRetried ? ` ${tried}` : "";
  return result("REFUSED", {
    after,
    detail: `the ground at ${goalName(goal)} has ${floors.length} floors: ${floors.map((floor) => floor.toFixed(1)).join(", ")}.${retried}`,
    next: nextCall("travel", {
      to: `${goal.x}, ${goal.y}, ${offer?.toFixed(1) ?? ""}`,
    }),
    options: floors,
    reason: "ambiguous_floor",
  });
}

function earlyRefusal(
  goal: Goal,
  leg: LegResult,
  after: TravelAfter,
  walked: string,
): Report | undefined {
  if (leg.reason === "target_not_observed" && goal.kind === "unit")
    return result("FAILED", {
      after,
      detail: `${goal.unit.name} is no longer in view; it may be dead or despawned.`,
      next: nextCall("look", { name: goal.unit.name, within: 100 }),
      reason: "target_not_observed",
    });
  if (leg.reason === "start_off_mesh")
    return result("FAILED", {
      after,
      detail: `your own position is not on ground the planner knows (start snapped off). ${walked}`,
      next: nextCall("travel", { to: "unstick" }),
      reason: "start_off_mesh",
    });
}

function goalLabel(goal: Goal): string {
  return goal.kind === "unit" ? goal.unit.name : goalName(goal);
}

function refusedReport(init: {
  ctx: ViewCtx;
  goal: Goal;
  to: string;
  leg: LegResult;
  after: TravelAfter;
}): Report {
  const { ctx, goal, to, leg, after } = init;
  const walked = `Walked ${yd(leg.traveledYd)} yd.`;
  const planner = leg.floorRetried
    ? "planner twice (floor retry)"
    : "planner once";
  const tried = `Tried: ${planner}.`;
  const ask = askHuman(
    `I cannot reach ${goalLabel(goal)} from here. Is there another way?`,
  );
  if (leg.reason === "ambiguous_floor" && goal.kind === "point")
    return pointFloorsReport({ after, ctx, goal, leg, tried });
  if (leg.reason === "ambiguous_floor" && goal.kind === "unit") {
    const floors = unitFloorsReport(goal, leg, after, tried);
    if (floors) return floors;
  }
  const early = earlyRefusal(goal, leg, after, walked);
  if (early) return early;
  if (leg.reason === "no_ground")
    return result("FAILED", {
      after,
      detail: `the path finder found no ground on the way (UNKNOWN_HEIGHT). ${walked} ${tried}`,
      next: ask,
      reason: "no_ground",
    });
  if (structuralReach(leg) === "unsupported_map")
    return result("FAILED", {
      after,
      detail: `${sentence(leg.detail)}. ${walked} ${tried} ${NO_MAP_DATA}`,
      next: structuralAsk("unsupported_map", goalLabel(goal)),
      reason: leg.reason ?? "unsupported_map",
    });
  return otherRefusal({ after, ctx, goal, leg, planner, to, walked });
}

export function legReport(init: {
  ctx: OpsCtx;
  to: string;
  goal: Goal;
  leg: LegResult;
  after: TravelAfter;
}): Report {
  const { ctx, to, goal, leg, after } = init;
  if (leg.status === "arrived") {
    const away =
      after.remainingYd === undefined
        ? ""
        : `${yd(after.remainingYd)} yd away `;
    return result("DONE", {
      after,
      detail: `arrived at ${goalName(goal)}: ${away}after ${yd(leg.traveledYd)} yd in ${secs(after.elapsedMs)} s.`,
      next: arrivedNext(ctx, to),
    });
  }
  if (leg.status === "cancelled" || leg.status === "interrupted")
    return result("FAILED", {
      after,
      detail: `${leg.detail}. Walked ${yd(leg.traveledYd)} yd.`,
      next: nextCall("look"),
      reason: "interrupted",
    });
  ctx.rt.travel.lastRefusedGoal = to;
  return refusedReport({ after, ctx, goal, leg, to });
}

function stuckAtStart(found: ExploreResult): string | undefined {
  const reasons = new Set(found.legs.map((leg) => leg.reason));
  const [reason] = reasons;
  if (found.walkedYd > 0 || reasons.size !== 1 || reason === undefined) return;
  return reason;
}

function obstructedReport(found: Found, after: TravelAfter): Report {
  const where = `${yd(found.walkedYd)} yd ${WORD[found.direction]}`;
  const seen = seenText(found);
  const blocked = `explored ${where}; ${found.obstructed === 1 ? "1 leg was" : `${found.obstructed} legs were`} blocked`;
  const stuck = stuckAtStart(found);
  const kind =
    stuck === undefined
      ? undefined
      : structuralReach({ detail: "", reason: stuck });
  if (kind === "unsupported_map")
    return result("PARTLY", {
      after,
      detail: `${blocked}. ${NO_MAP_DATA} ${seen}`,
      next: structuralAsk(kind),
      reason: "obstructed",
    });
  if (stuck !== undefined && !SIDE_REASONS.has(stuck))
    return result("PARTLY", {
      after,
      detail: `${blocked}, each by the same fault where you stand (${stuck}).${found.unstuck === "failed" ? " Moving off this spot also failed." : ""} ${seen}`,
      next:
        found.unstuck === "failed"
          ? askHuman("I am stuck. Can you move me?")
          : nextCall("travel", { to: "unstick" }),
      reason: "obstructed",
    });
  return result("PARTLY", {
    after,
    detail: `${blocked}. ${seen}`,
    next:
      found.untried && found.obstructedHere < 2
        ? nextCall("travel", { to: `explore ${WORD[found.untried]}` })
        : askHuman(
            "Explore is blocked in more than one direction from here. Can you move me or name a way out?",
          ),
    reason: "obstructed",
  });
}

export function exploreReport(
  found: Found,
  after: TravelAfter,
  init: { selfLevel?: number; seeksHostile?: boolean } = {},
): Report {
  const where = `${yd(found.walkedYd)} yd ${WORD[found.direction]}`;
  const seen = seenText(found);
  if (
    init.seeksHostile === true &&
    init.selfLevel !== undefined &&
    found.stoppedBy === "distance"
  ) {
    const gray = grayLevel(init.selfLevel);
    const range = `L${gray + 1}-${init.selfLevel + LEVEL_CAP_ABOVE}`;
    const more = ` Nothing ${range} came into view; only gray units give no XP. ${nextCall("travel", { to: `explore ${WORD[found.direction]}` })} keeps walking the same way.`;
    return result("DONE", {
      after,
      detail: `explored ${where}. ${seen}${more}`,
      next: nextCall("travel", { to: `explore ${WORD[found.direction]}` }),
    });
  }
  if (found.stoppedBy === "obstructed") return obstructedReport(found, after);
  if (found.stoppedBy === "explored")
    return result("DONE", {
      after,
      detail: `explored ${where}; the ground ahead was explored already. ${seen}`,
      next: found.untried
        ? nextCall("travel", { to: `explore ${WORD[found.untried]}` })
        : askHuman(
            "Everything around here is explored. Where should I look next?",
          ),
    });
  return result("DONE", { after, detail: `explored ${where}. ${seen}` });
}

export function stopReport(signal: AbortSignal, after: TravelAfter): Report {
  const code = messageOf(signal.reason, "cancelled");
  if (code === "human_stop" || code === "esc")
    return result("FAILED", {
      after,
      detail: "the human stopped you. Start nothing new.",
      next: "end your turn and wait for the human.",
      reason: "cancelled",
    });
  if (code === "connection_lost")
    return result("FAILED", {
      after,
      detail: "the game connection was lost.",
      next: "ask the human to run /connect.",
      reason: "interrupted",
    });
  return result("FAILED", {
    after,
    detail: `the run was stopped (${code}).`,
    next: nextCall("look"),
    reason: "cancelled",
  });
}

export function interruptReport(
  ctx: ViewCtx,
  cause: InterruptCause,
  after: TravelAfter,
): Report {
  if (cause.code === "died")
    return result("FAILED", {
      after,
      detail: "you died on the way.",
      next: nextCall("recover"),
      reason: "died",
    });
  const ref =
    cause.attacker === undefined
      ? undefined
      : ctx.rt.refs.refOf(cause.attacker);
  return result("FAILED", {
    after,
    detail: `${cause.detail} Walked ${yd(after.traveledYd)} yd.`,
    next: ref ? nextCall("engage", { target: ref }) : nextCall("look"),
    reason: "interrupted",
  });
}
