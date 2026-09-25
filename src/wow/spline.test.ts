import { describe, expect, test } from "bun:test";
import type { CreateSpline } from "wow/protocol/monster-move";
import { createTrajectory, sampleSplinePosition } from "wow/spline";

describe("sampleSplinePosition", () => {
  test("linear midpoint is predicted between observed points", () => {
    const sample = sampleSplinePosition(
      {
        points: [
          { x: 0, y: 0, z: 0 },
          { x: 10, y: 0, z: 0 },
        ],
        duration: 1000,
        flags: 0,
        cyclic: false,
        interpolation: "linear",
      },
      500,
    );
    expect(sample.supported).toBe(true);
    if (!sample.supported) return;
    expect(sample.x).toBeCloseTo(5);
    expect(sample.y).toBeCloseTo(0);
    expect(sample.z).toBeCloseTo(0);
  });

  test("catmull-rom at t0 returns the first control", () => {
    const sample = sampleSplinePosition(
      {
        points: [
          { x: 0, y: 0, z: 0 },
          { x: 10, y: 4, z: 0 },
          { x: 20, y: 0, z: 0 },
        ],
        duration: 1000,
        flags: 0x00_04_00_00,
        cyclic: false,
        interpolation: "catmullrom",
        orientation: 0,
      },
      0,
    );
    expect(sample.supported).toBe(true);
    if (!sample.supported) return;
    expect(sample.x).toBeCloseTo(0);
    expect(sample.y).toBeCloseTo(0);
  });

  test("open catmull uses orientation predecessor and repeated final", () => {
    const sample = sampleSplinePosition(
      {
        points: [
          { x: 0, y: 0, z: 0 },
          { x: 10, y: 0, z: 0 },
        ],
        duration: 1000,
        flags: 0x00_04_00_00,
        cyclic: false,
        interpolation: "catmullrom",
        orientation: 0,
      },
      500,
    );
    expect(sample.supported).toBe(true);
    if (!sample.supported) return;
    expect(sample.x).toBeCloseTo(5.0625);
    expect(sample.y).toBeCloseTo(0);
  });

  test("open catmull rejects absent or nonfinite launch orientation", () => {
    const trajectory = {
      points: [
        { x: 0, y: 0, z: 0 },
        { x: 10, y: 0, z: 0 },
      ],
      duration: 1000,
      flags: 0x00_04_00_00,
      cyclic: false,
      interpolation: "catmullrom" as const,
    };
    expect(sampleSplinePosition(trajectory, 500).supported).toBe(false);
    expect(
      sampleSplinePosition({ ...trajectory, orientation: Number.NaN }, 500)
        .supported,
    ).toBe(false);
  });

  test("cyclic wraps elapsed past duration", () => {
    const sample = sampleSplinePosition(
      {
        points: [
          { x: 0, y: 0, z: 0 },
          { x: 10, y: 0, z: 0 },
        ],
        duration: 1000,
        flags: 0x00_08_00_00,
        cyclic: true,
        interpolation: "linear",
      },
      1500,
    );
    expect(sample.supported).toBe(true);
    if (!sample.supported) return;
    expect(sample.x).toBeCloseTo(10);
  });

  test("falling is unsupported rather than stationary", () => {
    expect(
      sampleSplinePosition(
        {
          points: [
            { x: 1, y: 2, z: 3 },
            { x: 4, y: 5, z: 6 },
          ],
          duration: 1000,
          flags: 0x00_00_02_00,
          cyclic: false,
          interpolation: "linear",
        },
        0,
      ),
    ).toEqual({ supported: false, reason: "falling" });
  });

  test("parabolic is unsupported", () => {
    expect(
      sampleSplinePosition(
        {
          points: [{ x: 0, y: 0, z: 0 }],
          duration: 500,
          flags: 0x00_00_08_00,
          cyclic: false,
          interpolation: "linear",
        },
        10,
      ).supported,
    ).toBe(false);
  });
});

describe("createTrajectory", () => {
  const spline: CreateSpline = {
    flags: 0,
    facing: { kind: "none" },
    elapsed: 0,
    duration: 1000,
    splineId: 1,
    durationMod: 1,
    durationModNext: 1,
    verticalAcceleration: 0,
    effectStartTime: 0,
    points: [
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 5, z: 0 },
      { x: 0, y: 10, z: 0 },
      { x: 0, y: 15, z: 0 },
    ],
    mode: 0,
    final: { x: 0, y: 15, z: 0 },
  };

  test("drops the padding nodes and aims along the first segment", () => {
    const traj = createTrajectory(spline, 1);
    expect(traj.points).toEqual([
      { x: 0, y: 5, z: 0 },
      { x: 0, y: 10, z: 0 },
    ]);
    expect(traj.orientation).toBeCloseTo(Math.PI / 2);
    expect(traj.interpolation).toBe("linear");
  });

  test("drops the extra closing node of a cyclic spline", () => {
    const traj = createTrajectory({ ...spline, flags: 0x00_08_00_00 }, 1);
    expect(traj.cyclic).toBe(true);
    expect(traj.points).toEqual([{ x: 0, y: 5, z: 0 }]);
  });

  test("falls back to the given facing without two nodes", () => {
    const traj = createTrajectory({ ...spline, points: [] }, 1);
    expect(traj.orientation).toBe(1);
  });
});
