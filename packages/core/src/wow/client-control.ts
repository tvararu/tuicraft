import type { GotoTarget, WalkTarget, WorldHandle } from "#wow/client";
import type { ControlPose, MovementDirection, WalkOutcome } from "#wow/control";
import { bearing } from "#wow/geometry";
import {
  classifyNavigationRefusal,
  type GroundRoute,
  type NavDestination,
  type Navigation,
  type NavPoint,
  refusalFloors,
} from "#wow/navigation";
import { GROUND_ERROR } from "#wow/navigation-collision";
import { observeNavigation } from "#wow/navigation-observation";
import { queryNearby } from "#wow/nearby";
import type { Runtimes } from "#wow/runtime";
import type { WorldConn } from "#wow/world-conn";

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
    rt.steer();
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
  rt.steer();
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

function planDestination(
  navigation: Navigation,
  pose: ControlPose,
  destination: NavDestination,
): { route: GroundRoute; resolved: NavPoint } {
  const { x, y, z } = destination;
  if (z !== undefined)
    return {
      route: navigation.plan(pose.mapId, pose, { x, y, z }),
      resolved: { x, y, z },
    };
  const route = navigation.planGround(pose.mapId, pose, { x, y });
  const end = route.points.at(-1);
  if (end === undefined) throw new Error("navigation_route_empty");
  return { route, resolved: { x, y, z: end.z } };
}

function planUnitFloor(
  navigation: Navigation,
  pose: ControlPose,
  destination: NavDestination,
  unitZ: number,
): { route: GroundRoute; resolved: NavPoint } {
  try {
    return planDestination(navigation, pose, destination);
  } catch (error) {
    const near = (refusalFloors(error) ?? []).filter(
      (height) => Math.abs(height - unitZ) <= GROUND_ERROR,
    );
    const [picked] = near;
    if (near.length !== 1 || picked === undefined) throw error;
    return planDestination(navigation, pose, { ...destination, z: picked });
  }
}

function pointOf(target: GotoTarget): NavDestination | undefined {
  if (target.kind === "guid") return undefined;
  const { x, y, z } = target;
  if (![x, y, z ?? 0].every(Number.isFinite))
    throw new Error("stop: invalid_destination");
  return z === undefined ? { x, y } : { x, y, z };
}

function navigateTo(rt: Runtimes, target: GotoTarget): void {
  rt.steer(
    rt.control.navigationState().active ? "navigation_replaced" : undefined,
  );
  let destination = pointOf(target);
  const pose = rt.control.snapshot().pose;
  if (!pose) throw new Error("stop: no_pose");
  const navigation = rt.navigation();
  const guid = target.kind === "guid" ? target.guid : undefined;
  try {
    let unitZ: number | undefined;
    if (guid !== undefined) {
      const { x, y, z } = rt.observedTarget(guid);
      destination = { x, y };
      unitZ = z;
    }
    if (destination === undefined) throw new Error("invalid_destination");
    const { route, resolved } =
      unitZ === undefined
        ? planDestination(navigation, pose, destination)
        : planUnitFloor(navigation, pose, destination, unitZ);
    rt.control.navigate(
      route,
      resolved,
      (origin) => navigation.plan(pose.mapId, origin, resolved),
      guid,
    );
  } catch (error) {
    const raw = error instanceof Error ? error.message : "navigation_failed";
    const refusal = classifyNavigationRefusal(raw);
    rt.control.navigationError(destination, raw, {
      refusal,
      target: guid,
      floors: refusalFloors(error),
    });
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
      rt.steer();
      control.face(orientation);
    },
    faceGuid(guid) {
      const target = rt.observedTarget(guid);
      rt.steer();
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
      rt.defense.disarm("halt");
      rt.tactics.stop("halt");
      rt.cycle.stop("halt");
      rt.recovery.clearSpiritHealer("halt");
      rt.halt();
    },
    goTo(target) {
      navigateTo(rt, target);
    },
    getNavigationState() {
      return control.navigationState();
    },
    observeNavigation() {
      return observeNavigation(control.navigationState());
    },
    onControlEvent(cb) {
      return conn.events.control.subscribe(cb);
    },
    getRemotePoses() {
      return conn.remoteMotion.all();
    },
    queryNearby(query) {
      return queryNearby(
        {
          control: control.snapshot(),
          entities: conn.entityStore.all(),
          now: Date.now(),
          observedPosition: (guid) => rt.combat.observedPosition(guid),
          remotePoses: conn.remoteMotion.all(),
        },
        query,
      );
    },
    onRemoteMotionEvent(cb) {
      return conn.events.remoteMotion.subscribe(cb);
    },
  } satisfies Partial<WorldHandle>;
}
