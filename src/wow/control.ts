import type { GroundRoute, NavPoint } from "wow/navigation";
import type { Position } from "wow/entity-store";
import { GameOpcode } from "wow/protocol/opcodes";
import { MovementFlag } from "wow/protocol/entity-fields";
import type { PacketReader } from "wow/protocol/packet";
import {
  buildCanFlyAck,
  buildMoveMessage,
  buildRootAck,
  buildSetActiveMover,
  buildSetSelection,
  buildSpeedAck,
  buildTeleportAck,
  parseMovementInfo,
  parseWorldPosition,
  type FallData,
  type MovementInfo,
  type TransportInfo,
} from "wow/protocol/movement";

export type MovementDirection = "forward" | "backward" | "left" | "right";

export type ControlPose = Position & {
  source: "server" | "predicted";
  updatedAt: number;
};

export type ControlMode = "none" | "jev" | "follow";
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

export type ControlDeps = {
  send: ControlSend;
  ticks: () => number;
  now: () => number;
  guidLow: () => number;
  guidHigh: () => number;
  selfGuid: () => bigint;
  findHeight?: (
    mapId: number,
    x: number,
    y: number,
    from?: NavPoint,
  ) => number | undefined;
};

const MIN_DURATION_MS = 1;
const MAX_DURATION_MS = 10000;
const HEARTBEAT_MS = 500;
const TWO_PI = Math.PI * 2;

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

const UNIT_BLOCK_FLAGS = 0x00000004 | 0x00040000 | 0x00400000 | 0x00800000;

const SPEED_ACKS = [
  {
    smsg: GameOpcode.SMSG_FORCE_RUN_SPEED_CHANGE,
    ack: GameOpcode.CMSG_FORCE_RUN_SPEED_CHANGE_ACK,
    extraByte: true,
    field: "runSpeed",
  },
  {
    smsg: GameOpcode.SMSG_FORCE_RUN_BACK_SPEED_CHANGE,
    ack: GameOpcode.CMSG_FORCE_RUN_BACK_SPEED_CHANGE_ACK,
    field: "runBackSpeed",
  },
  {
    smsg: GameOpcode.SMSG_FORCE_SWIM_SPEED_CHANGE,
    ack: GameOpcode.CMSG_FORCE_SWIM_SPEED_CHANGE_ACK,
  },
  {
    smsg: GameOpcode.SMSG_FORCE_WALK_SPEED_CHANGE,
    ack: GameOpcode.CMSG_FORCE_WALK_SPEED_CHANGE_ACK,
  },
  {
    smsg: GameOpcode.SMSG_FORCE_SWIM_BACK_SPEED_CHANGE,
    ack: GameOpcode.CMSG_FORCE_SWIM_BACK_SPEED_CHANGE_ACK,
  },
  {
    smsg: GameOpcode.SMSG_FORCE_TURN_RATE_CHANGE,
    ack: GameOpcode.CMSG_FORCE_TURN_RATE_CHANGE_ACK,
  },
  {
    smsg: GameOpcode.SMSG_FORCE_FLIGHT_SPEED_CHANGE,
    ack: GameOpcode.CMSG_FORCE_FLIGHT_SPEED_CHANGE_ACK,
  },
  {
    smsg: GameOpcode.SMSG_FORCE_FLIGHT_BACK_SPEED_CHANGE,
    ack: GameOpcode.CMSG_FORCE_FLIGHT_BACK_SPEED_CHANGE_ACK,
  },
] as const;

export function speedAckFor(opcode: number) {
  return SPEED_ACKS.find((entry) => entry.smsg === opcode);
}

function copyPose(pose: ControlPose | undefined): ControlPose | undefined {
  return pose ? { ...pose } : undefined;
}

function normalizeFacing(orientation: number): number {
  return ((orientation % TWO_PI) + TWO_PI) % TWO_PI;
}

function unsupportedReason(flags: number): string | undefined {
  if (flags & MovementFlag.ON_TRANSPORT) return "transport";
  if (flags & MovementFlag.FLYING || flags & MovementFlag.CAN_FLY)
    return "flying";
  if (flags & MovementFlag.FALLING) return "falling";
  if (flags & MovementFlag.SWIMMING) return "swimming";
  if (flags & MovementFlag.DISABLE_GRAVITY) return "disable_gravity";
  if (flags & MovementFlag.SPLINE_ENABLED) return "spline";
  return undefined;
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
  private navigation: NavigationState = {
    active: false,
    destination: undefined,
    remaining: undefined,
    owner: "none",
    blockedReason: undefined,
  };
  private target: bigint | undefined;
  private requestedTarget: bigint | undefined;
  private clientControl = true;
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
  private loginVerified = false;
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

  pause(owner: "follow"): void {
    if (this.mode !== owner) throw new Error("control_owner_changed");
    this.stopMoving("follow_pause", true);
  }

  navigationState(): NavigationState {
    return {
      ...this.navigation,
      destination: this.navigation.destination
        ? { ...this.navigation.destination }
        : undefined,
    };
  }

  navigationError(destination: NavPoint, reason: string): void {
    this.abortUnsafe(reason);
    this.navigation = {
      active: false,
      destination: { ...destination },
      remaining: undefined,
      owner: "none",
      blockedReason: reason,
    };
    this.emit("control_error", reason);
  }

  navigate(
    route: GroundRoute,
    destination: NavPoint,
    mode: ControlMode = this.mode === "jev" ? "jev" : "none",
  ): void {
    this.guardMove("forward");
    this.setMode(mode);
    this.stopMoving("navigation_replaced", true);
    const origin = route.points[0]!;
    const pose = this.requirePose();
    if (
      Math.hypot(origin.x - pose.x, origin.y - pose.y, origin.z - pose.z) > 1e-6
    )
      throw new Error("navigation_origin_changed");
    if (route.length === 0) {
      this.navigation = {
        active: false,
        destination,
        remaining: 0,
        owner: "none",
        blockedReason: undefined,
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
    };
    this.startMoving(
      "forward",
      Math.min(MAX_DURATION_MS, (route.length / this.runSpeed!) * 1000),
    );
  }

  move(direction: MovementDirection, durationMs: number): void {
    this.assertDirection(direction);
    this.assertDuration(durationMs);
    if (this.mode === "follow") this.setMode("none");
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
    if (this.mode === "follow") this.setMode("none");
    this.applyFacing(orientation);
  }

  private applyFacing(orientation: number): void {
    this.integrate();
    const pose = this.requirePose();
    pose.orientation = normalizeFacing(orientation);
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
    if (this.mode === "follow") this.setMode("none");
    this.stopMoving("halt", true);
  }

  dispose(): void {
    this.listener = undefined;
    this.mode = "none";
    this.abortUnsafe("close");
  }

  applyLoginVerify(r: PacketReader): void {
    const position = parseWorldPosition(r);
    this.mapId = position.mapId;
    this.setServerPose(position);
    this.predicted = undefined;
    this.loginVerified = true;
    const waiters = this.loginWaiters;
    this.loginWaiters = [];
    for (const waiter of waiters) waiter();
    this.deps.send(
      GameOpcode.CMSG_SET_ACTIVE_MOVER,
      buildSetActiveMover(this.deps.guidLow(), this.deps.guidHigh()),
    );
  }

  waitLogin(timeoutMs = 10_000): Promise<void> {
    if (this.loginVerified) return Promise.resolve();
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

  handleTeleportAck(r: PacketReader): void {
    r.packedGuid();
    const counter = r.uint32LE();
    const dest = parseMovementInfo(r);
    this.teleporting = false;
    this.abortUnsafe("teleport");
    this.deps.send(
      GameOpcode.MSG_MOVE_TELEPORT_ACK,
      buildTeleportAck(
        this.deps.guidLow(),
        this.deps.guidHigh(),
        counter,
        this.deps.ticks(),
      ),
    );
    this.applyForcedPose(dest, "teleport");
  }

  handleTransferPending(): void {
    this.teleporting = true;
    this.abortUnsafe("teleport");
    this.emitAllowed("teleporting");
  }

  handleNewWorld(r: PacketReader): void {
    const position = parseWorldPosition(r);
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
      buildSetActiveMover(this.deps.guidLow(), this.deps.guidHigh()),
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

  handleKnockBack(r: PacketReader): void {
    r.packedGuid();
    const counter = r.uint32LE();
    const vCos = r.floatLE();
    const vSin = r.floatLE();
    const xySpeed = r.floatLE();
    const zSpeed = r.floatLE();
    this.abortUnsafe("knockback");
    this.observedFlags |= MovementFlag.FALLING;
    this.moveFlags |= MovementFlag.FALLING;
    this.fall = { zSpeed, sinAngle: vSin, cosAngle: vCos, xySpeed };
    this.ackRoot(GameOpcode.CMSG_MOVE_KNOCK_BACK_ACK, counter);
    this.emit("server_correction", "knockback");
  }

  handleClientControl(r: PacketReader): void {
    const guid = packedToBigint(r.packedGuid());
    const allow = r.uint8() !== 0;
    const self = this.deps.selfGuid();
    if (guid !== 0n && guid !== self) {
      this.clientControl = false;
      this.abortUnsafe("no_control");
      this.emitAllowed("no_control");
      return;
    }
    this.clientControl = allow;
    if (!allow) this.abortUnsafe("no_control");
    this.emitAllowed(allow ? undefined : "no_control");
  }

  handleForceSpeed(r: PacketReader, opcode: number): void {
    const spec = speedAckFor(opcode);
    if (!spec) return;
    r.packedGuid();
    const counter = r.uint32LE();
    if ("extraByte" in spec && spec.extraByte) r.uint8();
    const speed = r.floatLE();
    this.integrate();
    if ("field" in spec && spec.field === "runSpeed") this.runSpeed = speed;
    if ("field" in spec && spec.field === "runBackSpeed")
      this.runBackSpeed = speed;
    this.deps.send(
      spec.ack,
      buildSpeedAck(
        this.deps.guidLow(),
        this.deps.guidHigh(),
        counter,
        this.movementInfo(),
        speed,
      ),
    );
  }

  handleCanFly(r: PacketReader, enable: boolean): void {
    r.packedGuid();
    const counter = r.uint32LE();
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
      buildCanFlyAck(
        this.deps.guidLow(),
        this.deps.guidHigh(),
        counter,
        this.movementInfo(),
        enable,
      ),
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
      this.route ? 100 : HEARTBEAT_MS,
    );
    this.emit("movement_started");
    this.emit("control_changed");
  }

  private haltMovement(reason: string, sendStop: boolean): void {
    if (!this.moving && this.owner === "none") return;
    this.clearTimers();
    this.endNavigation(reason);
    const wasMoving = this.moving;
    const ownerChanged = this.owner !== "none";
    this.moving = false;
    this.direction = undefined;
    this.owner = "none";
    this.blockedReason = reason === "obstructed" ? "obstructed" : undefined;
    const movingBits =
      MovementFlag.FORWARD |
      MovementFlag.BACKWARD |
      MovementFlag.STRAFE_LEFT |
      MovementFlag.STRAFE_RIGHT;
    this.moveFlags &= ~movingBits;
    if (sendStop && wasMoving) this.sendMove(GameOpcode.MSG_MOVE_STOP);
    if (wasMoving) this.emit("movement_stopped", reason);
    if (ownerChanged) this.emit("control_changed", reason);
  }

  private stopMoving(reason: string, sendStop: boolean): void {
    this.integrate();
    this.haltMovement(reason, sendStop);
  }

  private abortUnsafe(reason: string): void {
    this.clearTimers();
    this.endNavigation(reason);
    const wasMoving = this.moving;
    const ownerChanged = this.owner !== "none";
    this.moving = false;
    this.direction = undefined;
    this.owner = "none";
    this.blockedReason = reason;
    this.moveFlags &= ~(
      MovementFlag.FORWARD |
      MovementFlag.BACKWARD |
      MovementFlag.STRAFE_LEFT |
      MovementFlag.STRAFE_RIGHT
    );
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
    if (now - this.lastHeartbeat < (this.route ? 100 : HEARTBEAT_MS)) return;
    this.lastHeartbeat = now;
    this.sendMove(GameOpcode.MSG_MOVE_HEARTBEAT);
  }

  private integrate(): void {
    if (!this.moving || !this.predicted || !this.direction) return;
    const now = this.deps.now();
    const dt = (now - this.lastIntegrate) / 1000;
    this.lastIntegrate = now;
    if (dt <= 0) return;
    const speed = this.currentSpeed();
    if (speed === undefined) return;
    if (this.route) {
      this.routeDistance = Math.min(
        this.route.length,
        this.routeDistance + speed * dt,
      );
      try {
        this.predicted = {
          ...this.predicted,
          ...this.route.sample(this.routeDistance),
          source: "predicted",
          updatedAt: now,
        };
        this.navigation.remaining = this.route.length - this.routeDistance;
      } catch (error) {
        const reason =
          error instanceof Error ? error.message : "navigation_sample_failed";
        this.abortUnsafe(reason);
        this.sendMove(GameOpcode.MSG_MOVE_STOP);
        this.emit("control_error", reason);
      }
      return;
    }
    const heading = this.predicted.orientation + DIR_HEADING[this.direction];
    const newX = this.predicted.x + Math.cos(heading) * speed * dt;
    const newY = this.predicted.y + Math.sin(heading) * speed * dt;
    let newZ: number | undefined;
    if (this.deps.findHeight) {
      try {
        newZ = this.deps.findHeight(
          this.predicted.mapId,
          newX,
          newY,
          this.predicted,
        );
      } catch {
        newZ = undefined;
      }
    }
    if (newZ === undefined || !Number.isFinite(newZ)) {
      let currentZ: number | undefined;
      if (this.deps.findHeight) {
        try {
          currentZ = this.deps.findHeight(
            this.predicted.mapId,
            this.predicted.x,
            this.predicted.y,
            this.predicted,
          );
        } catch {
          currentZ = undefined;
        }
      }
      if (currentZ !== undefined && Number.isFinite(currentZ)) {
        this.haltMovement("obstructed", true);
        return;
      }
      this.abortUnsafe("ground_height_unavailable");
      this.sendMove(GameOpcode.MSG_MOVE_STOP);
      this.emit("control_error", "ground_height_unavailable");
      return;
    }
    this.predicted.x = newX;
    this.predicted.y = newY;
    this.predicted.z = newZ;
    this.predicted.source = "predicted";
    this.predicted.updatedAt = now;
  }

  private armLease(durationMs: number): void {
    if (this.leaseTimer !== undefined) clearTimeout(this.leaseTimer);
    this.leaseTimer = setTimeout(() => {
      if (!this.route) {
        this.stopMoving("lease", true);
        return;
      }
      this.heartbeat();
      if (this.route)
        this.armLease(
          Math.max(
            1,
            Math.min(
              MAX_DURATION_MS,
              ((this.route.length - this.routeDistance) / this.runSpeed!) *
                1000,
            ),
          ),
        );
    }, durationMs);
  }

  private endNavigation(reason: string): void {
    if (!this.route) return;
    this.navigation = {
      ...this.navigation,
      active: false,
      owner: "none",
      blockedReason: reason === "arrived" ? undefined : reason,
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
      buildMoveMessage(
        this.deps.guidLow(),
        this.deps.guidHigh(),
        this.movementInfo(),
      ),
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
    this.deps.send(
      opcode,
      buildRootAck(
        this.deps.guidLow(),
        this.deps.guidHigh(),
        counter,
        this.movementInfo(),
      ),
    );
  }

  private setServerPose(position: Position): void {
    this.server = { ...position, source: "server", updatedAt: this.deps.now() };
  }

  private applyForcedPose(dest: MovementInfo, reason: string): void {
    const movingBits =
      MovementFlag.FORWARD |
      MovementFlag.BACKWARD |
      MovementFlag.STRAFE_LEFT |
      MovementFlag.STRAFE_RIGHT;
    this.observedFlags = dest.flags;
    this.extraFlags = dest.extraFlags;
    this.moveFlags = dest.flags & ~movingBits;
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
    if (!this.clientControl) return "no_control";
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

function packedToBigint(guid: { low: number; high: number }): bigint {
  return (BigInt(guid.high >>> 0) << 32n) | BigInt(guid.low >>> 0);
}
