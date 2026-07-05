import type { PacketReader } from "wow/protocol/packet";
import { GameOpcode, ChatType } from "wow/protocol/opcodes";
import { MovementFlag } from "wow/protocol/entity-fields";
import {
  parseMovementInfo,
  buildTeleportAck,
  buildSpeedAck,
  buildRootAck,
  buildSetActiveMover,
  type MovementInfo,
} from "wow/protocol/movement";
import { sendPacket, selfGuid } from "wow/world-handlers";
import type { WorldConn } from "wow/client";

export function currentMovementInfo(conn: WorldConn): MovementInfo {
  return {
    flags: conn.own.moveFlags,
    extraFlags: 0,
    time: conn.ticks(),
    x: conn.own.x,
    y: conn.own.y,
    z: conn.own.z,
    orientation: conn.own.orientation,
    fallTime: 0,
  };
}

export function handleForceSpeedChange(
  conn: WorldConn,
  r: PacketReader,
  ackOpcode: number,
  opts: { extraByte?: boolean; updatesRunSpeed?: boolean } = {},
): void {
  r.packedGuid();
  const counter = r.uint32LE();
  if (opts.extraByte) r.uint8();
  const speed = r.floatLE();
  if (opts.updatesRunSpeed) conn.own.runSpeed = speed;
  sendPacket(
    conn,
    ackOpcode,
    buildSpeedAck(
      conn.selfGuidLow,
      conn.selfGuidHigh,
      counter,
      currentMovementInfo(conn),
      speed,
    ),
  );
}

export function handleTeleportAckRequest(
  conn: WorldConn,
  r: PacketReader,
): void {
  r.packedGuid();
  const counter = r.uint32LE();
  const dest = parseMovementInfo(r);
  sendPacket(
    conn,
    GameOpcode.MSG_MOVE_TELEPORT_ACK,
    buildTeleportAck(
      conn.selfGuidLow,
      conn.selfGuidHigh,
      counter,
      conn.ticks(),
    ),
  );
  conn.own.x = dest.x;
  conn.own.y = dest.y;
  conn.own.z = dest.z;
  conn.own.orientation = dest.orientation;
  conn.entityStore.setPosition(selfGuid(conn), {
    mapId: conn.own.mapId,
    x: dest.x,
    y: dest.y,
    z: dest.z,
    orientation: dest.orientation,
  });
  conn.onMessage?.({
    type: ChatType.SYSTEM,
    sender: "",
    message: `Teleported to (${dest.x.toFixed(1)}, ${dest.y.toFixed(1)}, ${dest.z.toFixed(1)})`,
  });
  conn.onOwnTeleport?.();
}

export function handleTransferPending(conn: WorldConn, r: PacketReader): void {
  const mapId = r.uint32LE();
  conn.own.moveFlags = 0;
  conn.onMessage?.({
    type: ChatType.SYSTEM,
    sender: "",
    message: `Transferring to map ${mapId}...`,
  });
}

export function handleNewWorld(conn: WorldConn, r: PacketReader): void {
  const mapId = r.uint32LE();
  const x = r.floatLE();
  const y = r.floatLE();
  const z = r.floatLE();
  const orientation = r.floatLE();
  conn.own.mapId = mapId;
  conn.own.x = x;
  conn.own.y = y;
  conn.own.z = z;
  conn.own.orientation = orientation;
  conn.own.moveFlags = 0;
  conn.entityStore.clear();
  sendPacket(conn, GameOpcode.MSG_MOVE_WORLDPORT_ACK);
  sendPacket(
    conn,
    GameOpcode.CMSG_SET_ACTIVE_MOVER,
    buildSetActiveMover(conn.selfGuidLow, conn.selfGuidHigh),
  );
  conn.onMessage?.({
    type: ChatType.SYSTEM,
    sender: "",
    message: `Entered map ${mapId} at (${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)})`,
  });
  conn.onOwnTeleport?.();
}

export function handleForceMoveRoot(conn: WorldConn, r: PacketReader): void {
  r.packedGuid();
  const counter = r.uint32LE();
  conn.own.moveFlags |= MovementFlag.ROOT;
  sendPacket(
    conn,
    GameOpcode.CMSG_FORCE_MOVE_ROOT_ACK,
    buildRootAck(
      conn.selfGuidLow,
      conn.selfGuidHigh,
      counter,
      currentMovementInfo(conn),
    ),
  );
}

export function handleForceMoveUnroot(conn: WorldConn, r: PacketReader): void {
  r.packedGuid();
  const counter = r.uint32LE();
  conn.own.moveFlags &= ~MovementFlag.ROOT;
  sendPacket(
    conn,
    GameOpcode.CMSG_FORCE_MOVE_UNROOT_ACK,
    buildRootAck(
      conn.selfGuidLow,
      conn.selfGuidHigh,
      counter,
      currentMovementInfo(conn),
    ),
  );
}

export function handleObservedMove(conn: WorldConn, r: PacketReader): void {
  const { low, high } = r.packedGuid();
  const guid = (BigInt(high >>> 0) << 32n) | BigInt(low >>> 0);
  if (guid === selfGuid(conn)) return;
  const info = parseMovementInfo(r);
  conn.entityStore.setPosition(guid, {
    mapId: conn.own.mapId,
    x: info.x,
    y: info.y,
    z: info.z,
    orientation: info.orientation,
  });
}

export const OBSERVED_MOVE_OPCODES = [
  GameOpcode.MSG_MOVE_START_FORWARD,
  GameOpcode.MSG_MOVE_START_BACKWARD,
  GameOpcode.MSG_MOVE_STOP,
  GameOpcode.MSG_MOVE_START_STRAFE_LEFT,
  GameOpcode.MSG_MOVE_START_STRAFE_RIGHT,
  GameOpcode.MSG_MOVE_STOP_STRAFE,
  GameOpcode.MSG_MOVE_JUMP,
  GameOpcode.MSG_MOVE_START_TURN_LEFT,
  GameOpcode.MSG_MOVE_START_TURN_RIGHT,
  GameOpcode.MSG_MOVE_STOP_TURN,
  GameOpcode.MSG_MOVE_FALL_LAND,
  GameOpcode.MSG_MOVE_START_SWIM,
  GameOpcode.MSG_MOVE_STOP_SWIM,
  GameOpcode.MSG_MOVE_SET_FACING,
  GameOpcode.MSG_MOVE_HEARTBEAT,
];

export const SPEED_CHANGE_ACKS: Array<{
  smsg: number;
  ack: number;
  extraByte?: boolean;
  updatesRunSpeed?: boolean;
}> = [
  {
    smsg: GameOpcode.SMSG_FORCE_RUN_SPEED_CHANGE,
    ack: GameOpcode.CMSG_FORCE_RUN_SPEED_CHANGE_ACK,
    extraByte: true,
    updatesRunSpeed: true,
  },
  {
    smsg: GameOpcode.SMSG_FORCE_RUN_BACK_SPEED_CHANGE,
    ack: GameOpcode.CMSG_FORCE_RUN_BACK_SPEED_CHANGE_ACK,
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
];
