import { test, expect } from "bun:test";
import { PacketReader, PacketWriter } from "protocol/packet";

test("PacketWriter writes and PacketReader reads uint8", () => {
  const w = new PacketWriter();
  w.uint8(0xff);
  const r = new PacketReader(w.finish());
  expect(r.uint8()).toBe(0xff);
});

test("PacketWriter writes and PacketReader reads uint16LE", () => {
  const w = new PacketWriter();
  w.uint16LE(0x1234);
  const r = new PacketReader(w.finish());
  expect(r.uint16LE()).toBe(0x1234);
});

test("PacketWriter writes and PacketReader reads uint16BE", () => {
  const w = new PacketWriter();
  w.uint16BE(0x1234);
  const r = new PacketReader(w.finish());
  expect(r.uint16BE()).toBe(0x1234);
});

test("PacketWriter writes and PacketReader reads uint32LE", () => {
  const w = new PacketWriter();
  w.uint32LE(0xdeadbeef);
  const r = new PacketReader(w.finish());
  expect(r.uint32LE()).toBe(0xdeadbeef);
});

test("PacketReader reads cString (null-terminated)", () => {
  const bytes = new Uint8Array([0x48, 0x69, 0x00]);
  const r = new PacketReader(bytes);
  expect(r.cString()).toBe("Hi");
});

test("PacketWriter writes cString with null terminator", () => {
  const w = new PacketWriter();
  w.cString("Hi");
  const data = w.finish();
  expect(data).toEqual(new Uint8Array([0x48, 0x69, 0x00]));
});

test("PacketReader reads bytes", () => {
  const bytes = new Uint8Array([1, 2, 3, 4, 5]);
  const r = new PacketReader(bytes);
  expect(r.bytes(3)).toEqual(new Uint8Array([1, 2, 3]));
  expect(r.bytes(2)).toEqual(new Uint8Array([4, 5]));
});

test("PacketWriter writes bytes", () => {
  const w = new PacketWriter();
  w.rawBytes(new Uint8Array([0xaa, 0xbb]));
  w.uint8(0xcc);
  expect(w.finish()).toEqual(new Uint8Array([0xaa, 0xbb, 0xcc]));
});

test("PacketWriter grows buffer dynamically", () => {
  const w = new PacketWriter(2);
  w.uint32LE(1);
  w.uint32LE(2);
  w.uint32LE(3);
  const r = new PacketReader(w.finish());
  expect(r.uint32LE()).toBe(1);
  expect(r.uint32LE()).toBe(2);
  expect(r.uint32LE()).toBe(3);
});

test("PacketReader remaining returns unread bytes", () => {
  const r = new PacketReader(new Uint8Array(10));
  r.uint32LE();
  expect(r.remaining).toBe(6);
});

test("PacketReader floatLE round-trips", () => {
  const w = new PacketWriter();
  w.floatLE(3.14);
  const r = new PacketReader(w.finish());
  expect(r.floatLE()).toBeCloseTo(3.14, 2);
});

test("PacketReader cString reads to end when no null terminator", () => {
  const bytes = new Uint8Array([0x48, 0x69]);
  const r = new PacketReader(bytes);
  expect(r.cString()).toBe("Hi");
  expect(r.remaining).toBe(0);
});

test("PacketReader bytes throws when requesting more than remaining", () => {
  const r = new PacketReader(new Uint8Array([1, 2, 3]));
  expect(() => r.bytes(5)).toThrow(RangeError);
});

test("PacketReader offset tracks read position", () => {
  const r = new PacketReader(new Uint8Array(8));
  expect(r.offset).toBe(0);
  r.uint16LE();
  expect(r.offset).toBe(2);
  r.uint32LE();
  expect(r.offset).toBe(6);
});

test("PacketWriter offset tracks write position", () => {
  const w = new PacketWriter();
  expect(w.offset).toBe(0);
  w.uint8(1);
  expect(w.offset).toBe(1);
  w.uint32LE(2);
  expect(w.offset).toBe(5);
});
