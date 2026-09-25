import type { WalkTarget, WorldConn, WorldHandle } from "wow/client";
import type { ControlPose, MovementDirection, WalkOutcome } from "wow/control";
import { bearing } from "wow/geometry";
import {
  classifyNavigationRefusal,
  type Navigation,
  type NavPoint,
} from "wow/navigation";
import type { Runtimes } from "wow/runtime";

function manualMove(
  rt: Runtimes,
  direction: MovementDirection,
  durationMs: number,
): void {
  const state = rt.control.snapshot();
  if (
    state.owner !== "manual" ||
    !state.moving ||
    state.direction !== direction ||
    rt.control.walkActive() ||
    rt.tactics.snapshot().status !== "idle" ||
    rt.cycle.snapshot().active
  )
    rt.override();
  rt.control.move(direction, durationMs);
}

function groundedPoint(
  navigation: Navigation,
  target: NavPoint,
  pose: ControlPose,
): NavPoint {
  if (![target.x, target.y, target.z].every(Number.isFinite))
    throw new Error("invalid_destination");
  let z: number;
  try {
    z = navigation.height(pose.mapId, target.x, target.y);
  } catch {
    z = navigation.height(pose.mapId, target.x, target.y, pose);
  }
  if (Math.abs(z - target.z) > 0.25)
    throw new Error("destination_not_grounded");
  return { x: target.x, y: target.y, z };
}

function resolveWalkDestination(
  rt: Runtimes,
  target: WalkTarget,
  pose: ControlPose,
): NavPoint {
  const navigation = rt.navigation();
  const destination =
    target.kind === "guid"
      ? rt.observedTarget(target.guid)
      : groundedPoint(navigation, target, pose);
  const ground = navigation.height(pose.mapId, pose.x, pose.y, pose);
  if (Math.abs(ground - pose.z) > 0.25) throw new Error("self_not_grounded");
  return destination;
}

async function walkTowardTarget(
  rt: Runtimes,
  target: WalkTarget,
  yards: number,
  signal: AbortSignal | undefined,
): Promise<WalkOutcome> {
  if (!Number.isFinite(yards) || yards <= 0 || yards > 20)
    throw new Error("invalid_distance");
  const pose = rt.control.snapshot().pose;
  if (!pose) throw new Error("no_pose");
  if (signal?.aborted)
    return { status: "stopped", reason: "abort", traveled: 0, pose };
  let destination: NavPoint;
  try {
    destination = resolveWalkDestination(rt, target, pose);
  } catch (error) {
    const reason =
      error instanceof Error ? error.message : "target_unavailable";
    return { status: "stopped", reason, traveled: 0, pose };
  }
  rt.override();
  try {
    return await rt.control.walkToward(destination, yards, signal);
  } catch (error) {
    const reason =
      error instanceof Error ? error.message : "movement_unavailable";
    return {
      status: "stopped",
      reason,
      traveled: 0,
      pose: rt.control.snapshot().pose ?? pose,
    };
  }
}

function navigateTo(rt: Runtimes, destination: NavPoint): void {
  rt.override();
  const { x, y, z } = destination;
  if (![x, y, z].every(Number.isFinite))
    throw new Error("stop: invalid_destination");
  const pose = rt.control.snapshot().pose;
  if (!pose) throw new Error("stop: no_pose");
  const navigation = rt.navigation();
  try {
    rt.control.navigate(
      navigation.plan(pose.mapId, pose, destination),
      destination,
    );
  } catch (error) {
    const raw = error instanceof Error ? error.message : "navigation_failed";
    const refusal = classifyNavigationRefusal(raw);
    rt.control.navigationError(destination, raw, refusal);
    throw new Error(`${refusal}: ${raw}`, { cause: error });
  }
}

export function controlMethods(conn: WorldConn, rt: Runtimes) {
  const { control } = rt;
  return {
    getControlState() {
      return control.snapshot();
    },
    move(direction, durationMs) {
      manualMove(rt, direction, durationMs);
    },
    face(orientation) {
      rt.override();
      control.face(orientation);
    },
    faceGuid(guid) {
      const target = rt.observedTarget(guid);
      rt.override();
      const pose = control.snapshot().pose;
      if (!pose) throw new Error("no_pose");
      if (pose.x === target.x && pose.y === target.y)
        throw new Error("target_coincident");
      control.face(bearing(pose, target));
    },
    walkToward(target, yards, signal) {
      return walkTowardTarget(rt, target, yards, signal);
    },
    selectTarget(guid) {
      rt.override();
      control.selectTarget(guid);
    },
    halt() {
      rt.tactics.stop("halt");
      rt.cycle.stop("halt");
      rt.halt();
    },
    goTo(x, y, z) {
      navigateTo(rt, { x, y, z });
    },
    getNavigationState() {
      return control.navigationState();
    },
    onControlEvent(cb) {
      conn.onControlEvent = cb;
    },
  } satisfies Partial<WorldHandle>;
}
