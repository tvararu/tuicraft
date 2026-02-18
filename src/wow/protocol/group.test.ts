import { test, expect, describe } from "bun:test";
import { PacketReader, PacketWriter } from "wow/protocol/packet";
import {
  buildGroupInvite,
  buildGroupAccept,
  buildGroupDecline,
  buildGroupUninvite,
  buildGroupDisband,
  buildGroupSetLeader,
  parsePartyCommandResult,
  parseGroupInvite,
  parseGroupSetLeader,
  parseGroupDecline,
} from "wow/protocol/group";
import { PartyResult, PartyOperation } from "wow/protocol/opcodes";

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

describe("parsePartyCommandResult", () => {
  test("parses invite success", () => {
    const w = new PacketWriter();
    w.uint32LE(PartyOperation.INVITE);
    w.cString("Voidtrix");
    w.uint32LE(PartyResult.SUCCESS);
    w.uint32LE(0);

    const result = parsePartyCommandResult(new PacketReader(w.finish()));
    expect(result.operation).toBe(PartyOperation.INVITE);
    expect(result.member).toBe("Voidtrix");
    expect(result.result).toBe(PartyResult.SUCCESS);
    expect(result.val).toBe(0);
  });

  test("parses player not found", () => {
    const w = new PacketWriter();
    w.uint32LE(PartyOperation.INVITE);
    w.cString("Nobody");
    w.uint32LE(PartyResult.BAD_PLAYER_NAME);
    w.uint32LE(0);

    const result = parsePartyCommandResult(new PacketReader(w.finish()));
    expect(result.result).toBe(PartyResult.BAD_PLAYER_NAME);
  });
});

describe("parseGroupInvite", () => {
  test("parses incoming invite", () => {
    const w = new PacketWriter();
    w.uint8(1);
    w.cString("Voidtrix");
    w.uint32LE(0);
    w.uint8(0);
    w.uint32LE(0);

    const result = parseGroupInvite(new PacketReader(w.finish()));
    expect(result.status).toBe(1);
    expect(result.name).toBe("Voidtrix");
  });
});

describe("parseGroupSetLeader", () => {
  test("parses leader name", () => {
    const w = new PacketWriter();
    w.cString("Xia");

    const result = parseGroupSetLeader(new PacketReader(w.finish()));
    expect(result.name).toBe("Xia");
  });
});

describe("parseGroupDecline", () => {
  test("parses declining player name", () => {
    const w = new PacketWriter();
    w.cString("Voidtrix");

    const result = parseGroupDecline(new PacketReader(w.finish()));
    expect(result.name).toBe("Voidtrix");
  });
});
