import { test, expect, describe } from "bun:test";
import { PacketReader, PacketWriter } from "wow/protocol/packet";
import { MovementFlag, MovementFlagExtra } from "wow/protocol/entity-fields";
import {
  writeMovementInfo,
  parseMovementInfo,
  parseWorldPosition,
  buildMoveMessage,
  buildTeleportAck,
  buildSpeedAck,
  buildRootAck,
  buildSetActiveMover,
  buildSetSelection,
  type MovementInfo,
} from "wow/protocol/movement";

const base: MovementInfo = {
  flags: 0,
  extraFlags: 0,
  time: 123456,
  x: 8709.46,
  y: -6671.76,
  z: 70.34,
  orientation: 2.5187,
  fallTime: 0,
};

function reserialize(info: MovementInfo): MovementInfo {
  const w = new PacketWriter();
  writeMovementInfo(w, info);
  return parseMovementInfo(new PacketReader(w.finish()));
}

describe("MovementInfo round-trip", () => {
  test("idle state is 30 bytes", () => {
    const w = new PacketWriter();
    writeMovementInfo(w, base);
    expect(w.finish().byteLength).toBe(30);
    const out = reserialize(base);
    expect(out.time).toBe(123456);
    expect(out.x).toBeCloseTo(8709.46, 2);
    expect(out.fallTime).toBe(0);
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
    const parsed = new PacketReader(w.finish());
    const out = parseMovementInfo(parsed);
    expect(out.x).toBe(1);
    expect(out.fallTime).toBe(77);
    expect(out.transport?.guidLow).toBe(0x1234);
    expect(out.transport?.seat).toBe(1);
    expect(parsed.remaining).toBe(0);
  });

  test("parser skips interpolated transport time", () => {
    const w = new PacketWriter();
    w.uint32LE(MovementFlag.ON_TRANSPORT);
    w.uint16LE(0x0400);
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
    const parsed = new PacketReader(w.finish());
    const out = parseMovementInfo(parsed);
    expect(out.x).toBe(1);
    expect(out.fallTime).toBe(88);
    expect(out.transport?.time2).toBe(1000);
    expect(parsed.remaining).toBe(0);
  });

  test("falling extras are z then sin then cos then xy", () => {
    const w = new PacketWriter();
    writeMovementInfo(w, {
      ...base,
      flags: MovementFlag.FALLING,
      fallTime: 250,
      fall: { zSpeed: -7.5, sinAngle: 0.866, cosAngle: 0.5, xySpeed: 7 },
    });
    const r = new PacketReader(w.finish());
    r.skip(4 + 2 + 4 + 16);
    expect(r.uint32LE()).toBe(250);
    expect(r.floatLE()).toBeCloseTo(-7.5, 4);
    expect(r.floatLE()).toBeCloseTo(0.866, 4);
    expect(r.floatLE()).toBeCloseTo(0.5, 4);
    expect(r.floatLE()).toBe(7);
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
    expect(parseMovementInfo(r).time).toBe(base.time);
    expect(r.remaining).toBe(0);
  });

  test("buildSetActiveMover writes the full guid", () => {
    const body = buildSetActiveMover(0x0764, 0xf130);
    const r = new PacketReader(body);
    expect(r.uint32LE()).toBe(0x0764);
    expect(r.uint32LE()).toBe(0xf130);
    expect(r.remaining).toBe(0);
  });

  test("buildSetSelection writes unpacked guid including zero", () => {
    const clear = buildSetSelection(0n);
    const r = new PacketReader(clear);
    expect(r.uint64LE()).toBe(0n);
    expect(r.remaining).toBe(0);
    const set = new PacketReader(buildSetSelection(0x1234n));
    expect(set.uint64LE()).toBe(0x1234n);
  });

  test("parseWorldPosition reads login verify layout", () => {
    const w = new PacketWriter();
    w.uint32LE(530);
    w.floatLE(8709.46);
    w.floatLE(-6671.76);
    w.floatLE(70.34);
    w.floatLE(1.5);
    const pos = parseWorldPosition(new PacketReader(w.finish()));
    expect(pos.mapId).toBe(530);
    expect(pos.x).toBeCloseTo(8709.46, 2);
    expect(pos.orientation).toBeCloseTo(1.5, 4);
  });
});
