import { test, expect, describe } from "bun:test";
import { PacketReader, PacketWriter } from "wow/protocol/packet";
import {
  SocialFlag,
  FriendStatus,
  FriendResult,
  buildAddFriend,
  buildDelFriend,
  parseContactList,
  parseFriendStatus,
} from "wow/protocol/social";

describe("SocialFlag", () => {
  test("FRIEND is 0x01", () => {
    expect(SocialFlag.FRIEND).toBe(0x01);
  });

  test("IGNORED is 0x02", () => {
    expect(SocialFlag.IGNORED).toBe(0x02);
  });

  test("MUTED is 0x04", () => {
    expect(SocialFlag.MUTED).toBe(0x04);
  });
});

describe("FriendStatus", () => {
  test("OFFLINE is 0", () => {
    expect(FriendStatus.OFFLINE).toBe(0);
  });

  test("ONLINE is 1", () => {
    expect(FriendStatus.ONLINE).toBe(1);
  });

  test("AFK is 2", () => {
    expect(FriendStatus.AFK).toBe(2);
  });

  test("DND is 4", () => {
    expect(FriendStatus.DND).toBe(4);
  });
});

describe("FriendResult", () => {
  test("DB_ERROR is 0x00", () => {
    expect(FriendResult.DB_ERROR).toBe(0x00);
  });

  test("LIST_FULL is 0x01", () => {
    expect(FriendResult.LIST_FULL).toBe(0x01);
  });

  test("ONLINE is 0x02", () => {
    expect(FriendResult.ONLINE).toBe(0x02);
  });

  test("OFFLINE is 0x03", () => {
    expect(FriendResult.OFFLINE).toBe(0x03);
  });

  test("NOT_FOUND is 0x04", () => {
    expect(FriendResult.NOT_FOUND).toBe(0x04);
  });

  test("REMOVED is 0x05", () => {
    expect(FriendResult.REMOVED).toBe(0x05);
  });

  test("ADDED_ONLINE is 0x06", () => {
    expect(FriendResult.ADDED_ONLINE).toBe(0x06);
  });

  test("ADDED_OFFLINE is 0x07", () => {
    expect(FriendResult.ADDED_OFFLINE).toBe(0x07);
  });

  test("ALREADY is 0x08", () => {
    expect(FriendResult.ALREADY).toBe(0x08);
  });

  test("SELF is 0x09", () => {
    expect(FriendResult.SELF).toBe(0x09);
  });

  test("ENEMY is 0x0a", () => {
    expect(FriendResult.ENEMY).toBe(0x0a);
  });
});

describe("buildAddFriend", () => {
  test("writes name and note as CStrings", () => {
    const body = buildAddFriend("Voidtrix", "my buddy");
    const r = new PacketReader(body);
    expect(r.cString()).toBe("Voidtrix");
    expect(r.cString()).toBe("my buddy");
    expect(r.remaining).toBe(0);
  });

  test("writes empty note as empty CString", () => {
    const body = buildAddFriend("Xia", "");
    const r = new PacketReader(body);
    expect(r.cString()).toBe("Xia");
    expect(r.cString()).toBe("");
    expect(r.remaining).toBe(0);
  });
});

describe("buildDelFriend", () => {
  test("writes guid as uint64LE", () => {
    const body = buildDelFriend(0x0000000100000042n);
    const r = new PacketReader(body);
    expect(r.uint64LE()).toBe(0x0000000100000042n);
    expect(r.remaining).toBe(0);
  });

  test("writes zero guid", () => {
    const body = buildDelFriend(0n);
    const r = new PacketReader(body);
    expect(r.uint64LE()).toBe(0n);
    expect(r.remaining).toBe(0);
  });
});

describe("parseContactList", () => {
  test("parses empty list", () => {
    const w = new PacketWriter();
    w.uint32LE(SocialFlag.FRIEND);
    w.uint32LE(0);

    const result = parseContactList(new PacketReader(w.finish()));
    expect(result.listMask).toBe(SocialFlag.FRIEND);
    expect(result.contacts).toHaveLength(0);
  });

  test("parses online friend with status, area, level, class", () => {
    const w = new PacketWriter();
    w.uint32LE(SocialFlag.FRIEND);
    w.uint32LE(1);
    w.uint64LE(42n);
    w.uint32LE(SocialFlag.FRIEND);
    w.cString("best friend");
    w.uint8(FriendStatus.ONLINE);
    w.uint32LE(1519);
    w.uint32LE(80);
    w.uint32LE(9);

    const result = parseContactList(new PacketReader(w.finish()));
    expect(result.contacts).toHaveLength(1);
    const c = result.contacts[0]!;
    expect(c.guid).toBe(42n);
    expect(c.flags).toBe(SocialFlag.FRIEND);
    expect(c.note).toBe("best friend");
    expect(c.status).toBe(FriendStatus.ONLINE);
    expect(c.area).toBe(1519);
    expect(c.level).toBe(80);
    expect(c.playerClass).toBe(9);
  });

  test("parses offline friend with no area/level/class", () => {
    const w = new PacketWriter();
    w.uint32LE(SocialFlag.FRIEND);
    w.uint32LE(1);
    w.uint64LE(100n);
    w.uint32LE(SocialFlag.FRIEND);
    w.cString("");
    w.uint8(FriendStatus.OFFLINE);

    const result = parseContactList(new PacketReader(w.finish()));
    expect(result.contacts).toHaveLength(1);
    const c = result.contacts[0]!;
    expect(c.guid).toBe(100n);
    expect(c.flags).toBe(SocialFlag.FRIEND);
    expect(c.status).toBe(FriendStatus.OFFLINE);
    expect(c.area).toBeUndefined();
    expect(c.level).toBeUndefined();
    expect(c.playerClass).toBeUndefined();
  });

  test("parses AFK friend with area/level/class", () => {
    const w = new PacketWriter();
    w.uint32LE(SocialFlag.FRIEND);
    w.uint32LE(1);
    w.uint64LE(200n);
    w.uint32LE(SocialFlag.FRIEND);
    w.cString("afk note");
    w.uint8(FriendStatus.AFK);
    w.uint32LE(44);
    w.uint32LE(70);
    w.uint32LE(1);

    const result = parseContactList(new PacketReader(w.finish()));
    const c = result.contacts[0]!;
    expect(c.status).toBe(FriendStatus.AFK);
    expect(c.area).toBe(44);
    expect(c.level).toBe(70);
    expect(c.playerClass).toBe(1);
  });

  test("parses ignored entry with no status fields", () => {
    const w = new PacketWriter();
    w.uint32LE(SocialFlag.IGNORED);
    w.uint32LE(1);
    w.uint64LE(300n);
    w.uint32LE(SocialFlag.IGNORED);
    w.cString("");

    const result = parseContactList(new PacketReader(w.finish()));
    expect(result.contacts).toHaveLength(1);
    const c = result.contacts[0]!;
    expect(c.guid).toBe(300n);
    expect(c.flags).toBe(SocialFlag.IGNORED);
    expect(c.note).toBe("");
    expect(c.status).toBeUndefined();
    expect(c.area).toBeUndefined();
    expect(c.level).toBeUndefined();
    expect(c.playerClass).toBeUndefined();
  });

  test("parses mixed friends and ignored entries", () => {
    const w = new PacketWriter();
    w.uint32LE(SocialFlag.FRIEND | SocialFlag.IGNORED);
    w.uint32LE(3);

    w.uint64LE(10n);
    w.uint32LE(SocialFlag.FRIEND);
    w.cString("online pal");
    w.uint8(FriendStatus.ONLINE);
    w.uint32LE(1);
    w.uint32LE(80);
    w.uint32LE(5);

    w.uint64LE(20n);
    w.uint32LE(SocialFlag.IGNORED);
    w.cString("");

    w.uint64LE(30n);
    w.uint32LE(SocialFlag.FRIEND);
    w.cString("offline pal");
    w.uint8(FriendStatus.OFFLINE);

    const result = parseContactList(new PacketReader(w.finish()));
    expect(result.listMask).toBe(SocialFlag.FRIEND | SocialFlag.IGNORED);
    expect(result.contacts).toHaveLength(3);

    expect(result.contacts[0]!.guid).toBe(10n);
    expect(result.contacts[0]!.flags).toBe(SocialFlag.FRIEND);
    expect(result.contacts[0]!.status).toBe(FriendStatus.ONLINE);
    expect(result.contacts[0]!.area).toBe(1);
    expect(result.contacts[0]!.level).toBe(80);
    expect(result.contacts[0]!.playerClass).toBe(5);

    expect(result.contacts[1]!.guid).toBe(20n);
    expect(result.contacts[1]!.flags).toBe(SocialFlag.IGNORED);
    expect(result.contacts[1]!.status).toBeUndefined();

    expect(result.contacts[2]!.guid).toBe(30n);
    expect(result.contacts[2]!.flags).toBe(SocialFlag.FRIEND);
    expect(result.contacts[2]!.status).toBe(FriendStatus.OFFLINE);
    expect(result.contacts[2]!.area).toBeUndefined();
  });
});

describe("parseFriendStatus", () => {
  test("parses ADDED_ONLINE with note and online info", () => {
    const w = new PacketWriter();
    w.uint8(FriendResult.ADDED_ONLINE);
    w.uint64LE(42n);
    w.cString("new friend note");
    w.uint8(FriendStatus.ONLINE);
    w.uint32LE(1519);
    w.uint32LE(80);
    w.uint32LE(9);

    const result = parseFriendStatus(new PacketReader(w.finish()));
    expect(result.result).toBe(FriendResult.ADDED_ONLINE);
    expect(result.guid).toBe(42n);
    expect(result.note).toBe("new friend note");
    expect(result.status).toBe(FriendStatus.ONLINE);
    expect(result.area).toBe(1519);
    expect(result.level).toBe(80);
    expect(result.playerClass).toBe(9);
  });

  test("parses ADDED_OFFLINE with note but no online info", () => {
    const w = new PacketWriter();
    w.uint8(FriendResult.ADDED_OFFLINE);
    w.uint64LE(100n);
    w.cString("offline note");

    const result = parseFriendStatus(new PacketReader(w.finish()));
    expect(result.result).toBe(FriendResult.ADDED_OFFLINE);
    expect(result.guid).toBe(100n);
    expect(result.note).toBe("offline note");
    expect(result.status).toBeUndefined();
    expect(result.area).toBeUndefined();
    expect(result.level).toBeUndefined();
    expect(result.playerClass).toBeUndefined();
  });

  test("parses ONLINE with no note but has online info", () => {
    const w = new PacketWriter();
    w.uint8(FriendResult.ONLINE);
    w.uint64LE(200n);
    w.uint8(FriendStatus.ONLINE);
    w.uint32LE(44);
    w.uint32LE(70);
    w.uint32LE(1);

    const result = parseFriendStatus(new PacketReader(w.finish()));
    expect(result.result).toBe(FriendResult.ONLINE);
    expect(result.guid).toBe(200n);
    expect(result.note).toBeUndefined();
    expect(result.status).toBe(FriendStatus.ONLINE);
    expect(result.area).toBe(44);
    expect(result.level).toBe(70);
    expect(result.playerClass).toBe(1);
  });

  test("parses OFFLINE with just result and guid", () => {
    const w = new PacketWriter();
    w.uint8(FriendResult.OFFLINE);
    w.uint64LE(300n);

    const result = parseFriendStatus(new PacketReader(w.finish()));
    expect(result.result).toBe(FriendResult.OFFLINE);
    expect(result.guid).toBe(300n);
    expect(result.note).toBeUndefined();
    expect(result.status).toBeUndefined();
    expect(result.area).toBeUndefined();
  });

  test("parses REMOVED with just result and guid", () => {
    const w = new PacketWriter();
    w.uint8(FriendResult.REMOVED);
    w.uint64LE(400n);

    const result = parseFriendStatus(new PacketReader(w.finish()));
    expect(result.result).toBe(FriendResult.REMOVED);
    expect(result.guid).toBe(400n);
    expect(result.note).toBeUndefined();
    expect(result.status).toBeUndefined();
  });

  test("parses NOT_FOUND with just result and guid", () => {
    const w = new PacketWriter();
    w.uint8(FriendResult.NOT_FOUND);
    w.uint64LE(0n);

    const result = parseFriendStatus(new PacketReader(w.finish()));
    expect(result.result).toBe(FriendResult.NOT_FOUND);
    expect(result.guid).toBe(0n);
  });

  test("parses ALREADY with just result and guid", () => {
    const w = new PacketWriter();
    w.uint8(FriendResult.ALREADY);
    w.uint64LE(500n);

    const result = parseFriendStatus(new PacketReader(w.finish()));
    expect(result.result).toBe(FriendResult.ALREADY);
    expect(result.guid).toBe(500n);
  });

  test("parses SELF with just result and guid", () => {
    const w = new PacketWriter();
    w.uint8(FriendResult.SELF);
    w.uint64LE(600n);

    const result = parseFriendStatus(new PacketReader(w.finish()));
    expect(result.result).toBe(FriendResult.SELF);
    expect(result.guid).toBe(600n);
  });

  test("parses ENEMY with just result and guid", () => {
    const w = new PacketWriter();
    w.uint8(FriendResult.ENEMY);
    w.uint64LE(700n);

    const result = parseFriendStatus(new PacketReader(w.finish()));
    expect(result.result).toBe(FriendResult.ENEMY);
    expect(result.guid).toBe(700n);
  });

  test("parses LIST_FULL with just result and guid", () => {
    const w = new PacketWriter();
    w.uint8(FriendResult.LIST_FULL);
    w.uint64LE(800n);

    const result = parseFriendStatus(new PacketReader(w.finish()));
    expect(result.result).toBe(FriendResult.LIST_FULL);
    expect(result.guid).toBe(800n);
  });

  test("parses DB_ERROR with just result and guid", () => {
    const w = new PacketWriter();
    w.uint8(FriendResult.DB_ERROR);
    w.uint64LE(0n);

    const result = parseFriendStatus(new PacketReader(w.finish()));
    expect(result.result).toBe(FriendResult.DB_ERROR);
    expect(result.guid).toBe(0n);
    expect(result.note).toBeUndefined();
    expect(result.status).toBeUndefined();
  });
});
