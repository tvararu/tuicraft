import { test, expect, describe } from "bun:test";
import { PacketReader, PacketWriter } from "wow/protocol/packet";
import { ChatType, ChannelNotify, Language } from "wow/protocol/opcodes";
import {
  parseChatMessage,
  buildChatMessage,
  buildNameQuery,
  parseNameQueryResponse,
  buildWhoRequest,
  parseWhoResponse,
  parseChannelNotify,
  buildRandomRoll,
  parseRandomRoll,
} from "wow/protocol/chat";

describe("parseChatMessage", () => {
  test("parses a SAY message", () => {
    const w = new PacketWriter();
    w.uint8(ChatType.SAY);
    w.uint32LE(0);
    w.uint32LE(0x42);
    w.uint32LE(0x00);
    w.uint32LE(0);
    w.uint32LE(0x42);
    w.uint32LE(0x00);
    w.uint32LE(5);
    w.rawBytes(new TextEncoder().encode("hello"));
    w.uint8(0);

    const msg = parseChatMessage(new PacketReader(w.finish()));
    expect(msg.type).toBe(ChatType.SAY);
    expect(msg.senderGuidLow).toBe(0x42);
    expect(msg.message).toBe("hello");
    expect(msg.channel).toBeUndefined();
  });

  test("parses a WHISPER message", () => {
    const w = new PacketWriter();
    w.uint8(ChatType.WHISPER);
    w.uint32LE(0);
    w.uint32LE(0x10);
    w.uint32LE(0x00);
    w.uint32LE(0);
    w.uint32LE(0x10);
    w.uint32LE(0x00);
    w.uint32LE(3);
    w.rawBytes(new TextEncoder().encode("hey"));
    w.uint8(0);

    const msg = parseChatMessage(new PacketReader(w.finish()));
    expect(msg.type).toBe(ChatType.WHISPER);
    expect(msg.message).toBe("hey");
  });

  test("parses a CHANNEL message with channel name", () => {
    const w = new PacketWriter();
    w.uint8(ChatType.CHANNEL);
    w.uint32LE(0);
    w.uint32LE(0x42);
    w.uint32LE(0x00);
    w.uint32LE(0);
    w.cString("General");
    w.uint32LE(0x42);
    w.uint32LE(0x00);
    w.uint32LE(2);
    w.rawBytes(new TextEncoder().encode("hi"));
    w.uint8(0);

    const msg = parseChatMessage(new PacketReader(w.finish()));
    expect(msg.type).toBe(ChatType.CHANNEL);
    expect(msg.channel).toBe("General");
    expect(msg.message).toBe("hi");
  });

  test("parses a SYSTEM message", () => {
    const w = new PacketWriter();
    w.uint8(ChatType.SYSTEM);
    w.uint32LE(0);
    w.uint32LE(0x00);
    w.uint32LE(0x00);
    w.uint32LE(0);
    w.uint32LE(0x00);
    w.uint32LE(0x00);
    w.uint32LE(7);
    w.rawBytes(new TextEncoder().encode("Welcome"));
    w.uint8(0);

    const msg = parseChatMessage(new PacketReader(w.finish()));
    expect(msg.type).toBe(ChatType.SYSTEM);
    expect(msg.message).toBe("Welcome");
  });

  test("parses a GM message with embedded sender name", () => {
    const w = new PacketWriter();
    w.uint8(ChatType.SAY);
    w.uint32LE(0);
    w.uint32LE(0x42);
    w.uint32LE(0x00);
    w.uint32LE(0);
    const nameBytes = new TextEncoder().encode("GameMaster");
    w.uint32LE(nameBytes.byteLength);
    w.rawBytes(nameBytes);
    w.uint32LE(0x42);
    w.uint32LE(0x00);
    w.uint32LE(5);
    w.rawBytes(new TextEncoder().encode("hello"));
    w.uint8(0);

    const msg = parseChatMessage(new PacketReader(w.finish()), true);
    expect(msg.type).toBe(ChatType.SAY);
    expect(msg.senderName).toBe("GameMaster");
    expect(msg.message).toBe("hello");
  });
});

describe("buildChatMessage", () => {
  test("builds a SAY message", () => {
    const body = buildChatMessage(ChatType.SAY, Language.COMMON, "hello");
    const r = new PacketReader(body);
    expect(r.uint32LE()).toBe(ChatType.SAY);
    expect(r.uint32LE()).toBe(Language.COMMON);
    expect(r.cString()).toBe("hello");
  });

  test("builds a WHISPER message with target name", () => {
    const body = buildChatMessage(
      ChatType.WHISPER,
      Language.ORCISH,
      "hey",
      "Xiara",
    );
    const r = new PacketReader(body);
    expect(r.uint32LE()).toBe(ChatType.WHISPER);
    expect(r.uint32LE()).toBe(Language.ORCISH);
    expect(r.cString()).toBe("Xiara");
    expect(r.cString()).toBe("hey");
  });

  test("builds a CHANNEL message with channel name", () => {
    const body = buildChatMessage(
      ChatType.CHANNEL,
      Language.COMMON,
      "hi",
      "General",
    );
    const r = new PacketReader(body);
    expect(r.uint32LE()).toBe(ChatType.CHANNEL);
    expect(r.uint32LE()).toBe(Language.COMMON);
    expect(r.cString()).toBe("General");
    expect(r.cString()).toBe("hi");
  });

  test("builds a GUILD message (no target)", () => {
    const body = buildChatMessage(
      ChatType.GUILD,
      Language.COMMON,
      "hello guild",
    );
    const r = new PacketReader(body);
    expect(r.uint32LE()).toBe(ChatType.GUILD);
    expect(r.uint32LE()).toBe(Language.COMMON);
    expect(r.cString()).toBe("hello guild");
  });

  test("builds a DND message", () => {
    const body = buildChatMessage(ChatType.DND, Language.COMMON, "busy");
    const r = new PacketReader(body);
    expect(r.uint32LE()).toBe(ChatType.DND);
    expect(r.uint32LE()).toBe(Language.COMMON);
    expect(r.cString()).toBe("busy");
  });

  test("builds an AFK message", () => {
    const body = buildChatMessage(ChatType.AFK, Language.COMMON, "brb");
    const r = new PacketReader(body);
    expect(r.uint32LE()).toBe(ChatType.AFK);
    expect(r.uint32LE()).toBe(Language.COMMON);
    expect(r.cString()).toBe("brb");
  });
});

describe("buildNameQuery / parseNameQueryResponse", () => {
  test("builds a name query packet", () => {
    const body = buildNameQuery(0x42, 0x00);
    const r = new PacketReader(body);
    expect(r.uint32LE()).toBe(0x42);
    expect(r.uint32LE()).toBe(0x00);
  });

  test("parses a successful name query response", () => {
    const w = new PacketWriter();
    w.uint8(0x01);
    w.uint8(0x42);
    w.uint8(0);
    w.cString("Xiara");
    w.cString("");
    w.uint32LE(1);
    w.uint32LE(0);
    w.uint32LE(5);

    const result = parseNameQueryResponse(new PacketReader(w.finish()));
    expect(result.guidLow).toBe(0x42);
    expect(result.found).toBe(true);
    expect(result.name).toBe("Xiara");
  });

  test("parses a not-found name query response", () => {
    const w = new PacketWriter();
    w.uint8(0x01);
    w.uint8(0x42);
    w.uint8(1);

    const result = parseNameQueryResponse(new PacketReader(w.finish()));
    expect(result.guidLow).toBe(0x42);
    expect(result.found).toBe(false);
  });
});

describe("buildWhoRequest / parseWhoResponse", () => {
  test("builds a who request with defaults", () => {
    const body = buildWhoRequest({});
    const r = new PacketReader(body);
    expect(r.uint32LE()).toBe(0);
    expect(r.uint32LE()).toBe(100);
    expect(r.cString()).toBe("");
    expect(r.cString()).toBe("");
  });

  test("builds a who request with name filter", () => {
    const body = buildWhoRequest({ name: "Xiara" });
    const r = new PacketReader(body);
    r.uint32LE();
    r.uint32LE();
    expect(r.cString()).toBe("Xiara");
  });

  test("parses a who response", () => {
    const w = new PacketWriter();
    w.uint32LE(1);
    w.uint32LE(1);
    w.cString("Xiara");
    w.cString("TestGuild");
    w.uint32LE(80);
    w.uint32LE(5);
    w.uint32LE(1);
    w.uint8(0);
    w.uint32LE(1);

    const results = parseWhoResponse(new PacketReader(w.finish()));
    expect(results).toHaveLength(1);
    expect(results[0]!.name).toBe("Xiara");
    expect(results[0]!.guild).toBe("TestGuild");
    expect(results[0]!.level).toBe(80);
  });

  test("parses an empty who response", () => {
    const w = new PacketWriter();
    w.uint32LE(0);
    w.uint32LE(0);

    const results = parseWhoResponse(new PacketReader(w.finish()));
    expect(results).toHaveLength(0);
  });
});

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
    w.uint32LE(0xdeadbeef);
    w.uint32LE(0x00000001);

    const result = parseRandomRoll(new PacketReader(w.finish()));
    expect(result.min).toBe(0);
    expect(result.max).toBe(999);
    expect(result.result).toBe(500);
    expect(result.guidLow).toBe(0xdeadbeef);
    expect(result.guidHigh).toBe(0x00000001);
  });
});
