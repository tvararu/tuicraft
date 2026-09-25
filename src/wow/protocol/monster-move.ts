import type { PacketReader, Vec3 } from "wow/protocol/packet";

export const SplineFlag = {
  FALLING: 0x00_00_02_00,
  PARABOLIC: 0x00_00_08_00,
  FLYING: 0x00_00_20_00,
  FINAL_POINT: 0x00_00_80_00,
  FINAL_TARGET: 0x00_01_00_00,
  FINAL_ANGLE: 0x00_02_00_00,
  CATMULLROM: 0x00_04_00_00,
  CYCLIC: 0x00_08_00_00,
  ANIMATION: 0x00_20_00_00,
  TRANSPORT_ENTER: 0x00_80_00_00,
  TRANSPORT_EXIT: 0x01_00_00_00,
} as const;

const MASK_CATMULLROM = SplineFlag.FLYING | SplineFlag.CATMULLROM;

const ORIGIN: Vec3 = { x: 0, y: 0, z: 0 };

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
  const x = ((packed & 0x7_ff) << 21) >> 21;
  const y = (((packed >>> 11) & 0x7_ff) << 21) >> 21;
  const z = (((packed >>> 22) & 0x3_ff) << 22) >> 22;
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

function same(a: Vec3 | undefined, b: Vec3): boolean {
  return a !== undefined && a.x === b.x && a.y === b.y && a.z === b.z;
}

function readPoints(r: PacketReader, count: number): Vec3[] {
  const points: Vec3[] = [];
  for (let i = 0; i < count; i++) points.push(r.vec3());
  return points;
}

function readCatmullPath(r: PacketReader, start: Vec3, flags: number): Vec3[] {
  const extra = readPoints(r, r.uint32LE());
  if (!(flags & SplineFlag.CYCLIC)) return [start, ...extra];
  if (flags & SplineFlag.FLYING) extra.shift();
  else if (same(extra.at(-1), ORIGIN)) extra.pop();
  const points = [start, ...extra];
  if (same(points.at(-1), start)) points.pop();
  return points;
}

function interpolationOf(flags: number): SplineInterpolation {
  return flags & MASK_CATMULLROM ? "catmullrom" : "linear";
}

type MoveHead = Omit<MonsterMoveStop, "kind">;

function readMoveTail(
  r: PacketReader,
  head: MoveHead,
  facing: SplineFacing,
): MonsterMovePath {
  const flags = r.uint32LE();
  const animated = flags & SplineFlag.ANIMATION;
  const animation = animated
    ? { id: r.uint8(), startTime: r.uint32LE() | 0 }
    : undefined;
  const duration = r.uint32LE() | 0;
  const arcing = flags & SplineFlag.PARABOLIC;
  const parabolic = arcing
    ? { acceleration: r.floatLE(), startTime: r.uint32LE() | 0 }
    : undefined;
  const cyclic = (flags & SplineFlag.CYCLIC) !== 0;
  const interpolation = interpolationOf(flags);
  const linear = interpolation === "linear";
  const points = linear
    ? readLinearPath(r, head.start)
    : readCatmullPath(r, head.start, flags);
  return {
    kind: "move",
    ...head,
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

export function parseMonsterMove(r: PacketReader): MonsterMove {
  const guid = r.packedGuidBig();
  const extra = r.uint8();
  const start = r.vec3();
  const splineId = r.uint32LE();
  const head = { guid, extra, start, splineId };
  const type = r.uint8();
  if (type === 1) return { kind: "stop", ...head };
  return readMoveTail(r, head, readFacing(r, type));
}

function readFinalFacing(r: PacketReader, flags: number): SplineFacing {
  if (flags & SplineFlag.FINAL_ANGLE)
    return { kind: "angle", angle: r.floatLE() };
  if (flags & SplineFlag.FINAL_TARGET)
    return { kind: "target", guid: r.uint64LE() };
  if (flags & SplineFlag.FINAL_POINT) return { kind: "spot", point: r.vec3() };
  return { kind: "none" };
}

export function parseCreateSpline(r: PacketReader): CreateSpline {
  const flags = r.uint32LE();
  const facing = readFinalFacing(r, flags);
  const elapsed = r.uint32LE() | 0;
  const duration = r.uint32LE() | 0;
  const splineId = r.uint32LE();
  const durationMod = r.floatLE();
  const durationModNext = r.floatLE();
  const verticalAcceleration = r.floatLE();
  const effectStartTime = r.uint32LE() | 0;
  const points = readPoints(r, r.uint32LE());
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
