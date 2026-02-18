import { test, expect, describe, jest } from "bun:test";
import { PassThrough } from "node:stream";
import { parseCommand, formatMessage, startTui } from "tui";
import { ChatType } from "protocol/opcodes";
import type { WorldHandle, ChatMessage } from "client";

function createMockHandle(): WorldHandle & {
  triggerMessage(msg: ChatMessage): void;
  resolveClosed(): void;
} {
  let messageCb: ((msg: ChatMessage) => void) | undefined;
  let closeResolve: () => void;
  const closed = new Promise<void>((r) => {
    closeResolve = r;
  });

  return {
    closed,
    close: jest.fn(() => closeResolve()),
    onMessage(cb) {
      messageCb = cb;
    },
    sendWhisper: jest.fn(),
    sendSay: jest.fn(),
    sendYell: jest.fn(),
    sendGuild: jest.fn(),
    sendParty: jest.fn(),
    sendRaid: jest.fn(),
    sendChannel: jest.fn(),
    getChannel: jest.fn(),
    who: jest.fn(async () => []),
    triggerMessage(msg) {
      messageCb?.(msg);
    },
    resolveClosed() {
      closeResolve();
    },
  };
}

function writeLine(stream: PassThrough, line: string): void {
  stream.write(line + "\n");
}

describe("parseCommand", () => {
  test("bare text becomes say", () => {
    expect(parseCommand("hello")).toEqual({ type: "say", message: "hello" });
  });

  test("/s sends say", () => {
    expect(parseCommand("/s hello")).toEqual({ type: "say", message: "hello" });
  });

  test("/say sends say", () => {
    expect(parseCommand("/say hello there")).toEqual({
      type: "say",
      message: "hello there",
    });
  });

  test("/w sends whisper", () => {
    expect(parseCommand("/w Xiara follow me")).toEqual({
      type: "whisper",
      target: "Xiara",
      message: "follow me",
    });
  });

  test("/whisper sends whisper", () => {
    expect(parseCommand("/whisper Xiara hi")).toEqual({
      type: "whisper",
      target: "Xiara",
      message: "hi",
    });
  });

  test("/r sends reply", () => {
    expect(parseCommand("/r hello")).toEqual({
      type: "reply",
      message: "hello",
    });
  });

  test("/g sends guild", () => {
    expect(parseCommand("/g hello guild")).toEqual({
      type: "guild",
      message: "hello guild",
    });
  });

  test("/guild sends guild", () => {
    expect(parseCommand("/guild hi")).toEqual({
      type: "guild",
      message: "hi",
    });
  });

  test("/y sends yell", () => {
    expect(parseCommand("/y HELLO")).toEqual({
      type: "yell",
      message: "HELLO",
    });
  });

  test("/p sends party", () => {
    expect(parseCommand("/p inv")).toEqual({ type: "party", message: "inv" });
  });

  test("/party sends party", () => {
    expect(parseCommand("/party inv")).toEqual({
      type: "party",
      message: "inv",
    });
  });

  test("/raid sends raid", () => {
    expect(parseCommand("/raid pull")).toEqual({
      type: "raid",
      message: "pull",
    });
  });

  test("/1 sends channel 1", () => {
    expect(parseCommand("/1 hello general")).toEqual({
      type: "channel",
      target: "1",
      message: "hello general",
    });
  });

  test("/2 sends channel 2", () => {
    expect(parseCommand("/2 lfg")).toEqual({
      type: "channel",
      target: "2",
      message: "lfg",
    });
  });

  test("/who sends who query", () => {
    expect(parseCommand("/who")).toEqual({ type: "who" });
  });

  test("/who with name filter", () => {
    expect(parseCommand("/who Xiara")).toEqual({
      type: "who",
      target: "Xiara",
    });
  });

  test("/quit sends quit", () => {
    expect(parseCommand("/quit")).toEqual({ type: "quit" });
  });

  test("empty string becomes say with empty message", () => {
    expect(parseCommand("")).toEqual({ type: "say", message: "" });
  });

  test("unknown slash command becomes say with full input", () => {
    expect(parseCommand("/emote hello")).toEqual({
      type: "say",
      message: "/emote hello",
    });
  });
});

describe("formatMessage", () => {
  test("non-interactive say", () => {
    const msg = { type: ChatType.SAY, sender: "Alice", message: "hi" };
    expect(formatMessage(msg, false)).toBe("SAY\tAlice\thi");
  });

  test("non-interactive unknown type uses TYPE_N", () => {
    const msg = { type: 99, sender: "Bob", message: "wat" };
    expect(formatMessage(msg, false)).toBe("TYPE_99\tBob\twat");
  });

  test("non-interactive whisper from", () => {
    const msg = { type: ChatType.WHISPER, sender: "Eve", message: "psst" };
    expect(formatMessage(msg, false)).toBe("WHISPER_FROM\tEve\tpsst");
  });

  test("interactive whisper from", () => {
    const msg = { type: ChatType.WHISPER, sender: "Eve", message: "psst" };
    expect(formatMessage(msg, true)).toBe("[whisper from Eve] psst");
  });

  test("interactive whisper to", () => {
    const msg = {
      type: ChatType.WHISPER_INFORM,
      sender: "Eve",
      message: "hey",
    };
    expect(formatMessage(msg, true)).toBe("[whisper to Eve] hey");
  });

  test("interactive system message", () => {
    const msg = { type: ChatType.SYSTEM, sender: "", message: "Welcome" };
    expect(formatMessage(msg, true)).toBe("[system] Welcome");
  });

  test("interactive channel message", () => {
    const msg = {
      type: ChatType.CHANNEL,
      sender: "Al",
      message: "hey",
      channel: "General",
    };
    expect(formatMessage(msg, true)).toBe("[General] Al: hey");
  });

  test("interactive generic say", () => {
    const msg = { type: ChatType.SAY, sender: "Alice", message: "hi" };
    expect(formatMessage(msg, true)).toBe("[say] Alice: hi");
  });

  test("interactive unknown type", () => {
    const msg = { type: 99, sender: "Bob", message: "wat" };
    expect(formatMessage(msg, true)).toBe("[type 99] Bob: wat");
  });
});

describe("startTui", () => {
  test("dispatches say command", async () => {
    const handle = createMockHandle();
    const input = new PassThrough();
    const output: string[] = [];

    const done = startTui(handle, false, {
      input,
      write: (s) => void output.push(s),
    });
    writeLine(input, "hello");
    await Bun.sleep(10);

    expect(handle.sendSay).toHaveBeenCalledWith("hello");

    input.end();
    await done;
  });

  test("dispatches yell, guild, party, raid commands", async () => {
    const handle = createMockHandle();
    const input = new PassThrough();

    const done = startTui(handle, false, { input, write: () => {} });
    writeLine(input, "/y LOUD");
    writeLine(input, "/g guild msg");
    writeLine(input, "/p party msg");
    writeLine(input, "/raid pull now");
    await Bun.sleep(10);

    expect(handle.sendYell).toHaveBeenCalledWith("LOUD");
    expect(handle.sendGuild).toHaveBeenCalledWith("guild msg");
    expect(handle.sendParty).toHaveBeenCalledWith("party msg");
    expect(handle.sendRaid).toHaveBeenCalledWith("pull now");

    input.end();
    await done;
  });

  test("dispatches whisper command", async () => {
    const handle = createMockHandle();
    const input = new PassThrough();

    const done = startTui(handle, false, { input, write: () => {} });
    writeLine(input, "/w Alice hey there");
    await Bun.sleep(10);

    expect(handle.sendWhisper).toHaveBeenCalledWith("Alice", "hey there");

    input.end();
    await done;
  });

  test("reply without prior whisper shows error", async () => {
    const handle = createMockHandle();
    const input = new PassThrough();
    const output: string[] = [];

    const done = startTui(handle, false, {
      input,
      write: (s) => void output.push(s),
    });
    writeLine(input, "/r hello");
    await Bun.sleep(10);

    expect(output.join("")).toContain("No one has whispered you yet");

    input.end();
    await done;
  });

  test("reply after whisper sends to last sender", async () => {
    const handle = createMockHandle();
    const input = new PassThrough();

    const done = startTui(handle, false, { input, write: () => {} });
    writeLine(input, "/w Bob initial");
    writeLine(input, "/r followup");
    await Bun.sleep(10);

    expect(handle.sendWhisper).toHaveBeenCalledWith("Bob", "followup");

    input.end();
    await done;
  });

  test("who command formats results", async () => {
    const handle = createMockHandle();
    (handle.who as ReturnType<typeof jest.fn>).mockResolvedValue([
      {
        name: "Test",
        guild: "G",
        level: 80,
        classId: 1,
        race: 1,
        gender: 0,
        zone: 1,
      },
    ]);
    const input = new PassThrough();
    const output: string[] = [];

    const done = startTui(handle, false, {
      input,
      write: (s) => void output.push(s),
    });
    writeLine(input, "/who");
    await Bun.sleep(10);

    expect(output.join("")).toContain("WHO\tTest\t80\tG");

    input.end();
    await done;
  });

  test("channel by number resolves via getChannel", async () => {
    const handle = createMockHandle();
    (handle.getChannel as ReturnType<typeof jest.fn>).mockReturnValue(
      "General",
    );
    const input = new PassThrough();

    const done = startTui(handle, false, { input, write: () => {} });
    writeLine(input, "/1 hello general");
    await Bun.sleep(10);

    expect(handle.getChannel).toHaveBeenCalledWith(1);
    expect(handle.sendChannel).toHaveBeenCalledWith("General", "hello general");

    input.end();
    await done;
  });

  test("channel by number not joined shows error", async () => {
    const handle = createMockHandle();
    (handle.getChannel as ReturnType<typeof jest.fn>).mockReturnValue(
      undefined,
    );
    const input = new PassThrough();
    const output: string[] = [];

    const done = startTui(handle, false, {
      input,
      write: (s) => void output.push(s),
    });
    writeLine(input, "/3 hello");
    await Bun.sleep(10);

    expect(output.join("")).toContain("Not in channel 3");

    input.end();
    await done;
  });

  test("quit command closes handle and resolves", async () => {
    const handle = createMockHandle();
    const input = new PassThrough();

    const done = startTui(handle, false, { input, write: () => {} });
    writeLine(input, "/quit");
    await done;

    expect(handle.close).toHaveBeenCalled();
  });

  test("incoming message writes formatted output", async () => {
    const handle = createMockHandle();
    const input = new PassThrough();
    const output: string[] = [];

    const done = startTui(handle, false, {
      input,
      write: (s) => void output.push(s),
    });
    handle.triggerMessage({
      type: ChatType.SAY,
      sender: "Alice",
      message: "hi",
    });
    await Bun.sleep(10);

    expect(output.join("")).toContain("SAY\tAlice\thi");

    input.end();
    await done;
  });

  test("incoming whisper sets lastWhisperFrom for reply", async () => {
    const handle = createMockHandle();
    const input = new PassThrough();

    const done = startTui(handle, false, { input, write: () => {} });
    handle.triggerMessage({
      type: ChatType.WHISPER,
      sender: "Eve",
      message: "psst",
    });
    await Bun.sleep(10);

    writeLine(input, "/r got it");
    await Bun.sleep(10);

    expect(handle.sendWhisper).toHaveBeenCalledWith("Eve", "got it");

    input.end();
    await done;
  });

  test("stream close resolves promise", async () => {
    const handle = createMockHandle();
    const input = new PassThrough();

    const done = startTui(handle, false, { input, write: () => {} });
    input.end();
    await done;
  });

  test("server disconnect closes readline", async () => {
    const handle = createMockHandle();
    const input = new PassThrough();

    const done = startTui(handle, false, { input, write: () => {} });
    handle.resolveClosed();
    await done;
  });

  test("defaults to process.stdout.write when no write option", async () => {
    const handle = createMockHandle();
    const input = new PassThrough();
    const spy = jest
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);

    try {
      const done = startTui(handle, false, { input });
      handle.triggerMessage({
        type: ChatType.SAY,
        sender: "Al",
        message: "hi",
      });
      await Bun.sleep(10);

      expect(spy).toHaveBeenCalled();
      input.end();
      await done;
    } finally {
      spy.mockRestore();
    }
  });

  test("interactive who formats results inline", async () => {
    const handle = createMockHandle();
    (handle.who as ReturnType<typeof jest.fn>).mockResolvedValue([
      {
        name: "Test",
        guild: "G",
        level: 80,
        classId: 1,
        race: 1,
        gender: 0,
        zone: 1,
      },
    ]);
    const input = new PassThrough();
    const output: string[] = [];

    const done = startTui(handle, true, {
      input,
      write: (s) => void output.push(s),
    });
    writeLine(input, "/who");
    await Bun.sleep(10);

    expect(output.join("")).toContain("[who] 1 results: Test (80)");

    input.end();
    await done;
  });

  test("interactive mode uses ANSI formatting", async () => {
    const handle = createMockHandle();
    const input = new PassThrough();
    const output: string[] = [];

    const done = startTui(handle, true, {
      input,
      write: (s) => void output.push(s),
    });
    handle.triggerMessage({
      type: ChatType.SAY,
      sender: "Alice",
      message: "hi",
    });
    await Bun.sleep(10);

    expect(output.join("")).toContain("\r\x1b[K[say] Alice: hi\n");

    input.end();
    await done;
  });
});
