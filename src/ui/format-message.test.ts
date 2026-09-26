import { describe, expect, test } from "bun:test";
import { formatPrompt } from "ui/format";
import {
  formatMessage,
  formatMessageJson,
  formatMessageObj,
} from "ui/format-chat";
import { ChatType } from "wow";

describe("formatMessage", () => {
  test("whisper from", () => {
    const msg = { message: "psst", sender: "Eve", type: ChatType.WHISPER };
    expect(formatMessage(msg)).toBe("[whisper from Eve] psst");
  });

  test("whisper to", () => {
    const msg = {
      message: "hey",
      sender: "Eve",
      type: ChatType.WHISPER_INFORM,
    };
    expect(formatMessage(msg)).toBe("[whisper to Eve] hey");
  });

  test("system message", () => {
    const msg = { message: "Welcome", sender: "", type: ChatType.SYSTEM };
    expect(formatMessage(msg)).toBe("[system] Welcome");
  });

  test("channel message", () => {
    const msg = {
      channel: "General",
      message: "hey",
      sender: "Al",
      type: ChatType.CHANNEL,
    };
    expect(formatMessage(msg)).toBe("[General] Al: hey");
  });

  test("generic say", () => {
    const msg = { message: "hi", sender: "Alice", type: ChatType.SAY };
    expect(formatMessage(msg)).toBe("[say] Alice: hi");
  });

  test("unknown type", () => {
    const msg = { message: "wat", sender: "Bob", type: 99 };
    expect(formatMessage(msg)).toBe("[type 99] Bob: wat");
  });

  test("strips color codes from message", () => {
    const msg = {
      message: "|cff1eff00|Hitem:1234|h[Cool Sword]|h|r equipped",
      sender: "Alice",
      type: ChatType.SAY,
    };
    expect(formatMessage(msg)).toBe("[say] Alice: [Cool Sword] equipped");
  });

  test("roll message", () => {
    const msg = {
      message: "rolled 42 (1-100)",
      sender: "Xiara",
      type: ChatType.ROLL,
    };
    expect(formatMessage(msg)).toBe("[roll] Xiara rolled 42 (1-100)");
  });

  test("server broadcast origin shows [server] label", () => {
    const msg = {
      message: "Server shutdown in 15:00",
      origin: "server" as const,
      sender: "",
      type: ChatType.SYSTEM,
    };
    expect(formatMessage(msg)).toBe("[server] Server shutdown in 15:00");
  });

  test("notification origin shows [server] label", () => {
    const msg = {
      message: "Autobroadcast text",
      origin: "notification" as const,
      sender: "",
      type: ChatType.SYSTEM,
    };
    expect(formatMessage(msg)).toBe("[server] Autobroadcast text");
  });

  test("mail origin shows [mail] label", () => {
    const msg = {
      message: "You have new mail.",
      origin: "mail" as const,
      sender: "",
      type: ChatType.SYSTEM,
    };
    expect(formatMessage(msg)).toBe("[mail] You have new mail.");
  });
});

describe("formatMessageJson", () => {
  test("json say", () => {
    const msg = { message: "hi", sender: "Alice", type: ChatType.SAY };
    expect(JSON.parse(formatMessageJson(msg))).toEqual({
      message: "hi",
      sender: "Alice",
      type: "SAY",
    });
  });

  test("json whisper from", () => {
    const msg = { message: "psst", sender: "Eve", type: ChatType.WHISPER };
    expect(JSON.parse(formatMessageJson(msg))).toEqual({
      message: "psst",
      sender: "Eve",
      type: "WHISPER_FROM",
    });
  });

  test("json whisper to", () => {
    const msg = {
      message: "hey",
      sender: "Eve",
      type: ChatType.WHISPER_INFORM,
    };
    expect(JSON.parse(formatMessageJson(msg))).toEqual({
      message: "hey",
      sender: "Eve",
      type: "WHISPER_TO",
    });
  });

  test("json channel includes channel field", () => {
    const msg = {
      channel: "General",
      message: "hey",
      sender: "Al",
      type: ChatType.CHANNEL,
    };
    expect(JSON.parse(formatMessageJson(msg))).toEqual({
      channel: "General",
      message: "hey",
      sender: "Al",
      type: "CHANNEL",
    });
  });

  test("json system message", () => {
    const msg = { message: "Welcome", sender: "", type: ChatType.SYSTEM };
    expect(JSON.parse(formatMessageJson(msg))).toEqual({
      message: "Welcome",
      sender: "",
      type: "SYSTEM",
    });
  });

  test("json unknown type uses TYPE_N", () => {
    const msg = { message: "wat", sender: "Bob", type: 99 };
    expect(JSON.parse(formatMessageJson(msg))).toEqual({
      message: "wat",
      sender: "Bob",
      type: "TYPE_99",
    });
  });

  test("json roll message", () => {
    const msg = {
      message: "rolled 42 (1-100)",
      sender: "Xiara",
      type: ChatType.ROLL,
    };
    expect(JSON.parse(formatMessageJson(msg))).toEqual({
      message: "rolled 42 (1-100)",
      sender: "Xiara",
      type: "ROLL",
    });
  });

  test("server broadcast origin uses SERVER_BROADCAST JSON type", () => {
    const msg = {
      message: "Shutdown in 5:00",
      origin: "server" as const,
      sender: "",
      type: ChatType.SYSTEM,
    };
    expect(formatMessageObj(msg)).toEqual({
      message: "Shutdown in 5:00",
      sender: "",
      type: "SERVER_BROADCAST",
    });
  });

  test("notification origin uses NOTIFICATION JSON type", () => {
    const msg = {
      message: "Auto message",
      origin: "notification" as const,
      sender: "",
      type: ChatType.SYSTEM,
    };
    expect(formatMessageObj(msg)).toEqual({
      message: "Auto message",
      sender: "",
      type: "NOTIFICATION",
    });
  });

  test("mail origin uses MAIL JSON type", () => {
    const msg = {
      message: "You have new mail.",
      origin: "mail" as const,
      sender: "",
      type: ChatType.SYSTEM,
    };
    expect(formatMessageObj(msg)).toEqual({
      message: "You have new mail.",
      sender: "",
      type: "MAIL",
    });
  });
});

describe("formatPrompt", () => {
  test("say mode", () => {
    expect(formatPrompt({ type: "say" })).toBe("[say] > ");
  });

  test("party mode", () => {
    expect(formatPrompt({ type: "party" })).toBe("[party] > ");
  });

  test("whisper mode includes target", () => {
    expect(formatPrompt({ target: "Xiara", type: "whisper" })).toBe(
      "[whisper: Xiara] > ",
    );
  });

  test("channel mode includes channel name", () => {
    expect(formatPrompt({ channel: "General", type: "channel" })).toBe(
      "[General] > ",
    );
  });
});
