import { describe, expect, test } from "bun:test";
import {
  buildJoinChannel,
  buildLeaveChannel,
  buildRandomRoll,
  parseChannelNotify,
  parseNotification,
  parseRandomRoll,
  parseServerBroadcast,
} from "#wow/protocol/chat";
import { ChannelNotify } from "#wow/protocol/opcodes";
import { PacketReader, PacketWriter } from "#wow/protocol/packet";

describe("parseChannelNotify", () => {
  test("parses YOU_JOINED", () => {
    const w = new PacketWriter();
    w.uint8(ChannelNotify.YOU_JOINED);
    w.cString("General - Elwynn Forest");
    w.uint8(0x10);
    w.uint32LE(1);
    w.uint32LE(0);

    const result = parseChannelNotify(new PacketReader(w.finish()));
    expect(result).toEqual({
      type: "joined",
      channel: "General - Elwynn Forest",
    });
  });

  test("parses YOU_LEFT", () => {
    const w = new PacketWriter();
    w.uint8(ChannelNotify.YOU_LEFT);
    w.cString("General - Elwynn Forest");
    w.uint32LE(1);
    w.uint8(1);

    const result = parseChannelNotify(new PacketReader(w.finish()));
    expect(result).toEqual({
      type: "left",
      channel: "General - Elwynn Forest",
    });
  });

  test("returns other for unknown type", () => {
    const w = new PacketWriter();
    w.uint8(0x00);
    w.cString("General");

    const result = parseChannelNotify(new PacketReader(w.finish()));
    expect(result).toEqual({ type: "other" });
  });

  test("parses WRONG_PASSWORD", () => {
    const w = new PacketWriter();
    w.uint8(ChannelNotify.WRONG_PASSWORD);
    w.cString("Secret");

    const result = parseChannelNotify(new PacketReader(w.finish()));
    expect(result).toEqual({
      type: "error",
      channel: "Secret",
      code: ChannelNotify.WRONG_PASSWORD,
      message: "Wrong password for Secret",
    });
  });

  test("parses NOT_MEMBER", () => {
    const w = new PacketWriter();
    w.uint8(ChannelNotify.NOT_MEMBER);
    w.cString("Trade");

    const result = parseChannelNotify(new PacketReader(w.finish()));
    expect(result).toEqual({
      type: "error",
      channel: "Trade",
      code: ChannelNotify.NOT_MEMBER,
      message: "Not on channel Trade",
    });
  });

  test("parses BANNED", () => {
    const w = new PacketWriter();
    w.uint8(ChannelNotify.BANNED);
    w.cString("Trade");

    const result = parseChannelNotify(new PacketReader(w.finish()));
    expect(result).toEqual({
      type: "error",
      channel: "Trade",
      code: ChannelNotify.BANNED,
      message: "You are banned from Trade",
    });
  });

  test("parses MUTED", () => {
    const w = new PacketWriter();
    w.uint8(ChannelNotify.MUTED);
    w.cString("General");

    const result = parseChannelNotify(new PacketReader(w.finish()));
    expect(result).toEqual({
      type: "error",
      channel: "General",
      code: ChannelNotify.MUTED,
      message: "You do not have permission to speak in General",
    });
  });

  test("parses ALREADY_MEMBER", () => {
    const w = new PacketWriter();
    w.uint8(ChannelNotify.ALREADY_MEMBER);
    w.cString("General");

    const result = parseChannelNotify(new PacketReader(w.finish()));
    expect(result).toEqual({
      type: "error",
      channel: "General",
      code: ChannelNotify.ALREADY_MEMBER,
      message: "You are already in General",
    });
  });

  test("parses INVALID_NAME", () => {
    const w = new PacketWriter();
    w.uint8(ChannelNotify.INVALID_NAME);
    w.cString("");

    const result = parseChannelNotify(new PacketReader(w.finish()));
    expect(result).toEqual({
      type: "error",
      channel: "",
      code: ChannelNotify.INVALID_NAME,
      message: "Invalid channel name",
    });
  });

  test("parses THROTTLED", () => {
    const w = new PacketWriter();
    w.uint8(ChannelNotify.THROTTLED);
    w.cString("General");

    const result = parseChannelNotify(new PacketReader(w.finish()));
    expect(result).toEqual({
      type: "error",
      channel: "General",
      code: ChannelNotify.THROTTLED,
      message: "Channel message throttled in General",
    });
  });

  test("parses WRONG_FACTION", () => {
    const w = new PacketWriter();
    w.uint8(ChannelNotify.WRONG_FACTION);
    w.cString("General");

    const result = parseChannelNotify(new PacketReader(w.finish()));
    expect(result).toEqual({
      type: "error",
      channel: "General",
      code: ChannelNotify.WRONG_FACTION,
      message: "Wrong faction for General",
    });
  });

  test("parses NOT_IN_AREA", () => {
    const w = new PacketWriter();
    w.uint8(ChannelNotify.NOT_IN_AREA);
    w.cString("LocalDefense");

    const result = parseChannelNotify(new PacketReader(w.finish()));
    expect(result).toEqual({
      type: "error",
      channel: "LocalDefense",
      code: ChannelNotify.NOT_IN_AREA,
      message: "You are not in the correct area for LocalDefense",
    });
  });
});

describe("buildJoinChannel", () => {
  test("builds join packet without password", () => {
    const body = buildJoinChannel("General");
    const r = new PacketReader(body);
    expect(r.uint32LE()).toBe(0);
    expect(r.uint8()).toBe(0);
    expect(r.uint8()).toBe(0);
    expect(r.cString()).toBe("General");
    expect(r.cString()).toBe("");
  });

  test("builds join packet with password", () => {
    const body = buildJoinChannel("Secret", "hunter2");
    const r = new PacketReader(body);
    expect(r.uint32LE()).toBe(0);
    expect(r.uint8()).toBe(0);
    expect(r.uint8()).toBe(0);
    expect(r.cString()).toBe("Secret");
    expect(r.cString()).toBe("hunter2");
  });
});

describe("buildLeaveChannel", () => {
  test("builds leave packet", () => {
    const body = buildLeaveChannel("General");
    const r = new PacketReader(body);
    expect(r.uint32LE()).toBe(0);
    expect(r.cString()).toBe("General");
  });
});

describe("buildRandomRoll", () => {
  test("builds a roll packet with min and max", () => {
    const body = buildRandomRoll(1, 100);
    const r = new PacketReader(body);
    expect(r.uint32LE()).toBe(1);
    expect(r.uint32LE()).toBe(100);
  });

  test("builds a roll with custom range", () => {
    const body = buildRandomRoll(50, 200);
    const r = new PacketReader(body);
    expect(r.uint32LE()).toBe(50);
    expect(r.uint32LE()).toBe(200);
  });
});

describe("parseRandomRoll", () => {
  test("parses a roll result", () => {
    const w = new PacketWriter();
    w.uint32LE(1);
    w.uint32LE(100);
    w.uint32LE(42);
    w.uint32LE(0x10);
    w.uint32LE(0x00);

    const result = parseRandomRoll(new PacketReader(w.finish()));
    expect(result.min).toBe(1);
    expect(result.max).toBe(100);
    expect(result.result).toBe(42);
    expect(result.guidLow).toBe(0x10);
    expect(result.guidHigh).toBe(0x00);
  });

  test("parses a roll with large guid", () => {
    const w = new PacketWriter();
    w.uint32LE(0);
    w.uint32LE(999);
    w.uint32LE(500);
    w.uint32LE(0xde_ad_be_ef);
    w.uint32LE(0x00_00_00_01);

    const result = parseRandomRoll(new PacketReader(w.finish()));
    expect(result.min).toBe(0);
    expect(result.max).toBe(999);
    expect(result.result).toBe(500);
    expect(result.guidLow).toBe(0xde_ad_be_ef);
    expect(result.guidHigh).toBe(0x00_00_00_01);
  });
});

describe("parseServerBroadcast", () => {
  test("parses shutdown time message", () => {
    const w = new PacketWriter();
    w.uint32LE(1);
    w.cString("15:00");
    const result = parseServerBroadcast(new PacketReader(w.finish()));
    expect(result.message).toBe("Server shutdown in 15:00");
  });

  test("parses restart time message", () => {
    const w = new PacketWriter();
    w.uint32LE(2);
    w.cString("05:00");
    const result = parseServerBroadcast(new PacketReader(w.finish()));
    expect(result.message).toBe("Server restart in 05:00");
  });

  test("parses raw string message", () => {
    const w = new PacketWriter();
    w.uint32LE(3);
    w.cString("Custom admin broadcast");
    const result = parseServerBroadcast(new PacketReader(w.finish()));
    expect(result.message).toBe("Custom admin broadcast");
  });

  test("parses shutdown cancelled", () => {
    const w = new PacketWriter();
    w.uint32LE(4);
    w.cString("");
    const result = parseServerBroadcast(new PacketReader(w.finish()));
    expect(result.message).toBe("Server shutdown cancelled");
  });

  test("parses restart cancelled", () => {
    const w = new PacketWriter();
    w.uint32LE(5);
    w.cString("");
    const result = parseServerBroadcast(new PacketReader(w.finish()));
    expect(result.message).toBe("Server restart cancelled");
  });

  test("parses battleground shutdown", () => {
    const w = new PacketWriter();
    w.uint32LE(6);
    w.cString("10:00");
    const result = parseServerBroadcast(new PacketReader(w.finish()));
    expect(result.message).toBe("Battleground shutdown in 10:00");
  });

  test("parses battleground restart", () => {
    const w = new PacketWriter();
    w.uint32LE(7);
    w.cString("03:00");
    const result = parseServerBroadcast(new PacketReader(w.finish()));
    expect(result.message).toBe("Battleground restart in 03:00");
  });

  test("parses instance shutdown", () => {
    const w = new PacketWriter();
    w.uint32LE(8);
    w.cString("02:00");
    const result = parseServerBroadcast(new PacketReader(w.finish()));
    expect(result.message).toBe("Instance shutdown in 02:00");
  });

  test("parses instance restart", () => {
    const w = new PacketWriter();
    w.uint32LE(9);
    w.cString("01:00");
    const result = parseServerBroadcast(new PacketReader(w.finish()));
    expect(result.message).toBe("Instance restart in 01:00");
  });

  test("handles unknown message ID", () => {
    const w = new PacketWriter();
    w.uint32LE(99);
    w.cString("mystery");
    const result = parseServerBroadcast(new PacketReader(w.finish()));
    expect(result.message).toBe("Server message 99: mystery");
  });
});

describe("parseNotification", () => {
  test("parses notification string", () => {
    const w = new PacketWriter();
    w.cString("Welcome to our server!");
    const result = parseNotification(new PacketReader(w.finish()));
    expect(result.message).toBe("Welcome to our server!");
  });

  test("parses empty notification", () => {
    const w = new PacketWriter();
    w.cString("");
    const result = parseNotification(new PacketReader(w.finish()));
    expect(result.message).toBe("");
  });
});
