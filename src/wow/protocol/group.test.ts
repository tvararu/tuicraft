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
  parseGroupList,
  parsePartyMemberStats,
} from "wow/protocol/group";
import {
  PartyResult,
  PartyOperation,
  GroupUpdateFlag,
} from "wow/protocol/opcodes";

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

describe("parseGroupList", () => {
  test("parses two-member group", () => {
    const w = new PacketWriter();
    w.uint8(0);
    w.uint8(0);
    w.uint8(0);
    w.uint8(0);
    w.uint32LE(0);
    w.uint32LE(0);
    w.uint32LE(1);
    w.uint32LE(2);
    w.cString("Xia");
    w.uint32LE(0x10);
    w.uint32LE(0x00);
    w.uint8(1);
    w.uint8(0);
    w.uint8(0);
    w.uint8(0);
    w.cString("Voidtrix");
    w.uint32LE(0x20);
    w.uint32LE(0x00);
    w.uint8(1);
    w.uint8(0);
    w.uint8(0);
    w.uint8(0);
    w.uint32LE(0x10);
    w.uint32LE(0x00);

    const result = parseGroupList(new PacketReader(w.finish()));
    expect(result.members).toHaveLength(2);
    expect(result.members[0]!.name).toBe("Xia");
    expect(result.members[0]!.guidLow).toBe(0x10);
    expect(result.members[0]!.online).toBe(true);
    expect(result.members[1]!.name).toBe("Voidtrix");
    expect(result.leaderGuidLow).toBe(0x10);
  });

  test("parses empty group", () => {
    const w = new PacketWriter();
    w.uint8(0);
    w.uint8(0);
    w.uint8(0);
    w.uint8(0);
    w.uint32LE(0);
    w.uint32LE(0);
    w.uint32LE(0);
    w.uint32LE(0);
    w.uint32LE(0);
    w.uint32LE(0);

    const result = parseGroupList(new PacketReader(w.finish()));
    expect(result.members).toHaveLength(0);
  });
});

describe("parsePartyMemberStats", () => {
  test("parses status + hp + level", () => {
    const w = new PacketWriter();
    w.uint8(0x01);
    w.uint8(0x42);
    const mask =
      GroupUpdateFlag.STATUS |
      GroupUpdateFlag.CUR_HP |
      GroupUpdateFlag.MAX_HP |
      GroupUpdateFlag.LEVEL;
    w.uint32LE(mask);
    w.uint16LE(0x01);
    w.uint32LE(12000);
    w.uint32LE(15000);
    w.uint16LE(80);

    const result = parsePartyMemberStats(new PacketReader(w.finish()));
    expect(result.guidLow).toBe(0x42);
    expect(result.online).toBe(true);
    expect(result.hp).toBe(12000);
    expect(result.maxHp).toBe(15000);
    expect(result.level).toBe(80);
  });

  test("parses status-only update", () => {
    const w = new PacketWriter();
    w.uint8(0x01);
    w.uint8(0x10);
    w.uint32LE(GroupUpdateFlag.STATUS);
    w.uint16LE(0x04);

    const result = parsePartyMemberStats(new PacketReader(w.finish()));
    expect(result.guidLow).toBe(0x10);
    expect(result.online).toBe(false);
    expect(result.hp).toBeUndefined();
  });

  test("skips power and zone fields correctly", () => {
    const w = new PacketWriter();
    w.uint8(0x01);
    w.uint8(0x10);
    const mask =
      GroupUpdateFlag.STATUS |
      GroupUpdateFlag.POWER_TYPE |
      GroupUpdateFlag.CUR_POWER |
      GroupUpdateFlag.MAX_POWER |
      GroupUpdateFlag.LEVEL |
      GroupUpdateFlag.ZONE;
    w.uint32LE(mask);
    w.uint16LE(0x01);
    w.uint8(0);
    w.uint16LE(5000);
    w.uint16LE(8000);
    w.uint16LE(80);
    w.uint16LE(1);

    const result = parsePartyMemberStats(new PacketReader(w.finish()));
    expect(result.level).toBe(80);
    expect(result.online).toBe(true);
  });

  test("skips auras correctly", () => {
    const w = new PacketWriter();
    w.uint8(0x01);
    w.uint8(0x10);
    const mask = GroupUpdateFlag.STATUS | GroupUpdateFlag.AURAS;
    w.uint32LE(mask);
    w.uint16LE(0x01);
    w.uint32LE(0x05);
    w.uint32LE(0x00);
    w.uint32LE(12345);
    w.uint8(0);
    w.uint32LE(67890);
    w.uint8(0);

    const result = parsePartyMemberStats(new PacketReader(w.finish()));
    expect(result.online).toBe(true);
  });

  test("skips high-mask auras correctly", () => {
    const w = new PacketWriter();
    w.uint8(0x01);
    w.uint8(0x11);
    const mask = GroupUpdateFlag.STATUS | GroupUpdateFlag.AURAS;
    w.uint32LE(mask);
    w.uint16LE(0x01);
    w.uint32LE(0x00);
    w.uint32LE(0x02);
    w.uint32LE(54321);
    w.uint8(0);

    const result = parsePartyMemberStats(new PacketReader(w.finish()));
    expect(result.online).toBe(true);
  });

  test("handles full stats variant with leading byte", () => {
    const w = new PacketWriter();
    w.uint8(0);
    w.uint8(0x01);
    w.uint8(0x42);
    w.uint32LE(GroupUpdateFlag.STATUS | GroupUpdateFlag.CUR_HP);
    w.uint16LE(0x01);
    w.uint32LE(10000);

    const result = parsePartyMemberStats(new PacketReader(w.finish()), true);
    expect(result.guidLow).toBe(0x42);
    expect(result.hp).toBe(10000);
  });

  test("skips position and pet guid fields correctly", () => {
    const w = new PacketWriter();
    w.uint8(0x01);
    w.uint8(0x10);
    const mask =
      GroupUpdateFlag.STATUS |
      GroupUpdateFlag.POSITION |
      GroupUpdateFlag.PET_GUID;
    w.uint32LE(mask);
    w.uint16LE(0x01);
    w.uint16LE(1234);
    w.uint16LE(5678);
    w.uint32LE(0xaaaa);
    w.uint32LE(0xbbbb);

    const result = parsePartyMemberStats(new PacketReader(w.finish()));
    expect(result.online).toBe(true);
    expect(result.guidLow).toBe(0x10);
  });
});
