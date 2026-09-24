import type { Vec3 } from "wow/protocol/packet";

type Point = { x: number; y: number };

const TWO_PI = Math.PI * 2;

export function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

export function distance2d(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function bearing(from: Point, to: Point): number {
  return Math.atan2(to.y - from.y, to.x - from.x);
}

export function normalizeAngle(radians: number): number {
  return ((radians % TWO_PI) + TWO_PI) % TWO_PI;
}
