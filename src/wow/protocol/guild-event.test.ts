import { describe, expect, test } from "bun:test";
import {
  buildGuildDemote,
  buildGuildInvite,
  buildGuildLeader,
  buildGuildMotd,
  buildGuildPromote,
  buildGuildRemove,
  GuildEventCode,
  parseGuildEvent,
} from "wow/protocol/guild";
import { PacketReader, PacketWriter } from "wow/protocol/packet";

describe("parseGuildEvent", () => {
  test("parses MOTD with 1 string param", () => {
    const w = new PacketWriter();
    w.uint8(GuildEventCode.MOTD);
    w.uint8(1);
    w.cString("Welcome back!");
    const result = parseGuildEvent(new PacketReader(w.finish()));
    expect(result).toEqual({
      eventType: GuildEventCode.MOTD,
      params: ["Welcome back!"],
    });
  });

  test("parses PROMOTION with 3 string params", () => {
    const w = new PacketWriter();
    w.uint8(GuildEventCode.PROMOTION);
    w.uint8(3);
    w.cString("Thrall");
    w.cString("Garrosh");
    w.cString("Officer");
    const result = parseGuildEvent(new PacketReader(w.finish()));
    expect(result).toEqual({
      eventType: GuildEventCode.PROMOTION,
      params: ["Thrall", "Garrosh", "Officer"],
    });
  });

  test("parses DISBANDED with 0 string params", () => {
    const w = new PacketWriter();
    w.uint8(GuildEventCode.DISBANDED);
    w.uint8(0);
    const result = parseGuildEvent(new PacketReader(w.finish()));
    expect(result).toEqual({
      eventType: GuildEventCode.DISBANDED,
      params: [],
    });
  });

  test("parses SIGNED_ON with trailing guid", () => {
    const w = new PacketWriter();
    w.uint8(GuildEventCode.SIGNED_ON);
    w.uint8(1);
    w.cString("Jaina");
    w.uint64LE(42n);
    const r = new PacketReader(w.finish());
    const result = parseGuildEvent(r);
    expect(result).toEqual({
      eventType: GuildEventCode.SIGNED_ON,
      params: ["Jaina"],
    });
    expect(r.remaining).toBe(0);
  });

  test("parses JOINED with trailing guid", () => {
    const w = new PacketWriter();
    w.uint8(GuildEventCode.JOINED);
    w.uint8(1);
    w.cString("Arthas");
    w.uint64LE(99n);
    const r = new PacketReader(w.finish());
    parseGuildEvent(r);
    expect(r.remaining).toBe(0);
  });

  test("parses LEFT with trailing guid", () => {
    const w = new PacketWriter();
    w.uint8(GuildEventCode.LEFT);
    w.uint8(1);
    w.cString("Sylvanas");
    w.uint64LE(7n);
    const r = new PacketReader(w.finish());
    parseGuildEvent(r);
    expect(r.remaining).toBe(0);
  });

  test("parses SIGNED_OFF with trailing guid", () => {
    const w = new PacketWriter();
    w.uint8(GuildEventCode.SIGNED_OFF);
    w.uint8(1);
    w.cString("Varian");
    w.uint64LE(55n);
    const r = new PacketReader(w.finish());
    parseGuildEvent(r);
    expect(r.remaining).toBe(0);
  });

  test("parses REMOVED with 2 string params", () => {
    const w = new PacketWriter();
    w.uint8(GuildEventCode.REMOVED);
    w.uint8(2);
    w.cString("Garrosh");
    w.cString("Thrall");
    const result = parseGuildEvent(new PacketReader(w.finish()));
    expect(result).toEqual({
      eventType: GuildEventCode.REMOVED,
      params: ["Garrosh", "Thrall"],
    });
  });

  test("parses LEADER_CHANGED with 2 string params", () => {
    const w = new PacketWriter();
    w.uint8(GuildEventCode.LEADER_CHANGED);
    w.uint8(2);
    w.cString("Thrall");
    w.cString("Garrosh");
    const result = parseGuildEvent(new PacketReader(w.finish()));
    expect(result).toEqual({
      eventType: GuildEventCode.LEADER_CHANGED,
      params: ["Thrall", "Garrosh"],
    });
  });

  test("parses unknown event type without crashing", () => {
    const w = new PacketWriter();
    w.uint8(19);
    w.uint8(0);
    const result = parseGuildEvent(new PacketReader(w.finish()));
    expect(result.eventType).toBe(19);
    expect(result.params).toEqual([]);
  });
});

describe("buildGuildInvite", () => {
  test("writes player name as CString", () => {
    const buf = buildGuildInvite("Thrall");
    const r = new PacketReader(buf);
    expect(r.cString()).toBe("Thrall");
    expect(r.remaining).toBe(0);
  });
});

describe("buildGuildRemove", () => {
  test("writes player name as CString", () => {
    const buf = buildGuildRemove("Garrosh");
    const r = new PacketReader(buf);
    expect(r.cString()).toBe("Garrosh");
    expect(r.remaining).toBe(0);
  });
});

describe("buildGuildPromote", () => {
  test("writes player name as CString", () => {
    const buf = buildGuildPromote("Jaina");
    const r = new PacketReader(buf);
    expect(r.cString()).toBe("Jaina");
    expect(r.remaining).toBe(0);
  });
});

describe("buildGuildDemote", () => {
  test("writes player name as CString", () => {
    const buf = buildGuildDemote("Arthas");
    const r = new PacketReader(buf);
    expect(r.cString()).toBe("Arthas");
    expect(r.remaining).toBe(0);
  });
});

describe("buildGuildLeader", () => {
  test("writes player name as CString", () => {
    const buf = buildGuildLeader("Sylvanas");
    const r = new PacketReader(buf);
    expect(r.cString()).toBe("Sylvanas");
    expect(r.remaining).toBe(0);
  });
});

describe("buildGuildMotd", () => {
  test("writes motd as CString", () => {
    const buf = buildGuildMotd("Raid tonight at 8pm");
    const r = new PacketReader(buf);
    expect(r.cString()).toBe("Raid tonight at 8pm");
    expect(r.remaining).toBe(0);
  });

  test("writes empty motd", () => {
    const buf = buildGuildMotd("");
    const r = new PacketReader(buf);
    expect(r.cString()).toBe("");
    expect(r.remaining).toBe(0);
  });
});
