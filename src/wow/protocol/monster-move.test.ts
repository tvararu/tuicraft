import { test, expect, describe } from "bun:test";
import { PacketReader } from "wow/protocol/packet";
import { parseMonsterMove, parseCreateSpline } from "wow/protocol/monster-move";

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
