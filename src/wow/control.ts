import {
  type Ground,
  groundStep,
  MOVING_BITS,
  unsupportedReason,
} from "wow/control-motion";
import type { Position } from "wow/entity-store";
import { bearing, distance, distance2d, normalizeAngle } from "wow/geometry";
import {
  classifyNavigationRefusal,
  type GroundRoute,
  type NavigationRefusal,
  type NavPoint,
} from "wow/navigation";
import { MovementFlag, UnitFlag } from "wow/protocol/entity-fields";
import {
  buildCanFlyAck,
  buildMoveMessage,
  buildRootAck,
  buildSetActiveMover,
  buildSetSelection,
  buildSpeedAck,
  buildTeleportAck,
  type ClientControl,
  type FallData,
  type ForceSpeed,
  type KnockBack,
  type MoveAck,
  type MovementInfo,
  type SpeedAck,
  type TransportInfo,
} from "wow/protocol/movement";
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

type DirectedWalk = {
  x: number;
  y: number;
  dx: number;
  dy: number;
  distance: number;
  traveled: number;
  lastProgressAt: number;
  signal?: AbortSignal;
  abort: () => void;
  resolve: (outcome: WalkOutcome) => void;
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
  destination: NavPoint | undefined;
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
const MAX_DURATION_MS = 10_000;
const HEARTBEAT_MS = 500;
const ROUTE_HEARTBEAT_MS = 100;
const STEP_MS = 100;
const STEP_YARDS = 0.5;
const HALT_BLOCKERS = new Set(["obstructed", "height_unresolved"]);

const DIR_FLAG: Record<MovementDirection, number> = {
  forward: MovementFlag.FORWARD,
  backward: MovementFlag.BACKWARD,
  left: MovementFlag.STRAFE_LEFT,
  right: MovementFlag.STRAFE_RIGHT,
};

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

const UNIT_BLOCK_FLAGS =
  UnitFlag.DISABLE_MOVE |
  UnitFlag.STUNNED |
  UnitFlag.CONFUSED |
  UnitFlag.FLEEING;

function copyPose(pose: ControlPose | undefined): ControlPose | undefined {
  return pose ? { ...pose } : undefined;
}

export class ControlRuntime {
  private readonly deps: ControlDeps;
  private listener: ((event: ControlEvent) => void) | undefined;
  private predicted: ControlPose | undefined;
  private server: ControlPose | undefined;
  private mapId = 0;
  private runSpeed: number | undefined;
  private runBackSpeed: number | undefined;
  private moveFlags = 0;
  private extraFlags = 0;
  private observedFlags = 0;
  private direction: MovementDirection | undefined;
  private moving = false;
  private owner: "manual" | "none" = "none";
  private mode: ControlMode = "none";
  private route: GroundRoute | undefined;
  private routeDistance = 0;
  private walk: DirectedWalk | undefined;
  private navigation: NavigationState = {
    active: false,
    destination: undefined,
    remaining: undefined,
    owner: "none",
    blockedReason: undefined,
    refusal: undefined,
  };
  private target: bigint | undefined;
  private requestedTarget: bigint | undefined;
  private controlAllowed = true;
  private rooted = false;
  private teleporting = false;
  private unitBlocked = false;
  private blockedReason: string | undefined;
  private leaseTimer: ReturnType<typeof setTimeout> | undefined;
  private heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  private lastIntegrate = 0;
  private lastHeartbeat = 0;
  private fall: FallData | undefined;
  private transport: TransportInfo | undefined;
  private verified = false;
  private loginWaiters: Array<() => void> = [];

  constructor(deps: ControlDeps) {
    this.deps = deps;
  }

  onEvent(cb: ((event: ControlEvent) => void) | undefined): void {
    this.listener = cb;
  }

  snapshot(): ControlState {
    const blockedReason = this.blockReason() ?? this.blockedReason;
    return {
      selfGuid: this.deps.selfGuid(),
      pose: copyPose(this.predicted ?? this.server),
      serverPose: copyPose(this.server),
      target: this.target,
      requestedTarget: this.requestedTarget,
      moving: this.moving,
      direction: this.direction,
      movementAllowed: this.blockReason() === undefined,
      blockedReason,
      speed: this.currentSpeed() ?? 0,
      owner: this.mode === "none" ? this.owner : this.mode,
    };
  }

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
    destination: NavPoint,
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
    const distance = Math.min(yards, separation);
    if (distance === 0)
      return Promise.resolve({ status: "completed", traveled: 0, pose });

    this.applyFacing(bearing(pose, target));
    const { promise, resolve } = Promise.withResolvers<WalkOutcome>();
    const walk: DirectedWalk = {
      x: pose.x,
      y: pose.y,
      dx: dx / separation,
      dy: dy / separation,
      distance,
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

  private applyFacing(orientation: number): void {
    this.integrate();
    const pose = this.requirePose();
    pose.orientation = normalizeAngle(orientation);
    pose.source = "predicted";
    pose.updatedAt = this.deps.now();
    this.predicted = pose;
    this.sendMove(GameOpcode.MSG_MOVE_SET_FACING);
    this.emit("facing_changed");
  }

  selectTarget(guid: bigint): void {
    if (guid < 0n) throw new Error("invalid_guid");
    this.requestedTarget = guid;
    this.deps.send(GameOpcode.CMSG_SET_SELECTION, buildSetSelection(guid));
    this.emit("target_requested");
  }

  halt(): void {
    this.stopMoving("halt", true);
  }

  dispose(): void {
    this.listener = undefined;
    this.mode = "none";
    this.abortUnsafe("close");
  }

  loginVerified(position: Position): void {
    this.mapId = position.mapId;
    this.setServerPose(position);
    this.predicted = undefined;
    this.verified = true;
    const waiters = this.loginWaiters;
    this.loginWaiters = [];
    for (const waiter of waiters) waiter();
    this.deps.send(
      GameOpcode.CMSG_SET_ACTIVE_MOVER,
      buildSetActiveMover(this.deps.selfGuid()),
    );
  }

  waitLogin(timeoutMs = 10_000): Promise<void> {
    if (this.verified) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error("Timed out waiting for opcode 0x236"));
      }, timeoutMs);
      this.loginWaiters.push(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  currentMapId(): number {
    return this.mapId;
  }

  observeSelf(input: {
    position?: Position;
    movementFlags?: number;
    runSpeed?: number;
    runBackSpeed?: number;
    target?: bigint;
    unitFlags?: number;
  }): void {
    if (input.runSpeed !== undefined) this.runSpeed = input.runSpeed;
    if (input.runBackSpeed !== undefined)
      this.runBackSpeed = input.runBackSpeed;
    if (input.unitFlags !== undefined) this.setUnitFlags(input.unitFlags);
    if (input.target !== undefined) this.observeTarget(input.target);
    if (input.movementFlags !== undefined) {
      this.observedFlags = input.movementFlags;
      this.rooted = (input.movementFlags & MovementFlag.ROOT) !== 0;
      if (this.rooted) this.moveFlags |= MovementFlag.ROOT;
      else this.moveFlags &= ~MovementFlag.ROOT;
    }
    if (input.position) {
      const stamped = {
        ...input.position,
        mapId: this.mapId || input.position.mapId,
      };
      this.server = {
        ...stamped,
        source: "server",
        updatedAt: this.deps.now(),
      };
      if (this.moving) {
        this.abortUnsafe("server_correction");
        this.predicted = undefined;
        this.emit("server_correction", "observed");
        return;
      }
      this.predicted = undefined;
    }
    const unsafe = this.blockReason();
    if (this.moving && unsafe) this.abortUnsafe(unsafe);
  }

  observeTarget(target: bigint): void {
    if (this.target === target) return;
    this.target = target;
    this.emit("target_observed");
  }

  teleportAck({ counter, info: dest }: MoveAck): void {
    this.teleporting = false;
    this.abortUnsafe("teleport");
    this.deps.send(
      GameOpcode.MSG_MOVE_TELEPORT_ACK,
      buildTeleportAck(this.deps.selfGuid(), counter, this.deps.ticks()),
    );
    this.applyForcedPose(dest, "teleport");
  }

  nearTeleport(dest: MovementInfo): void {
    this.teleporting = false;
    this.abortUnsafe("near_teleport");
    this.applyForcedPose(dest, "near_teleport");
  }

  handleTransferPending(): void {
    this.teleporting = true;
    this.abortUnsafe("teleport");
    this.emitAllowed("teleporting");
  }

  newWorld(position: Position): void {
    this.teleporting = false;
    this.abortUnsafe("teleport");
    this.mapId = position.mapId;
    this.moveFlags = 0;
    this.observedFlags = 0;
    this.extraFlags = 0;
    this.fall = undefined;
    this.transport = undefined;
    this.rooted = false;
    this.setServerPose(position);
    this.predicted = undefined;
    this.deps.send(GameOpcode.MSG_MOVE_WORLDPORT_ACK);
    this.deps.send(
      GameOpcode.CMSG_SET_ACTIVE_MOVER,
      buildSetActiveMover(this.deps.selfGuid()),
    );
    this.emit("server_correction", "new_world");
  }

  forceRoot(counter: number): void {
    this.rooted = true;
    this.abortUnsafe("root");
    this.moveFlags |= MovementFlag.ROOT;
    this.ackRoot(GameOpcode.CMSG_FORCE_MOVE_ROOT_ACK, counter);
    this.emitAllowed("rooted");
  }

  forceUnroot(counter: number): void {
    this.rooted = false;
    this.moveFlags &= ~MovementFlag.ROOT;
    this.ackRoot(GameOpcode.CMSG_FORCE_MOVE_UNROOT_ACK, counter);
    this.emitAllowed(undefined);
  }

  knockBack({ counter, fall }: KnockBack): void {
    this.abortUnsafe("knockback");
    this.observedFlags |= MovementFlag.FALLING;
    this.moveFlags |= MovementFlag.FALLING;
    this.fall = fall;
    this.ackRoot(GameOpcode.CMSG_MOVE_KNOCK_BACK_ACK, counter);
    this.emit("server_correction", "knockback");
  }

  clientControl({ guid, allow }: ClientControl): void {
    const self = this.deps.selfGuid();
    if (guid !== 0n && guid !== self) {
      this.controlAllowed = false;
      this.abortUnsafe("no_control");
      this.emitAllowed("no_control");
      return;
    }
    this.controlAllowed = allow;
    if (!allow) this.abortUnsafe("no_control");
    this.emitAllowed(allow ? undefined : "no_control");
  }

  forceSpeed(spec: SpeedAck, { counter, speed }: ForceSpeed): void {
    this.integrate();
    if ("field" in spec && spec.field === "runSpeed") this.runSpeed = speed;
    if ("field" in spec && spec.field === "runBackSpeed")
      this.runBackSpeed = speed;
    this.deps.send(spec.ack, buildSpeedAck(this.moveAck(counter), speed));
  }

  setCanFly(counter: number, enable: boolean): void {
    this.abortUnsafe(enable ? "flying" : "unset_can_fly");
    if (enable) {
      this.observedFlags |= MovementFlag.CAN_FLY;
      this.moveFlags |= MovementFlag.CAN_FLY;
    } else {
      this.observedFlags &= ~(MovementFlag.CAN_FLY | MovementFlag.FLYING);
      this.moveFlags &= ~(MovementFlag.CAN_FLY | MovementFlag.FLYING);
    }
    this.deps.send(
      GameOpcode.CMSG_MOVE_SET_CAN_FLY_ACK,
      buildCanFlyAck(this.moveAck(counter), enable),
    );
    this.emitAllowed(enable ? "flying" : undefined);
  }

  private startMoving(direction: MovementDirection, durationMs: number): void {
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

  private stopMoving(reason: string, sendStop: boolean): void {
    this.integrate();
    this.haltMovement(reason, sendStop);
  }

  private abortUnsafe(reason: string): void {
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

  private integrate(): void {
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
    const newX = predicted.x + Math.cos(heading) * speed * dt;
    const newY = predicted.y + Math.sin(heading) * speed * dt;
    this.integrateGroundStep(predicted, newX, newY, now);
  }

  private integrateRoute(
    route: GroundRoute,
    predicted: ControlPose,
    advance: number,
    now: number,
  ): void {
    this.routeDistance = Math.min(route.length, this.routeDistance + advance);
    try {
      this.predicted = {
        ...predicted,
        ...route.sample(this.routeDistance),
        source: "predicted",
        updatedAt: now,
      };
      this.navigation.remaining = route.length - this.routeDistance;
    } catch (error) {
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
    const distance = Math.min(walk.distance, walk.traveled + advance);
    while (walk.traveled < distance) {
      const next = Math.min(distance, walk.traveled + STEP_YARDS);
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

  private armLease(durationMs: number): void {
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

  private endWalk(reason: string): void {
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
    this.navigation = {
      ...this.navigation,
      active: false,
      owner: "none",
      blockedReason: reason === "arrived" ? undefined : reason,
      refusal:
        reason === "arrived" ? undefined : classifyNavigationRefusal(reason),
    };
    this.route = undefined;
  }

  private clearTimers(): void {
    if (this.leaseTimer !== undefined) clearTimeout(this.leaseTimer);
    if (this.heartbeatTimer !== undefined) clearInterval(this.heartbeatTimer);
    this.leaseTimer = undefined;
    this.heartbeatTimer = undefined;
  }

  private sendMove(opcode: number): void {
    this.deps.send(
      opcode,
      buildMoveMessage(this.deps.selfGuid(), this.movementInfo()),
    );
  }

  private movementInfo(): MovementInfo {
    const pose = this.predicted ?? this.server;
    return {
      flags: this.moveFlags,
      extraFlags: this.extraFlags,
      time: this.deps.ticks(),
      x: pose?.x ?? 0,
      y: pose?.y ?? 0,
      z: pose?.z ?? 0,
      orientation: pose?.orientation ?? 0,
      fallTime: 0,
      fall: this.fall,
      transport: this.transport,
    };
  }

  private ackRoot(opcode: number, counter: number): void {
    this.deps.send(opcode, buildRootAck(this.moveAck(counter)));
  }

  private moveAck(counter: number): MoveAck {
    return { guid: this.deps.selfGuid(), counter, info: this.movementInfo() };
  }

  private setServerPose(position: Position): void {
    this.server = { ...position, source: "server", updatedAt: this.deps.now() };
  }

  private applyForcedPose(dest: MovementInfo, reason: string): void {
    this.observedFlags = dest.flags;
    this.extraFlags = dest.extraFlags;
    this.moveFlags = dest.flags & ~MOVING_BITS;
    this.fall = dest.fall;
    this.transport = dest.transport;
    this.rooted = (dest.flags & MovementFlag.ROOT) !== 0;
    this.setServerPose({
      mapId: this.mapId,
      x: dest.x,
      y: dest.y,
      z: dest.z,
      orientation: dest.orientation,
    });
    this.predicted = undefined;
    this.emit("server_correction", reason);
  }

  private setUnitFlags(unitFlags: number): void {
    const blocked = (unitFlags & UNIT_BLOCK_FLAGS) !== 0;
    if (blocked === this.unitBlocked) return;
    this.unitBlocked = blocked;
    if (blocked) this.stopMoving("disable_move", false);
    this.emitAllowed(blocked ? "disable_move" : undefined);
  }

  private guardMove(direction: MovementDirection): void {
    const reason = this.blockReason() ?? unsupportedReason(this.observedFlags);
    if (reason) throw new Error(reason);
    this.requirePose();
    if (this.speedFor(direction) === undefined)
      throw new Error("missing_speed");
  }

  private requirePose(): ControlPose {
    const pose = this.predicted ?? this.server;
    if (!pose) throw new Error("no_pose");
    return { ...pose };
  }

  private currentSpeed(): number | undefined {
    return this.direction ? this.speedFor(this.direction) : this.runSpeed;
  }

  private speedFor(direction: MovementDirection): number | undefined {
    return direction === "backward" ? this.runBackSpeed : this.runSpeed;
  }

  private blockReason(): string | undefined {
    if (this.teleporting) return "teleporting";
    if (this.rooted) return "rooted";
    if (!this.controlAllowed) return "no_control";
    if (this.unitBlocked) return "disable_move";
    return unsupportedReason(this.observedFlags);
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

  private emitAllowed(reason: string | undefined): void {
    this.emit("control_changed", reason);
  }

  private emit(type: ControlEventType, reason?: string): void {
    const event: ControlEvent = { type, state: this.snapshot() };
    if (reason !== undefined) event.reason = reason;
    this.listener?.(event);
  }
}
