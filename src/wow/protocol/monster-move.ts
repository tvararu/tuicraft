import { PacketReader, type Vec3 } from "wow/protocol/packet";

const SPLINE_FALLING = 0x00000200;
const SPLINE_PARABOLIC = 0x00000800;
const SPLINE_FLYING = 0x00002000;
const SPLINE_CATMULLROM = 0x00040000;
const SPLINE_CYCLIC = 0x00080000;
const SPLINE_ANIMATION = 0x00200000;
const SPLINE_TRANSPORT_ENTER = 0x00800000;
const SPLINE_TRANSPORT_EXIT = 0x01000000;
const MASK_CATMULLROM = SPLINE_FLYING | SPLINE_CATMULLROM;
const FINAL_POINT = 0x00008000;
const FINAL_TARGET = 0x00010000;
const FINAL_ANGLE = 0x00020000;
const UNSUPPORTED_SAMPLE =
  SPLINE_FALLING |
  SPLINE_PARABOLIC |
  SPLINE_ANIMATION |
  SPLINE_TRANSPORT_ENTER |
  SPLINE_TRANSPORT_EXIT;

export type SplineFacing =
  | { kind: "none" }
  | { kind: "spot"; point: Vec3 }
  | { kind: "target"; guid: bigint }
  | { kind: "angle"; angle: number };

export type SplineInterpolation = "linear" | "catmullrom";

export type SplineTrajectory = {
  points: Vec3[];
  duration: number;
  flags: number;
  cyclic: boolean;
  interpolation: SplineInterpolation;
  orientation?: number;
};

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

export type SampledSpline =
  | { supported: true; x: number; y: number; z: number }
  | { supported: false; reason: string };

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

function dist(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.hypot(dx, dy, dz);
}

function lerp(a: Vec3, b: Vec3, u: number): Vec3 {
  return {
    x: a.x + (b.x - a.x) * u,
    y: a.y + (b.y - a.y) * u,
    z: a.z + (b.z - a.z) * u,
  };
}

function catmull(p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3, t: number): Vec3 {
  const t2 = t * t;
  const t3 = t2 * t;
  const w0 = -0.5 * t3 + t2 - 0.5 * t;
  const w1 = 1.5 * t3 - 2.5 * t2 + 1;
  const w2 = -1.5 * t3 + 2 * t2 + 0.5 * t;
  const w3 = 0.5 * t3 - 0.5 * t2;
  return {
    x: w0 * p0.x + w1 * p1.x + w2 * p2.x + w3 * p3.x,
    y: w0 * p0.y + w1 * p1.y + w2 * p2.y + w3 * p3.y,
    z: w0 * p0.z + w1 * p1.z + w2 * p2.z + w3 * p3.z,
  };
}

function pointAt(
  points: Vec3[],
  i: number,
  cyclic: boolean,
  orientation: number,
): Vec3 {
  const n = points.length;
  if (n === 0) return { x: 0, y: 0, z: 0 };
  if (cyclic) return points[((i % n) + n) % n] as Vec3;
  if (i < 0) {
    const start = points[0] as Vec3;
    return {
      x: start.x - Math.cos(orientation),
      y: start.y - Math.sin(orientation),
      z: start.z,
    };
  }
  if (i >= n) return points[n - 1] as Vec3;
  return points[i] as Vec3;
}

function segmentLengths(traj: SplineTrajectory): number[] {
  const { points, cyclic, interpolation } = traj;
  const orientation = traj.orientation ?? 0;
  const n = cyclic ? points.length : points.length - 1;
  const lengths: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = pointAt(points, i, cyclic, orientation);
    const b = pointAt(points, i + 1, cyclic, orientation);
    if (interpolation === "linear") {
      lengths.push(dist(a, b));
      continue;
    }
    const p0 = pointAt(points, i - 1, cyclic, orientation);
    const p3 = pointAt(points, i + 2, cyclic, orientation);
    let length = 0;
    let prev = a;
    for (let s = 1; s <= 3; s++) {
      const next = catmull(p0, a, b, p3, s / 3);
      length += dist(prev, next);
      prev = next;
    }
    lengths.push(length);
  }
  return lengths;
}

function sampleAlong(traj: SplineTrajectory, t: number): Vec3 {
  const { points, cyclic, interpolation } = traj;
  const orientation = traj.orientation ?? 0;
  if (points.length === 0) return { x: 0, y: 0, z: 0 };
  if (points.length === 1) return points[0] as Vec3;
  const lengths = segmentLengths(traj);
  const total = lengths.reduce((sum, len) => sum + len, 0);
  if (total === 0) return points[0] as Vec3;
  let remain = t * total;
  for (let i = 0; i < lengths.length; i++) {
    const len = lengths[i] as number;
    if (remain > len && i < lengths.length - 1) {
      remain -= len;
      continue;
    }
    const u = len === 0 ? 1 : remain / len;
    const a = pointAt(points, i, cyclic, orientation);
    const b = pointAt(points, i + 1, cyclic, orientation);
    if (interpolation === "linear") return lerp(a, b, u);
    return catmull(
      pointAt(points, i - 1, cyclic, orientation),
      a,
      b,
      pointAt(points, i + 2, cyclic, orientation),
      u,
    );
  }
  return pointAt(points, points.length - 1, cyclic, orientation);
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
    flags & SPLINE_ANIMATION
      ? { id: r.uint8(), startTime: r.uint32LE() | 0 }
      : undefined;
  const duration = r.uint32LE() | 0;
  const parabolic =
    flags & SPLINE_PARABOLIC
      ? { acceleration: r.floatLE(), startTime: r.uint32LE() | 0 }
      : undefined;
  const cyclic = (flags & SPLINE_CYCLIC) !== 0;
  const interpolation = interpolationOf(flags);
  const points =
    interpolation === "linear"
      ? readLinearPath(r, start)
      : readCatmullPath(r, start, cyclic, (flags & SPLINE_FLYING) !== 0);
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
  if (flags & FINAL_ANGLE) facing = { kind: "angle", angle: r.floatLE() };
  else if (flags & FINAL_TARGET)
    facing = { kind: "target", guid: r.uint64LE() };
  else if (flags & FINAL_POINT) facing = { kind: "spot", point: r.vec3() };
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

export function sampleSplinePosition(
  trajectory: SplineTrajectory,
  elapsedMs: number,
): SampledSpline {
  if (trajectory.flags & UNSUPPORTED_SAMPLE) {
    let reason = "transport";
    if (trajectory.flags & SPLINE_FALLING) reason = "falling";
    else if (trajectory.flags & SPLINE_PARABOLIC) reason = "parabolic";
    else if (trajectory.flags & SPLINE_ANIMATION) reason = "animation";
    return { supported: false, reason };
  }
  if (trajectory.points.length === 0)
    return { supported: false, reason: "empty" };
  if (trajectory.duration <= 0) {
    const end = trajectory.points[trajectory.points.length - 1] as Vec3;
    return { supported: true, ...end };
  }
  if (
    trajectory.interpolation === "catmullrom" &&
    !trajectory.cyclic &&
    !Number.isFinite(trajectory.orientation)
  ) {
    return { supported: false, reason: "launch_orientation" };
  }
  let t = elapsedMs / trajectory.duration;
  if (trajectory.cyclic) t = ((t % 1) + 1) % 1;
  else if (t < 0) t = 0;
  else if (t > 1) t = 1;
  const p = sampleAlong(trajectory, t);
  return { supported: true, ...p };
}
