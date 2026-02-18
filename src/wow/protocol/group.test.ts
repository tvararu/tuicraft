import { test, expect, describe } from "bun:test";
import { PacketReader, PacketWriter } from "wow/protocol/packet";
import {
  buildGroupInvite,
  buildGroupAccept,
  buildGroupDecline,
  buildGroupUninvite,
  buildGroupDisband,
  buildGroupSetLeader,
} from "wow/protocol/group";

describe("buildGroupInvite", () => {
  test("writes name and trailing u32 zero", () => {
    const body = buildGroupInvite("Voidtrix");
    const r = new PacketReader(body);
    expect(r.cString()).toBe("Voidtrix");
    expect(r.uint32LE()).toBe(0);
    expect(r.remaining).toBe(0);
  });
});

describe("buildGroupAccept", () => {
  test("writes u32 zero", () => {
    const body = buildGroupAccept();
    const r = new PacketReader(body);
    expect(r.uint32LE()).toBe(0);
    expect(r.remaining).toBe(0);
  });
});

describe("buildGroupDecline", () => {
  test("returns empty body", () => {
    expect(buildGroupDecline().byteLength).toBe(0);
  });
});

describe("buildGroupUninvite", () => {
  test("writes name as CString", () => {
    const body = buildGroupUninvite("Voidtrix");
    const r = new PacketReader(body);
    expect(r.cString()).toBe("Voidtrix");
    expect(r.remaining).toBe(0);
  });
});

describe("buildGroupDisband", () => {
  test("returns empty body", () => {
    expect(buildGroupDisband().byteLength).toBe(0);
  });
});

describe("buildGroupSetLeader", () => {
  test("writes 8-byte GUID", () => {
    const body = buildGroupSetLeader(0x42, 0x01);
    const r = new PacketReader(body);
    expect(r.uint32LE()).toBe(0x42);
    expect(r.uint32LE()).toBe(0x01);
    expect(r.remaining).toBe(0);
  });
});
