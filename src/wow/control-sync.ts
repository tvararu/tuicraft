import { ControlDrive } from "wow/control-drive";
import { MOVING_BITS } from "wow/control-motion";
import type { Position } from "wow/entity-store";
import { MovementFlag, UnitFlag } from "wow/protocol/entity-fields";
import {
  buildCanFlyAck,
  buildSetActiveMover,
  buildSpeedAck,
  buildTeleportAck,
  type ClientControl,
  type ForceSpeed,
  type KnockBack,
  type MoveAck,
  type MovementInfo,
  type SpeedAck,
} from "wow/protocol/movement";
import { GameOpcode } from "wow/protocol/opcodes";

const UNIT_BLOCK_FLAGS =
  UnitFlag.DISABLE_MOVE |
  UnitFlag.STUNNED |
  UnitFlag.CONFUSED |
  UnitFlag.FLEEING;

export class ControlSync extends ControlDrive {
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
}
