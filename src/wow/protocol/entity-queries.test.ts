import { test, expect, describe } from "bun:test";
import { PacketReader, PacketWriter } from "./packet";
import {
  buildCreatureQuery,
  parseCreatureQueryResponse,
  buildGameObjectQuery,
  parseGameObjectQueryResponse,
} from "./entity-queries";

describe("creature query", () => {
  test("buildCreatureQuery produces u32 entry + u64 guid", () => {
    const buf = buildCreatureQuery(1234, 5n);
    const r = new PacketReader(buf);
    expect(r.uint32LE()).toBe(1234);
    expect(r.uint64LE()).toBe(5n);
    expect(r.remaining).toBe(0);
  });

  test("parseCreatureQueryResponse extracts name", () => {
    const w = new PacketWriter();
    w.uint32LE(1234);
    w.cString("Innkeeper Palla");
    w.cString("");
    w.cString("");
    w.cString("");
    w.cString("Innkeeper");
    const r = new PacketReader(w.finish());
    const result = parseCreatureQueryResponse(r);
    expect(result.entry).toBe(1234);
    expect(result.name).toBe("Innkeeper Palla");
  });

  test("parseCreatureQueryResponse handles unknown entry", () => {
    const w = new PacketWriter();
    w.uint32LE(1234 | 0x80000000);
    const r = new PacketReader(w.finish());
    const result = parseCreatureQueryResponse(r);
    expect(result.entry).toBe(1234);
    expect(result.name).toBeUndefined();
  });

  test("buildCreatureQuery with large guid", () => {
    const guid = 0xdeadbeefcafebaben;
    const buf = buildCreatureQuery(999, guid);
    const r = new PacketReader(buf);
    expect(r.uint32LE()).toBe(999);
    expect(r.uint64LE()).toBe(guid);
  });
});

describe("game object query", () => {
  test("buildGameObjectQuery produces u32 entry + u64 guid", () => {
    const buf = buildGameObjectQuery(5678, 10n);
    const r = new PacketReader(buf);
    expect(r.uint32LE()).toBe(5678);
    expect(r.uint64LE()).toBe(10n);
    expect(r.remaining).toBe(0);
  });

  test("parseGameObjectQueryResponse extracts name and type", () => {
    const w = new PacketWriter();
    w.uint32LE(5678);
    w.uint32LE(19);
    w.uint32LE(1234);
    w.cString("Mailbox");
    const r = new PacketReader(w.finish());
    const result = parseGameObjectQueryResponse(r);
    expect(result.entry).toBe(5678);
    expect(result.name).toBe("Mailbox");
    expect(result.gameObjectType).toBe(19);
  });

  test("parseGameObjectQueryResponse handles unknown entry", () => {
    const w = new PacketWriter();
    w.uint32LE(5678 | 0x80000000);
    const r = new PacketReader(w.finish());
    const result = parseGameObjectQueryResponse(r);
    expect(result.entry).toBe(5678);
    expect(result.name).toBeUndefined();
    expect(result.gameObjectType).toBeUndefined();
  });
});
