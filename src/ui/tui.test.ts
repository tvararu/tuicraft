import { test, expect, describe, jest } from "bun:test";
import { PassThrough } from "node:stream";
import {
  parseCommand,
  formatMessage,
  formatMessageJson,
  formatGroupEvent,
  formatEntityEvent,
  formatEntityEventObj,
  formatFriendList,
  formatFriendListJson,
  formatFriendEvent,
  formatFriendEventObj,
  formatPrompt,
  startTui,
} from "ui/tui";
import { ChatType, PartyOperation, PartyResult } from "wow/protocol/opcodes";
import { ObjectType } from "wow/protocol/entity-fields";
import { FriendStatus } from "wow/protocol/social";
import type { FriendEntry } from "wow/friend-store";
import { createMockHandle } from "test/mock-handle";

function writeLine(stream: PassThrough, line: string): void {
  stream.write(line + "\n");
}

const flush = async (turns = 1): Promise<void> => {
  for (let i = 0; i < turns; i += 1) {
    await Bun.sleep(0);
  }
};

describe("parseCommand", () => {
  test("bare text becomes chat", () => {
    expect(parseCommand("hello")).toEqual({ type: "chat", message: "hello" });
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

  test("empty string becomes chat with empty message", () => {
    expect(parseCommand("")).toEqual({ type: "chat", message: "" });
  });

  test("unknown slash command becomes say with full input", () => {
    expect(parseCommand("/dance hello")).toEqual({
      type: "say",
      message: "/dance hello",
    });
  });

  test("/invite", () => {
    expect(parseCommand("/invite Voidtrix")).toEqual({
      type: "invite",
      target: "Voidtrix",
    });
  });

  test("/kick", () => {
    expect(parseCommand("/kick Voidtrix")).toEqual({
      type: "kick",
      target: "Voidtrix",
    });
  });

  test("/leave", () => {
    expect(parseCommand("/leave")).toEqual({ type: "leave" });
  });

  test("/leader", () => {
    expect(parseCommand("/leader Voidtrix")).toEqual({
      type: "leader",
      target: "Voidtrix",
    });
  });

  test("/accept", () => {
    expect(parseCommand("/accept")).toEqual({ type: "accept" });
  });

  test("/decline", () => {
    expect(parseCommand("/decline")).toEqual({ type: "decline" });
  });

  test("/invite with no target falls back to say", () => {
    expect(parseCommand("/invite")).toEqual({
      type: "say",
      message: "/invite",
    });
  });

  test("/kick with no target falls back to say", () => {
    expect(parseCommand("/kick")).toEqual({
      type: "say",
      message: "/kick",
    });
  });

  test("/leader with no target falls back to say", () => {
    expect(parseCommand("/leader")).toEqual({
      type: "say",
      message: "/leader",
    });
  });

  test("/friends returns friends", () => {
    expect(parseCommand("/friends")).toEqual({ type: "friends" });
  });

  test("/f returns friends", () => {
    expect(parseCommand("/f")).toEqual({ type: "friends" });
  });

  test("/friend add Arthas returns add-friend", () => {
    expect(parseCommand("/friend add Arthas")).toEqual({
      type: "add-friend",
      target: "Arthas",
    });
  });

  test("/friend remove Arthas returns remove-friend", () => {
    expect(parseCommand("/friend remove Arthas")).toEqual({
      type: "remove-friend",
      target: "Arthas",
    });
  });

  test("/friend bare returns friends", () => {
    expect(parseCommand("/friend")).toEqual({ type: "friends" });
  });

  describe("unimplemented commands", () => {
    test("/ignore returns unimplemented", () => {
      expect(parseCommand("/ignore Foo")).toEqual({
        type: "unimplemented",
        feature: "Ignore list",
      });
    });
    test("/join returns unimplemented", () => {
      expect(parseCommand("/join Trade")).toEqual({
        type: "unimplemented",
        feature: "Channel join/leave",
      });
    });
    test("/ginvite returns unimplemented", () => {
      expect(parseCommand("/ginvite Foo")).toEqual({
        type: "unimplemented",
        feature: "Guild management",
      });
    });
    test("/gkick returns unimplemented", () => {
      expect(parseCommand("/gkick Foo")).toEqual({
        type: "unimplemented",
        feature: "Guild management",
      });
    });
    test("/gleave returns unimplemented", () => {
      expect(parseCommand("/gleave")).toEqual({
        type: "unimplemented",
        feature: "Guild management",
      });
    });
    test("/gpromote returns unimplemented", () => {
      expect(parseCommand("/gpromote Foo")).toEqual({
        type: "unimplemented",
        feature: "Guild management",
      });
    });
    test("/mail returns unimplemented", () => {
      expect(parseCommand("/mail")).toEqual({
        type: "unimplemented",
        feature: "Mail",
      });
    });
    test("/roll returns unimplemented", () => {
      expect(parseCommand("/roll")).toEqual({
        type: "unimplemented",
        feature: "Random roll",
      });
    });
    test("/dnd returns unimplemented", () => {
      expect(parseCommand("/dnd")).toEqual({
        type: "unimplemented",
        feature: "Player status",
      });
    });
    test("/afk returns unimplemented", () => {
      expect(parseCommand("/afk")).toEqual({
        type: "unimplemented",
        feature: "Player status",
      });
    });
    test("/e sends emote", () => {
      expect(parseCommand("/e waves")).toEqual({
        type: "emote",
        message: "waves",
      });
    });
    test("/emote sends emote", () => {
      expect(parseCommand("/emote waves")).toEqual({
        type: "emote",
        message: "waves",
      });
    });
  });
});

describe("formatMessage", () => {
  test("whisper from", () => {
    const msg = { type: ChatType.WHISPER, sender: "Eve", message: "psst" };
    expect(formatMessage(msg)).toBe("[whisper from Eve] psst");
  });

  test("whisper to", () => {
    const msg = {
      type: ChatType.WHISPER_INFORM,
      sender: "Eve",
      message: "hey",
    };
    expect(formatMessage(msg)).toBe("[whisper to Eve] hey");
  });

  test("system message", () => {
    const msg = { type: ChatType.SYSTEM, sender: "", message: "Welcome" };
    expect(formatMessage(msg)).toBe("[system] Welcome");
  });

  test("channel message", () => {
    const msg = {
      type: ChatType.CHANNEL,
      sender: "Al",
      message: "hey",
      channel: "General",
    };
    expect(formatMessage(msg)).toBe("[General] Al: hey");
  });

  test("generic say", () => {
    const msg = { type: ChatType.SAY, sender: "Alice", message: "hi" };
    expect(formatMessage(msg)).toBe("[say] Alice: hi");
  });

  test("unknown type", () => {
    const msg = { type: 99, sender: "Bob", message: "wat" };
    expect(formatMessage(msg)).toBe("[type 99] Bob: wat");
  });

  test("strips color codes from message", () => {
    const msg = {
      type: ChatType.SAY,
      sender: "Alice",
      message: "|cff1eff00|Hitem:1234|h[Cool Sword]|h|r equipped",
    };
    expect(formatMessage(msg)).toBe("[say] Alice: [Cool Sword] equipped");
  });
});

describe("formatMessageJson", () => {
  test("json say", () => {
    const msg = { type: ChatType.SAY, sender: "Alice", message: "hi" };
    expect(JSON.parse(formatMessageJson(msg))).toEqual({
      type: "SAY",
      sender: "Alice",
      message: "hi",
    });
  });

  test("json whisper from", () => {
    const msg = { type: ChatType.WHISPER, sender: "Eve", message: "psst" };
    expect(JSON.parse(formatMessageJson(msg))).toEqual({
      type: "WHISPER_FROM",
      sender: "Eve",
      message: "psst",
    });
  });

  test("json whisper to", () => {
    const msg = {
      type: ChatType.WHISPER_INFORM,
      sender: "Eve",
      message: "hey",
    };
    expect(JSON.parse(formatMessageJson(msg))).toEqual({
      type: "WHISPER_TO",
      sender: "Eve",
      message: "hey",
    });
  });

  test("json channel includes channel field", () => {
    const msg = {
      type: ChatType.CHANNEL,
      sender: "Al",
      message: "hey",
      channel: "General",
    };
    expect(JSON.parse(formatMessageJson(msg))).toEqual({
      type: "CHANNEL",
      sender: "Al",
      message: "hey",
      channel: "General",
    });
  });

  test("json system message", () => {
    const msg = { type: ChatType.SYSTEM, sender: "", message: "Welcome" };
    expect(JSON.parse(formatMessageJson(msg))).toEqual({
      type: "SYSTEM",
      sender: "",
      message: "Welcome",
    });
  });

  test("json unknown type uses TYPE_N", () => {
    const msg = { type: 99, sender: "Bob", message: "wat" };
    expect(JSON.parse(formatMessageJson(msg))).toEqual({
      type: "TYPE_99",
      sender: "Bob",
      message: "wat",
    });
  });
});

describe("startTui", () => {
  test("bare text sends via sticky mode", async () => {
    const handle = createMockHandle();
    const input = new PassThrough();

    const done = startTui(handle, false, { input, write: () => {} });
    writeLine(input, "hello");
    await flush();

    expect(handle.sendInCurrentMode).toHaveBeenCalledWith("hello");

    input.end();
    await done;
  });

  test("/say explicitly sends say and not sendInCurrentMode", async () => {
    const handle = createMockHandle();
    const input = new PassThrough();

    const done = startTui(handle, false, { input, write: () => {} });
    writeLine(input, "/say hello");
    await flush();

    expect(handle.sendSay).toHaveBeenCalledWith("hello");
    expect(handle.sendInCurrentMode).not.toHaveBeenCalled();

    input.end();
    await done;
  });

  test("dispatches yell, guild, party, raid, emote commands", async () => {
    const handle = createMockHandle();
    const input = new PassThrough();

    const done = startTui(handle, false, { input, write: () => {} });
    writeLine(input, "/y LOUD");
    writeLine(input, "/g guild msg");
    writeLine(input, "/p party msg");
    writeLine(input, "/raid pull now");
    writeLine(input, "/e waves hello");
    await flush();

    expect(handle.sendYell).toHaveBeenCalledWith("LOUD");
    expect(handle.sendGuild).toHaveBeenCalledWith("guild msg");
    expect(handle.sendParty).toHaveBeenCalledWith("party msg");
    expect(handle.sendRaid).toHaveBeenCalledWith("pull now");
    expect(handle.sendEmote).toHaveBeenCalledWith("waves hello");

    input.end();
    await done;
  });

  test("dispatches whisper command", async () => {
    const handle = createMockHandle();
    const input = new PassThrough();

    const done = startTui(handle, false, { input, write: () => {} });
    writeLine(input, "/w Alice hey there");
    await flush();

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
    await flush();

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
    await flush();

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
    await flush(2);

    expect(output.join("")).toContain("[who] 1 results: Test (80)");

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
    await flush();

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
    await flush();

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

    expect(output.join("")).toContain("[say] Alice: hi");

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

    writeLine(input, "/r got it");
    await flush();

    expect(handle.sendWhisper).toHaveBeenCalledWith("Eve", "got it");

    input.end();
    await done;
  });

  test("SIGINT closes handle and resolves", async () => {
    const handle = createMockHandle();
    const input = new PassThrough();
    const spy = jest
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);

    try {
      const done = startTui(handle, true, {
        input,
        write: () => {},
      });
      input.write("\x03");
      await done;

      expect(handle.close).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
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
    const spy = jest
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);

    try {
      const done = startTui(handle, true, {
        input,
        write: (s) => void output.push(s),
      });
      writeLine(input, "/who");
      await flush(2);

      expect(output.join("")).toContain("[who] 1 results: Test (80)");

      input.end();
      await done;
    } finally {
      spy.mockRestore();
    }
  });

  test("interactive mode uses ANSI formatting", async () => {
    const handle = createMockHandle();
    const input = new PassThrough();
    const output: string[] = [];
    const spy = jest
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);

    try {
      const done = startTui(handle, true, {
        input,
        write: (s) => void output.push(s),
      });
      handle.triggerMessage({
        type: ChatType.SAY,
        sender: "Alice",
        message: "hi",
      });

      expect(output.join("")).toContain("\r\x1b[K[say] Alice: hi\n");

      input.end();
      await done;
    } finally {
      spy.mockRestore();
    }
  });

  test("command error is caught and displayed", async () => {
    const handle = createMockHandle();
    (handle.who as ReturnType<typeof jest.fn>).mockRejectedValue(
      new Error("Timed out waiting for opcode 0x63"),
    );
    const input = new PassThrough();
    const output: string[] = [];

    const done = startTui(handle, false, {
      input,
      write: (s) => void output.push(s),
    });
    writeLine(input, "/who");
    await flush(2);

    expect(output.join("")).toContain("Timed out waiting for opcode 0x63");

    input.end();
    await done;
  });

  test("/invite calls handle.invite", async () => {
    const handle = createMockHandle();
    const input = new PassThrough();

    const done = startTui(handle, false, { input, write: () => {} });
    writeLine(input, "/invite Voidtrix");
    await flush();

    expect(handle.invite).toHaveBeenCalledWith("Voidtrix");

    input.end();
    await done;
  });

  test("/kick calls handle.uninvite", async () => {
    const handle = createMockHandle();
    const input = new PassThrough();

    const done = startTui(handle, false, { input, write: () => {} });
    writeLine(input, "/kick Voidtrix");
    await flush();

    expect(handle.uninvite).toHaveBeenCalledWith("Voidtrix");

    input.end();
    await done;
  });

  test("/leave calls handle.leaveGroup", async () => {
    const handle = createMockHandle();
    const input = new PassThrough();

    const done = startTui(handle, false, { input, write: () => {} });
    writeLine(input, "/leave");
    await flush();

    expect(handle.leaveGroup).toHaveBeenCalled();

    input.end();
    await done;
  });

  test("/leader calls handle.setLeader", async () => {
    const handle = createMockHandle();
    const input = new PassThrough();

    const done = startTui(handle, false, { input, write: () => {} });
    writeLine(input, "/leader Voidtrix");
    await flush();

    expect(handle.setLeader).toHaveBeenCalledWith("Voidtrix");

    input.end();
    await done;
  });

  test("/accept calls handle.acceptInvite", async () => {
    const handle = createMockHandle();
    const input = new PassThrough();

    const done = startTui(handle, false, { input, write: () => {} });
    writeLine(input, "/accept");
    await flush();

    expect(handle.acceptInvite).toHaveBeenCalled();

    input.end();
    await done;
  });

  test("/decline calls handle.declineInvite", async () => {
    const handle = createMockHandle();
    const input = new PassThrough();

    const done = startTui(handle, false, { input, write: () => {} });
    writeLine(input, "/decline");
    await flush();

    expect(handle.declineInvite).toHaveBeenCalled();

    input.end();
    await done;
  });

  test("unimplemented command writes error message", async () => {
    const handle = createMockHandle();
    const input = new PassThrough();
    const output: string[] = [];

    const done = startTui(handle, false, {
      input,
      write: (s) => void output.push(s),
    });
    writeLine(input, "/ignore");
    await flush();

    expect(output.join("")).toContain("Ignore list is not yet implemented");

    input.end();
    await done;
  });

  test("incoming displayable group event writes output", async () => {
    const handle = createMockHandle();
    const input = new PassThrough();
    const output: string[] = [];

    const done = startTui(handle, false, {
      input,
      write: (s) => void output.push(s),
    });
    handle.triggerGroupEvent({
      type: "invite_declined",
      name: "Voidtrix",
    });

    expect(output.join("")).toContain(
      "[group] Voidtrix has declined your invitation",
    );

    input.end();
    await done;
  });

  test("incoming non-displayable group event is ignored", async () => {
    const handle = createMockHandle();
    const input = new PassThrough();
    const output: string[] = [];

    const done = startTui(handle, false, {
      input,
      write: (s) => void output.push(s),
    });
    handle.triggerGroupEvent({
      type: "group_list",
      members: [],
      leader: "",
    });

    expect(output).toEqual([]);

    input.end();
    await done;
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
    expect(formatPrompt({ type: "whisper", target: "Xiara" })).toBe(
      "[whisper: Xiara] > ",
    );
  });

  test("channel mode includes channel name", () => {
    expect(formatPrompt({ type: "channel", channel: "General" })).toBe(
      "[General] > ",
    );
  });
});

describe("formatGroupEvent", () => {
  test("invite success", () => {
    expect(
      formatGroupEvent({
        type: "command_result",
        operation: PartyOperation.INVITE,
        target: "Voidtrix",
        result: PartyResult.SUCCESS,
      }),
    ).toBe("[group] Invited Voidtrix");
  });

  test("invite failure", () => {
    expect(
      formatGroupEvent({
        type: "command_result",
        operation: PartyOperation.INVITE,
        target: "Voidtrix",
        result: PartyResult.BAD_PLAYER_NAME,
      }),
    ).toBe("[group] Cannot invite Voidtrix: player not found");
  });

  test("uninvite success", () => {
    expect(
      formatGroupEvent({
        type: "command_result",
        operation: PartyOperation.UNINVITE,
        target: "Voidtrix",
        result: PartyResult.SUCCESS,
      }),
    ).toBe("[group] Removed Voidtrix from group");
  });

  test("uninvite failure", () => {
    expect(
      formatGroupEvent({
        type: "command_result",
        operation: PartyOperation.UNINVITE,
        target: "Voidtrix",
        result: PartyResult.NOT_LEADER,
      }),
    ).toBe("[group] Cannot kick Voidtrix: you are not the leader");
  });

  test("leave success", () => {
    expect(
      formatGroupEvent({
        type: "command_result",
        operation: PartyOperation.LEAVE,
        target: "",
        result: PartyResult.SUCCESS,
      }),
    ).toBe("[group] Left the group");
  });

  test("leave failure", () => {
    expect(
      formatGroupEvent({
        type: "command_result",
        operation: PartyOperation.LEAVE,
        target: "",
        result: PartyResult.NOT_LEADER,
      }),
    ).toBe("[group] Cannot leave: you are not the leader");
  });

  test("command_result with empty target omits extra space", () => {
    expect(
      formatGroupEvent({
        type: "command_result",
        operation: PartyOperation.UNINVITE,
        target: "",
        result: PartyResult.NOT_LEADER,
      }),
    ).toBe("[group] Cannot kick: you are not the leader");
  });

  test("invite failure with group full label", () => {
    expect(
      formatGroupEvent({
        type: "command_result",
        operation: PartyOperation.INVITE,
        target: "Voidtrix",
        result: PartyResult.GROUP_FULL,
      }),
    ).toBe("[group] Cannot invite Voidtrix: group is full");
  });

  test("invite failure with already in group label", () => {
    expect(
      formatGroupEvent({
        type: "command_result",
        operation: PartyOperation.INVITE,
        target: "Voidtrix",
        result: PartyResult.ALREADY_IN_GROUP,
      }),
    ).toBe("[group] Cannot invite Voidtrix: already in a group");
  });

  test("invite failure with wrong faction label", () => {
    expect(
      formatGroupEvent({
        type: "command_result",
        operation: PartyOperation.INVITE,
        target: "Voidtrix",
        result: PartyResult.PLAYER_WRONG_FACTION,
      }),
    ).toBe("[group] Cannot invite Voidtrix: wrong faction");
  });

  test("invite failure with ignoring you label", () => {
    expect(
      formatGroupEvent({
        type: "command_result",
        operation: PartyOperation.INVITE,
        target: "Voidtrix",
        result: PartyResult.IGNORING_YOU,
      }),
    ).toBe("[group] Cannot invite Voidtrix: player is ignoring you");
  });

  test("leader changed", () => {
    expect(formatGroupEvent({ type: "leader_changed", name: "Alice" })).toBe(
      "[group] Alice is now the group leader",
    );
  });

  test("group destroyed", () => {
    expect(formatGroupEvent({ type: "group_destroyed" })).toBe(
      "[group] Group has been disbanded",
    );
  });

  test("kicked", () => {
    expect(formatGroupEvent({ type: "kicked" })).toBe(
      "[group] You have been removed from the group",
    );
  });

  test("invite declined", () => {
    expect(formatGroupEvent({ type: "invite_declined", name: "Bob" })).toBe(
      "[group] Bob has declined your invitation",
    );
  });

  test("group_list returns undefined", () => {
    expect(
      formatGroupEvent({
        type: "group_list",
        members: [],
        leader: "",
      }),
    ).toBeUndefined();
  });
});

describe("tuicraft command", () => {
  test("parseCommand handles /tuicraft entities on", () => {
    const cmd = parseCommand("/tuicraft entities on");
    expect(cmd).toEqual({
      type: "tuicraft",
      subcommand: "entities",
      value: "on",
    });
  });

  test("parseCommand handles /tuicraft entities off", () => {
    const cmd = parseCommand("/tuicraft entities off");
    expect(cmd).toEqual({
      type: "tuicraft",
      subcommand: "entities",
      value: "off",
    });
  });

  test("parseCommand handles /tuicraft with unknown subcommand", () => {
    const cmd = parseCommand("/tuicraft foo");
    expect(cmd).toEqual({ type: "tuicraft", subcommand: "foo", value: "" });
  });

  test("entities on enables display", async () => {
    const handle = createMockHandle();
    const input = new PassThrough();
    const output: string[] = [];

    const done = startTui(handle, false, {
      input,
      write: (s) => void output.push(s),
    });
    writeLine(input, "/tuicraft entities on");
    await flush();

    expect(output.join("")).toContain("Entity events enabled");

    input.end();
    await done;
  });

  test("entities with invalid value shows usage", async () => {
    const handle = createMockHandle();
    const input = new PassThrough();
    const output: string[] = [];

    const done = startTui(handle, false, {
      input,
      write: (s) => void output.push(s),
    });
    writeLine(input, "/tuicraft entities toggle");
    await flush();

    expect(output.join("")).toContain("Usage: /tuicraft entities on|off");

    input.end();
    await done;
  });

  test("entities off disables display", async () => {
    const handle = createMockHandle();
    const input = new PassThrough();
    const output: string[] = [];

    const done = startTui(handle, false, {
      input,
      write: (s) => void output.push(s),
    });
    writeLine(input, "/tuicraft entities off");
    await flush();

    expect(output.join("")).toContain("Entity events disabled");

    input.end();
    await done;
  });

  test("unknown subcommand shows error", async () => {
    const handle = createMockHandle();
    const input = new PassThrough();
    const output: string[] = [];

    const done = startTui(handle, false, {
      input,
      write: (s) => void output.push(s),
    });
    writeLine(input, "/tuicraft foo");
    await flush();

    expect(output.join("")).toContain("Unknown tuicraft command: foo");

    input.end();
    await done;
  });

  test("entity events displayed when enabled", async () => {
    const handle = createMockHandle();
    const input = new PassThrough();
    const output: string[] = [];

    const done = startTui(handle, false, {
      input,
      write: (s) => void output.push(s),
    });
    writeLine(input, "/tuicraft entities on");
    await flush();

    handle.triggerEntityEvent({
      type: "appear",
      entity: {
        guid: 1n,
        objectType: ObjectType.UNIT,
        name: "Innkeeper Palla",
        level: 55,
        entry: 0,
        scale: 1,
        position: undefined,
        rawFields: new Map(),
        health: 100,
        maxHealth: 100,
        factionTemplate: 0,
        displayId: 0,
        npcFlags: 0,
        unitFlags: 0,
        target: 0n,
        race: 0,
        class_: 0,
        gender: 0,
        power: [],
        maxPower: [],
      },
    });

    expect(output.join("")).toContain(
      "[world] Innkeeper Palla appeared (NPC, level 55)",
    );

    input.end();
    await done;
  });

  test("entity events suppressed when disabled", async () => {
    const handle = createMockHandle();
    const input = new PassThrough();
    const output: string[] = [];

    const done = startTui(handle, false, {
      input,
      write: (s) => void output.push(s),
    });

    handle.triggerEntityEvent({
      type: "appear",
      entity: {
        guid: 1n,
        objectType: ObjectType.UNIT,
        name: "Innkeeper Palla",
        level: 55,
        entry: 0,
        scale: 1,
        position: undefined,
        rawFields: new Map(),
        health: 100,
        maxHealth: 100,
        factionTemplate: 0,
        displayId: 0,
        npcFlags: 0,
        unitFlags: 0,
        target: 0n,
        race: 0,
        class_: 0,
        gender: 0,
        power: [],
        maxPower: [],
      },
    });

    expect(output.join("")).not.toContain("[world]");

    input.end();
    await done;
  });
});

describe("formatEntityEvent", () => {
  test("formats unit appear with name and level", () => {
    const result = formatEntityEvent({
      type: "appear",
      entity: {
        guid: 1n,
        objectType: ObjectType.UNIT,
        name: "Innkeeper Palla",
        level: 55,
        entry: 0,
        scale: 1,
        position: undefined,
        rawFields: new Map(),
        health: 100,
        maxHealth: 100,
        factionTemplate: 0,
        displayId: 0,
        npcFlags: 0,
        unitFlags: 0,
        target: 0n,
        race: 0,
        class_: 0,
        gender: 0,
        power: [],
        maxPower: [],
      },
    });
    expect(result).toBe("[world] Innkeeper Palla appeared (NPC, level 55)");
  });

  test("suppresses appear without name", () => {
    const result = formatEntityEvent({
      type: "appear",
      entity: {
        guid: 2n,
        objectType: ObjectType.UNIT,
        name: undefined,
        level: 1,
      } as any,
    });
    expect(result).toBeUndefined();
  });

  test("formats player appear", () => {
    const result = formatEntityEvent({
      type: "appear",
      entity: {
        guid: 2n,
        objectType: ObjectType.PLAYER,
        name: "Thrall",
        level: 80,
        entry: 0,
        scale: 1,
        position: undefined,
        rawFields: new Map(),
        health: 100,
        maxHealth: 100,
        factionTemplate: 0,
        displayId: 0,
        npcFlags: 0,
        unitFlags: 0,
        target: 0n,
        race: 0,
        class_: 0,
        gender: 0,
        power: [],
        maxPower: [],
      },
    });
    expect(result).toBe("[world] Thrall appeared (Player, level 80)");
  });

  test("formats gameobject appear", () => {
    const result = formatEntityEvent({
      type: "appear",
      entity: {
        guid: 3n,
        objectType: ObjectType.GAMEOBJECT,
        name: "Mailbox",
        entry: 0,
        scale: 1,
        position: undefined,
        rawFields: new Map(),
        displayId: 0,
        flags: 0,
        gameObjectType: 19,
        bytes1: 0,
      },
    });
    expect(result).toBe("[world] Mailbox appeared (GameObject)");
  });

  test("formats disappear", () => {
    const result = formatEntityEvent({
      type: "disappear",
      guid: 1n,
      name: "Silvermoon Guardian",
    });
    expect(result).toBe("[world] Silvermoon Guardian left range");
  });

  test("formats disappear without name", () => {
    const result = formatEntityEvent({
      type: "disappear",
      guid: 1n,
    });
    expect(result).toBe("[world] Unknown entity left range");
  });

  test("update returns undefined for non-name changes", () => {
    const result = formatEntityEvent({
      type: "update",
      entity: { guid: 1n } as any,
      changed: ["health"],
    });
    expect(result).toBeUndefined();
  });

  test("update with name change formats appear-like message for NPC", () => {
    const result = formatEntityEvent({
      type: "update",
      entity: {
        guid: 1n,
        objectType: ObjectType.UNIT,
        name: "Springpaw Cub",
        level: 1,
      } as any,
      changed: ["name"],
    });
    expect(result).toBe("[world] Springpaw Cub appeared (NPC, level 1)");
  });

  test("appear for CORPSE returns undefined", () => {
    const result = formatEntityEvent({
      type: "appear",
      entity: {
        guid: 10n,
        objectType: ObjectType.CORPSE,
        name: "Some Corpse",
        entry: 0,
        scale: 1,
        position: undefined,
        rawFields: new Map(),
      },
    });
    expect(result).toBeUndefined();
  });
});

describe("formatEntityEventObj", () => {
  test("appear for UNIT with position", () => {
    const result = formatEntityEventObj({
      type: "appear",
      entity: {
        guid: 1n,
        objectType: ObjectType.UNIT,
        name: "Innkeeper Palla",
        level: 55,
        entry: 0,
        scale: 1,
        position: { mapId: 0, x: 100.5, y: 200.5, z: 50.0, orientation: 0 },
        rawFields: new Map(),
        health: 4200,
        maxHealth: 5000,
        factionTemplate: 0,
        displayId: 0,
        npcFlags: 0,
        unitFlags: 0,
        target: 0n,
        race: 0,
        class_: 0,
        gender: 0,
        power: [],
        maxPower: [],
      },
    });
    expect(result).toEqual({
      type: "ENTITY_APPEAR",
      guid: "0x1",
      objectType: ObjectType.UNIT,
      name: "Innkeeper Palla",
      level: 55,
      health: 4200,
      maxHealth: 5000,
      x: 100.5,
      y: 200.5,
      z: 50.0,
    });
  });

  test("appear for UNIT without position", () => {
    const result = formatEntityEventObj({
      type: "appear",
      entity: {
        guid: 1n,
        objectType: ObjectType.UNIT,
        name: "Guard",
        level: 75,
        entry: 0,
        scale: 1,
        position: undefined,
        rawFields: new Map(),
        health: 100,
        maxHealth: 100,
        factionTemplate: 0,
        displayId: 0,
        npcFlags: 0,
        unitFlags: 0,
        target: 0n,
        race: 0,
        class_: 0,
        gender: 0,
        power: [],
        maxPower: [],
      },
    });
    expect(result).toEqual({
      type: "ENTITY_APPEAR",
      guid: "0x1",
      objectType: ObjectType.UNIT,
      name: "Guard",
      level: 75,
      health: 100,
      maxHealth: 100,
    });
    expect(result).not.toHaveProperty("x");
    expect(result).not.toHaveProperty("y");
    expect(result).not.toHaveProperty("z");
  });

  test("appear for PLAYER with position", () => {
    const result = formatEntityEventObj({
      type: "appear",
      entity: {
        guid: 5n,
        objectType: ObjectType.PLAYER,
        name: "Thrall",
        level: 80,
        entry: 0,
        scale: 1,
        position: { mapId: 0, x: 1, y: 2, z: 3, orientation: 0 },
        rawFields: new Map(),
        health: 9000,
        maxHealth: 9000,
        factionTemplate: 0,
        displayId: 0,
        npcFlags: 0,
        unitFlags: 0,
        target: 0n,
        race: 0,
        class_: 0,
        gender: 0,
        power: [],
        maxPower: [],
      },
    });
    expect(result).toEqual({
      type: "ENTITY_APPEAR",
      guid: "0x5",
      objectType: ObjectType.PLAYER,
      name: "Thrall",
      level: 80,
      health: 9000,
      maxHealth: 9000,
      x: 1,
      y: 2,
      z: 3,
    });
  });

  test("appear for GAMEOBJECT", () => {
    const result = formatEntityEventObj({
      type: "appear",
      entity: {
        guid: 1n,
        objectType: ObjectType.GAMEOBJECT,
        name: "Mailbox",
        entry: 0,
        scale: 1,
        position: undefined,
        rawFields: new Map(),
        displayId: 0,
        flags: 0,
        gameObjectType: 19,
        bytes1: 0,
      },
    });
    expect(result).toEqual({
      type: "ENTITY_APPEAR",
      guid: "0x1",
      objectType: ObjectType.GAMEOBJECT,
      name: "Mailbox",
    });
    expect(result).not.toHaveProperty("level");
    expect(result).not.toHaveProperty("health");
    expect(result).not.toHaveProperty("maxHealth");
  });

  test("disappear", () => {
    const result = formatEntityEventObj({
      type: "disappear",
      guid: 1n,
      name: "Silvermoon Guardian",
    });
    expect(result).toEqual({
      type: "ENTITY_DISAPPEAR",
      guid: "0x1",
      name: "Silvermoon Guardian",
    });
  });

  test("update returns undefined", () => {
    const result = formatEntityEventObj({
      type: "update",
      entity: { guid: 1n, objectType: ObjectType.UNIT } as any,
      changed: ["health"],
    });
    expect(result).toBeUndefined();
  });
});

describe("formatFriendList", () => {
  test("empty list returns no-friends message", () => {
    expect(formatFriendList([])).toBe("[friends] No friends on your list");
  });

  test("shows online and offline friends", () => {
    const friends: FriendEntry[] = [
      {
        guid: 1n,
        name: "Arthas",
        note: "",
        status: FriendStatus.ONLINE,
        area: 0,
        level: 80,
        playerClass: 6,
      },
      {
        guid: 2n,
        name: "Jaina",
        note: "",
        status: FriendStatus.OFFLINE,
        area: 0,
        level: 80,
        playerClass: 8,
      },
    ];
    const result = formatFriendList(friends);
    expect(result).toContain("1/2 online");
    expect(result).toContain("Arthas — Online, Level 80 Death Knight");
    expect(result).toContain("Jaina — Offline");
  });

  test("shows AFK and DND statuses", () => {
    const friends: FriendEntry[] = [
      {
        guid: 1n,
        name: "Afker",
        note: "",
        status: FriendStatus.AFK,
        area: 0,
        level: 70,
        playerClass: 1,
      },
      {
        guid: 2n,
        name: "Dnder",
        note: "",
        status: FriendStatus.DND,
        area: 0,
        level: 60,
        playerClass: 4,
      },
    ];
    const result = formatFriendList(friends);
    expect(result).toContain("Afker — AFK, Level 70 Warrior");
    expect(result).toContain("Dnder — DND, Level 60 Rogue");
  });

  test("falls back to guid when name is empty", () => {
    const friends: FriendEntry[] = [
      {
        guid: 42n,
        name: "",
        note: "",
        status: FriendStatus.OFFLINE,
        area: 0,
        level: 1,
        playerClass: 1,
      },
    ];
    const result = formatFriendList(friends);
    expect(result).toContain("guid:42 — Offline");
  });
});

describe("formatFriendListJson", () => {
  test("serializes friends with status, class, and area", () => {
    const friends: FriendEntry[] = [
      {
        guid: 1n,
        name: "Arthas",
        note: "buddy",
        status: FriendStatus.ONLINE,
        area: 394,
        level: 80,
        playerClass: 6,
      },
      {
        guid: 2n,
        name: "Jaina",
        note: "",
        status: FriendStatus.OFFLINE,
        area: 0,
        level: 80,
        playerClass: 8,
      },
    ];
    const result = JSON.parse(formatFriendListJson(friends));
    expect(result.type).toBe("FRIENDS");
    expect(result.count).toBe(2);
    expect(result.online).toBe(1);
    expect(result.friends[0].name).toBe("Arthas");
    expect(result.friends[0].note).toBe("buddy");
    expect(result.friends[0].status).toBe("ONLINE");
    expect(result.friends[0].level).toBe(80);
    expect(result.friends[0].class).toBe("Death Knight");
    expect(result.friends[0].area).toBe(394);
    expect(result.friends[1].name).toBe("Jaina");
    expect(result.friends[1].status).toBe("OFFLINE");
    expect(result.friends[1].class).toBe("Mage");
  });
});

describe("formatFriendEvent", () => {
  test("friend-online with class and level", () => {
    const result = formatFriendEvent({
      type: "friend-online",
      friend: {
        guid: 1n,
        name: "Arthas",
        note: "",
        status: FriendStatus.ONLINE,
        area: 0,
        level: 80,
        playerClass: 6,
      },
    });
    expect(result).toBe(
      "[friends] Arthas is now online (Level 80 Death Knight)",
    );
  });

  test("friend-offline", () => {
    const result = formatFriendEvent({
      type: "friend-offline",
      guid: 1n,
      name: "Arthas",
    });
    expect(result).toBe("[friends] Arthas went offline");
  });

  test("friend-added", () => {
    const result = formatFriendEvent({
      type: "friend-added",
      friend: {
        guid: 1n,
        name: "Jaina",
        note: "",
        status: FriendStatus.OFFLINE,
        area: 0,
        level: 80,
        playerClass: 8,
      },
    });
    expect(result).toBe("[friends] Jaina added to friends list");
  });

  test("friend-removed", () => {
    const result = formatFriendEvent({
      type: "friend-removed",
      guid: 1n,
      name: "Jaina",
    });
    expect(result).toBe("[friends] Jaina removed from friends list");
  });

  test("friend-error", () => {
    const result = formatFriendEvent({
      type: "friend-error",
      result: 0x04,
      name: "Nobody",
    });
    expect(result).toBe("[friends] Error: player not found");
  });

  test("friend-error with unknown code", () => {
    const result = formatFriendEvent({
      type: "friend-error",
      result: 0xff,
      name: "Nobody",
    });
    expect(result).toBe("[friends] Error: error 255");
  });

  test("friend-list returns undefined", () => {
    const result = formatFriendEvent({ type: "friend-list", friends: [] });
    expect(result).toBeUndefined();
  });
});

describe("formatFriendEventObj", () => {
  test("friend-online", () => {
    const result = formatFriendEventObj({
      type: "friend-online",
      friend: {
        guid: 1n,
        name: "Arthas",
        note: "",
        status: FriendStatus.ONLINE,
        area: 394,
        level: 80,
        playerClass: 6,
      },
    });
    expect(result).toEqual({
      type: "FRIEND_ONLINE",
      name: "Arthas",
      level: 80,
      class: "Death Knight",
      area: 394,
    });
  });

  test("friend-offline", () => {
    const result = formatFriendEventObj({
      type: "friend-offline",
      guid: 1n,
      name: "Arthas",
    });
    expect(result).toEqual({ type: "FRIEND_OFFLINE", name: "Arthas" });
  });

  test("friend-added", () => {
    const result = formatFriendEventObj({
      type: "friend-added",
      friend: {
        guid: 1n,
        name: "Jaina",
        note: "",
        status: FriendStatus.OFFLINE,
        area: 0,
        level: 80,
        playerClass: 8,
      },
    });
    expect(result).toEqual({ type: "FRIEND_ADDED", name: "Jaina" });
  });

  test("friend-removed", () => {
    const result = formatFriendEventObj({
      type: "friend-removed",
      guid: 1n,
      name: "Jaina",
    });
    expect(result).toEqual({ type: "FRIEND_REMOVED", name: "Jaina" });
  });

  test("friend-error", () => {
    const result = formatFriendEventObj({
      type: "friend-error",
      result: 0x08,
      name: "Self",
    });
    expect(result).toEqual({
      type: "FRIEND_ERROR",
      result: 0x08,
      message: "already on friends list",
    });
  });

  test("friend-list returns undefined", () => {
    const result = formatFriendEventObj({ type: "friend-list", friends: [] });
    expect(result).toBeUndefined();
  });
});

describe("friend TUI commands", () => {
  test("/friends calls getFriends and writes output", async () => {
    const handle = createMockHandle();
    (handle.getFriends as ReturnType<typeof jest.fn>).mockReturnValue([]);
    const input = new PassThrough();
    const output: string[] = [];

    const done = startTui(handle, false, {
      input,
      write: (s) => void output.push(s),
    });
    writeLine(input, "/friends");
    await flush();

    expect(handle.getFriends).toHaveBeenCalled();
    expect(output.join("")).toContain("No friends on your list");

    input.end();
    await done;
  });

  test("/friend add calls addFriend", async () => {
    const handle = createMockHandle();
    const input = new PassThrough();

    const done = startTui(handle, false, { input, write: () => {} });
    writeLine(input, "/friend add Arthas");
    await flush();

    expect(handle.addFriend).toHaveBeenCalledWith("Arthas");

    input.end();
    await done;
  });

  test("/friend remove calls removeFriend", async () => {
    const handle = createMockHandle();
    const input = new PassThrough();

    const done = startTui(handle, false, { input, write: () => {} });
    writeLine(input, "/friend remove Arthas");
    await flush();

    expect(handle.removeFriend).toHaveBeenCalledWith("Arthas");

    input.end();
    await done;
  });
});
