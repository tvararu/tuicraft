import type { Position } from "wow/entity-store";
import { PacketReader, PacketWriter } from "wow/protocol/packet";
import { MovementFlag, MovementFlagExtra } from "wow/protocol/entity-fields";

export type FallData = {
  zSpeed: number;
  cosAngle: number;
  sinAngle: number;
  xySpeed: number;
};

export type TransportInfo = {
  guidLow: number;
  guidHigh: number;
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

const PITCH_FLAGS = MovementFlag.SWIMMING | MovementFlag.FLYING;

function hasPitch(flags: number, extraFlags: number): boolean {
  return (
    (flags & PITCH_FLAGS) !== 0 ||
    (extraFlags & MovementFlagExtra.ALWAYS_ALLOW_PITCHING) !== 0
  );
}

function writeTransport(w: PacketWriter, info: MovementInfo): void {
  const transport = info.transport;
  if (!transport) throw new Error("missing_transport");
  w.packedGuid(transport.guidLow, transport.guidHigh);
  w.floatLE(transport.x);
  w.floatLE(transport.y);
  w.floatLE(transport.z);
  w.floatLE(transport.orientation);
  w.uint32LE(transport.time);
  w.uint8(transport.seat);
  if (info.extraFlags & MovementFlagExtra.INTERPOLATED_MOVEMENT)
    w.uint32LE(transport.time2 ?? 0);
}

function parseTransport(r: PacketReader, extraFlags: number): TransportInfo {
  const guid = r.packedGuid();
  const transport: TransportInfo = {
    guidLow: guid.low,
    guidHigh: guid.high,
    x: r.floatLE(),
    y: r.floatLE(),
    z: r.floatLE(),
    orientation: r.floatLE(),
    time: r.uint32LE(),
    seat: r.uint8(),
  };
  if (extraFlags & MovementFlagExtra.INTERPOLATED_MOVEMENT)
    transport.time2 = r.uint32LE();
  return transport;
}

export function writeMovementInfo(w: PacketWriter, info: MovementInfo): void {
  w.uint32LE(info.flags);
  w.uint16LE(info.extraFlags);
  w.uint32LE(info.time);
  w.floatLE(info.x);
  w.floatLE(info.y);
  w.floatLE(info.z);
  w.floatLE(info.orientation);
  if (info.flags & MovementFlag.ON_TRANSPORT) writeTransport(w, info);
  if (hasPitch(info.flags, info.extraFlags)) w.floatLE(info.pitch ?? 0);
  w.uint32LE(info.fallTime);
  if (info.flags & MovementFlag.FALLING) {
    const fall = info.fall ?? {
      zSpeed: 0,
      sinAngle: 0,
      cosAngle: 1,
      xySpeed: 0,
    };
    w.floatLE(fall.zSpeed);
    w.floatLE(fall.sinAngle);
    w.floatLE(fall.cosAngle);
    w.floatLE(fall.xySpeed);
  }
  if (info.flags & MovementFlag.SPLINE_ELEVATION)
    w.floatLE(info.splineElevation ?? 0);
}

export function parseMovementInfo(r: PacketReader): MovementInfo {
  const flags = r.uint32LE();
  const extraFlags = r.uint16LE();
  const time = r.uint32LE();
  const x = r.floatLE();
  const y = r.floatLE();
  const z = r.floatLE();
  const orientation = r.floatLE();
  const transport =
    flags & MovementFlag.ON_TRANSPORT
      ? parseTransport(r, extraFlags)
      : undefined;
  const pitch = hasPitch(flags, extraFlags) ? r.floatLE() : undefined;
  const fallTime = r.uint32LE();
  const fall =
    flags & MovementFlag.FALLING
      ? {
          zSpeed: r.floatLE(),
          sinAngle: r.floatLE(),
          cosAngle: r.floatLE(),
          xySpeed: r.floatLE(),
        }
      : undefined;
  const splineElevation =
    flags & MovementFlag.SPLINE_ELEVATION ? r.floatLE() : undefined;
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
  return {
    mapId: r.uint32LE(),
    x: r.floatLE(),
    y: r.floatLE(),
    z: r.floatLE(),
    orientation: r.floatLE(),
  };
}

export function buildMoveMessage(
  guidLow: number,
  guidHigh: number,
  info: MovementInfo,
): Uint8Array {
  const w = new PacketWriter();
  w.packedGuid(guidLow, guidHigh);
  writeMovementInfo(w, info);
  return w.finish();
}

export function buildTeleportAck(
  guidLow: number,
  guidHigh: number,
  counter: number,
  time: number,
): Uint8Array {
  const w = new PacketWriter();
  w.packedGuid(guidLow, guidHigh);
  w.uint32LE(counter);
  w.uint32LE(time);
  return w.finish();
}

export function buildSpeedAck(
  guidLow: number,
  guidHigh: number,
  counter: number,
  info: MovementInfo,
  speed: number,
): Uint8Array {
  const w = new PacketWriter();
  w.packedGuid(guidLow, guidHigh);
  w.uint32LE(counter);
  writeMovementInfo(w, info);
  w.floatLE(speed);
  return w.finish();
}

export function buildRootAck(
  guidLow: number,
  guidHigh: number,
  counter: number,
  info: MovementInfo,
): Uint8Array {
  const w = new PacketWriter();
  w.packedGuid(guidLow, guidHigh);
  w.uint32LE(counter);
  writeMovementInfo(w, info);
  return w.finish();
}

export function buildSetActiveMover(
  guidLow: number,
  guidHigh: number,
): Uint8Array {
  const w = new PacketWriter();
  w.uint32LE(guidLow);
  w.uint32LE(guidHigh);
  return w.finish();
}

export function buildSetSelection(guid: bigint): Uint8Array {
  const w = new PacketWriter();
  w.uint64LE(guid);
  return w.finish();
}

export function buildCanFlyAck(
  guidLow: number,
  guidHigh: number,
  counter: number,
  info: MovementInfo,
  applied: boolean,
): Uint8Array {
  const w = new PacketWriter();
  w.packedGuid(guidLow, guidHigh);
  w.uint32LE(counter);
  writeMovementInfo(w, info);
  w.uint32LE(applied ? 1 : 0);
  return w.finish();
}
