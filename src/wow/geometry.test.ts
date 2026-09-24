import { describe, expect, test } from "bun:test";
import { bearing, distance, distance2d, normalizeAngle } from "wow/geometry";

describe("distance", () => {
  test("measures 3D separation", () => {
    expect(distance({ x: 0, y: 0, z: 0 }, { x: 2, y: 3, z: 6 })).toBe(7);
  });
});

describe("distance2d", () => {
  test("ignores height", () => {
    expect(distance2d({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });
});

describe("bearing", () => {
  test("points from one position toward another", () => {
    expect(bearing({ x: 0, y: 0 }, { x: 0, y: 1 })).toBeCloseTo(Math.PI / 2);
  });
});

describe("normalizeAngle", () => {
  test("wraps into [0, 2pi)", () => {
    expect(normalizeAngle(-Math.PI / 2)).toBeCloseTo((3 * Math.PI) / 2);
    expect(normalizeAngle(2 * Math.PI)).toBe(0);
  });
});
