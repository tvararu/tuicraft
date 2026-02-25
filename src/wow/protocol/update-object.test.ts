import { describe, expect, test } from "bun:test";
import { PacketReader, PacketWriter } from "./packet";
import { parseUpdateObject, readGuidBigint } from "./update-object";
import { UpdateFlag } from "./entity-fields";

function writePackedGuid(w: PacketWriter, guid: bigint) {
  const low = Number(guid & 0xffffffffn);
  const high = Number((guid >> 32n) & 0xffffffffn);
  let mask = 0;
  const bytes: number[] = [];
  for (let i = 0; i < 4; i++) {
    const b = (low >> (i * 8)) & 0xff;
    if (b !== 0) {
      mask |= 1 << i;
      bytes.push(b);
    }
  }
  for (let i = 0; i < 4; i++) {
    const b = (high >> (i * 8)) & 0xff;
    if (b !== 0) {
      mask |= 1 << (i + 4);
      bytes.push(b);
    }
  }
  w.uint8(mask);
  for (const b of bytes) w.uint8(b);
}

function writeLivingSelfMovementBlock(
  w: PacketWriter,
  x: number,
  y: number,
  z: number,
  orientation: number,
) {
  w.uint16LE(UpdateFlag.LIVING | UpdateFlag.SELF);
  w.uint32LE(0);
  w.uint16LE(0);
  w.uint32LE(0);
  w.floatLE(x);
  w.floatLE(y);
  w.floatLE(z);
  w.floatLE(orientation);
  w.floatLE(0);
  for (let i = 0; i < 9; i++) w.floatLE(0);
}

function writeHasPositionMovementBlock(
  w: PacketWriter,
  x: number,
  y: number,
  z: number,
  orientation: number,
) {
  w.uint16LE(UpdateFlag.HAS_POSITION);
  w.floatLE(x);
  w.floatLE(y);
  w.floatLE(z);
  w.floatLE(orientation);
}

function writeUpdateMask(w: PacketWriter, fields: Map<number, number>) {
  let maxBit = 0;
  for (const bit of fields.keys()) {
    if (bit > maxBit) maxBit = bit;
  }
  const blockCount =
    maxBit === 0 && fields.size === 0 ? 0 : Math.floor(maxBit / 32) + 1;
  w.uint8(blockCount);
  const masks = new Array<number>(blockCount).fill(0);
  for (const bit of fields.keys()) {
    masks[Math.floor(bit / 32)]! |= 1 << (bit % 32);
  }
  for (const m of masks) w.uint32LE(m);
  for (let block = 0; block < blockCount; block++) {
    for (let bit = 0; bit < 32; bit++) {
      const index = block * 32 + bit;
      if (fields.has(index)) {
        w.uint32LE(fields.get(index)!);
      }
    }
  }
}

describe("parseUpdateObject", () => {
  test("CREATE_OBJECT2 for a player (wowm reference)", () => {
    const w = new PacketWriter();
    w.uint32LE(1);
    w.uint8(3);
    writePackedGuid(w, 8n);
    w.uint8(4);
    writeLivingSelfMovementBlock(w, -8949.95, -132.49, 83.53, 0);
    const fields = new Map<number, number>([
      [0, 8],
      [1, 0],
      [2, 0x19],
      [55, 1],
      [67, 0x4d0c],
      [68, 0x4d0c],
    ]);
    writeUpdateMask(w, fields);

    const r = new PacketReader(w.finish());
    const entries = parseUpdateObject(r);
    expect(r.remaining).toBe(0);
    expect(entries).toHaveLength(1);
    const e = entries[0]!;
    expect(e.type).toBe("create");
    if (e.type !== "create") throw new Error("wrong type");
    expect(e.guid).toBe(8n);
    expect(e.objectType).toBe(4);
    expect(e.position).toBeDefined();
    expect(e.position!.x).toBeCloseTo(-8949.95, 1);
    expect(e.position!.y).toBeCloseTo(-132.49, 1);
    expect(e.position!.z).toBeCloseTo(83.53, 1);
    expect(e.fields.size).toBe(6);
  });

  test("VALUES update", () => {
    const w = new PacketWriter();
    w.uint32LE(1);
    w.uint8(0);
    writePackedGuid(w, 42n);
    const fields = new Map<number, number>([[3, 999]]);
    writeUpdateMask(w, fields);

    const r = new PacketReader(w.finish());
    const entries = parseUpdateObject(r);
    expect(r.remaining).toBe(0);
    expect(entries).toHaveLength(1);
    const e = entries[0]!;
    expect(e.type).toBe("values");
    if (e.type !== "values") throw new Error("wrong type");
    expect(e.guid).toBe(42n);
    expect(e.fields.size).toBe(1);
    expect(e.fields.get(3)).toBe(999);
  });

  test("MOVEMENT update", () => {
    const w = new PacketWriter();
    w.uint32LE(1);
    w.uint8(1);
    writePackedGuid(w, 100n);
    writeHasPositionMovementBlock(w, 10.5, 20.5, 30.5, 1.25);

    const r = new PacketReader(w.finish());
    const entries = parseUpdateObject(r);
    expect(r.remaining).toBe(0);
    expect(entries).toHaveLength(1);
    const e = entries[0]!;
    expect(e.type).toBe("movement");
    if (e.type !== "movement") throw new Error("wrong type");
    expect(e.guid).toBe(100n);
    expect(e.position.x).toBeCloseTo(10.5);
    expect(e.position.y).toBeCloseTo(20.5);
    expect(e.position.z).toBeCloseTo(30.5);
    expect(e.position.orientation).toBeCloseTo(1.25);
  });

  test("OUT_OF_RANGE", () => {
    const w = new PacketWriter();
    w.uint32LE(1);
    w.uint8(4);
    w.uint32LE(2);
    writePackedGuid(w, 10n);
    writePackedGuid(w, 20n);

    const r = new PacketReader(w.finish());
    const entries = parseUpdateObject(r);
    expect(r.remaining).toBe(0);
    expect(entries).toHaveLength(1);
    const e = entries[0]!;
    expect(e.type).toBe("outOfRange");
    if (e.type !== "outOfRange") throw new Error("wrong type");
    expect(e.guids).toHaveLength(2);
    expect(e.guids[0]).toBe(10n);
    expect(e.guids[1]).toBe(20n);
  });

  test("NEAR_OBJECTS", () => {
    const w = new PacketWriter();
    w.uint32LE(1);
    w.uint8(5);
    w.uint32LE(2);
    writePackedGuid(w, 30n);
    writePackedGuid(w, 40n);

    const r = new PacketReader(w.finish());
    const entries = parseUpdateObject(r);
    expect(r.remaining).toBe(0);
    expect(entries).toHaveLength(1);
    const e = entries[0]!;
    expect(e.type).toBe("nearObjects");
    if (e.type !== "nearObjects") throw new Error("wrong type");
    expect(e.guids).toHaveLength(2);
    expect(e.guids[0]).toBe(30n);
    expect(e.guids[1]).toBe(40n);
  });

  test("multiple objects in one packet", () => {
    const w = new PacketWriter();
    w.uint32LE(2);

    w.uint8(3);
    writePackedGuid(w, 5n);
    w.uint8(4);
    writeLivingSelfMovementBlock(w, 1, 2, 3, 0);
    const createFields = new Map<number, number>([[0, 5]]);
    writeUpdateMask(w, createFields);

    w.uint8(0);
    writePackedGuid(w, 5n);
    const valFields = new Map<number, number>([[24, 100]]);
    writeUpdateMask(w, valFields);

    const r = new PacketReader(w.finish());
    const entries = parseUpdateObject(r);
    expect(r.remaining).toBe(0);
    expect(entries).toHaveLength(2);
    expect(entries[0]!.type).toBe("create");
    expect(entries[1]!.type).toBe("values");
  });

  test("CREATE_OBJECT for game object", () => {
    const w = new PacketWriter();
    w.uint32LE(1);
    w.uint8(2);
    writePackedGuid(w, 500n);
    w.uint8(5);
    writeHasPositionMovementBlock(w, 100, 200, 300, 0.5);
    const fields = new Map<number, number>([
      [0, 500],
      [1, 0],
    ]);
    writeUpdateMask(w, fields);

    const r = new PacketReader(w.finish());
    const entries = parseUpdateObject(r);
    expect(r.remaining).toBe(0);
    expect(entries).toHaveLength(1);
    const e = entries[0]!;
    expect(e.type).toBe("create");
    if (e.type !== "create") throw new Error("wrong type");
    expect(e.objectType).toBe(5);
    expect(e.position!.x).toBeCloseTo(100);
    expect(e.position!.y).toBeCloseTo(200);
    expect(e.position!.z).toBeCloseTo(300);
  });

  test("readGuidBigint composes high/low correctly", () => {
    const w = new PacketWriter();
    const guid = (0x12n << 32n) | 0x34n;
    writePackedGuid(w, guid);

    const r = new PacketReader(w.finish());
    const result = readGuidBigint(r);
    expect(result).toBe(guid);
  });

  test("readGuidBigint with large guid", () => {
    const w = new PacketWriter();
    const guid = (0xdeadbeefn << 32n) | 0xcafebaben;
    writePackedGuid(w, guid);

    const r = new PacketReader(w.finish());
    const result = readGuidBigint(r);
    expect(result).toBe(guid);
  });

  test("zero-count packet returns empty array", () => {
    const w = new PacketWriter();
    w.uint32LE(0);

    const r = new PacketReader(w.finish());
    const entries = parseUpdateObject(r);
    expect(r.remaining).toBe(0);
    expect(entries).toHaveLength(0);
  });
});
