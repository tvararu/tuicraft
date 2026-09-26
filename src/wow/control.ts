import { DIR_FLAG, type DirectedWalk, MAX_DURATION_MS } from "wow/control-core";
import type { Ground } from "wow/control-motion";
import { ControlSync } from "wow/control-sync";
import type { Position } from "wow/entity-store";
import { bearing, distance, distance2d } from "wow/geometry";
import {
  classifyNavigationRefusal,
  type GroundRoute,
  type NavDestination,
  type NavigationRefusal,
  type NavPoint,
} from "wow/navigation";
import { buildSetSelection } from "wow/protocol/movement";
import { GameOpcode } from "wow/protocol/opcodes";

export type MovementDirection = "forward" | "backward" | "left" | "right";

export type ControlPose = Position & {
  source: "server" | "predicted";
  updatedAt: number;
};

export type WalkOutcome = {
  status: "completed" | "stopped";
  traveled: number;
  pose: ControlPose;
  reason?: string;
};

export type ControlMode = "none" | "jev";
export type ControlOwner = ControlMode | "manual";

export type ControlState = {
  selfGuid: bigint;
  pose: ControlPose | undefined;
  serverPose: ControlPose | undefined;
  target: bigint | undefined;
  requestedTarget: bigint | undefined;
  moving: boolean;
  direction: MovementDirection | undefined;
  movementAllowed: boolean;
  blockedReason: string | undefined;
  speed: number;
  owner: ControlOwner;
};

export type NavigationState = {
  active: boolean;
  destination: NavDestination | undefined;
  remaining: number | undefined;
  owner: ControlOwner;
  blockedReason: string | undefined;
  refusal: NavigationRefusal | undefined;
};

export type ControlEventType =
  | "movement_started"
  | "movement_stopped"
  | "facing_changed"
  | "target_requested"
  | "target_observed"
  | "server_correction"
  | "control_changed"
  | "control_error";

export type ControlEvent = {
  type: ControlEventType;
  state: ControlState;
  reason?: string;
};

export type ControlSend = (opcode: number, body?: Uint8Array) => void;

export type ControlDeps = Ground & {
  send: ControlSend;
  ticks: () => number;
  now: () => number;
  selfGuid: () => bigint;
};

const MIN_DURATION_MS = 1;

export class ControlRuntime extends ControlSync {
  setMode(mode: ControlMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    this.stopMoving("mode_changed", true);
    this.emit("control_changed", "mode_changed");
  }

  navigationState(): NavigationState {
    return {
      ...this.navigation,
      destination: this.navigation.destination
        ? { ...this.navigation.destination }
        : undefined,
    };
  }

  navigationError(
    destination: NavDestination,
    reason: string,
    refusal?: NavigationRefusal,
  ): void {
    this.abortUnsafe(reason);
    this.navigation = {
      active: false,
      destination: { ...destination },
      remaining: undefined,
      owner: "none",
      blockedReason: reason,
      refusal: refusal ?? classifyNavigationRefusal(reason),
    };
    this.emit("control_error", reason);
  }

  navigate(route: GroundRoute, destination: NavPoint): void {
    this.guardMove("forward");
    this.stopMoving("navigation_replaced", true);
    const origin = route.points[0];
    const pose = this.requirePose();
    if (origin === undefined) throw new Error("navigation_route_empty");
    if (distance(origin, pose) > 1e-6)
      throw new Error("navigation_origin_changed");
    if (route.length === 0) {
      this.navigation = {
        active: false,
        destination,
        remaining: 0,
        owner: "none",
        blockedReason: undefined,
        refusal: undefined,
      };
      return;
    }
    this.applyFacing(route.sample(0).orientation);
    this.route = route;
    this.routeDistance = 0;
    this.navigation = {
      active: true,
      destination: { ...destination },
      remaining: route.length,
      owner: this.mode === "none" ? "manual" : this.mode,
      blockedReason: undefined,
      refusal: undefined,
    };
    this.startMoving(
      "forward",
      Math.min(
        MAX_DURATION_MS,
        (route.length / (this.runSpeed ?? Number.NaN)) * 1000,
      ),
    );
  }

  walkActive(): boolean {
    return this.walk !== undefined;
  }

  walkToward(
    target: NavPoint,
    yards: number,
    signal?: AbortSignal,
  ): Promise<WalkOutcome> {
    const { x: targetX, y: targetY } = target;
    this.assertWalkable(target, yards);
    this.guardMove("forward");
    if (signal?.aborted)
      return Promise.resolve({
        status: "stopped",
        traveled: 0,
        pose: this.requirePose(),
        reason: "abort",
      });

    this.setMode("none");
    this.stopMoving("walk_replaced", true);
    const pose = this.requirePose();
    const dx = targetX - pose.x;
    const dy = targetY - pose.y;
    const separation = distance2d(pose, target);
    const walkDistance = Math.min(yards, separation);
    if (walkDistance === 0)
      return Promise.resolve({ status: "completed", traveled: 0, pose });

    this.applyFacing(bearing(pose, target));
    const { promise, resolve } = Promise.withResolvers<WalkOutcome>();
    const walk: DirectedWalk = {
      x: pose.x,
      y: pose.y,
      dx: dx / separation,
      dy: dy / separation,
      distance: walkDistance,
      traveled: 0,
      lastProgressAt: this.deps.now(),
      signal,
      abort: () => {
        if (this.walk !== walk) return;
        if (this.moving) this.stopMoving("abort", true);
        else this.endWalk("abort");
      },
      resolve,
    };
    this.walk = walk;
    signal?.addEventListener("abort", walk.abort, { once: true });
    this.startMoving("forward", MAX_DURATION_MS);
    return promise;
  }

  private assertWalkable(target: NavPoint, yards: number): void {
    if (
      !(
        Number.isFinite(target.x) &&
        Number.isFinite(target.y) &&
        Number.isFinite(target.z)
      )
    )
      throw new Error("invalid_destination");
    if (!Number.isFinite(yards) || yards <= 0 || yards > 20)
      throw new Error("invalid_distance");
    const speed = this.speedFor("forward");
    if (speed === undefined || !Number.isFinite(speed) || speed <= 0)
      throw new Error("missing_speed");
  }

  move(direction: MovementDirection, durationMs: number): void {
    this.assertDirection(direction);
    this.assertDuration(durationMs);
    if (this.walk) this.stopMoving("manual_move", true);
    if (this.route) this.stopMoving("manual_move", true);
    if (this.moving && this.direction === direction) {
      this.guardMove(direction);
      this.armLease(durationMs);
      return;
    }
    this.guardMove(direction);
    if (this.moving) this.stopMoving("direction_change", true);
    this.startMoving(direction, durationMs);
  }

  face(orientation: number): void {
    if (!Number.isFinite(orientation)) throw new Error("invalid_orientation");
    const reason = this.blockReason();
    if (reason) throw new Error(reason);
    if (this.walk) this.stopMoving("face", true);
    this.applyFacing(orientation);
  }

  selectTarget(guid: bigint): void {
    if (guid < 0n) throw new Error("invalid_guid");
    this.requestedTarget = guid;
    this.deps.send(GameOpcode.CMSG_SET_SELECTION, buildSetSelection(guid));
    this.emit("target_requested");
  }

  halt(reason = "halt"): void {
    this.stopMoving(reason, true);
  }

  dispose(): void {
    this.events.clear();
    this.mode = "none";
    this.abortUnsafe("close");
  }

  private assertDuration(durationMs: number): void {
    if (
      !Number.isFinite(durationMs) ||
      durationMs < MIN_DURATION_MS ||
      durationMs > MAX_DURATION_MS
    ) {
      throw new Error("invalid_duration");
    }
  }

  private assertDirection(direction: MovementDirection): void {
    if (!(direction in DIR_FLAG)) throw new Error("invalid_direction");
  }
}
