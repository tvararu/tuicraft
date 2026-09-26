import { MovementFlag, UpdateFlag } from "#wow/protocol/entity-fields";
import {
  type CreateSpline,
  parseCreateSpline,
} from "#wow/protocol/monster-move";
import { type MovementInfo, parseMovementInfo } from "#wow/protocol/movement";
import type { PacketReader } from "#wow/protocol/packet";

type Point = { x: number; y: number; z: number; orientation: number };

export type MovementData = {
  updateFlags: number;
  point?: Point;
  runSpeed?: number;
  runBackSpeed?: number;
  movementInfo?: MovementInfo;
  spline?: CreateSpline;
};

type Placement = Omit<MovementData, "updateFlags">;

function readLiving(r: PacketReader): Placement {
  const movementInfo = parseMovementInfo(r);
  const { flags, x, y, z, orientation } = movementInfo;
  r.skip(4);
  const runSpeed = r.floatLE();
  const runBackSpeed = r.floatLE();
  r.skip(24);
  const splined = flags & MovementFlag.SPLINE_ENABLED;
  const spline = splined ? parseCreateSpline(r) : undefined;
  return {
    point: { x, y, z, orientation },
    runSpeed,
    runBackSpeed,
    movementInfo,
    spline,
  };
}

function readStationaryTransport(r: PacketReader): Placement {
  r.packedGuid();
  const position = r.vec3();
  r.skip(12);
  const orientation = r.floatLE();
  r.skip(4);
  return { point: { ...position, orientation } };
}

function readPlacement(r: PacketReader, updateFlags: number): Placement {
  if (updateFlags & UpdateFlag.LIVING) return readLiving(r);
  if (updateFlags & UpdateFlag.POSITION) return readStationaryTransport(r);
  if (updateFlags & UpdateFlag.HAS_POSITION)
    return { point: { ...r.vec3(), orientation: r.floatLE() } };
  return {};
}

function skipTrailer(r: PacketReader, updateFlags: number): void {
  if (updateFlags & UpdateFlag.HIGH_GUID) r.skip(4);
  if (updateFlags & UpdateFlag.LOW_GUID) r.skip(4);
  if (updateFlags & UpdateFlag.HAS_ATTACKING_TARGET) r.packedGuid();
  if (updateFlags & UpdateFlag.TRANSPORT) r.skip(4);
  if (updateFlags & UpdateFlag.VEHICLE) r.skip(8);
  if (updateFlags & UpdateFlag.ROTATION) r.skip(8);
}

export function parseMovementBlock(r: PacketReader): MovementData {
  const updateFlags = r.uint16LE();
  const placement = readPlacement(r, updateFlags);
  skipTrailer(r, updateFlags);
  return { updateFlags, ...placement };
}
