import type { ControlPose, MovementDirection, WalkOutcome } from "#wow/control";
import {
  ControlCore,
  DIR_FLAG,
  type DirectedWalk,
  MAX_DURATION_MS,
} from "#wow/control-core";
import { groundStep, MOVING_BITS } from "#wow/control-motion";
import { normalizeAngle } from "#wow/geometry";
import {
  classifyNavigationRefusal,
  type GroundRoute,
  type NavDestination,
} from "#wow/navigation";
import { GameOpcode } from "#wow/protocol/opcodes";
import { REPLAN_LIMITS, replannable } from "#wow/route-session";

const HEARTBEAT_MS = 500;
const ROUTE_HEARTBEAT_MS = 100;
const STEP_MS = 100;
const STEP_YARDS = 0.5;
const HALT_BLOCKERS = new Set(["obstructed", "height_unresolved", "too_steep"]);

const DIR_START: Record<MovementDirection, number> = {
  forward: GameOpcode.MSG_MOVE_START_FORWARD,
  backward: GameOpcode.MSG_MOVE_START_BACKWARD,
  left: GameOpcode.MSG_MOVE_START_STRAFE_LEFT,
  right: GameOpcode.MSG_MOVE_START_STRAFE_RIGHT,
};

const DIR_HEADING: Record<MovementDirection, number> = {
  forward: 0,
  backward: Math.PI,
  left: Math.PI / 2,
  right: -Math.PI / 2,
};

export class ControlDrive extends ControlCore {
  protected applyFacing(orientation: number): void {
    this.integrate();
    const pose = this.requirePose();
    pose.orientation = normalizeAngle(orientation);
    pose.source = "predicted";
    pose.updatedAt = this.deps.now();
    this.predicted = pose;
    this.sendMove(GameOpcode.MSG_MOVE_SET_FACING);
    this.emit("facing_changed");
  }

  protected startMoving(
    direction: MovementDirection,
    durationMs: number,
  ): void {
    const pose = this.requirePose();
    this.predicted = {
      ...pose,
      source: "predicted",
      updatedAt: this.deps.now(),
    };
    this.direction = direction;
    this.moving = true;
    this.owner = "manual";
    this.blockedReason = undefined;
    this.moveFlags = DIR_FLAG[direction];
    this.lastIntegrate = this.deps.now();
    this.lastHeartbeat = this.deps.ticks();
    this.sendMove(DIR_START[direction]);
    this.armLease(durationMs);
    this.heartbeatTimer = setInterval(
      () => this.heartbeat(),
      this.route || this.walk ? STEP_MS : HEARTBEAT_MS,
    );
    this.emit("movement_started");
    this.emit("control_changed");
  }

  private haltMovement(reason: string, sendStop: boolean): void {
    const blocked = HALT_BLOCKERS.has(reason) ? reason : undefined;
    if (!this.moving && this.owner === "none") {
      if (!blocked) this.blockedReason = undefined;
      return;
    }
    this.endMotion(reason, blocked, sendStop);
  }

  protected stopMoving(reason: string, sendStop: boolean): void {
    this.integrate();
    this.haltMovement(reason, sendStop);
    this.cancelReplan(reason);
  }

  protected abortUnsafe(reason: string): void {
    this.cancelReplan(reason);
    this.endMotion(reason, reason, false);
  }

  private fail(reason: string): void {
    this.abortUnsafe(reason);
    this.sendMove(GameOpcode.MSG_MOVE_STOP);
    this.emit("control_error", reason);
  }

  private endMotion(
    reason: string,
    blocked: string | undefined,
    sendStop: boolean,
  ): void {
    this.clearTimers();
    this.endNavigation(reason);
    const wasMoving = this.moving;
    const ownerChanged = this.owner !== "none";
    this.moving = false;
    this.direction = undefined;
    this.owner = "none";
    this.blockedReason = blocked;
    this.moveFlags &= ~MOVING_BITS;
    this.endWalk(reason);
    if (sendStop && wasMoving) this.sendMove(GameOpcode.MSG_MOVE_STOP);
    if (wasMoving) this.emit("movement_stopped", reason);
    if (ownerChanged) this.emit("control_changed", reason);
  }

  private heartbeat(): void {
    this.integrate();
    if (!this.moving) return;
    if (this.route && this.routeDistance >= this.route.length) {
      this.stopMoving("arrived", true);
      return;
    }
    const now = this.deps.ticks();
    if (
      now - this.lastHeartbeat <
      (this.route ? ROUTE_HEARTBEAT_MS : HEARTBEAT_MS)
    )
      return;
    this.lastHeartbeat = now;
    this.sendMove(GameOpcode.MSG_MOVE_HEARTBEAT);
  }

  protected integrate(): void {
    const predicted = this.predicted;
    if (!(this.moving && predicted && this.direction)) return;
    const now = this.deps.now();
    const dt = (now - this.lastIntegrate) / 1000;
    this.lastIntegrate = now;
    if (dt <= 0) return;
    const speed = this.currentSpeed();
    if (speed === undefined) return;
    if (this.route) {
      this.integrateRoute(this.route, predicted, speed * dt, now);
      return;
    }
    const walk = this.walk;
    if (walk) {
      this.integrateWalk(walk, predicted, speed * dt, now);
      return;
    }
    const heading = predicted.orientation + DIR_HEADING[this.direction];
    const { x, y } = predicted;
    const advance = speed * dt;
    for (let moved = 0; moved < advance; ) {
      moved = Math.min(advance, moved + STEP_YARDS);
      const nextX = x + Math.cos(heading) * moved;
      const nextY = y + Math.sin(heading) * moved;
      if (!this.integrateGroundStep(predicted, nextX, nextY, now)) return;
    }
  }

  protected refuseBlockedStart(direction: MovementDirection): void {
    const pose = this.requirePose();
    const heading = pose.orientation + DIR_HEADING[direction];
    const step = groundStep(
      this.deps,
      pose,
      {
        x: pose.x + Math.cos(heading) * STEP_YARDS,
        y: pose.y + Math.sin(heading) * STEP_YARDS,
      },
      false,
    );
    if (step.ok) return;
    this.blockedReason = step.reason;
    this.emit("control_changed", step.reason);
    throw new Error(step.reason);
  }

  private integrateRoute(
    route: GroundRoute,
    predicted: ControlPose,
    advance: number,
    now: number,
  ): void {
    const distance = Math.min(route.length, this.routeDistance + advance);
    try {
      this.predicted = {
        ...predicted,
        ...route.sample(distance),
        source: "predicted",
        updatedAt: now,
      };
      this.routeDistance = distance;
      this.navigation.remaining = route.length - distance;
    } catch (error) {
      this.sampleFailure = true;
      this.fail(
        error instanceof Error ? error.message : "navigation_sample_failed",
      );
    }
  }

  private integrateWalk(
    walk: DirectedWalk,
    pose: ControlPose,
    advance: number,
    now: number,
  ): void {
    const reach = Math.min(walk.distance, walk.traveled + advance);
    while (walk.traveled < reach) {
      const next = Math.min(reach, walk.traveled + STEP_YARDS);
      if (
        !this.integrateGroundStep(
          pose,
          walk.x + walk.dx * next,
          walk.y + walk.dy * next,
          now,
        )
      )
        return;
      walk.traveled = next;
      walk.lastProgressAt = now;
    }
    if (walk.traveled >= walk.distance) this.haltMovement("arrived", true);
  }

  private integrateGroundStep(
    pose: ControlPose,
    x: number,
    y: number,
    now: number,
  ): boolean {
    const step = groundStep(this.deps, pose, { x, y }, this.walk !== undefined);
    if (!step.ok) {
      if (step.reason === "ground_height_unavailable") this.fail(step.reason);
      else this.haltMovement(step.reason, true);
      return false;
    }
    Object.assign(pose, {
      x,
      y,
      z: step.z,
      source: "predicted",
      updatedAt: now,
    });
    return true;
  }

  protected armLease(durationMs: number): void {
    if (this.leaseTimer !== undefined) clearTimeout(this.leaseTimer);
    this.leaseTimer = setTimeout(() => {
      const walk = this.walk;
      if (walk) {
        this.heartbeat();
        if (this.walk !== walk || !this.moving) return;
        const remaining =
          MAX_DURATION_MS - (this.deps.now() - walk.lastProgressAt);
        if (remaining <= 0) this.stopMoving("lease", true);
        else this.armLease(remaining);
        return;
      }
      if (!this.route) {
        this.stopMoving("lease", true);
        return;
      }
      this.heartbeat();
      if (this.route) this.armLease(this.routeLeaseMs(this.route));
    }, durationMs);
  }

  private routeLeaseMs(route: GroundRoute): number {
    const ms =
      ((route.length - this.routeDistance) / (this.runSpeed ?? Number.NaN)) *
      1000;
    return Math.max(1, Math.min(MAX_DURATION_MS, ms));
  }

  protected endWalk(reason: string): void {
    const walk = this.walk;
    if (!walk) return;
    this.walk = undefined;
    walk.signal?.removeEventListener("abort", walk.abort);
    const outcome: WalkOutcome = {
      status: reason === "arrived" ? "completed" : "stopped",
      traveled: walk.traveled,
      pose: this.requirePose(),
    };
    if (reason !== "arrived") outcome.reason = reason;
    walk.resolve(outcome);
  }

  private endNavigation(reason: string): void {
    if (!this.route) return;
    const session = this.session;
    const replan =
      session !== undefined &&
      reason !== "arrived" &&
      replannable(reason, this.sampleFailure);
    this.sampleFailure = false;
    session?.walked(this.routeDistance, this.deps.now());
    if (replan) session?.interrupted(reason);
    else this.session = undefined;
    this.navigation = {
      ...this.navigation,
      active: false,
      owner: "none",
      blockedReason: reason === "arrived" ? undefined : reason,
      refusal:
        reason === "arrived" ? undefined : classifyNavigationRefusal(reason),
      replan: session?.snapshot(),
    };
    this.route = undefined;
    if (replan)
      this.replanTimer = setTimeout(
        () => this.replanNow(),
        REPLAN_LIMITS.delayMs,
      );
  }

  protected startRoute(
    route: GroundRoute,
    destination: NavDestination,
    target?: bigint,
  ): void {
    if (route.length === 0) {
      this.navigation = {
        active: false,
        destination,
        remaining: 0,
        owner: "none",
        blockedReason: undefined,
        refusal: undefined,
        replan: this.session?.snapshot(),
        target,
      };
      this.session = undefined;
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
      replan: this.session?.snapshot(),
      target,
    };
    this.startMoving(
      "forward",
      Math.min(
        MAX_DURATION_MS,
        (route.length / (this.runSpeed ?? Number.NaN)) * 1000,
      ),
    );
  }

  private replanNow(): void {
    this.replanTimer = undefined;
    const session = this.session;
    const destination = this.navigation.destination;
    if (!(session && destination)) return;
    session.settle(this.deps.now());
    const { x, y, z } = this.requirePose();
    const origin = { x, y, z };
    const limit = this.blockReason() ?? session.limitReached(origin);
    if (limit) {
      this.finishReplan(limit, true);
      return;
    }
    let route: GroundRoute;
    try {
      route = session.replan(origin);
    } catch (error) {
      const raw = error instanceof Error ? error.message : "replan_failed";
      this.finishReplan(`replan_refused: ${raw}`, true);
      return;
    }
    session.planned(route);
    this.emit("control_changed", "replanned");
    this.startRoute(route, destination, this.navigation.target);
  }

  protected cancelReplan(reason: string): void {
    if (this.replanTimer === undefined) return;
    clearTimeout(this.replanTimer);
    this.replanTimer = undefined;
    this.session?.settle(this.deps.now());
    this.finishReplan(reason, false);
  }

  private finishReplan(reason: string, error: boolean): void {
    const session = this.session;
    this.session = undefined;
    this.navigation = {
      ...this.navigation,
      active: false,
      owner: "none",
      blockedReason: reason,
      refusal: classifyNavigationRefusal(reason),
      replan: session?.snapshot(),
    };
    if (error) this.emit("control_error", reason);
  }

  private clearTimers(): void {
    if (this.leaseTimer !== undefined) clearTimeout(this.leaseTimer);
    if (this.heartbeatTimer !== undefined) clearInterval(this.heartbeatTimer);
    this.leaseTimer = undefined;
    this.heartbeatTimer = undefined;
  }
}
