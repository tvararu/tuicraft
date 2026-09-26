import type { Position } from "wow/entity-store";
import {
  collisionFree,
  GROUND_ERROR,
  type NavPoint,
  withinStep,
} from "wow/navigation";
import { MovementFlag } from "wow/protocol/entity-fields";

export type Ground = {
  findHeight: (
    mapId: number,
    x: number,
    y: number,
    from?: NavPoint,
  ) => number | undefined;
  isPathClear: (mapId: number, from: NavPoint, to: NavPoint) => boolean;
};

const STEP_REFUSALS = [
  "obstructed",
  "height_unresolved",
  "ground_height_unavailable",
  "too_steep",
] as const;

export type StepRefusal = (typeof STEP_REFUSALS)[number];

export function isStepRefusal(reason: string): reason is StepRefusal {
  return STEP_REFUSALS.some((refusal) => refusal === reason);
}

export type Step = { ok: true; z: number } | { ok: false; reason: StepRefusal };

export const MOVING_BITS =
  MovementFlag.FORWARD |
  MovementFlag.BACKWARD |
  MovementFlag.STRAFE_LEFT |
  MovementFlag.STRAFE_RIGHT;

export function unsupportedReason(flags: number): string | undefined {
  if (flags & MovementFlag.ON_TRANSPORT) return "transport";
  if (flags & MovementFlag.FLYING || flags & MovementFlag.CAN_FLY)
    return "flying";
  if (flags & MovementFlag.FALLING) return "falling";
  if (flags & MovementFlag.SWIMMING) return "swimming";
  if (flags & MovementFlag.DISABLE_GRAVITY) return "disable_gravity";
  if (flags & MovementFlag.SPLINE_ENABLED) return "spline";
  return undefined;
}

export function groundStep(
  ground: Ground,
  pose: Position,
  to: { x: number; y: number },
  directed: boolean,
): Step {
  const { x, y } = to;
  const z = finite(ground.findHeight(pose.mapId, x, y, pose));
  if (z === undefined)
    return { ok: false, reason: blockedStep(ground, pose, x, y) };
  if (!withinStep(pose, { x, y, z })) return { ok: false, reason: "too_steep" };
  const reason = directed
    ? directedRefusal(ground, pose, { x, y, z })
    : undefined;
  return reason ? { ok: false, reason } : { ok: true, z };
}

function blockedStep(
  ground: Ground,
  pose: Position,
  x: number,
  y: number,
): StepRefusal {
  const z = finite(ground.findHeight(pose.mapId, pose.x, pose.y, pose));
  if (z === undefined) return "ground_height_unavailable";
  const start = { x: pose.x, y: pose.y, z };
  const ray = (a: NavPoint, b: NavPoint) =>
    ground.isPathClear(pose.mapId, a, b);
  return collisionFree(ray, start, { x, y, z })
    ? "height_unresolved"
    : "obstructed";
}

function directedRefusal(
  ground: Ground,
  pose: Position,
  to: NavPoint,
): StepRefusal | undefined {
  const back = finite(ground.findHeight(pose.mapId, pose.x, pose.y, to));
  if (back === undefined || Math.abs(back - pose.z) > GROUND_ERROR)
    return "height_unresolved";
  const ray = (a: NavPoint, b: NavPoint) =>
    ground.isPathClear(pose.mapId, a, b);
  return collisionFree(ray, pose, to) ? undefined : "obstructed";
}

function finite(value: number | undefined): number | undefined {
  return value !== undefined && Number.isFinite(value) ? value : undefined;
}
