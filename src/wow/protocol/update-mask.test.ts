import { describe, expect, test } from "bun:test";
import { PacketReader, PacketWriter } from "./packet";
import { parseUpdateMask } from "./update-mask";

function buildReader(...writeFn: ((w: PacketWriter) => void)[]): PacketReader {
  const w = new PacketWriter();
  for (const fn of writeFn) fn(w);
  return new PacketReader(w.finish());
}

describe("parseUpdateMask", () => {
  test("empty mask (0 blocks)", () => {
    const r = buildReader((w) => w.uint8(0));
    const result = parseUpdateMask(r);
    expect(result.size).toBe(0);
  });

  test("single field set in first block", () => {
    const r = buildReader(
      (w) => w.uint8(1),
      (w) => w.uint32LE(0x00000008),
      (w) => w.uint32LE(42),
    );
    const result = parseUpdateMask(r);
    expect(result.size).toBe(1);
    expect(result.get(3)).toBe(42);
  });

  test("multiple fields across multiple blocks (wowm test data)", () => {
    const r = buildReader(
      (w) => w.uint8(3),
      (w) => w.uint32LE(0x00000007),
      (w) => w.uint32LE(0x00800000),
      (w) => w.uint32LE(0x00000018),
      (w) => w.uint32LE(8),
      (w) => w.uint32LE(0),
      (w) => w.uint32LE(0x19),
      (w) => w.uint32LE(1),
      (w) => w.uint32LE(0x4d0c),
      (w) => w.uint32LE(0x4d0c),
    );
    const result = parseUpdateMask(r);
    expect(result.size).toBe(6);
    expect(result.get(0)).toBe(8);
    expect(result.get(1)).toBe(0);
    expect(result.get(2)).toBe(0x19);
    expect(result.get(55)).toBe(1);
    expect(result.get(67)).toBe(0x4d0c);
    expect(result.get(68)).toBe(0x4d0c);
  });

  test("all 32 bits set in one block", () => {
    const w = new PacketWriter();
    w.uint8(1);
    w.uint32LE(0xffffffff);
    for (let i = 0; i < 32; i++) w.uint32LE(i * 10);
    const r = new PacketReader(w.finish());
    const result = parseUpdateMask(r);
    expect(result.size).toBe(32);
    for (let i = 0; i < 32; i++) {
      expect(result.get(i)).toBe(i * 10);
    }
  });

  test("reader position advances past all bytes", () => {
    const w = new PacketWriter();
    w.uint8(1);
    w.uint32LE(0x00000008);
    w.uint32LE(99);
    w.uint8(0xff);
    const r = new PacketReader(w.finish());
    parseUpdateMask(r);
    expect(r.remaining).toBe(1);
  });

  test("two blocks, second block all zeros", () => {
    const r = buildReader(
      (w) => w.uint8(2),
      (w) => w.uint32LE(0x00000005),
      (w) => w.uint32LE(0x00000000),
      (w) => w.uint32LE(100),
      (w) => w.uint32LE(200),
    );
    const result = parseUpdateMask(r);
    expect(result.size).toBe(2);
    expect(result.get(0)).toBe(100);
    expect(result.get(2)).toBe(200);
  });

  test("bit at block boundary (bit 31 and bit 32)", () => {
    const r = buildReader(
      (w) => w.uint8(2),
      (w) => w.uint32LE(0x80000000),
      (w) => w.uint32LE(0x00000001),
      (w) => w.uint32LE(31_000),
      (w) => w.uint32LE(32_000),
    );
    const result = parseUpdateMask(r);
    expect(result.size).toBe(2);
    expect(result.get(31)).toBe(31_000);
    expect(result.get(32)).toBe(32_000);
  });
});
