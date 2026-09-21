import { describe, expect, test } from "bun:test";
import { GameOpcode } from "wow/protocol/opcodes";
import { PacketReader, PacketWriter } from "wow/protocol/packet";
import {
  parseRemoteMovementBody,
  type RemoteMovementBody,
} from "wow/protocol/remote-movement";

function ordinary(): Uint8Array {
  return Buffer.from(
    "010000000000785634120000803f00000040000040400000003f00000000",
    "hex",
  );
}

function tail(body: Uint8Array, ...values: number[]): Uint8Array {
  const writer = new PacketWriter();
  writer.rawBytes(body);
  for (const value of values) writer.floatLE(value);
  return writer.finish();
}

function parse(opcode: number, bytes: Uint8Array): RemoteMovementBody {
  return parseRemoteMovementBody(opcode, new PacketReader(bytes));
}

type Floats = {
  x: number;
  transportOrientation: number;
  pitch: number;
  fallCosAngle: number;
  splineElevation: number;
};

function conditional(overrides: Partial<Floats> = {}): Uint8Array {
  const values = {
    x: 1,
    transportOrientation: 0.5,
    pitch: -0.25,
    fallCosAngle: 0.75,
    splineElevation: 3.5,
    ...overrides,
  };
  const writer = new PacketWriter();
  writer.uint32LE(0x84201200);
  writer.uint16LE(0x8420);
  writer.uint32LE(123);
  writer.floatLE(values.x);
  writer.floatLE(2);
  writer.floatLE(3);
  writer.floatLE(0.5);
  writer.packedGuid(9, 0);
  writer.floatLE(4);
  writer.floatLE(5);
  writer.floatLE(6);
  writer.floatLE(values.transportOrientation);
  writer.uint32LE(456);
  writer.uint8(2);
  writer.uint32LE(789);
  writer.floatLE(values.pitch);
  writer.uint32LE(300);
  writer.floatLE(-8);
  writer.floatLE(0.25);
  writer.floatLE(values.fallCosAngle);
  writer.floatLE(7);
  writer.floatLE(values.splineElevation);
  return writer.finish();
}

describe("remote movement body boundaries", () => {
  test("parses after Main consumes packed GUID, retaining the body position and flags", () => {
    const writer = new PacketWriter();
    writer.packedGuid(0x1234, 0);
    writer.rawBytes(ordinary());
    const reader = new PacketReader(writer.finish());
    expect(reader.packedGuid()).toEqual({ low: 0x1234, high: 0 });
    const body = parseRemoteMovementBody(GameOpcode.MSG_MOVE_HEARTBEAT, reader);
    expect(body).toMatchObject({
      kind: "movement",
      transition: "ordinary",
      info: {
        flags: 1,
        extraFlags: 0,
        time: 0x12345678,
        x: 1,
        y: 2,
        z: 3,
        orientation: 0.5,
        fallTime: 0,
      },
    });
    expect(reader.remaining).toBe(0);
  });

  test("observer flag-change opcodes carry MovementInfo, not forced-self counters", () => {
    for (const opcode of [
      0x0ec, 0x0ed, 0x0f7, 0x2b0, 0x2b1, 0x346, 0x3ad, 0x4d2,
    ]) {
      expect(parse(opcode, ordinary())).toMatchObject({
        kind: "movement",
        transition: "ordinary",
        info: { x: 1 },
      });
      expect(() => parse(opcode, tail(ordinary(), 7))).toThrow(RangeError);
    }
  });

  test("preserves transport, pitch, falling, spline and unknown flags for caller safety policy", () => {
    const body = parse(GameOpcode.MSG_MOVE_START_SWIM, conditional());
    expect(body).toMatchObject({
      kind: "movement",
      transition: "ordinary",
      info: {
        flags: 0x84201200,
        extraFlags: 0x8420,
        transport: {
          guidLow: 9,
          guidHigh: 0,
          x: 4,
          y: 5,
          z: 6,
          orientation: 0.5,
          time: 456,
          seat: 2,
          time2: 789,
        },
        pitch: -0.25,
        fallTime: 300,
        fall: { zSpeed: -8, sinAngle: 0.25, cosAngle: 0.75, xySpeed: 7 },
        splineElevation: 3.5,
      },
    });
  });

  test("rejects truncated conditional body at every consumed byte boundary", () => {
    const bytes = conditional();
    for (let length = 0; length < bytes.length; length++)
      expect(() =>
        parse(GameOpcode.MSG_MOVE_HEARTBEAT, bytes.subarray(0, length)),
      ).toThrow(RangeError);
    expect(() => parse(GameOpcode.MSG_MOVE_HEARTBEAT, tail(bytes, 1))).toThrow(
      RangeError,
    );
  });

  test("rejects nonfinite values in world and optional movement branches", () => {
    const corruptions: Partial<Floats>[] = [
      { x: Number.NaN },
      { transportOrientation: Number.POSITIVE_INFINITY },
      { pitch: Number.NEGATIVE_INFINITY },
      { fallCosAngle: Number.NaN },
      { splineElevation: Number.POSITIVE_INFINITY },
    ];
    for (const corruption of corruptions)
      expect(() =>
        parse(GameOpcode.MSG_MOVE_HEARTBEAT, conditional(corruption)),
      ).toThrow(RangeError);
  });

  test("rejects forced-self, acknowledgments and nonrebroadcast request families", () => {
    for (const opcode of [
      0x0c7, 0x0dc, 0x0e2, 0x0e3, 0x0e8, 0x0ef, 0x0f0, 0x2ca, 0x343, 0x345,
      0x38d, 0xffff,
    ]) {
      const reader = new PacketReader(ordinary());
      expect(() => parseRemoteMovementBody(opcode, reader)).toThrow(RangeError);
      expect(reader.offset).toBe(0);
    }
  });
});

describe("remote movement observer tails", () => {
  test("collision-height observer preserves its float without inventing a speed update", () => {
    const body = parse(0x518, tail(ordinary(), 2.25));
    expect(body).toMatchObject({
      kind: "movement",
      transition: "ordinary",
      collisionHeight: 2.25,
    });
    expect(body).not.toHaveProperty("speed");
    expect(() => parse(0x518, ordinary())).toThrow(RangeError);
    expect(() => parse(0x518, tail(ordinary(), 2.25, 1))).toThrow(RangeError);
    expect(() =>
      parse(0x518, tail(ordinary(), Number.NEGATIVE_INFINITY)),
    ).toThrow(RangeError);
  });

  test("all nine speed observer opcodes require exactly one finite float after MovementInfo", () => {
    for (const opcode of [
      0x0cd, 0x0cf, 0x0d1, 0x0d3, 0x0d5, 0x0d8, 0x37e, 0x380, 0x45b,
    ]) {
      expect(parse(opcode, tail(ordinary(), 7.5))).toMatchObject({
        kind: "movement",
        transition: "ordinary",
        speed: 7.5,
      });
      expect(() => parse(opcode, ordinary())).toThrow(RangeError);
      expect(() => parse(opcode, tail(ordinary(), 7.5, 1))).toThrow(RangeError);
      expect(() => parse(opcode, tail(ordinary(), Number.NaN))).toThrow(
        RangeError,
      );
    }
  });

  test("teleport has the ordinary body layout but distinct discontinuity provenance", () => {
    expect(parse(0x0c5, ordinary())).toMatchObject({
      kind: "movement",
      transition: "teleport",
      info: { x: 1, y: 2, z: 3 },
    });
    expect(() => parse(0x0c5, tail(ordinary(), 123))).toThrow(RangeError);
  });

  test("knockback retains its separate four-float tail after the full falling body", () => {
    const body = parse(0x0f1, tail(conditional(), 0.5, 0.75, 12, -9));
    expect(body).toMatchObject({
      kind: "movement",
      transition: "knockback",
      info: {
        fall: { zSpeed: -8, sinAngle: 0.25, cosAngle: 0.75, xySpeed: 7 },
      },
      knockback: { sinAngle: 0.5, cosAngle: 0.75, xySpeed: 12, zSpeed: -9 },
    });
    expect(() => parse(0x0f1, conditional())).toThrow(RangeError);
    expect(() => parse(0x0f1, tail(conditional(), 0.5, 0.75, 12))).toThrow(
      RangeError,
    );
    expect(() =>
      parse(0x0f1, tail(conditional(), 0.5, 0.75, 12, -9, 1)),
    ).toThrow(RangeError);
    expect(() =>
      parse(
        0x0f1,
        tail(conditional(), 0.5, 0.75, 12, Number.POSITIVE_INFINITY),
      ),
    ).toThrow(RangeError);
  });

  test("time-skipped body is only u32 milliseconds, with no GUID or MovementInfo", () => {
    expect(parse(0x319, Uint8Array.of(0x78, 0x56, 0x34, 0x12))).toEqual({
      kind: "time_skipped",
      milliseconds: 0x12345678,
    });
    expect(parse(0x319, Uint8Array.of(255, 255, 255, 255))).toEqual({
      kind: "time_skipped",
      milliseconds: 0xffffffff,
    });
    expect(() => parse(0x319, Uint8Array.of(1, 2, 3))).toThrow(RangeError);
    expect(() => parse(0x319, Uint8Array.of(1, 2, 3, 4, 5))).toThrow(
      RangeError,
    );
    expect(() => parse(0x319, ordinary())).toThrow(RangeError);
  });
});
