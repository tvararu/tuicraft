import { messageOf } from "lib/errors";
import type { ControlEvent } from "wow/control";
import type { CorpseRun } from "wow/corpse-run";
import { cycleStop as stop, type CycleStop } from "wow/cycle-stop";
import { bearing, distance, normalizeAngle } from "wow/geometry";
import type { Vec3 } from "wow/protocol/packet";
import type { RecoveryReclaim } from "wow/recovery";

const MAX_LEGS = 40;
const LEG_MS = 3000;
const MIN_LEG_MS = 500;
const STOP_MARGIN_MS = 1000;
const STANDOFF_YD = 30;
const PROGRESS_YD = 1;
const OFFSETS = [0, 0.3, -0.3, 0.6, -0.6, 0.9, -0.9, 1.2, -1.2, 1.5, -1.5];

export type Walked = { ok: true; legs: number } | CycleStop;
type Leg = { ok: true; stalled: boolean } | CycleStop;
type Heading = { corpse: Vec3; offset: number; range: number | undefined };

export async function walkToCorpse(
  run: CorpseRun,
  corpse: Vec3,
): Promise<Walked> {
  let stalls = 0;
  for (let legs = 0; ; legs++) {
    const reclaim = run.recovery.snapshot().reclaim;
    if (inRange(reclaim)) return { ok: true, legs };
    if (legs >= MAX_LEGS)
      return stop("corpse_out_of_range", legDetail(reclaim, legs));
    const offset = OFFSETS[stalls];
    if (offset === undefined)
      return stop("corpse_unreachable", legDetail(reclaim, legs));
    const leg = await travelLeg(run, {
      corpse,
      offset,
      range: reclaim.distance,
    });
    if (!leg.ok) return leg;
    stalls = leg.stalled ? stalls + 1 : 0;
  }
}

async function travelLeg(run: CorpseRun, heading: Heading): Promise<Leg> {
  const before = run.control.snapshot().pose;
  if (!before) return stop("corpse_unreachable", { error: "no_pose" });
  const ms = legMs(run, heading.range);
  try {
    run.control.face(
      normalizeAngle(bearing(before, heading.corpse) + heading.offset),
    );
    run.control.move("forward", ms);
  } catch (error) {
    return stop("corpse_unreachable", {
      pose: before,
      error: messageOf(error),
    });
  }
  const stopped = (event: ControlEvent) => event.type === "movement_stopped";
  await run.motion.find(stopped, ms + STOP_MARGIN_MS, run.signal);
  const after = run.control.snapshot().pose;
  const gained = after
    ? distance(before, heading.corpse) - distance(after, heading.corpse)
    : 0;
  return { ok: true, stalled: gained < PROGRESS_YD };
}

function legMs(run: CorpseRun, range: number | undefined): number {
  const { speed } = run.control.snapshot();
  if (range === undefined || speed <= 0) return LEG_MS;
  const ms = ((range - STANDOFF_YD) / speed) * 1000;
  return Math.round(Math.min(LEG_MS, Math.max(MIN_LEG_MS, ms)));
}

function inRange(reclaim: RecoveryReclaim): boolean {
  return (
    reclaim.distance !== undefined && reclaim.reason !== "corpse_out_of_range"
  );
}

export function legDetail(
  reclaim: RecoveryReclaim,
  legs: number,
): Record<string, unknown> {
  return { pose: reclaim.pose, range: reclaim.distance, legs };
}
