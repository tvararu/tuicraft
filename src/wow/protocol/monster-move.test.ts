import { test, expect, describe } from "bun:test";
import { PacketReader } from "wow/protocol/packet";
import {
  parseMonsterMove,
  parseCreateSpline,
  sampleSplinePosition,
} from "wow/protocol/monster-move";

function reader(bytes: number[]): PacketReader {
  return new PacketReader(Uint8Array.from(bytes));
}

function f32(n: number): number[] {
  const view = new DataView(new ArrayBuffer(4));
  view.setFloat32(0, n, true);
  return [
    view.getUint8(0),
    view.getUint8(1),
    view.getUint8(2),
    view.getUint8(3),
  ];
}

function u32(n: number): number[] {
  const view = new DataView(new ArrayBuffer(4));
  view.setUint32(0, n, true);
  return [
    view.getUint8(0),
    view.getUint8(1),
    view.getUint8(2),
    view.getUint8(3),
  ];
}

describe("parseMonsterMove", () => {
  test("stop has no path tail", () => {
    const result = parseMonsterMove(
      reader([
        0x01,
        0x17,
        0x00,
        ...f32(1),
        ...f32(2),
        ...f32(3),
        ...u32(9),
        0x01,
      ]),
    );
    expect(result).toEqual({
      kind: "stop",
      guid: 0x17n,
      extra: 0,
      start: { x: 1, y: 2, z: 3 },
      splineId: 9,
    });
  });

  test("linear last_idx 1 is start plus destination", () => {
    const result = parseMonsterMove(
      reader([
        0x00,
        0x00,
        ...f32(0),
        ...f32(0),
        ...f32(0),
        ...u32(1),
        0x00,
        ...u32(0),
        ...u32(1000),
        ...u32(1),
        ...f32(10),
        ...f32(0),
        ...f32(0),
      ]),
    );
    expect(result.kind).toBe("move");
    if (result.kind !== "move") return;
    expect(result.interpolation).toBe("linear");
    expect(result.duration).toBe(1000);
    expect(result.points).toEqual([
      { x: 0, y: 0, z: 0 },
      { x: 10, y: 0, z: 0 },
    ]);
  });

  test("linear packed offset reconstructs signed intermediate", () => {
    const packed = ((-8 & 0x7ff) << 11) >>> 0;
    const result = parseMonsterMove(
      reader([
        0x00,
        0x00,
        ...f32(0),
        ...f32(0),
        ...f32(0),
        ...u32(1),
        0x00,
        ...u32(0),
        ...u32(2000),
        ...u32(2),
        ...f32(10),
        ...f32(0),
        ...f32(0),
        ...u32(packed),
      ]),
    );
    expect(result.kind).toBe("move");
    if (result.kind !== "move") return;
    expect(result.points[1]).toEqual({ x: 5, y: 2, z: 0 });
    expect(result.points[2]).toEqual({ x: 10, y: 0, z: 0 });
  });

  test("facing angle then catmull-rom points", () => {
    const result = parseMonsterMove(
      reader([
        0x00,
        0x00,
        ...f32(1),
        ...f32(1),
        ...f32(1),
        ...u32(4),
        0x04,
        ...f32(1.5),
        ...u32(0x00040000),
        ...u32(800),
        ...u32(1),
        ...f32(2),
        ...f32(3),
        ...f32(4),
      ]),
    );
    expect(result.kind).toBe("move");
    if (result.kind !== "move") return;
    expect(result.facing).toEqual({ kind: "angle", angle: 1.5 });
    expect(result.interpolation).toBe("catmullrom");
    expect(result.points).toEqual([
      { x: 1, y: 1, z: 1 },
      { x: 2, y: 3, z: 4 },
    ]);
  });

  test("cyclic catmull drops serialized closing start", () => {
    const result = parseMonsterMove(
      reader([
        0x00,
        0x00,
        ...f32(1),
        ...f32(2),
        ...f32(3),
        ...u32(8),
        0x00,
        ...u32(0x000c0000),
        ...u32(1000),
        ...u32(3),
        ...f32(4),
        ...f32(5),
        ...f32(6),
        ...f32(1),
        ...f32(2),
        ...f32(3),
        ...f32(0),
        ...f32(0),
        ...f32(0),
      ]),
    );
    expect(result.kind).toBe("move");
    if (result.kind !== "move") return;
    expect(result.cyclic).toBe(true);
    expect(result.points).toEqual([
      { x: 1, y: 2, z: 3 },
      { x: 4, y: 5, z: 6 },
    ]);
  });

  test("throws on truncated packed offset", () => {
    expect(() =>
      parseMonsterMove(
        reader([
          0x00,
          0x00,
          ...f32(0),
          ...f32(0),
          ...f32(0),
          ...u32(1),
          0x00,
          ...u32(0),
          ...u32(1),
          ...u32(2),
          ...f32(1),
          ...f32(0),
          ...f32(0),
        ]),
      ),
    ).toThrow();
  });

  test("throws on unknown move type", () => {
    expect(() =>
      parseMonsterMove(
        reader([0x00, 0x00, ...f32(0), ...f32(0), ...f32(0), ...u32(1), 0x05]),
      ),
    ).toThrow();
  });
});

describe("parseCreateSpline", () => {
  test("reads elapsed duration nodes and final", () => {
    const result = parseCreateSpline(
      reader([
        ...u32(0),
        ...u32(250),
        ...u32(1000),
        ...u32(7),
        ...f32(1),
        ...f32(1),
        ...f32(0),
        ...u32(0),
        ...u32(2),
        ...f32(0),
        ...f32(0),
        ...f32(0),
        ...f32(8),
        ...f32(0),
        ...f32(0),
        0x00,
        ...f32(8),
        ...f32(0),
        ...f32(0),
      ]),
    );
    expect(result.elapsed).toBe(250);
    expect(result.duration).toBe(1000);
    expect(result.splineId).toBe(7);
    expect(result.durationMod).toBe(1);
    expect(result.mode).toBe(0);
    expect(result.points).toEqual([
      { x: 0, y: 0, z: 0 },
      { x: 8, y: 0, z: 0 },
    ]);
    expect(result.final).toEqual({ x: 8, y: 0, z: 0 });
  });

  test("final target guid is unpacked", () => {
    const result = parseCreateSpline(
      reader([
        ...u32(0x00010000),
        0x42,
        0x00,
        0x00,
        0x00,
        0x00,
        0x00,
        0x00,
        0x00,
        ...u32(0),
        ...u32(1),
        ...u32(1),
        ...f32(1),
        ...f32(1),
        ...f32(0),
        ...u32(0),
        ...u32(0),
        0x01,
        ...f32(0),
        ...f32(0),
        ...f32(0),
      ]),
    );
    expect(result.facing).toEqual({ kind: "target", guid: 0x42n });
    expect(result.mode).toBe(1);
  });

  test("throws when node xyz is truncated", () => {
    expect(() =>
      parseCreateSpline(
        reader([
          ...u32(0),
          ...u32(0),
          ...u32(1),
          ...u32(1),
          ...f32(1),
          ...f32(1),
          ...f32(0),
          ...u32(0),
          ...u32(1),
          ...f32(0),
        ]),
      ),
    ).toThrow();
  });
});

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
        flags: 0x00040000,
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
        flags: 0x00040000,
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
      flags: 0x00040000,
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
        flags: 0x00080000,
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
          flags: 0x00000200,
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
          flags: 0x00000800,
          cyclic: false,
          interpolation: "linear",
        },
        10,
      ).supported,
    ).toBe(false);
  });
});
