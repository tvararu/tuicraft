import { Emitter, type Unsubscribe } from "lib/emitter";
import type {
  ControlDeps,
  ControlEvent,
  ControlEventType,
  ControlMode,
  ControlPose,
  ControlState,
  MovementDirection,
  NavigationState,
  WalkOutcome,
} from "wow/control";
import { unsupportedReason } from "wow/control-motion";
import type { Position } from "wow/entity-store";
import type { GroundRoute } from "wow/navigation";
import { MovementFlag } from "wow/protocol/entity-fields";
import {
  buildMoveMessage,
  buildRootAck,
  type FallData,
  type MoveAck,
  type MovementInfo,
  type TransportInfo,
} from "wow/protocol/movement";

export const MAX_DURATION_MS = 10_000;

export const DIR_FLAG: Record<MovementDirection, number> = {
  forward: MovementFlag.FORWARD,
  backward: MovementFlag.BACKWARD,
  left: MovementFlag.STRAFE_LEFT,
  right: MovementFlag.STRAFE_RIGHT,
};

export type DirectedWalk = {
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

function copyPose(pose: ControlPose | undefined): ControlPose | undefined {
  return pose ? { ...pose } : undefined;
}

export class ControlCore {
  protected readonly deps: ControlDeps;
  protected readonly events = new Emitter<[ControlEvent]>();
  protected predicted: ControlPose | undefined;
  protected server: ControlPose | undefined;
  protected mapId = 0;
  protected runSpeed: number | undefined;
  protected runBackSpeed: number | undefined;
  protected moveFlags = 0;
  protected extraFlags = 0;
  protected observedFlags = 0;
  protected direction: MovementDirection | undefined;
  protected moving = false;
  protected owner: "manual" | "none" = "none";
  protected mode: ControlMode = "none";
  protected route: GroundRoute | undefined;
  protected routeDistance = 0;
  protected walk: DirectedWalk | undefined;
  protected navigation: NavigationState = {
    active: false,
    destination: undefined,
    remaining: undefined,
    owner: "none",
    blockedReason: undefined,
    refusal: undefined,
  };
  protected target: bigint | undefined;
  protected requestedTarget: bigint | undefined;
  protected controlAllowed = true;
  protected rooted = false;
  protected teleporting = false;
  protected unitBlocked = false;
  protected blockedReason: string | undefined;
  protected leaseTimer: ReturnType<typeof setTimeout> | undefined;
  protected heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  protected lastIntegrate = 0;
  protected lastHeartbeat = 0;
  protected fall: FallData | undefined;
  protected transport: TransportInfo | undefined;
  protected verified = false;
  protected loginWaiters: Array<() => void> = [];

  constructor(deps: ControlDeps) {
    this.deps = deps;
  }

  onEvent(listener: (event: ControlEvent) => void): Unsubscribe {
    return this.events.subscribe(listener);
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

  protected sendMove(opcode: number): void {
    this.deps.send(
      opcode,
      buildMoveMessage(this.deps.selfGuid(), this.movementInfo()),
    );
  }

  protected movementInfo(): MovementInfo {
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

  protected ackRoot(opcode: number, counter: number): void {
    this.deps.send(opcode, buildRootAck(this.moveAck(counter)));
  }

  protected moveAck(counter: number): MoveAck {
    return { guid: this.deps.selfGuid(), counter, info: this.movementInfo() };
  }

  protected setServerPose(position: Position): void {
    this.server = { ...position, source: "server", updatedAt: this.deps.now() };
  }

  protected guardMove(direction: MovementDirection): void {
    const reason = this.blockReason() ?? unsupportedReason(this.observedFlags);
    if (reason) throw new Error(reason);
    this.requirePose();
    if (this.speedFor(direction) === undefined)
      throw new Error("missing_speed");
  }

  protected requirePose(): ControlPose {
    const pose = this.predicted ?? this.server;
    if (!pose) throw new Error("no_pose");
    return { ...pose };
  }

  protected currentSpeed(): number | undefined {
    return this.direction ? this.speedFor(this.direction) : this.runSpeed;
  }

  protected speedFor(direction: MovementDirection): number | undefined {
    return direction === "backward" ? this.runBackSpeed : this.runSpeed;
  }

  protected blockReason(): string | undefined {
    if (this.teleporting) return "teleporting";
    if (this.rooted) return "rooted";
    if (!this.controlAllowed) return "no_control";
    if (this.unitBlocked) return "disable_move";
    return unsupportedReason(this.observedFlags);
  }

  protected emitAllowed(reason: string | undefined): void {
    this.emit("control_changed", reason);
  }

  protected emit(type: ControlEventType, reason?: string): void {
    const event: ControlEvent = { type, state: this.snapshot() };
    if (reason !== undefined) event.reason = reason;
    this.events.emit(event);
  }
}
