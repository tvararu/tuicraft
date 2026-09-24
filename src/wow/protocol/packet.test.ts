import { test, expect, describe } from "bun:test";
import {
  PacketReader,
  PacketWriter,
  joinGuid,
  splitGuid,
} from "wow/protocol/packet";

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

test("PacketReader reads packed GUID with all bytes present", () => {
  const r = new PacketReader(
    new Uint8Array([0xff, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08]),
  );
  const { low, high } = r.packedGuid();
  expect(low).toBe(0x04030201);
  expect(high).toBe(0x08070605);
});

test("PacketReader reads packed GUID with only low bytes", () => {
  const r = new PacketReader(new Uint8Array([0x01, 0x42]));
  const { low, high } = r.packedGuid();
  expect(low).toBe(0x42);
  expect(high).toBe(0);
});

test("PacketReader reads packed GUID with no bytes (zero GUID)", () => {
  const r = new PacketReader(new Uint8Array([0x00]));
  const { low, high } = r.packedGuid();
  expect(low).toBe(0);
  expect(high).toBe(0);
});

test("PacketReader reads packed GUID with sparse bytes", () => {
  const r = new PacketReader(new Uint8Array([0x05, 0xaa, 0xbb]));
  const { low, high } = r.packedGuid();
  expect(low).toBe(0xaa | (0xbb << 16));
  expect(high).toBe(0);
});

describe("PacketReader.uint64LE", () => {
  test("reads 8-byte little-endian bigint", () => {
    const buf = new Uint8Array([0x08, 0, 0, 0, 0, 0, 0, 0]);
    const r = new PacketReader(buf);
    expect(r.uint64LE()).toBe(8n);
  });

  test("reads large values", () => {
    const buf = new Uint8Array([
      0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x7f,
    ]);
    const r = new PacketReader(buf);
    expect(r.uint64LE()).toBe(0x7fffffffffffffffn);
  });

  test("advances position by 8", () => {
    const buf = new Uint8Array(16);
    const r = new PacketReader(buf);
    r.uint64LE();
    expect(r.offset).toBe(8);
  });
});

describe("PacketWriter.uint64LE", () => {
  test("writes 8-byte little-endian bigint", () => {
    const w = new PacketWriter();
    w.uint64LE(42n);
    const buf = w.finish();
    expect(buf.byteLength).toBe(8);
    const r = new PacketReader(buf);
    expect(r.uint64LE()).toBe(42n);
  });

  test("roundtrips large values", () => {
    const w = new PacketWriter();
    w.uint64LE(0x7fffffffffffffffn);
    const r = new PacketReader(w.finish());
    expect(r.uint64LE()).toBe(0x7fffffffffffffffn);
  });
});

describe("PacketWriter.packedGuid", () => {
  function roundTrip(low: number, high: number) {
    const w = new PacketWriter();
    w.packedGuid(low, high);
    const bytes = w.finish();
    const r = new PacketReader(bytes);
    return { ...r.packedGuid(), size: bytes.byteLength };
  }

  test("zero guid is a single mask byte", () => {
    expect(roundTrip(0, 0)).toEqual({ low: 0, high: 0, size: 1 });
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
  });

  test("skips zero bytes in the middle", () => {
    const w = new PacketWriter();
    w.packedGuid(0x00ff00ff, 0);
    const bytes = w.finish();
    expect(bytes[0]).toBe(0b0101);
    expect(bytes.byteLength).toBe(3);
  });
});

describe("joinGuid", () => {
  test("joins signed halves as unsigned", () => {
    expect(joinGuid(0xcafebabe | 0, 0xdeadbeef | 0)).toBe(0xdeadbeefcafebaben);
  });
});

describe("splitGuid", () => {
  test("inverts joinGuid", () => {
    expect(splitGuid(0xdeadbeefcafebaben)).toEqual({
      low: 0xcafebabe,
      high: 0xdeadbeef,
    });
  });
});

describe("packedGuidBig", () => {
  test("round-trips a full guid", () => {
    const w = new PacketWriter();
    w.packedGuidBig(0xf1300040_0d000764n);
    const r = new PacketReader(w.finish());
    expect(r.packedGuidBig()).toBe(0xf1300040_0d000764n);
    expect(r.remaining).toBe(0);
  });
});

describe("vec3", () => {
  test("round-trips three floats", () => {
    const w = new PacketWriter();
    w.vec3({ x: 1.5, y: -2.25, z: 3 });
    const r = new PacketReader(w.finish());
    expect(r.vec3()).toEqual({ x: 1.5, y: -2.25, z: 3 });
    expect(r.remaining).toBe(0);
  });
});

describe("sizedString", () => {
  function sized(bytes: number[]) {
    const w = new PacketWriter();
    w.uint32LE(bytes.length);
    w.rawBytes(Uint8Array.from(bytes));
    return new PacketReader(w.finish());
  }

  test("strips the counted terminator", () => {
    const r = sized([0x68, 0x69, 0]);
    expect(r.sizedString()).toBe("hi");
    expect(r.remaining).toBe(0);
  });

  test("keeps text without a terminator", () => {
    expect(sized([0x68, 0x69]).sizedString()).toBe("hi");
  });
});
