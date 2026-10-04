import { messageOf } from "@peon/core/lib/errors";
import {
  isObjectRef,
  objectRows,
  objectUnit,
  reachYd,
  resolveObjectRef,
} from "#harness/areas/objects/reads";
import type { TravelAfter } from "#harness/contract/details";
import type { ToolStatus } from "#harness/contract/result";
import type { RunControl, RunEnd, RunStatus } from "#harness/contract/runs";
import type { OpsCtx, ToolCtx } from "#harness/contract/services";
import { dangerView, watchInterrupts } from "#harness/ops/danger";
import { explore, parseDirection } from "#harness/ops/explore";
import { exploreWanted, passedUnits } from "#harness/ops/explore-wanted";
import { distanceTo } from "#harness/ops/range";
import { aliveWhere, recoverOp } from "#harness/ops/recover";
import { Refusal } from "#harness/ops/refusal";
import { notAtLastKnown, seekLastKnown } from "#harness/ops/remembered";
import { resolveUnit, unitRefusal } from "#harness/ops/resolve";
import { travelLeg } from "#harness/ops/travel-leg";
import {
  MIN_UNSTICK_YD,
  UNSTICK_SAMPLE_YD,
  unstick,
} from "#harness/ops/unstick";
import { poseView, selfView, unitViews } from "#harness/ops/views";
import { awaitRun } from "#harness/runs/wait";
import { defineGameTool, result, UPDATE_EVERY_MS } from "#harness/tools/define";
import type { GameToolSpec } from "#harness/tools/game-tool";
import { askHuman, nextCall } from "#harness/tools/next-call";
import { type TravelArgs, travelParams } from "#harness/tools/params-travel";
import { flyWork } from "#harness/tools/travel-fly";
import {
  COORDS,
  parseYards,
  pointGoal,
  YARDS,
} from "#harness/tools/travel-goal";
import { hearthWork } from "#harness/tools/travel-hearth";
import { mountHint, withMountHint } from "#harness/tools/travel-mount";
import { noteTravel, noteUnstick } from "#harness/tools/travel-recovery";
import {
  exploreReport,
  type Goal,
  goalName,
  goalView,
  interruptReport,
  legReport,
  movedWord,
  type Report,
  secs,
  stopReport,
  yd,
  yieldTravel,
  youLine,
} from "#harness/tools/travel-report";
import { rideStop, rideWork } from "#harness/tools/travel-ride";
import { travelRenderers } from "#harness/ui/renderers/live-run";

type After = (patch: Partial<TravelAfter>) => TravelAfter;
type Work = {
  ops: OpsCtx;
  ctx: ToolCtx<TravelAfter>;
  args: TravelArgs;
  goal: Goal;
  after: After;
  runId: () => string;
  held: { text: string | undefined };
};

const RUN_STATUS: Record<ToolStatus, Exclude<RunStatus, "running">> = {
  DONE: "succeeded",
  FAILED: "failed",
  PARTLY: "partly",
  REFUSED: "failed",
  RUNNING: "succeeded",
  UNCONFIRMED: "failed",
};

function parseExplore(text: string, lower: string): Goal {
  const direction = parseDirection(lower);
  if (lower !== "explore" && !direction)
    throw new Refusal({
      detail: `"${text}" is not a direction.`,
      next: nextCall("travel", { to: "explore north" }),
      reason: "bad_direction",
    });
  return { direction, kind: "explore" };
}

function parseFly(text: string): Goal {
  const destination = text.slice("fly".length).trim();
  if (destination === "")
    throw new Refusal({
      detail: 'fly needs a destination, for example "fly Silvermoon City".',
      next: nextCall("look", { find: "flight_master" }),
      reason: "no_destination",
    });
  return { destination, kind: "fly" };
}

function parseRide(text: string): Goal {
  const stop = rideStop(text);
  if (stop === "")
    throw new Refusal({
      detail: 'ride needs a stop, for example "ride Thunder Bluff".',
      next: nextCall("look"),
      reason: "no_stop",
    });
  return { kind: "ride", stop };
}

function parseGoal(ctx: ToolCtx<TravelAfter>, to: string): Goal {
  const text = to.trim();
  const lower = text.toLowerCase();
  if (lower === "fly" || lower.startsWith("fly ")) return parseFly(text);
  if (lower === "ride" || lower.startsWith("ride ")) return parseRide(text);
  if (lower === "corpse") return { kind: "corpse" };
  if (lower === "unstick") return { kind: "unstick" };
  if (lower === "hearth") return { kind: "hearth" };
  if (lower === "explore" || lower.startsWith("explore "))
    return parseExplore(text, lower);
  const coords = COORDS.exec(text);
  if (coords) return pointGoal(coords);
  const yards = YARDS.exec(text);
  if (yards) return parseYards(ctx, text, yards);
  return unitGoal(ctx, text);
}

function unitGoal(ctx: ToolCtx<TravelAfter>, text: string): Goal {
  if (isObjectRef(text)) {
    const object = resolveObjectRef(ctx, text);
    if (object)
      return { guid: object.guid, kind: "unit", unit: objectUnit(object) };
  }
  const resolved = resolveUnit(ctx, { text });
  if (resolved.kind === "not_seen") {
    const object = resolveObjectRef(ctx, text);
    if (object)
      return { guid: object.guid, kind: "unit", unit: objectUnit(object) };
  }
  if (resolved.kind !== "unit")
    throw unitRefusal({ param: "to", resolved, tool: "travel" });
  return { guid: resolved.guid, kind: "unit", unit: resolved.unit };
}

function reachOf(ctx: OpsCtx, guid: bigint): number | undefined {
  const row = objectRows(ctx).find((known) => known.guid === guid);
  return row ? reachYd(row, ctx) : undefined;
}

function remainingOf(ctx: OpsCtx, goal: Goal): number | undefined {
  if (goal.kind === "unit") return distanceTo(ctx, goal.guid);
  const pose = poseView(ctx);
  return goal.kind === "point" && pose
    ? Math.hypot(pose.x - goal.x, pose.y - goal.y)
    : undefined;
}

type UnitGoal = Extract<Goal, { kind: "unit" }>;

async function legWork(
  work: Work & { goal: Extract<Goal, { kind: "unit" | "point" }> },
  walkedYd = 0,
): Promise<Report> {
  const { ops, args, goal, after } = work;
  const walked = await travelLeg(ops, {
    goal:
      goal.kind === "unit"
        ? { guid: goal.guid, kind: "unit", name: goal.unit.name }
        : {
            kind: "point",
            x: goal.x,
            y: goal.y,
            ...(goal.z === undefined ? {} : { z: goal.z }),
          },
    within:
      args.within ??
      (goal.kind === "unit" ? (reachOf(ops, goal.guid) ?? 3) : 1),
  });
  const leg = { ...walked, traveledYd: walked.traveledYd + walkedYd };
  const view = after({
    floorRetried: leg.floorRetried,
    floors: leg.floors,
    legs: [
      {
        index: 0,
        reason: leg.reason,
        status: leg.status,
        traveledYd: leg.traveledYd,
      },
    ],
    remainingYd: remainingOf(ops, goal),
    traveledYd: leg.traveledYd,
  });
  return legReport({ after: view, ctx: ops, goal, leg, to: args.to });
}

async function rememberedWork(
  work: Work & { goal: UnitGoal },
): Promise<Report> {
  const { ops, args, goal, after } = work;
  const { found, leg } = await seekLastKnown(ops, goal.unit);
  if (found)
    return legWork(
      { ...work, goal: { ...goal, guid: found.guid, unit: found.unit } },
      leg?.traveledYd,
    );
  const view = after({ traveledYd: leg?.traveledYd ?? 0 });
  if (leg && leg.status !== "arrived")
    return legReport({ after: view, ctx: ops, goal, leg, to: args.to });
  const refusal = notAtLastKnown(ops, goal.unit);
  return result("FAILED", {
    after: view,
    detail: refusal.detail,
    next: refusal.next,
    reason: refusal.reason,
  });
}

async function unstickWork(work: Work): Promise<Report> {
  noteUnstick(work.ops);
  try {
    const moved = await unstick(work.ops);
    if (moved.movedYd < MIN_UNSTICK_YD)
      return result("FAILED", {
        after: work.after({ traveledYd: moved.movedYd }),
        detail: `moved ${yd(moved.movedYd)} yd; no way to open ground within ${UNSTICK_SAMPLE_YD} yd planned or walked from here.`,
        next: askHuman("I am stuck. Can you move me?"),
        reason: "stuck",
      });
    return result("DONE", {
      after: work.after({
        goal: { kind: "unstick", refusedGoal: moved.refusedGoal },
        traveledYd: moved.movedYd,
      }),
      detail: `moved ${yd(moved.movedYd)} yd.`,
      next: moved.refusedGoal
        ? nextCall("travel", { to: moved.refusedGoal })
        : nextCall("look"),
    });
  } catch (error) {
    return result("FAILED", {
      after: work.after({}),
      detail: messageOf(error),
      next: askHuman("I am stuck. Can you move me?"),
      reason: "unstick_failed",
    });
  }
}

async function corpseWork(work: Work): Promise<Report> {
  const recovered = await recoverOp(work.ops, "corpse");
  const view = work.after({ legs: [], remainingYd: recovered.corpseYd });
  if (recovered.outcome.ok)
    return result("DONE", {
      after: view,
      detail: `alive again ${aliveWhere(recovered.corpseYd, undefined)} after ${secs(view.elapsedMs)} s. ${youLine(work.ops)}`,
    });
  const healer = recovered.alternatives.some((text) =>
    text.startsWith("spirit healer"),
  );
  return result("FAILED", {
    after: view,
    body: [`Other ways: ${recovered.alternatives.join(". ")}.`],
    detail: `could not get back to your corpse (${recovered.outcome.cause}).`,
    next: healer
      ? nextCall("recover", { how: "spirit_healer" })
      : askHuman("I cannot reach my corpse. What should I do?"),
    reason: recovered.outcome.cause,
  });
}

async function doWork(work: Work): Promise<Report> {
  const { goal } = work;
  if (goal.kind === "unit" && !goal.unit.inView)
    return rememberedWork({ ...work, goal });
  if (goal.kind === "unit" || goal.kind === "point")
    return legWork({ ...work, goal });
  if (goal.kind === "unstick") return unstickWork(work);
  if (goal.kind === "corpse") return corpseWork(work);
  if (goal.kind === "hearth")
    return hearthWork({ ...work.ctx, signal: work.ops.signal }, work.after);
  if (goal.kind === "fly")
    return flyWork({ ...work, destination: goal.destination });
  if (goal.kind === "ride") {
    return rideWork({ ...work, runId: work.runId, stop: goal.stop }, work.held);
  }
  const wanted = exploreWanted(work.ops, work.args.for);
  const found = await explore(work.ops, { direction: goal.direction, wanted });
  return exploreReport(
    { ...found, passed: passedUnits(work.ops, found.newInView, wanted) },
    work.after({
      legs: found.legs,
      newInView: found.newInView,
      traveledYd: found.walkedYd,
    }),
  );
}

function runStatus(
  value: Report,
  stop: string | undefined,
): Exclude<RunStatus, "running"> {
  if (stop === "connection_lost") return "interrupted";
  if (stop !== undefined) return "cancelled";
  if (value.reason === "interrupted" || value.reason === "died")
    return "interrupted";
  return RUN_STATUS[value.status];
}

function runEnd(value: Report, stop?: string): RunEnd<Report> {
  return {
    reason: stop ?? value.reason,
    status: runStatus(value, stop),
    summary: `${value.status} ${value.detail}`,
    value,
  };
}

function afterOf(ops: OpsCtx, goal: Goal): After {
  const startedAt = ops.rt.clock.now();
  const start = poseView(ops);
  const seen = new Set(unitViews(ops).map((unit) => unit.guid));
  const totalYd = remainingOf(ops, goal);
  return (patch) => {
    const pose = poseView(ops);
    return {
      elapsedMs: ops.rt.clock.now() - startedAt,
      floorRetried: false,
      floors: undefined,
      goal: goalView(goal),
      legs: [],
      newInView: unitViews(ops).filter((unit) => !seen.has(unit.guid)),
      pose,
      remainingYd: remainingOf(ops, goal),
      totalYd,
      traveledYd:
        start && pose ? Math.hypot(pose.x - start.x, pose.y - start.y) : 0,
      ...patch,
    };
  };
}

async function launch(init: {
  ctx: ToolCtx<TravelAfter>;
  args: TravelArgs;
  goal: Goal;
  control: RunControl;
  held: { text: string | undefined };
  partial: (after: TravelAfter) => void;
  runId: () => string;
}): Promise<RunEnd<Report>> {
  const { ctx, args, goal, control, held, partial, runId } = init;
  const rules = { death: true, newAttacker: true, rooted: true };
  const watch = watchInterrupts(
    { ...ctx, progress: control.progress, signal: control.signal },
    rules,
  );
  const ops: OpsCtx = {
    ...ctx,
    progress: control.progress,
    signal: AbortSignal.any([control.signal, watch.signal]),
  };
  const base = afterOf(ops, goal);
  const after: After = (patch) =>
    base({ ...(held.text === undefined ? {} : { wait: held.text }), ...patch });
  const tick = setInterval(() => {
    const now = after({});
    if (now.wait === undefined) {
      control.progress(`${yd(now.traveledYd)} yd ${movedWord(goal)}`);
      partial(now);
    } else {
      control.progress(now.wait);
      partial(now);
    }
  }, UPDATE_EVERY_MS);
  try {
    const report = await doWork({ after, args, ctx, goal, held, ops, runId });
    if (control.signal.aborted)
      return runEnd(
        stopReport(control.signal, report.after),
        messageOf(control.signal.reason),
      );
    const cause = watch.cause();
    return runEnd(cause ? interruptReport(ctx, cause, report.after) : report);
  } finally {
    clearInterval(tick);
    watch.dispose();
  }
}

function emptyTravel(): TravelAfter {
  return {
    elapsedMs: 0,
    floorRetried: false,
    floors: undefined,
    goal: { direction: undefined, kind: "explore" },
    legs: [],
    newInView: [],
    pose: undefined,
    remainingYd: undefined,
    totalYd: undefined,
    traveledYd: 0,
  };
}

function refuseUnderAttack(ctx: ToolCtx<TravelAfter>): void {
  const [attacker] = dangerView(ctx).attackers;
  if (!attacker) return;
  throw new Refusal({
    detail: `${attacker.name} ${attacker.ref} is attacking you.`,
    next: nextCall("engage", { target: attacker.ref }),
    reason: "attacked",
  });
}

async function runTravel(
  args: TravelArgs,
  ctx: ToolCtx<TravelAfter>,
): Promise<Report> {
  const goal = parseGoal(ctx, args.to);
  refuseUnderAttack(ctx);
  noteTravel(ctx, args.to);
  const hintPromise =
    goal.kind === "unit" || goal.kind === "point"
      ? mountHint(ctx, goal)
      : Promise.resolve(undefined);
  if (goal.kind === "corpse" && selfView(ctx).life === "alive")
    throw new Refusal({
      detail: "you are alive; there is no corpse to reach.",
      next: nextCall("look"),
      reason: "alive",
    });
  let runId = "";
  let latest = emptyTravel();
  const partial = (after: TravelAfter) => {
    latest = after;
    if (after.wait !== undefined) {
      ctx.update(
        result("RUNNING", {
          after,
          detail: after.wait,
          next: `keep waiting; end your turn and let the run continue. Or ${nextCall("stop", { run: runId })}.`,
          runId,
        }),
      );
      return;
    }
    const detail = `travel to ${goalName(goal)}, ${yd(after.traveledYd)} yd ${movedWord(goal)}.`;
    ctx.update(result("RUNNING", { after, detail, runId }));
  };
  const held: { text: string | undefined } = { text: undefined };
  const run = ctx.rt.runs.start<Report>({
    args,
    kind: "travel",
    launch: (control) =>
      launch({
        args,
        control,
        ctx,
        goal,
        held,
        partial,
        runId: () => runId,
      }),
    toolCallId: ctx.toolCallId,
  });
  runId = run.id;
  const waited = await awaitRun({ rt: ctx.rt, run });
  const hint = await hintPromise.catch(() => undefined);
  if (waited.kind === "ended")
    return withMountHint({ ...waited.end.value, runId }, hint);
  return withMountHint(
    yieldTravel({ ctx, goal, held, latest, runId, waited }),
    hint,
  );
}

export const travelSpec: GameToolSpec<
  typeof travelParams,
  "travel",
  TravelAfter
> = {
  fallback: emptyTravel,
  kind: "run",
  minimalArgs: { to: "explore" },
  name: "travel",
  parameters: travelParams,
  renderers: travelRenderers,
  run: runTravel,
  text: {
    description:
      "Walks to a unit, to your corpse or to a point, or explores in a direction. With to hearth it uses your hearthstone and waits for the teleport home. With to ride <stop> it walks to a boat or zeppelin dock, boards when the transport is docked, rides and gets off at the named stop. With to fly <destination> it walks to a flight master, pays for the flight and waits for the landing. It waits until you arrive or it fails, up to two minutes. Use explore when look does not show a unit that the task needs. Do not use it to fight.",
    guidelines: [
      "Never invent coordinates. If a refusal gives floors, use one as the third number.",
      'If a result says start_off_mesh, call travel with to "unstick". Then try the goal again.',
    ],
    label: "Travel",
  },
};

export const travelTool = defineGameTool(travelSpec);
