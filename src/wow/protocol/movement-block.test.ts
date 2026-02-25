import { describe, expect, test } from "bun:test";
import { PacketReader, PacketWriter } from "./packet";
import { parseMovementBlock } from "./movement-block";
import { UpdateFlag, MovementFlag, MovementFlagExtra } from "./entity-fields";

function buildLivingBlock(
  opts: {
    updateFlags?: number;
    movementFlags?: number;
    movementFlagsExtra?: number;
    x?: number;
    y?: number;
    z?: number;
    orientation?: number;
    walkSpeed?: number;
    runSpeed?: number;
  } = {},
): PacketWriter {
  const w = new PacketWriter();
  w.uint16LE(opts.updateFlags ?? UpdateFlag.LIVING);
  w.uint32LE(opts.movementFlags ?? 0);
  w.uint16LE(opts.movementFlagsExtra ?? 0);
  w.uint32LE(0);
  w.floatLE(opts.x ?? 0);
  w.floatLE(opts.y ?? 0);
  w.floatLE(opts.z ?? 0);
  w.floatLE(opts.orientation ?? 0);
  w.floatLE(0);
  const speeds = [opts.walkSpeed ?? 0, opts.runSpeed ?? 0, 0, 0, 0, 0, 0, 0, 0];
  for (const s of speeds) w.floatLE(s);
  return w;
}

describe("parseMovementBlock", () => {
  test("LIVING flag, basic", () => {
    const w = buildLivingBlock({
      x: 1.5,
      y: 2.5,
      z: 3.5,
      orientation: 0.5,
      walkSpeed: 2.5,
      runSpeed: 7.0,
    });
    const r = new PacketReader(w.finish());
    const m = parseMovementBlock(r);
    expect(m.updateFlags).toBe(UpdateFlag.LIVING);
    expect(m.x).toBeCloseTo(1.5);
    expect(m.y).toBeCloseTo(2.5);
    expect(m.z).toBeCloseTo(3.5);
    expect(m.orientation).toBeCloseTo(0.5);
    expect(m.walkSpeed).toBeCloseTo(2.5);
    expect(m.runSpeed).toBeCloseTo(7.0);
    expect(r.remaining).toBe(0);
  });

  test("LIVING | SELF", () => {
    const w = buildLivingBlock({
      updateFlags: UpdateFlag.LIVING | UpdateFlag.SELF,
      x: 10,
      y: 20,
      z: 30,
      walkSpeed: 2.5,
      runSpeed: 7.0,
    });
    const r = new PacketReader(w.finish());
    const m = parseMovementBlock(r);
    expect(m.updateFlags).toBe(UpdateFlag.LIVING | UpdateFlag.SELF);
    expect(m.x).toBeCloseTo(10);
    expect(m.y).toBeCloseTo(20);
    expect(m.z).toBeCloseTo(30);
    expect(m.walkSpeed).toBeCloseTo(2.5);
    expect(m.runSpeed).toBeCloseTo(7.0);
    expect(r.remaining).toBe(0);
  });

  test("HAS_POSITION only", () => {
    const w = new PacketWriter();
    w.uint16LE(UpdateFlag.HAS_POSITION);
    w.floatLE(5.0);
    w.floatLE(6.0);
    w.floatLE(7.0);
    w.floatLE(1.0);
    const r = new PacketReader(w.finish());
    const m = parseMovementBlock(r);
    expect(m.updateFlags).toBe(UpdateFlag.HAS_POSITION);
    expect(m.x).toBeCloseTo(5.0);
    expect(m.y).toBeCloseTo(6.0);
    expect(m.z).toBeCloseTo(7.0);
    expect(m.orientation).toBeCloseTo(1.0);
    expect(r.remaining).toBe(0);
  });

  test("POSITION flag", () => {
    const w = new PacketWriter();
    w.uint16LE(UpdateFlag.POSITION);
    w.rawBytes(new Uint8Array([0]));
    w.floatLE(100);
    w.floatLE(200);
    w.floatLE(300);
    w.floatLE(0);
    w.floatLE(0);
    w.floatLE(0);
    w.floatLE(1.5);
    w.floatLE(0);
    const r = new PacketReader(w.finish());
    const m = parseMovementBlock(r);
    expect(m.updateFlags).toBe(UpdateFlag.POSITION);
    expect(m.x).toBeCloseTo(100);
    expect(m.y).toBeCloseTo(200);
    expect(m.z).toBeCloseTo(300);
    expect(m.orientation).toBeCloseTo(1.5);
    expect(r.remaining).toBe(0);
  });

  test("LIVING with FALLING", () => {
    const w = new PacketWriter();
    w.uint16LE(UpdateFlag.LIVING);
    w.uint32LE(MovementFlag.FALLING);
    w.uint16LE(0);
    w.uint32LE(0);
    w.floatLE(1);
    w.floatLE(2);
    w.floatLE(3);
    w.floatLE(0);
    w.floatLE(0);
    w.floatLE(0);
    w.floatLE(0);
    w.floatLE(0);
    w.floatLE(0);
    for (let i = 0; i < 9; i++) w.floatLE(0);
    const r = new PacketReader(w.finish());
    const m = parseMovementBlock(r);
    expect(m.x).toBeCloseTo(1);
    expect(m.y).toBeCloseTo(2);
    expect(m.z).toBeCloseTo(3);
    expect(r.remaining).toBe(0);
  });

  test("LIVING with ON_TRANSPORT", () => {
    const w = new PacketWriter();
    w.uint16LE(UpdateFlag.LIVING);
    w.uint32LE(MovementFlag.ON_TRANSPORT);
    w.uint16LE(0);
    w.uint32LE(0);
    w.floatLE(1);
    w.floatLE(2);
    w.floatLE(3);
    w.floatLE(0);
    w.rawBytes(new Uint8Array([0]));
    w.floatLE(0);
    w.floatLE(0);
    w.floatLE(0);
    w.floatLE(0);
    w.uint32LE(0);
    w.uint8(0);
    w.floatLE(0);
    for (let i = 0; i < 9; i++) w.floatLE(0);
    const r = new PacketReader(w.finish());
    const m = parseMovementBlock(r);
    expect(m.x).toBeCloseTo(1);
    expect(m.y).toBeCloseTo(2);
    expect(m.z).toBeCloseTo(3);
    expect(r.remaining).toBe(0);
  });

  test("LIVING with ON_TRANSPORT + INTERPOLATED_MOVEMENT", () => {
    const w = new PacketWriter();
    w.uint16LE(UpdateFlag.LIVING);
    w.uint32LE(MovementFlag.ON_TRANSPORT);
    w.uint16LE(MovementFlagExtra.INTERPOLATED_MOVEMENT);
    w.uint32LE(0);
    w.floatLE(1);
    w.floatLE(2);
    w.floatLE(3);
    w.floatLE(0);
    w.rawBytes(new Uint8Array([0]));
    w.floatLE(0);
    w.floatLE(0);
    w.floatLE(0);
    w.floatLE(0);
    w.uint32LE(0);
    w.uint8(0);
    w.uint32LE(0);
    w.floatLE(0);
    for (let i = 0; i < 9; i++) w.floatLE(0);
    const r = new PacketReader(w.finish());
    const m = parseMovementBlock(r);
    expect(m.x).toBeCloseTo(1);
    expect(m.y).toBeCloseTo(2);
    expect(m.z).toBeCloseTo(3);
    expect(r.remaining).toBe(0);
  });

  test("LIVING with SWIMMING", () => {
    const w = new PacketWriter();
    w.uint16LE(UpdateFlag.LIVING);
    w.uint32LE(MovementFlag.SWIMMING);
    w.uint16LE(0);
    w.uint32LE(0);
    w.floatLE(1);
    w.floatLE(2);
    w.floatLE(3);
    w.floatLE(0);
    w.floatLE(0);
    w.floatLE(0);
    for (let i = 0; i < 9; i++) w.floatLE(0);
    const r = new PacketReader(w.finish());
    const m = parseMovementBlock(r);
    expect(m.x).toBeCloseTo(1);
    expect(m.y).toBeCloseTo(2);
    expect(m.z).toBeCloseTo(3);
    expect(r.remaining).toBe(0);
  });

  test("LIVING with SPLINE_ELEVATION", () => {
    const w = new PacketWriter();
    w.uint16LE(UpdateFlag.LIVING);
    w.uint32LE(MovementFlag.SPLINE_ELEVATION);
    w.uint16LE(0);
    w.uint32LE(0);
    w.floatLE(1);
    w.floatLE(2);
    w.floatLE(3);
    w.floatLE(0);
    w.floatLE(0);
    w.floatLE(0);
    for (let i = 0; i < 9; i++) w.floatLE(0);
    const r = new PacketReader(w.finish());
    const m = parseMovementBlock(r);
    expect(m.x).toBeCloseTo(1);
    expect(m.y).toBeCloseTo(2);
    expect(m.z).toBeCloseTo(3);
    expect(r.remaining).toBe(0);
  });

  test("LIVING with SPLINE_ENABLED (no final flags)", () => {
    const w = new PacketWriter();
    w.uint16LE(UpdateFlag.LIVING);
    w.uint32LE(MovementFlag.SPLINE_ENABLED);
    w.uint16LE(0);
    w.uint32LE(0);
    w.floatLE(1);
    w.floatLE(2);
    w.floatLE(3);
    w.floatLE(0);
    w.floatLE(0);
    for (let i = 0; i < 9; i++) w.floatLE(0);
    w.uint32LE(0);
    w.uint32LE(0);
    w.uint32LE(0);
    w.uint32LE(0);
    w.floatLE(0);
    w.floatLE(0);
    w.floatLE(0);
    w.floatLE(0);
    w.uint32LE(0);
    w.uint8(0);
    w.floatLE(0);
    w.floatLE(0);
    w.floatLE(0);
    const r = new PacketReader(w.finish());
    const m = parseMovementBlock(r);
    expect(m.x).toBeCloseTo(1);
    expect(m.y).toBeCloseTo(2);
    expect(m.z).toBeCloseTo(3);
    expect(r.remaining).toBe(0);
  });

  test("LIVING with SPLINE_ENABLED + FINAL_ANGLE", () => {
    const w = new PacketWriter();
    w.uint16LE(UpdateFlag.LIVING);
    w.uint32LE(MovementFlag.SPLINE_ENABLED);
    w.uint16LE(0);
    w.uint32LE(0);
    w.floatLE(1);
    w.floatLE(2);
    w.floatLE(3);
    w.floatLE(0);
    w.floatLE(0);
    for (let i = 0; i < 9; i++) w.floatLE(0);
    w.uint32LE(0x00010000);
    w.floatLE(1.23);
    w.uint32LE(0);
    w.uint32LE(0);
    w.uint32LE(0);
    w.floatLE(0);
    w.floatLE(0);
    w.floatLE(0);
    w.floatLE(0);
    w.uint32LE(0);
    w.uint8(0);
    w.floatLE(0);
    w.floatLE(0);
    w.floatLE(0);
    const r = new PacketReader(w.finish());
    const m = parseMovementBlock(r);
    expect(m.x).toBeCloseTo(1);
    expect(r.remaining).toBe(0);
  });

  test("LIVING with SPLINE_ENABLED + FINAL_TARGET", () => {
    const w = new PacketWriter();
    w.uint16LE(UpdateFlag.LIVING);
    w.uint32LE(MovementFlag.SPLINE_ENABLED);
    w.uint16LE(0);
    w.uint32LE(0);
    w.floatLE(1);
    w.floatLE(2);
    w.floatLE(3);
    w.floatLE(0);
    w.floatLE(0);
    for (let i = 0; i < 9; i++) w.floatLE(0);
    w.uint32LE(0x00020000);
    w.uint64LE(42n);
    w.uint32LE(0);
    w.uint32LE(0);
    w.uint32LE(0);
    w.floatLE(0);
    w.floatLE(0);
    w.floatLE(0);
    w.floatLE(0);
    w.uint32LE(0);
    w.uint8(0);
    w.floatLE(0);
    w.floatLE(0);
    w.floatLE(0);
    const r = new PacketReader(w.finish());
    const m = parseMovementBlock(r);
    expect(m.x).toBeCloseTo(1);
    expect(r.remaining).toBe(0);
  });

  test("LIVING with SPLINE_ENABLED + FINAL_POINT", () => {
    const w = new PacketWriter();
    w.uint16LE(UpdateFlag.LIVING);
    w.uint32LE(MovementFlag.SPLINE_ENABLED);
    w.uint16LE(0);
    w.uint32LE(0);
    w.floatLE(1);
    w.floatLE(2);
    w.floatLE(3);
    w.floatLE(0);
    w.floatLE(0);
    for (let i = 0; i < 9; i++) w.floatLE(0);
    w.uint32LE(0x00040000);
    w.floatLE(0);
    w.floatLE(0);
    w.floatLE(0);
    w.uint32LE(0);
    w.uint32LE(0);
    w.uint32LE(0);
    w.floatLE(0);
    w.floatLE(0);
    w.floatLE(0);
    w.floatLE(0);
    w.uint32LE(0);
    w.uint8(0);
    w.floatLE(0);
    w.floatLE(0);
    w.floatLE(0);
    const r = new PacketReader(w.finish());
    const m = parseMovementBlock(r);
    expect(m.x).toBeCloseTo(1);
    expect(r.remaining).toBe(0);
  });

  test("LIVING with spline nodes", () => {
    const w = new PacketWriter();
    w.uint16LE(UpdateFlag.LIVING);
    w.uint32LE(MovementFlag.SPLINE_ENABLED);
    w.uint16LE(0);
    w.uint32LE(0);
    w.floatLE(1);
    w.floatLE(2);
    w.floatLE(3);
    w.floatLE(0);
    w.floatLE(0);
    for (let i = 0; i < 9; i++) w.floatLE(0);
    w.uint32LE(0);
    w.uint32LE(0);
    w.uint32LE(0);
    w.uint32LE(0);
    w.floatLE(0);
    w.floatLE(0);
    w.floatLE(0);
    w.floatLE(0);
    w.uint32LE(2);
    for (let i = 0; i < 6; i++) w.floatLE(0);
    w.uint8(0);
    w.floatLE(0);
    w.floatLE(0);
    w.floatLE(0);
    const r = new PacketReader(w.finish());
    const m = parseMovementBlock(r);
    expect(m.x).toBeCloseTo(1);
    expect(r.remaining).toBe(0);
  });

  test("trailing: HIGH_GUID", () => {
    const w = new PacketWriter();
    w.uint16LE(UpdateFlag.HAS_POSITION | UpdateFlag.HIGH_GUID);
    w.floatLE(5);
    w.floatLE(6);
    w.floatLE(7);
    w.floatLE(0);
    w.uint32LE(0);
    const r = new PacketReader(w.finish());
    const m = parseMovementBlock(r);
    expect(m.x).toBeCloseTo(5);
    expect(r.remaining).toBe(0);
  });

  test("trailing: LOW_GUID", () => {
    const w = new PacketWriter();
    w.uint16LE(UpdateFlag.HAS_POSITION | UpdateFlag.LOW_GUID);
    w.floatLE(5);
    w.floatLE(6);
    w.floatLE(7);
    w.floatLE(0);
    w.uint32LE(0);
    const r = new PacketReader(w.finish());
    const m = parseMovementBlock(r);
    expect(m.x).toBeCloseTo(5);
    expect(r.remaining).toBe(0);
  });

  test("trailing: HAS_ATTACKING_TARGET", () => {
    const w = new PacketWriter();
    w.uint16LE(UpdateFlag.HAS_POSITION | UpdateFlag.HAS_ATTACKING_TARGET);
    w.floatLE(5);
    w.floatLE(6);
    w.floatLE(7);
    w.floatLE(0);
    w.rawBytes(new Uint8Array([0]));
    const r = new PacketReader(w.finish());
    const m = parseMovementBlock(r);
    expect(m.x).toBeCloseTo(5);
    expect(r.remaining).toBe(0);
  });

  test("trailing: TRANSPORT", () => {
    const w = new PacketWriter();
    w.uint16LE(UpdateFlag.HAS_POSITION | UpdateFlag.TRANSPORT);
    w.floatLE(5);
    w.floatLE(6);
    w.floatLE(7);
    w.floatLE(0);
    w.uint32LE(0);
    const r = new PacketReader(w.finish());
    const m = parseMovementBlock(r);
    expect(m.x).toBeCloseTo(5);
    expect(r.remaining).toBe(0);
  });

  test("trailing: VEHICLE", () => {
    const w = new PacketWriter();
    w.uint16LE(UpdateFlag.HAS_POSITION | UpdateFlag.VEHICLE);
    w.floatLE(5);
    w.floatLE(6);
    w.floatLE(7);
    w.floatLE(0);
    w.uint32LE(0);
    w.floatLE(0);
    const r = new PacketReader(w.finish());
    const m = parseMovementBlock(r);
    expect(m.x).toBeCloseTo(5);
    expect(r.remaining).toBe(0);
  });

  test("trailing: ROTATION", () => {
    const w = new PacketWriter();
    w.uint16LE(UpdateFlag.HAS_POSITION | UpdateFlag.ROTATION);
    w.floatLE(5);
    w.floatLE(6);
    w.floatLE(7);
    w.floatLE(0);
    w.uint64LE(0n);
    const r = new PacketReader(w.finish());
    const m = parseMovementBlock(r);
    expect(m.x).toBeCloseTo(5);
    expect(r.remaining).toBe(0);
  });

  test("combined LIVING + trailing", () => {
    const w = new PacketWriter();
    const flags =
      UpdateFlag.LIVING | UpdateFlag.HAS_ATTACKING_TARGET | UpdateFlag.LOW_GUID;
    w.uint16LE(flags);
    w.uint32LE(0);
    w.uint16LE(0);
    w.uint32LE(0);
    w.floatLE(10);
    w.floatLE(20);
    w.floatLE(30);
    w.floatLE(0);
    w.floatLE(0);
    for (let i = 0; i < 9; i++) w.floatLE(0);
    w.uint32LE(0);
    w.rawBytes(new Uint8Array([0]));
    const r = new PacketReader(w.finish());
    const m = parseMovementBlock(r);
    expect(m.updateFlags).toBe(flags);
    expect(m.x).toBeCloseTo(10);
    expect(m.y).toBeCloseTo(20);
    expect(m.z).toBeCloseTo(30);
    expect(r.remaining).toBe(0);
  });
});
