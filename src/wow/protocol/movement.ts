import type { Position } from "wow/entity-store";
import { PacketReader, PacketWriter } from "wow/protocol/packet";
import { MovementFlag, MovementFlagExtra } from "wow/protocol/entity-fields";
import { GameOpcode } from "wow/protocol/opcodes";

export type FallData = {
  zSpeed: number;
  cosAngle: number;
  sinAngle: number;
  xySpeed: number;
};

export type TransportInfo = {
  guid: bigint;
  x: number;
  y: number;
  z: number;
  orientation: number;
  time: number;
  seat: number;
  time2?: number;
};

export type MovementInfo = {
  flags: number;
  extraFlags: number;
  time: number;
  x: number;
  y: number;
  z: number;
  orientation: number;
  fallTime: number;
  pitch?: number;
  fall?: FallData;
  splineElevation?: number;
  transport?: TransportInfo;
};

export type MoveCounter = { guid: bigint; counter: number };
export type MoveAck = MoveCounter & { info: MovementInfo };
export type KnockBack = MoveCounter & { fall: FallData };
export type ForceSpeed = MoveCounter & { speed: number };
export type ClientControl = { guid: bigint; allow: boolean };

export const SPEED_ACKS = [
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

export type SpeedAck = (typeof SPEED_ACKS)[number];

export function speedAckFor(opcode: number): SpeedAck | undefined {
  return SPEED_ACKS.find((entry) => entry.smsg === opcode);
}

const PITCH_FLAGS = MovementFlag.SWIMMING | MovementFlag.FLYING;

const IDLE_FALL: FallData = { zSpeed: 0, sinAngle: 0, cosAngle: 1, xySpeed: 0 };

function hasPitch(flags: number, extraFlags: number): boolean {
  return (
    (flags & PITCH_FLAGS) !== 0 ||
    (extraFlags & MovementFlagExtra.ALWAYS_ALLOW_PITCHING) !== 0
  );
}

function interpolated(extraFlags: number): boolean {
  return (extraFlags & MovementFlagExtra.INTERPOLATED_MOVEMENT) !== 0;
}

function writeTransport(w: PacketWriter, info: MovementInfo): void {
  const transport = info.transport;
  if (!transport) throw new Error("missing_transport");
  w.packedGuidBig(transport.guid);
  w.vec3(transport);
  w.floatLE(transport.orientation);
  w.uint32LE(transport.time);
  w.uint8(transport.seat);
  if (interpolated(info.extraFlags)) w.uint32LE(transport.time2 ?? 0);
}

function parseTransport(r: PacketReader, extraFlags: number): TransportInfo {
  const transport: TransportInfo = {
    guid: r.packedGuidBig(),
    ...r.vec3(),
    orientation: r.floatLE(),
    time: r.uint32LE(),
    seat: r.uint8(),
  };
  if (interpolated(extraFlags)) transport.time2 = r.uint32LE();
  return transport;
}

function writeFall(w: PacketWriter, fall: FallData): void {
  w.floatLE(fall.zSpeed);
  w.floatLE(fall.sinAngle);
  w.floatLE(fall.cosAngle);
  w.floatLE(fall.xySpeed);
}

function readFall(r: PacketReader): FallData {
  const zSpeed = r.floatLE();
  const sinAngle = r.floatLE();
  const cosAngle = r.floatLE();
  return { zSpeed, sinAngle, cosAngle, xySpeed: r.floatLE() };
}

export function writeMovementInfo(w: PacketWriter, info: MovementInfo): void {
  w.uint32LE(info.flags);
  w.uint16LE(info.extraFlags);
  w.uint32LE(info.time);
  w.vec3(info);
  w.floatLE(info.orientation);
  if (info.flags & MovementFlag.ON_TRANSPORT) writeTransport(w, info);
  if (hasPitch(info.flags, info.extraFlags)) w.floatLE(info.pitch ?? 0);
  w.uint32LE(info.fallTime);
  if (info.flags & MovementFlag.FALLING) writeFall(w, info.fall ?? IDLE_FALL);
  if (info.flags & MovementFlag.SPLINE_ELEVATION)
    w.floatLE(info.splineElevation ?? 0);
}

export function parseMovementInfo(r: PacketReader): MovementInfo {
  const flags = r.uint32LE();
  const extraFlags = r.uint16LE();
  const time = r.uint32LE();
  const { x, y, z } = r.vec3();
  const orientation = r.floatLE();
  const onTransport = flags & MovementFlag.ON_TRANSPORT;
  const transport = onTransport ? parseTransport(r, extraFlags) : undefined;
  const pitch = hasPitch(flags, extraFlags) ? r.floatLE() : undefined;
  const fallTime = r.uint32LE();
  const fall = flags & MovementFlag.FALLING ? readFall(r) : undefined;
  const elevated = flags & MovementFlag.SPLINE_ELEVATION;
  const splineElevation = elevated ? r.floatLE() : undefined;
  return {
    flags,
    extraFlags,
    time,
    x,
    y,
    z,
    orientation,
    fallTime,
    pitch,
    fall,
    splineElevation,
    transport,
  };
}

export function parseWorldPosition(r: PacketReader): Position {
  const mapId = r.uint32LE();
  return { mapId, ...r.vec3(), orientation: r.floatLE() };
}

export function parseMoveCounter(r: PacketReader): MoveCounter {
  return { guid: r.packedGuidBig(), counter: r.uint32LE() };
}

export function parseTeleportAck(r: PacketReader): MoveAck {
  return { ...parseMoveCounter(r), info: parseMovementInfo(r) };
}

export function parseKnockBack(r: PacketReader): KnockBack {
  const move = parseMoveCounter(r);
  const cosAngle = r.floatLE();
  const sinAngle = r.floatLE();
  const xySpeed = r.floatLE();
  return {
    ...move,
    fall: { zSpeed: r.floatLE(), sinAngle, cosAngle, xySpeed },
  };
}

export function parseForceSpeed(r: PacketReader, spec: SpeedAck): ForceSpeed {
  const move = parseMoveCounter(r);
  if ("extraByte" in spec) r.uint8();
  return { ...move, speed: r.floatLE() };
}

export function parseClientControl(r: PacketReader): ClientControl {
  return { guid: r.packedGuidBig(), allow: r.uint8() !== 0 };
}

export function buildMoveMessage(guid: bigint, info: MovementInfo): Uint8Array {
  const w = new PacketWriter();
  w.packedGuidBig(guid);
  writeMovementInfo(w, info);
  return w.finish();
}

export function buildTeleportAck(
  guid: bigint,
  counter: number,
  time: number,
): Uint8Array {
  const w = new PacketWriter();
  w.packedGuidBig(guid);
  w.uint32LE(counter);
  w.uint32LE(time);
  return w.finish();
}

function writeMoveAck(w: PacketWriter, { guid, counter, info }: MoveAck): void {
  w.packedGuidBig(guid);
  w.uint32LE(counter);
  writeMovementInfo(w, info);
}

export function buildRootAck(ack: MoveAck): Uint8Array {
  const w = new PacketWriter();
  writeMoveAck(w, ack);
  return w.finish();
}

export function buildSpeedAck(ack: MoveAck, speed: number): Uint8Array {
  const w = new PacketWriter();
  writeMoveAck(w, ack);
  w.floatLE(speed);
  return w.finish();
}

export function buildCanFlyAck(ack: MoveAck, applied: boolean): Uint8Array {
  const w = new PacketWriter();
  writeMoveAck(w, ack);
  w.uint32LE(applied ? 1 : 0);
  return w.finish();
}

export function buildSetActiveMover(guid: bigint): Uint8Array {
  const w = new PacketWriter();
  w.uint64LE(guid);
  return w.finish();
}

export function buildSetSelection(guid: bigint): Uint8Array {
  const w = new PacketWriter();
  w.uint64LE(guid);
  return w.finish();
}
