import { PacketReader, type Vec3 } from "wow/protocol/packet";

export const SplineFlag = {
  FALLING: 0x00000200,
  PARABOLIC: 0x00000800,
  FLYING: 0x00002000,
  FINAL_POINT: 0x00008000,
  FINAL_TARGET: 0x00010000,
  FINAL_ANGLE: 0x00020000,
  CATMULLROM: 0x00040000,
  CYCLIC: 0x00080000,
  ANIMATION: 0x00200000,
  TRANSPORT_ENTER: 0x00800000,
  TRANSPORT_EXIT: 0x01000000,
} as const;

const MASK_CATMULLROM = SplineFlag.FLYING | SplineFlag.CATMULLROM;

export type SplineFacing =
  | { kind: "none" }
  | { kind: "spot"; point: Vec3 }
  | { kind: "target"; guid: bigint }
  | { kind: "angle"; angle: number };

export type SplineInterpolation = "linear" | "catmullrom";

export type MonsterMoveStop = {
  kind: "stop";
  guid: bigint;
  extra: number;
  start: Vec3;
  splineId: number;
};

export type MonsterMovePath = {
  kind: "move";
  guid: bigint;
  extra: number;
  start: Vec3;
  splineId: number;
  facing: SplineFacing;
  flags: number;
  duration: number;
  animation?: { id: number; startTime: number };
  parabolic?: { acceleration: number; startTime: number };
  points: Vec3[];
  interpolation: SplineInterpolation;
  cyclic: boolean;
};

export type MonsterMove = MonsterMoveStop | MonsterMovePath;

export type CreateSpline = {
  flags: number;
  facing: SplineFacing;
  elapsed: number;
  duration: number;
  splineId: number;
  durationMod: number;
  durationModNext: number;
  verticalAcceleration: number;
  effectStartTime: number;
  points: Vec3[];
  mode: number;
  final: Vec3;
};

function unpackXyz(packed: number): Vec3 {
  const x = ((packed & 0x7ff) << 21) >> 21;
  const y = (((packed >>> 11) & 0x7ff) << 21) >> 21;
  const z = (((packed >>> 22) & 0x3ff) << 22) >> 22;
  return { x: x * 0.25, y: y * 0.25, z: z * 0.25 };
}

function readFacing(r: PacketReader, type: number): SplineFacing {
  if (type === 0) return { kind: "none" };
  if (type === 2) return { kind: "spot", point: r.vec3() };
  if (type === 3) return { kind: "target", guid: r.uint64LE() };
  if (type === 4) return { kind: "angle", angle: r.floatLE() };
  throw new RangeError(`unsupported monster move type ${type}`);
}

function readLinearPath(r: PacketReader, start: Vec3): Vec3[] {
  const lastIdx = r.uint32LE();
  const dest = r.vec3();
  const points: Vec3[] = [start];
  if (lastIdx > 1) {
    const middle = {
      x: (start.x + dest.x) / 2,
      y: (start.y + dest.y) / 2,
      z: (start.z + dest.z) / 2,
    };
    for (let i = 1; i < lastIdx; i++) {
      const offset = unpackXyz(r.uint32LE());
      points.push({
        x: middle.x - offset.x,
        y: middle.y - offset.y,
        z: middle.z - offset.z,
      });
    }
  }
  points.push(dest);
  return points;
}

function readCatmullPath(
  r: PacketReader,
  start: Vec3,
  cyclic: boolean,
  flying: boolean,
): Vec3[] {
  const count = r.uint32LE();
  const extra: Vec3[] = [];
  for (let i = 0; i < count; i++) extra.push(r.vec3());
  if (cyclic && flying && extra.length > 0) extra.shift();
  if (cyclic && !flying && extra.length > 0) {
    const last = extra[extra.length - 1];
    if (last && last.x === 0 && last.y === 0 && last.z === 0) extra.pop();
  }
  const points = [start, ...extra];
  const close = points[points.length - 1];
  if (
    cyclic &&
    close &&
    close.x === start.x &&
    close.y === start.y &&
    close.z === start.z
  ) {
    points.pop();
  }
  return points;
}

function interpolationOf(flags: number): SplineInterpolation {
  return flags & MASK_CATMULLROM ? "catmullrom" : "linear";
}

export function parseMonsterMove(r: PacketReader): MonsterMove {
  const guid = r.packedGuidBig();
  const extra = r.uint8();
  const start = r.vec3();
  const splineId = r.uint32LE();
  const type = r.uint8();
  if (type === 1) return { kind: "stop", guid, extra, start, splineId };
  const facing = readFacing(r, type);
  const flags = r.uint32LE();
  const animation =
    flags & SplineFlag.ANIMATION
      ? { id: r.uint8(), startTime: r.uint32LE() | 0 }
      : undefined;
  const duration = r.uint32LE() | 0;
  const parabolic =
    flags & SplineFlag.PARABOLIC
      ? { acceleration: r.floatLE(), startTime: r.uint32LE() | 0 }
      : undefined;
  const cyclic = (flags & SplineFlag.CYCLIC) !== 0;
  const interpolation = interpolationOf(flags);
  const points =
    interpolation === "linear"
      ? readLinearPath(r, start)
      : readCatmullPath(r, start, cyclic, (flags & SplineFlag.FLYING) !== 0);
  return {
    kind: "move",
    guid,
    extra,
    start,
    splineId,
    facing,
    flags,
    duration,
    animation,
    parabolic,
    points,
    interpolation,
    cyclic,
  };
}

export function parseCreateSpline(r: PacketReader): CreateSpline {
  const flags = r.uint32LE();
  let facing: SplineFacing = { kind: "none" };
  if (flags & SplineFlag.FINAL_ANGLE)
    facing = { kind: "angle", angle: r.floatLE() };
  else if (flags & SplineFlag.FINAL_TARGET)
    facing = { kind: "target", guid: r.uint64LE() };
  else if (flags & SplineFlag.FINAL_POINT)
    facing = { kind: "spot", point: r.vec3() };
  const elapsed = r.uint32LE() | 0;
  const duration = r.uint32LE() | 0;
  const splineId = r.uint32LE();
  const durationMod = r.floatLE();
  const durationModNext = r.floatLE();
  const verticalAcceleration = r.floatLE();
  const effectStartTime = r.uint32LE() | 0;
  const nodeCount = r.uint32LE();
  const points: Vec3[] = [];
  for (let i = 0; i < nodeCount; i++) points.push(r.vec3());
  const mode = r.uint8();
  const final = r.vec3();
  return {
    flags,
    facing,
    elapsed,
    duration,
    splineId,
    durationMod,
    durationModNext,
    verticalAcceleration,
    effectStartTime,
    points,
    mode,
    final,
  };
}
