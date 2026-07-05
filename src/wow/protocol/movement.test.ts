import { test, expect, describe } from "bun:test";
import { PacketReader, PacketWriter } from "wow/protocol/packet";
import { MovementFlag, MovementFlagExtra } from "wow/protocol/entity-fields";
import {
  writeMovementInfo,
  parseMovementInfo,
  buildMoveMessage,
  buildTeleportAck,
  buildSpeedAck,
  buildRootAck,
  buildSetActiveMover,
  type MovementInfo,
} from "wow/protocol/movement";

describe("PacketWriter.packedGuid", () => {
  function roundTrip(low: number, high: number) {
    const w = new PacketWriter();
    w.packedGuid(low, high);
    const bytes = w.finish();
    const r = new PacketReader(bytes);
    return { ...r.packedGuid(), size: bytes.byteLength };
  }

  test("zero guid is a single mask byte", () => {
    const result = roundTrip(0, 0);
    expect(result).toEqual({ low: 0, high: 0, size: 1 });
  });

  test("low-only guid round-trips", () => {
    const result = roundTrip(0x0764, 0);
    expect(result.low).toBe(0x0764);
    expect(result.high).toBe(0);
    expect(result.size).toBe(3);
  });

  test("full guid round-trips", () => {
    const result = roundTrip(0x0d000764 | 0, 0xf1300040 | 0);
    expect(result.low >>> 0).toBe(0x0d000764);
    expect(result.high >>> 0).toBe(0xf1300040);
    expect(result.size).toBe(1 + 3 + 3);
  });

  test("skips zero bytes in the middle", () => {
    const w = new PacketWriter();
    w.packedGuid(0x00ff00ff, 0);
    const bytes = w.finish();
    expect(bytes[0]).toBe(0b0101);
    expect(bytes.byteLength).toBe(3);
  });
});

const base: MovementInfo = {
  flags: 0,
  extraFlags: 0,
  time: 123456,
  x: 8702.686,
  y: -6638.76,
  z: 72.744,
  orientation: 2.5187,
  fallTime: 0,
};

function reserialize(info: MovementInfo): MovementInfo {
  const w = new PacketWriter();
  writeMovementInfo(w, info);
  return parseMovementInfo(new PacketReader(w.finish()));
}

describe("MovementInfo round-trip", () => {
  test("idle state", () => {
    const out = reserialize(base);
    expect(out.flags).toBe(0);
    expect(out.time).toBe(123456);
    expect(out.x).toBeCloseTo(8702.686, 2);
    expect(out.y).toBeCloseTo(-6638.76, 2);
    expect(out.z).toBeCloseTo(72.744, 2);
    expect(out.orientation).toBeCloseTo(2.5187, 3);
    expect(out.fallTime).toBe(0);
    expect(out.fall).toBeUndefined();
    expect(out.pitch).toBeUndefined();
  });

  test("walking forward is 30 bytes", () => {
    const w = new PacketWriter();
    writeMovementInfo(w, { ...base, flags: MovementFlag.FORWARD });
    expect(w.finish().byteLength).toBe(30);
  });

  test("falling carries the fall block", () => {
    const out = reserialize({
      ...base,
      flags: MovementFlag.FORWARD | MovementFlag.FALLING,
      fallTime: 250,
      fall: { zSpeed: -7.9555473, cosAngle: 0.5, sinAngle: 0.866, xySpeed: 7 },
    });
    expect(out.fallTime).toBe(250);
    expect(out.fall?.zSpeed).toBeCloseTo(-7.9555473, 4);
    expect(out.fall?.xySpeed).toBe(7);
  });

  test("falling without fall data writes zeros", () => {
    const out = reserialize({ ...base, flags: MovementFlag.FALLING });
    expect(out.fall).toEqual({
      zSpeed: 0,
      cosAngle: 1,
      sinAngle: 0,
      xySpeed: 0,
    });
  });

  test("swimming carries pitch", () => {
    const out = reserialize({
      ...base,
      flags: MovementFlag.SWIMMING,
      pitch: -0.25,
    });
    expect(out.pitch).toBeCloseTo(-0.25, 4);
  });

  test("always-allow-pitching extra flag carries pitch", () => {
    const out = reserialize({
      ...base,
      extraFlags: MovementFlagExtra.ALWAYS_ALLOW_PITCHING,
      pitch: 0.5,
    });
    expect(out.pitch).toBeCloseTo(0.5, 4);
  });

  test("pitch defaults to zero when flagged but unset", () => {
    const out = reserialize({ ...base, flags: MovementFlag.SWIMMING });
    expect(out.pitch).toBe(0);
  });

  test("spline elevation round-trips", () => {
    const out = reserialize({
      ...base,
      flags: MovementFlag.SPLINE_ELEVATION,
      splineElevation: 1.5,
    });
    expect(out.splineElevation).toBeCloseTo(1.5, 4);
  });

  test("spline elevation defaults to zero when flagged but unset", () => {
    const out = reserialize({ ...base, flags: MovementFlag.SPLINE_ELEVATION });
    expect(out.splineElevation).toBe(0);
  });

  test("parser skips transport block", () => {
    const w = new PacketWriter();
    w.uint32LE(MovementFlag.ON_TRANSPORT);
    w.uint16LE(0);
    w.uint32LE(42);
    w.floatLE(1);
    w.floatLE(2);
    w.floatLE(3);
    w.floatLE(0.5);
    w.packedGuid(0x1234, 0);
    w.floatLE(0);
    w.floatLE(0);
    w.floatLE(0);
    w.floatLE(0);
    w.uint32LE(999);
    w.uint8(1);
    w.uint32LE(77);
    const out = parseMovementInfo(new PacketReader(w.finish()));
    expect(out.x).toBe(1);
    expect(out.fallTime).toBe(77);
  });

  test("parser skips interpolated transport time", () => {
    const w = new PacketWriter();
    w.uint32LE(MovementFlag.ON_TRANSPORT);
    w.uint16LE(MovementFlagExtra.INTERPOLATED_MOVEMENT);
    w.uint32LE(42);
    w.floatLE(1);
    w.floatLE(2);
    w.floatLE(3);
    w.floatLE(0.5);
    w.packedGuid(0x1234, 0);
    w.floatLE(0);
    w.floatLE(0);
    w.floatLE(0);
    w.floatLE(0);
    w.uint32LE(999);
    w.uint8(1);
    w.uint32LE(1000);
    w.uint32LE(88);
    const out = parseMovementInfo(new PacketReader(w.finish()));
    expect(out.fallTime).toBe(88);
  });
});

describe("packet builders", () => {
  test("buildMoveMessage prefixes the packed guid", () => {
    const body = buildMoveMessage(0x0764, 0, { ...base, flags: 1 });
    const r = new PacketReader(body);
    expect(r.packedGuid()).toEqual({ low: 0x0764, high: 0 });
    const info = parseMovementInfo(r);
    expect(info.flags).toBe(1);
    expect(r.remaining).toBe(0);
  });

  test("buildTeleportAck echoes counter and time", () => {
    const body = buildTeleportAck(0x0764, 0, 3, 456789);
    const r = new PacketReader(body);
    expect(r.packedGuid()).toEqual({ low: 0x0764, high: 0 });
    expect(r.uint32LE()).toBe(3);
    expect(r.uint32LE()).toBe(456789);
    expect(r.remaining).toBe(0);
  });

  test("buildSpeedAck echoes the exact f32 speed bits", () => {
    const speed = Math.fround(7.1234567);
    const body = buildSpeedAck(0x0764, 0, 5, base, speed);
    const r = new PacketReader(body);
    r.packedGuid();
    expect(r.uint32LE()).toBe(5);
    parseMovementInfo(r);
    expect(r.floatLE()).toBe(speed);
    expect(r.remaining).toBe(0);
  });

  test("buildRootAck carries counter and movement info", () => {
    const body = buildRootAck(0x0764, 0, 9, base);
    const r = new PacketReader(body);
    r.packedGuid();
    expect(r.uint32LE()).toBe(9);
    const info = parseMovementInfo(r);
    expect(info.time).toBe(base.time);
    expect(r.remaining).toBe(0);
  });

  test("buildSetActiveMover writes the full guid", () => {
    const body = buildSetActiveMover(0x0764, 0xf130);
    const r = new PacketReader(body);
    expect(r.uint32LE()).toBe(0x0764);
    expect(r.uint32LE()).toBe(0xf130);
    expect(r.remaining).toBe(0);
  });
});
