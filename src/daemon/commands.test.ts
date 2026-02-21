import { test, expect, describe, jest, afterEach } from "bun:test";
import { unlink } from "node:fs/promises";
import {
  parseIpcCommand,
  dispatchCommand,
  onChatMessage,
  onGroupEvent,
  writeLines,
  type EventEntry,
} from "daemon/commands";
import { startDaemonServer } from "daemon/server";
import { sendToSocket } from "cli/ipc";
import { RingBuffer } from "lib/ring-buffer";
import { ChatType } from "wow/protocol/opcodes";
import { SessionLog } from "lib/session-log";
import { createMockHandle } from "test/mock-handle";

function createMockSocket(): {
  write: ReturnType<typeof jest.fn>;
  end: ReturnType<typeof jest.fn>;
  written(): string;
} {
  const chunks: string[] = [];
  return {
    write: jest.fn((data: string | Uint8Array) => {
      chunks.push(
        typeof data === "string" ? data : Buffer.from(data).toString(),
      );
      return (typeof data === "string" ? data : Buffer.from(data).toString())
        .length;
    }),
    end: jest.fn(),
    written() {
      return chunks.join("");
    },
  };
}

describe("parseIpcCommand", () => {
  test("SAY", () => {
    expect(parseIpcCommand("SAY hello world")).toEqual({
      type: "say",
      message: "hello world",
    });
  });

  test("YELL", () => {
    expect(parseIpcCommand("YELL hey everyone")).toEqual({
      type: "yell",
      message: "hey everyone",
    });
  });

  test("GUILD", () => {
    expect(parseIpcCommand("GUILD inv pls")).toEqual({
      type: "guild",
      message: "inv pls",
    });
  });

  test("PARTY", () => {
    expect(parseIpcCommand("PARTY pull now")).toEqual({
      type: "party",
      message: "pull now",
    });
  });

  test("WHISPER", () => {
    expect(parseIpcCommand("WHISPER Xiara follow me")).toEqual({
      type: "whisper",
      target: "Xiara",
      message: "follow me",
    });
  });

  test("WHISPER without message", () => {
    expect(parseIpcCommand("WHISPER Xiara")).toEqual({
      type: "whisper",
      target: "Xiara",
      message: "",
    });
  });

  test("READ", () => {
    expect(parseIpcCommand("READ")).toEqual({ type: "read" });
  });

  test("READ_WAIT", () => {
    expect(parseIpcCommand("READ_WAIT 3000")).toEqual({
      type: "read_wait",
      ms: 3000,
    });
  });

  test("STOP", () => {
    expect(parseIpcCommand("STOP")).toEqual({ type: "stop" });
  });

  test("STATUS", () => {
    expect(parseIpcCommand("STATUS")).toEqual({ type: "status" });
  });

  test("WHO without filter", () => {
    expect(parseIpcCommand("WHO")).toEqual({ type: "who" });
  });

  test("WHO with filter", () => {
    expect(parseIpcCommand("WHO mage")).toEqual({
      type: "who",
      filter: "mage",
    });
  });

  test("READ_JSON", () => {
    expect(parseIpcCommand("READ_JSON")).toEqual({ type: "read_json" });
  });

  test("READ_WAIT_JSON", () => {
    expect(parseIpcCommand("READ_WAIT_JSON 2000")).toEqual({
      type: "read_wait_json",
      ms: 2000,
    });
  });

  test("WHO_JSON without filter", () => {
    expect(parseIpcCommand("WHO_JSON")).toEqual({ type: "who_json" });
  });

  test("WHO_JSON with filter", () => {
    expect(parseIpcCommand("WHO_JSON mage")).toEqual({
      type: "who_json",
      filter: "mage",
    });
  });

  test("INVITE", () => {
    expect(parseIpcCommand("INVITE Voidtrix")).toEqual({
      type: "invite",
      target: "Voidtrix",
    });
  });

  test("KICK", () => {
    expect(parseIpcCommand("KICK Voidtrix")).toEqual({
      type: "kick",
      target: "Voidtrix",
    });
  });

  test("LEAVE", () => {
    expect(parseIpcCommand("LEAVE")).toEqual({ type: "leave" });
  });

  test("LEADER", () => {
    expect(parseIpcCommand("LEADER Voidtrix")).toEqual({
      type: "leader",
      target: "Voidtrix",
    });
  });

  test("ACCEPT", () => {
    expect(parseIpcCommand("ACCEPT")).toEqual({ type: "accept" });
  });

  test("DECLINE", () => {
    expect(parseIpcCommand("DECLINE")).toEqual({ type: "decline" });
  });

  test("slash /accept maps to accept", () => {
    expect(parseIpcCommand("/accept")).toEqual({ type: "accept" });
  });

  test("slash /say maps to say", () => {
    expect(parseIpcCommand("/say hello")).toEqual({
      type: "say",
      message: "hello",
    });
  });

  test("slash /yell maps to yell", () => {
    expect(parseIpcCommand("/yell hey")).toEqual({
      type: "yell",
      message: "hey",
    });
  });

  test("slash /guild maps to guild", () => {
    expect(parseIpcCommand("/guild inv pls")).toEqual({
      type: "guild",
      message: "inv pls",
    });
  });

  test("slash /party maps to party", () => {
    expect(parseIpcCommand("/party pull")).toEqual({
      type: "party",
      message: "pull",
    });
  });

  test("slash /whisper maps to whisper", () => {
    expect(parseIpcCommand("/whisper Xiara hi")).toEqual({
      type: "whisper",
      target: "Xiara",
      message: "hi",
    });
  });

  test("slash /who maps to who with filter", () => {
    expect(parseIpcCommand("/who mage")).toEqual({
      type: "who",
      filter: "mage",
    });
  });

  test("slash /who maps to who without filter", () => {
    expect(parseIpcCommand("/who")).toEqual({ type: "who" });
  });

  test("slash /invite maps to invite", () => {
    expect(parseIpcCommand("/invite Voidtrix")).toEqual({
      type: "invite",
      target: "Voidtrix",
    });
  });

  test("slash /kick maps to kick", () => {
    expect(parseIpcCommand("/kick Voidtrix")).toEqual({
      type: "kick",
      target: "Voidtrix",
    });
  });

  test("slash /leave maps to leave", () => {
    expect(parseIpcCommand("/leave")).toEqual({ type: "leave" });
  });

  test("slash unimplemented maps to unimplemented", () => {
    expect(parseIpcCommand("/friends")).toEqual({
      type: "unimplemented",
      feature: "Friends list",
    });
  });

  test("unknown slash command maps to say with full input", () => {
    expect(parseIpcCommand("/dance hello")).toEqual({
      type: "say",
      message: "/dance hello",
    });
  });

  test("slash command unsupported by daemon falls back to say", () => {
    expect(parseIpcCommand("/r hello")).toEqual({
      type: "say",
      message: "/r hello",
    });
  });

  test("INVITE with no target returns undefined", () => {
    expect(parseIpcCommand("INVITE")).toBeUndefined();
  });

  test("KICK with no target returns undefined", () => {
    expect(parseIpcCommand("KICK")).toBeUndefined();
  });

  test("LEADER with no target returns undefined", () => {
    expect(parseIpcCommand("LEADER")).toBeUndefined();
  });

  describe("unimplemented IPC commands", () => {
    const cases = [
      ["FRIENDS", "Friends list"],
      ["IGNORE Foo", "Ignore list"],
      ["JOIN Trade", "Channel join/leave"],
      ["GINVITE Foo", "Guild management"],
      ["GKICK Foo", "Guild management"],
      ["GLEAVE", "Guild management"],
      ["GPROMOTE Foo", "Guild management"],
      ["MAIL", "Mail"],
      ["ROLL", "Random roll"],
      ["DND", "Player status"],
      ["AFK", "Player status"],
      ["EMOTE waves", "Text emotes"],
    ] as const;

    for (const [input, feature] of cases) {
      test(`${input.split(" ")[0]} returns unimplemented`, () => {
        expect(parseIpcCommand(input)).toEqual({
          type: "unimplemented",
          feature,
        });
      });
    }
  });

  test("unrecognized verb becomes chat", () => {
    expect(parseIpcCommand("DANCE")).toEqual({
      type: "chat",
      message: "DANCE",
    });
  });

  test("unrecognized text becomes chat command", () => {
    expect(parseIpcCommand("hello world")).toEqual({
      type: "chat",
      message: "hello world",
    });
  });

  test("single word becomes chat command", () => {
    expect(parseIpcCommand("hello")).toEqual({
      type: "chat",
      message: "hello",
    });
  });

  test("empty string returns undefined", () => {
    expect(parseIpcCommand("")).toBeUndefined();
  });

  test("READ_WAIT with empty argument returns undefined", () => {
    expect(parseIpcCommand("READ_WAIT")).toBeUndefined();
  });

  test("READ_WAIT with non-numeric argument returns undefined", () => {
    expect(parseIpcCommand("READ_WAIT abc")).toBeUndefined();
  });

  test("READ_WAIT with negative value returns undefined", () => {
    expect(parseIpcCommand("READ_WAIT -100")).toBeUndefined();
  });

  test("READ_WAIT clamps to 60000ms", () => {
    expect(parseIpcCommand("READ_WAIT 120000")).toEqual({
      type: "read_wait",
      ms: 60_000,
    });
  });

  test("READ_WAIT_JSON with empty argument returns undefined", () => {
    expect(parseIpcCommand("READ_WAIT_JSON")).toBeUndefined();
  });

  test("READ_WAIT_JSON clamps to 60000ms", () => {
    expect(parseIpcCommand("READ_WAIT_JSON 999999")).toEqual({
      type: "read_wait_json",
      ms: 60_000,
    });
  });
});

describe("dispatchCommand", () => {
  test("say calls sendSay and writes OK", async () => {
    const handle = createMockHandle();
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    const result = await dispatchCommand(
      { type: "say", message: "hello" },
      handle,
      events,
      socket,
      cleanup,
    );

    expect(result).toBe(false);
    expect(handle.sendSay).toHaveBeenCalledWith("hello");
    expect(socket.written()).toBe("OK\n\n");
  });

  test("yell calls sendYell and writes OK", async () => {
    const handle = createMockHandle();
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand(
      { type: "yell", message: "HEY" },
      handle,
      events,
      socket,
      cleanup,
    );

    expect(handle.sendYell).toHaveBeenCalledWith("HEY");
    expect(socket.written()).toBe("OK\n\n");
  });

  test("guild calls sendGuild and writes OK", async () => {
    const handle = createMockHandle();
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand(
      { type: "guild", message: "inv pls" },
      handle,
      events,
      socket,
      cleanup,
    );

    expect(handle.sendGuild).toHaveBeenCalledWith("inv pls");
    expect(socket.written()).toBe("OK\n\n");
  });

  test("party calls sendParty and writes OK", async () => {
    const handle = createMockHandle();
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand(
      { type: "party", message: "pull" },
      handle,
      events,
      socket,
      cleanup,
    );

    expect(handle.sendParty).toHaveBeenCalledWith("pull");
    expect(socket.written()).toBe("OK\n\n");
  });

  test("whisper calls sendWhisper and writes OK", async () => {
    const handle = createMockHandle();
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand(
      { type: "whisper", target: "Xiara", message: "hey" },
      handle,
      events,
      socket,
      cleanup,
    );

    expect(handle.sendWhisper).toHaveBeenCalledWith("Xiara", "hey");
    expect(socket.written()).toBe("OK\n\n");
  });

  test("read drains ring buffer text", async () => {
    const handle = createMockHandle();
    const events = new RingBuffer<EventEntry>(10);
    events.push({ text: "[say] Alice: hi", json: '{"type":"SAY"}' });
    events.push({ text: "[say] Bob: hey", json: '{"type":"SAY"}' });
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand({ type: "read" }, handle, events, socket, cleanup);

    expect(socket.written()).toBe("[say] Alice: hi\n[say] Bob: hey\n\n");
  });

  test("read on empty buffer writes just terminator", async () => {
    const handle = createMockHandle();
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand({ type: "read" }, handle, events, socket, cleanup);

    expect(socket.written()).toBe("\n");
  });

  test("read_wait delays then drains", async () => {
    jest.useFakeTimers();
    try {
      const handle = createMockHandle();
      const events = new RingBuffer<EventEntry>(10);
      events.push({ text: "[say] Alice: hi", json: '{"type":"SAY"}' });
      const socket = createMockSocket();
      const cleanup = jest.fn();

      const promise = dispatchCommand(
        { type: "read_wait", ms: 1000 },
        handle,
        events,
        socket,
        cleanup,
      );

      expect(socket.written()).toBe("");
      jest.advanceTimersByTime(1000);
      await promise;
      expect(socket.written()).toBe("[say] Alice: hi\n\n");
    } finally {
      jest.useRealTimers();
    }
  });

  test("status writes CONNECTED", async () => {
    const handle = createMockHandle();
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand({ type: "status" }, handle, events, socket, cleanup);

    expect(socket.written()).toBe("CONNECTED\n\n");
  });

  test("stop calls cleanup and returns true", async () => {
    const handle = createMockHandle();
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    const result = await dispatchCommand(
      { type: "stop" },
      handle,
      events,
      socket,
      cleanup,
    );

    expect(result).toBe(true);
    expect(cleanup).toHaveBeenCalled();
    expect(socket.written()).toBe("OK\n\n");
  });

  test("who passes filter and formats results", async () => {
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
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand(
      { type: "who", filter: "mage" },
      handle,
      events,
      socket,
      cleanup,
    );

    expect(handle.who).toHaveBeenCalledWith({ name: "mage" });
    expect(socket.written()).toContain("[who] 1 results: Test (80)");
  });

  test("who without filter passes empty object", async () => {
    const handle = createMockHandle();
    (handle.who as ReturnType<typeof jest.fn>).mockResolvedValue([]);
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand({ type: "who" }, handle, events, socket, cleanup);

    expect(handle.who).toHaveBeenCalledWith({});
  });

  test("read_json drains ring buffer json", async () => {
    const handle = createMockHandle();
    const events = new RingBuffer<EventEntry>(10);
    events.push({
      text: "[say] Alice: hi",
      json: '{"type":"SAY","sender":"Alice","message":"hi"}',
    });
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand(
      { type: "read_json" },
      handle,
      events,
      socket,
      cleanup,
    );

    expect(socket.written()).toBe(
      '{"type":"SAY","sender":"Alice","message":"hi"}\n\n',
    );
  });

  test("read_wait_json delays then drains json", async () => {
    jest.useFakeTimers();
    try {
      const handle = createMockHandle();
      const events = new RingBuffer<EventEntry>(10);
      events.push({
        text: "[say] Alice: hi",
        json: '{"type":"SAY"}',
      });
      const socket = createMockSocket();
      const cleanup = jest.fn();

      const promise = dispatchCommand(
        { type: "read_wait_json", ms: 500 },
        handle,
        events,
        socket,
        cleanup,
      );

      expect(socket.written()).toBe("");
      jest.advanceTimersByTime(500);
      await promise;
      expect(socket.written()).toBe('{"type":"SAY"}\n\n');
    } finally {
      jest.useRealTimers();
    }
  });

  test("invite calls handle.invite and writes OK", async () => {
    const handle = createMockHandle();
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand(
      { type: "invite", target: "Voidtrix" },
      handle,
      events,
      socket,
      cleanup,
    );

    expect(handle.invite).toHaveBeenCalledWith("Voidtrix");
    expect(socket.written()).toBe("OK\n\n");
  });

  test("kick calls handle.uninvite and writes OK", async () => {
    const handle = createMockHandle();
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand(
      { type: "kick", target: "Voidtrix" },
      handle,
      events,
      socket,
      cleanup,
    );

    expect(handle.uninvite).toHaveBeenCalledWith("Voidtrix");
    expect(socket.written()).toBe("OK\n\n");
  });

  test("leave calls handle.leaveGroup and writes OK", async () => {
    const handle = createMockHandle();
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand({ type: "leave" }, handle, events, socket, cleanup);

    expect(handle.leaveGroup).toHaveBeenCalled();
    expect(socket.written()).toBe("OK\n\n");
  });

  test("leader calls handle.setLeader and writes OK", async () => {
    const handle = createMockHandle();
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand(
      { type: "leader", target: "Voidtrix" },
      handle,
      events,
      socket,
      cleanup,
    );

    expect(handle.setLeader).toHaveBeenCalledWith("Voidtrix");
    expect(socket.written()).toBe("OK\n\n");
  });

  test("accept calls handle.acceptInvite and writes OK", async () => {
    const handle = createMockHandle();
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand({ type: "accept" }, handle, events, socket, cleanup);

    expect(handle.acceptInvite).toHaveBeenCalled();
    expect(socket.written()).toBe("OK\n\n");
  });

  test("decline calls handle.declineInvite and writes OK", async () => {
    const handle = createMockHandle();
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand({ type: "decline" }, handle, events, socket, cleanup);

    expect(handle.declineInvite).toHaveBeenCalled();
    expect(socket.written()).toBe("OK\n\n");
  });

  test("who_json returns JSON formatted results", async () => {
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
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand(
      { type: "who_json", filter: "mage" },
      handle,
      events,
      socket,
      cleanup,
    );

    expect(handle.who).toHaveBeenCalledWith({ name: "mage" });
    const parsed = JSON.parse(socket.written().replace(/\n+$/, ""));
    expect(parsed.type).toBe("WHO");
    expect(parsed.count).toBe(1);
    expect(parsed.results[0].name).toBe("Test");
  });

  test("unimplemented writes UNIMPLEMENTED response", async () => {
    const handle = createMockHandle();
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    const result = await dispatchCommand(
      { type: "unimplemented", feature: "Friends list" },
      handle,
      events,
      socket,
      cleanup,
    );

    expect(result).toBe(false);
    expect(socket.written()).toBe("UNIMPLEMENTED Friends list\n\n");
  });

  test("chat sends via sendInCurrentMode and responds with mode", async () => {
    const handle = createMockHandle();
    (handle.getLastChatMode as ReturnType<typeof jest.fn>).mockReturnValue({
      type: "say",
    });
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    const result = await dispatchCommand(
      { type: "chat", message: "hello" },
      handle,
      events,
      socket,
      cleanup,
    );

    expect(result).toBe(false);
    expect(handle.sendInCurrentMode).toHaveBeenCalledWith("hello");
    expect(socket.written()).toBe("OK SAY\n\n");
  });

  test("chat mode label includes whisper target", async () => {
    const handle = createMockHandle();
    (handle.getLastChatMode as ReturnType<typeof jest.fn>).mockReturnValue({
      type: "whisper",
      target: "Xiara",
    });
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand(
      { type: "chat", message: "follow me" },
      handle,
      events,
      socket,
      cleanup,
    );

    expect(socket.written()).toBe("OK WHISPER Xiara\n\n");
  });

  test("chat mode label includes channel name", async () => {
    const handle = createMockHandle();
    (handle.getLastChatMode as ReturnType<typeof jest.fn>).mockReturnValue({
      type: "channel",
      channel: "General",
    });
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand(
      { type: "chat", message: "hello general" },
      handle,
      events,
      socket,
      cleanup,
    );

    expect(socket.written()).toBe("OK CHANNEL General\n\n");
  });
});

describe("writeLines", () => {
  test("writes each line with newline then blank terminator", () => {
    const socket = createMockSocket();
    writeLines(socket, ["line1", "line2"]);
    expect(socket.written()).toBe("line1\nline2\n\n");
  });

  test("empty array writes just terminator", () => {
    const socket = createMockSocket();
    writeLines(socket, []);
    expect(socket.written()).toBe("\n");
  });
});

describe("onChatMessage", () => {
  test("pushes formatted message to ring buffer", () => {
    const events = new RingBuffer<EventEntry>(10);
    const log: SessionLog = {
      append: jest.fn(() => Promise.resolve()),
    } as unknown as SessionLog;

    onChatMessage(
      { type: ChatType.SAY, sender: "Alice", message: "hi" },
      events,
      log,
    );

    const drained = events.drain();
    expect(drained[0]!.text).toBe("[say] Alice: hi");
    expect(JSON.parse(drained[0]!.json)).toEqual({
      type: "SAY",
      sender: "Alice",
      message: "hi",
    });
  });

  test("appends JSON to session log", () => {
    const events = new RingBuffer<EventEntry>(10);
    const append = jest.fn(() => Promise.resolve());
    const log: SessionLog = { append } as unknown as SessionLog;

    onChatMessage(
      { type: ChatType.WHISPER, sender: "Eve", message: "psst" },
      events,
      log,
    );

    expect(append).toHaveBeenCalledWith({
      type: "WHISPER_FROM",
      sender: "Eve",
      message: "psst",
    });
  });

  test("swallows session log append errors", async () => {
    const events = new RingBuffer<EventEntry>(10);
    const append = jest.fn(() => Promise.reject(new Error("disk full")));
    const log: SessionLog = { append } as unknown as SessionLog;

    onChatMessage(
      { type: ChatType.WHISPER, sender: "Eve", message: "psst" },
      events,
      log,
    );
    await Promise.resolve();

    expect(append).toHaveBeenCalled();
  });
});

describe("onGroupEvent", () => {
  test("pushes group_list with undefined text to ring buffer", () => {
    const events = new RingBuffer<EventEntry>(10);
    const log: SessionLog = {
      append: jest.fn(() => Promise.resolve()),
    } as unknown as SessionLog;

    onGroupEvent(
      {
        type: "group_list",
        members: [{ name: "Alice", guidLow: 1, guidHigh: 0, online: true }],
        leader: "Alice",
      },
      events,
      log,
    );

    const drained = events.drain();
    expect(drained).toHaveLength(1);
    expect(drained[0]!.text).toBeUndefined();
    expect(JSON.parse(drained[0]!.json)).toMatchObject({ type: "GROUP_LIST" });
  });

  test("pushes member_stats to session log", () => {
    const events = new RingBuffer<EventEntry>(10);
    const append = jest.fn(() => Promise.resolve());
    const log: SessionLog = { append } as unknown as SessionLog;

    onGroupEvent(
      { type: "member_stats", guidLow: 42, hp: 100, maxHp: 200 },
      events,
      log,
    );

    expect(append).toHaveBeenCalledWith(
      expect.objectContaining({ type: "PARTY_MEMBER_STATS", guidLow: 42 }),
    );
  });

  test("swallows group event log append errors", async () => {
    const events = new RingBuffer<EventEntry>(10);
    const append = jest.fn(() => Promise.reject(new Error("disk full")));
    const log: SessionLog = { append } as unknown as SessionLog;

    onGroupEvent({ type: "group_destroyed" }, events, log);
    await Promise.resolve();

    expect(append).toHaveBeenCalled();
  });

  test("pushes displayable events with text", () => {
    const events = new RingBuffer<EventEntry>(10);
    const log: SessionLog = {
      append: jest.fn(() => Promise.resolve()),
    } as unknown as SessionLog;

    onGroupEvent({ type: "invite_received", from: "Bob" }, events, log);

    const drained = events.drain();
    expect(drained[0]!.text).toBe("[group] Bob invites you to a group");
  });

  test("serializes command_result event details", () => {
    const events = new RingBuffer<EventEntry>(10);
    const log: SessionLog = {
      append: jest.fn(() => Promise.resolve()),
    } as unknown as SessionLog;

    onGroupEvent(
      {
        type: "command_result",
        operation: 1,
        target: "Voidtrix",
        result: 0,
      },
      events,
      log,
    );

    const drained = events.drain();
    expect(JSON.parse(drained[0]!.json)).toEqual({
      type: "GROUP_COMMAND_RESULT",
      operation: 1,
      target: "Voidtrix",
      result: 0,
    });
  });

  test("serializes leader/group lifecycle events", () => {
    const events = new RingBuffer<EventEntry>(10);
    const log: SessionLog = {
      append: jest.fn(() => Promise.resolve()),
    } as unknown as SessionLog;

    onGroupEvent({ type: "leader_changed", name: "Alice" }, events, log);
    onGroupEvent({ type: "group_destroyed" }, events, log);
    onGroupEvent({ type: "kicked" }, events, log);
    onGroupEvent({ type: "invite_declined", name: "Bob" }, events, log);

    const drained = events.drain().map((entry) => JSON.parse(entry.json));
    expect(drained).toEqual([
      { type: "GROUP_LEADER_CHANGED", name: "Alice" },
      { type: "GROUP_DESTROYED" },
      { type: "GROUP_KICKED" },
      { type: "GROUP_INVITE_DECLINED", name: "Bob" },
    ]);
  });
});

describe("IPC round-trip", () => {
  let sockCounter = 0;
  let sockPath: string;
  let handle: ReturnType<typeof createMockHandle>;
  let result: ReturnType<typeof startDaemonServer>;
  let exitSpy: ReturnType<typeof jest.fn>;

  function startTestServer(opts?: { onActivity?: () => void }) {
    sockPath = `./tmp/test-daemon-${++sockCounter}-${Date.now()}.sock`;
    handle = createMockHandle();
    const log = new SessionLog(`./tmp/test-daemon-${sockCounter}.jsonl`);
    exitSpy = jest
      .spyOn(process, "exit")
      .mockImplementation(() => undefined as never);
    result = startDaemonServer({ handle, sock: sockPath, log, ...opts });
  }

  afterEach(async () => {
    exitSpy?.mockRestore();
    result?.cleanup();
  });

  test("STATUS returns CONNECTED", async () => {
    startTestServer();
    const lines = await sendToSocket("STATUS", sockPath);
    expect(lines).toEqual(["CONNECTED"]);
  });

  test("SAY returns OK and calls handle", async () => {
    startTestServer();
    const lines = await sendToSocket("SAY hello world", sockPath);
    expect(lines).toEqual(["OK"]);
    expect(handle.sendSay).toHaveBeenCalledWith("hello world");
  });

  test("WHISPER returns OK", async () => {
    startTestServer();
    const lines = await sendToSocket("WHISPER Xiara hey", sockPath);
    expect(lines).toEqual(["OK"]);
    expect(handle.sendWhisper).toHaveBeenCalledWith("Xiara", "hey");
  });

  test("READ returns buffered events", async () => {
    startTestServer();
    result.events.push({ text: "[say] Alice: hi", json: '{"type":"SAY"}' });
    result.events.push({ text: "[say] Bob: hey", json: '{"type":"SAY"}' });
    const lines = await sendToSocket("READ", sockPath);
    expect(lines).toEqual(["[say] Alice: hi", "[say] Bob: hey"]);
  });

  test("bare text sends via sticky mode", async () => {
    startTestServer();
    const lines = await sendToSocket("hello world", sockPath);
    expect(lines[0]).toMatch(/^OK /);
    expect(handle.sendInCurrentMode).toHaveBeenCalledWith("hello world");
  });

  test("empty command returns ERR", async () => {
    startTestServer();
    const lines = await sendToSocket("", sockPath);
    expect(lines).toEqual(["ERR unknown command"]);
  });

  test("sendToSocket rejects on missing socket", async () => {
    await expect(
      sendToSocket("STATUS", "./tmp/nonexistent.sock"),
    ).rejects.toThrow();
  });

  test("onActivity fires on each IPC command", async () => {
    const activity = jest.fn();
    startTestServer({ onActivity: activity });
    await sendToSocket("STATUS", sockPath);
    await sendToSocket("STATUS", sockPath);
    expect(activity).toHaveBeenCalledTimes(2);
  });

  test("cleanup closes handle and stops server", async () => {
    startTestServer();
    await sendToSocket("STATUS", sockPath);
    result.cleanup();
    expect(handle.close).toHaveBeenCalled();
    await expect(sendToSocket("STATUS", sockPath)).rejects.toThrow();
  });

  test("cleanup is idempotent", async () => {
    startTestServer();
    result.cleanup();
    result.cleanup();
    expect(handle.close).toHaveBeenCalledTimes(1);
  });

  test("cleanup ignores missing socket file", async () => {
    startTestServer();
    await sendToSocket("STATUS", sockPath);
    await unlink(sockPath);
    result.cleanup();
    expect(handle.close).toHaveBeenCalledTimes(1);
  });

  test("STOP triggers process.exit", async () => {
    startTestServer();
    const lines = await sendToSocket("STOP", sockPath);
    expect(lines).toEqual(["OK"]);
    await Bun.sleep(0);
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  test("buffers split command chunks before parsing", async () => {
    const origListen = Bun.listen;
    let capturedData:
      | ((
          socket: {
            write(data: string | Uint8Array): number;
            end(): void;
          },
          data: ArrayBuffer | ArrayBufferView,
        ) => void | Promise<void>)
      | undefined;
    let stopFn: ReturnType<typeof jest.fn> | undefined;

    Bun.listen = jest.fn((opts: { socket: { data: typeof capturedData } }) => {
      capturedData = opts.socket.data;
      stopFn = jest.fn();
      return { stop: stopFn } as unknown as ReturnType<typeof Bun.listen>;
    }) as unknown as typeof Bun.listen;

    try {
      const handle = createMockHandle();
      const log = new SessionLog(`./tmp/test-daemon-split-${Date.now()}.jsonl`);
      const { cleanup } = startDaemonServer({
        handle,
        sock: `./tmp/test-daemon-split-${Date.now()}.sock`,
        log,
      });
      const socket = createMockSocket();

      capturedData!(socket, Buffer.from("STA"));
      capturedData!(socket, Buffer.from("TUS\n"));
      await Promise.resolve();

      expect(socket.written()).toBe("CONNECTED\n\n");

      cleanup();
      expect(stopFn).toHaveBeenCalled();
    } finally {
      Bun.listen = origListen;
    }
  });

  test("processes multiple commands from a single chunk", async () => {
    const origListen = Bun.listen;
    let capturedData:
      | ((
          socket: {
            write(data: string | Uint8Array): number;
            end(): void;
          },
          data: ArrayBuffer | ArrayBufferView,
        ) => void | Promise<void>)
      | undefined;
    let stopFn: ReturnType<typeof jest.fn> | undefined;

    Bun.listen = jest.fn((opts: { socket: { data: typeof capturedData } }) => {
      capturedData = opts.socket.data;
      stopFn = jest.fn();
      return { stop: stopFn } as unknown as ReturnType<typeof Bun.listen>;
    }) as unknown as typeof Bun.listen;

    try {
      const handle = createMockHandle();
      const log = new SessionLog(`./tmp/test-daemon-multi-${Date.now()}.jsonl`);
      const { cleanup } = startDaemonServer({
        handle,
        sock: `./tmp/test-daemon-multi-${Date.now()}.sock`,
        log,
      });
      const socket = createMockSocket();

      capturedData!(socket, Buffer.from("STATUS\nSTATUS\n"));
      await Bun.sleep(0);

      expect(socket.written()).toBe("CONNECTED\n\nCONNECTED\n\n");

      cleanup();
      expect(stopFn).toHaveBeenCalled();
    } finally {
      Bun.listen = origListen;
    }
  });

  test("onMessage wiring pushes to ring buffer", async () => {
    startTestServer();
    handle.triggerMessage({
      type: ChatType.SAY,
      sender: "Alice",
      message: "hi",
    });
    const lines = await sendToSocket("READ", sockPath);
    expect(lines).toEqual(["[say] Alice: hi"]);
  });

  test("onGroupEvent wiring pushes to ring buffer", async () => {
    startTestServer();
    handle.triggerGroupEvent({ type: "group_destroyed" });
    const lines = await sendToSocket("READ", sockPath);
    expect(lines).toEqual(["[group] Group has been disbanded"]);
  });

  test("dispatch error returns ERR internal", async () => {
    startTestServer();
    (handle.who as ReturnType<typeof jest.fn>).mockRejectedValue(
      new Error("db fail"),
    );
    const lines = await sendToSocket("WHO", sockPath);
    expect(lines).toEqual(["ERR internal"]);
  });
});
