import { PacketReader, PacketWriter } from "wow/protocol/packet";
import { MovementFlag, MovementFlagExtra } from "wow/protocol/entity-fields";

export type FallData = {
  zSpeed: number;
  cosAngle: number;
  sinAngle: number;
  xySpeed: number;
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
};

const PITCH_FLAGS = MovementFlag.SWIMMING | MovementFlag.FLYING;

export function writeMovementInfo(w: PacketWriter, info: MovementInfo): void {
  w.uint32LE(info.flags);
  w.uint16LE(info.extraFlags);
  w.uint32LE(info.time);
  w.floatLE(info.x);
  w.floatLE(info.y);
  w.floatLE(info.z);
  w.floatLE(info.orientation);
  if (
    info.flags & PITCH_FLAGS ||
    info.extraFlags & MovementFlagExtra.ALWAYS_ALLOW_PITCHING
  ) {
    w.floatLE(info.pitch ?? 0);
  }
  w.uint32LE(info.fallTime);
  if (info.flags & MovementFlag.FALLING) {
    const fall = info.fall ?? {
      zSpeed: 0,
      cosAngle: 1,
      sinAngle: 0,
      xySpeed: 0,
    };
    w.floatLE(fall.zSpeed);
    w.floatLE(fall.cosAngle);
    w.floatLE(fall.sinAngle);
    w.floatLE(fall.xySpeed);
  }
  if (info.flags & MovementFlag.SPLINE_ELEVATION) {
    w.floatLE(info.splineElevation ?? 0);
  }
}

export function parseMovementInfo(r: PacketReader): MovementInfo {
  const flags = r.uint32LE();
  const extraFlags = r.uint16LE();
  const time = r.uint32LE();
  const x = r.floatLE();
  const y = r.floatLE();
  const z = r.floatLE();
  const orientation = r.floatLE();

  if (flags & MovementFlag.ON_TRANSPORT) {
    r.packedGuid();
    r.skip(21);
    if (extraFlags & MovementFlagExtra.INTERPOLATED_MOVEMENT) r.skip(4);
  }

  let pitch: number | undefined;
  if (
    flags & PITCH_FLAGS ||
    extraFlags & MovementFlagExtra.ALWAYS_ALLOW_PITCHING
  ) {
    pitch = r.floatLE();
  }

  const fallTime = r.uint32LE();

  let fall: FallData | undefined;
  if (flags & MovementFlag.FALLING) {
    fall = {
      zSpeed: r.floatLE(),
      cosAngle: r.floatLE(),
      sinAngle: r.floatLE(),
      xySpeed: r.floatLE(),
    };
  }

  let splineElevation: number | undefined;
  if (flags & MovementFlag.SPLINE_ELEVATION) {
    splineElevation = r.floatLE();
  }

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
