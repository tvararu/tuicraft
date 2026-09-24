import type { Vec3 } from "wow/protocol/packet";
import {
  SplineFlag,
  type CreateSpline,
  type MonsterMovePath,
  type SplineInterpolation,
} from "wow/protocol/monster-move";

export type SplineTrajectory = {
  points: Vec3[];
  duration: number;
  flags: number;
  cyclic: boolean;
  interpolation: SplineInterpolation;
  orientation?: number;
};

export type SampledSpline =
  | { supported: true; x: number; y: number; z: number }
  | { supported: false; reason: string };

const ORIGIN: Vec3 = { x: 0, y: 0, z: 0 };

const UNSUPPORTED_SAMPLE =
  SplineFlag.FALLING |
  SplineFlag.PARABOLIC |
  SplineFlag.ANIMATION |
  SplineFlag.TRANSPORT_ENTER |
  SplineFlag.TRANSPORT_EXIT;

export function pathTrajectory(move: MonsterMovePath): SplineTrajectory {
  const { points, duration, interpolation, cyclic, flags } = move;
  return { points, duration, interpolation, cyclic, flags };
}

export function createTrajectory(
  spline: CreateSpline,
  facing: number,
): SplineTrajectory {
  const cyclic = (spline.flags & SplineFlag.CYCLIC) !== 0;
  const [first, second] = spline.points;
  const heading =
    first && second
      ? Math.atan2(second.y - first.y, second.x - first.x)
      : facing;
  return {
    points: spline.points.slice(1, cyclic ? -2 : -1),
    duration: spline.duration,
    flags: spline.flags,
    cyclic,
    interpolation: spline.mode === 1 ? "catmullrom" : "linear",
    orientation: heading,
  };
}

function dist(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
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

function pointAt(traj: SplineTrajectory, i: number): Vec3 {
  const { points, cyclic } = traj;
  const n = points.length;
  if (cyclic) return points[((i % n) + n) % n] ?? ORIGIN;
  const start = points[0] ?? ORIGIN;
  const orientation = traj.orientation ?? 0;
  if (i < 0)
    return {
      x: start.x - Math.cos(orientation),
      y: start.y - Math.sin(orientation),
      z: start.z,
    };
  return points[Math.min(i, n - 1)] ?? ORIGIN;
}

function segmentAt(traj: SplineTrajectory, i: number, u: number): Vec3 {
  const a = pointAt(traj, i);
  const b = pointAt(traj, i + 1);
  if (traj.interpolation === "linear") return lerp(a, b, u);
  return catmull(pointAt(traj, i - 1), a, b, pointAt(traj, i + 2), u);
}

function segmentLength(traj: SplineTrajectory, i: number): number {
  if (traj.interpolation === "linear")
    return dist(pointAt(traj, i), pointAt(traj, i + 1));
  let length = 0;
  let prev = pointAt(traj, i);
  for (let s = 1; s <= 3; s++) {
    const next = segmentAt(traj, i, s / 3);
    length += dist(prev, next);
    prev = next;
  }
  return length;
}

function sampleAlong(traj: SplineTrajectory, t: number): Vec3 {
  const { points, cyclic } = traj;
  const count = cyclic ? points.length : points.length - 1;
  const lengths = Array.from({ length: count }, (_, i) =>
    segmentLength(traj, i),
  );
  const total = lengths.reduce((sum, len) => sum + len, 0);
  if (total === 0) return pointAt(traj, 0);
  let remain = t * total;
  for (const [i, len] of lengths.entries()) {
    if (remain > len && i < lengths.length - 1) {
      remain -= len;
      continue;
    }
    return segmentAt(traj, i, len === 0 ? 1 : remain / len);
  }
  return pointAt(traj, points.length - 1);
}

function unsupportedReason(flags: number): string | undefined {
  if (!(flags & UNSUPPORTED_SAMPLE)) return undefined;
  if (flags & SplineFlag.FALLING) return "falling";
  if (flags & SplineFlag.PARABOLIC) return "parabolic";
  if (flags & SplineFlag.ANIMATION) return "animation";
  return "transport";
}

function progress(traj: SplineTrajectory, elapsedMs: number): number {
  const t = elapsedMs / traj.duration;
  if (traj.cyclic) return ((t % 1) + 1) % 1;
  return Math.min(Math.max(t, 0), 1);
}

export function sampleSplinePosition(
  traj: SplineTrajectory,
  elapsedMs: number,
): SampledSpline {
  const reason = unsupportedReason(traj.flags);
  if (reason) return { supported: false, reason };
  const end = traj.points.at(-1);
  if (!end) return { supported: false, reason: "empty" };
  if (traj.duration <= 0) return { supported: true, ...end };
  const launch = traj.interpolation === "catmullrom" && !traj.cyclic;
  if (launch && !Number.isFinite(traj.orientation))
    return { supported: false, reason: "launch_orientation" };
  return { supported: true, ...sampleAlong(traj, progress(traj, elapsedMs)) };
}
