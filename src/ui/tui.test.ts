import { test, expect, describe, jest } from "bun:test";
import { PassThrough } from "node:stream";
import {
  parseCommand,
  formatMessage,
  formatMessageJson,
  formatGroupEvent,
  formatPrompt,
  startTui,
} from "ui/tui";
import { ChatType, PartyOperation, PartyResult } from "wow/protocol/opcodes";
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
    expect(parseCommand("/emote hello")).toEqual({
      type: "say",
      message: "/emote hello",
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

  test("dispatches yell, guild, party, raid commands", async () => {
    const handle = createMockHandle();
    const input = new PassThrough();

    const done = startTui(handle, false, { input, write: () => {} });
    writeLine(input, "/y LOUD");
    writeLine(input, "/g guild msg");
    writeLine(input, "/p party msg");
    writeLine(input, "/raid pull now");
    await flush();

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
