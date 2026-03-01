import { test, expect, describe, jest, afterEach } from "bun:test";
import { unlink } from "node:fs/promises";
import {
  parseIpcCommand,
  dispatchCommand,
  onChatMessage,
  onGroupEvent,
  onEntityEvent,
  onFriendEvent,
  writeLines,
  type EventEntry,
} from "daemon/commands";
import { startDaemonServer } from "daemon/server";
import { sendToSocket } from "cli/ipc";
import { RingBuffer } from "lib/ring-buffer";
import { ChatType } from "wow/protocol/opcodes";
import { FriendStatus } from "wow/protocol/social";
import { ObjectType } from "wow/protocol/entity-fields";
import type {
  UnitEntity,
  GameObjectEntity,
  BaseEntity,
} from "wow/entity-store";
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

  test("EMOTE", () => {
    expect(parseIpcCommand("EMOTE waves hello")).toEqual({
      type: "emote",
      message: "waves hello",
    });
  });

  test("DND", () => {
    expect(parseIpcCommand("DND busy right now")).toEqual({
      type: "dnd",
      message: "busy right now",
    });
  });

  test("DND without message", () => {
    expect(parseIpcCommand("DND")).toEqual({
      type: "dnd",
      message: "",
    });
  });

  test("AFK", () => {
    expect(parseIpcCommand("AFK grabbing coffee")).toEqual({
      type: "afk",
      message: "grabbing coffee",
    });
  });

  test("AFK without message", () => {
    expect(parseIpcCommand("AFK")).toEqual({
      type: "afk",
      message: "",
    });
  });

  test("ROLL defaults to 1-100", () => {
    expect(parseIpcCommand("ROLL")).toEqual({
      type: "roll",
      min: 1,
      max: 100,
    });
  });

  test("ROLL with max", () => {
    expect(parseIpcCommand("ROLL 50")).toEqual({
      type: "roll",
      min: 1,
      max: 50,
    });
  });

  test("ROLL with min and max", () => {
    expect(parseIpcCommand("ROLL 10 20")).toEqual({
      type: "roll",
      min: 10,
      max: 20,
    });
  });

  test("/roll via slash style", () => {
    expect(parseIpcCommand("/roll 50")).toEqual({
      type: "roll",
      min: 1,
      max: 50,
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

  test("NEARBY", () => {
    expect(parseIpcCommand("NEARBY")).toEqual({ type: "nearby" });
  });

  test("NEARBY_JSON", () => {
    expect(parseIpcCommand("NEARBY_JSON")).toEqual({ type: "nearby_json" });
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

  test("slash /whisper maps to whisper", () => {
    expect(parseIpcCommand("/whisper Xiara hi")).toEqual({
      type: "whisper",
      target: "Xiara",
      message: "hi",
    });
  });

  test("slash /emote maps to emote", () => {
    expect(parseIpcCommand("/emote waves")).toEqual({
      type: "emote",
      message: "waves",
    });
  });

  test("slash /dnd maps to dnd", () => {
    expect(parseIpcCommand("/dnd busy")).toEqual({
      type: "dnd",
      message: "busy",
    });
  });

  test("slash /afk maps to afk", () => {
    expect(parseIpcCommand("/afk brb")).toEqual({
      type: "afk",
      message: "brb",
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

  test("slash /friends maps to friends", () => {
    expect(parseIpcCommand("/friends")).toEqual({ type: "friends" });
  });

  test("slash /ignore maps to unimplemented", () => {
    expect(parseIpcCommand("/ignore someone")).toEqual({
      type: "unimplemented",
      feature: "Ignore list",
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
      ["IGNORE Foo", "Ignore list"],
      ["JOIN Trade", "Channel join/leave"],
      ["GINVITE Foo", "Guild management"],
      ["GKICK Foo", "Guild management"],
      ["GLEAVE", "Guild management"],
      ["GPROMOTE Foo", "Guild management"],
      ["MAIL", "Mail"],
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

  test("FRIENDS", () => {
    expect(parseIpcCommand("FRIENDS")).toEqual({ type: "friends" });
  });

  test("FRIENDS_JSON", () => {
    expect(parseIpcCommand("FRIENDS_JSON")).toEqual({ type: "friends_json" });
  });

  test("ADD_FRIEND", () => {
    expect(parseIpcCommand("ADD_FRIEND Arthas")).toEqual({
      type: "add_friend",
      target: "Arthas",
    });
  });

  test("ADD_FRIEND with no target returns undefined", () => {
    expect(parseIpcCommand("ADD_FRIEND")).toBeUndefined();
  });

  test("DEL_FRIEND", () => {
    expect(parseIpcCommand("DEL_FRIEND Arthas")).toEqual({
      type: "del_friend",
      target: "Arthas",
    });
  });

  test("DEL_FRIEND with no target returns undefined", () => {
    expect(parseIpcCommand("DEL_FRIEND")).toBeUndefined();
  });

  test("slash /friend add maps to add_friend", () => {
    expect(parseIpcCommand("/friend add Arthas")).toEqual({
      type: "add_friend",
      target: "Arthas",
    });
  });

  test("slash /friend remove maps to del_friend", () => {
    expect(parseIpcCommand("/friend remove Arthas")).toEqual({
      type: "del_friend",
      target: "Arthas",
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

  test("emote calls sendEmote and writes OK", async () => {
    const handle = createMockHandle();
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand(
      { type: "emote", message: "waves hello" },
      handle,
      events,
      socket,
      cleanup,
    );

    expect(handle.sendEmote).toHaveBeenCalledWith("waves hello");
    expect(socket.written()).toBe("OK\n\n");
  });

  test("dnd calls sendDnd and writes OK", async () => {
    const handle = createMockHandle();
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand(
      { type: "dnd", message: "busy" },
      handle,
      events,
      socket,
      cleanup,
    );

    expect(handle.sendDnd).toHaveBeenCalledWith("busy");
    expect(socket.written()).toBe("OK\n\n");
  });

  test("afk calls sendAfk and writes OK", async () => {
    const handle = createMockHandle();
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand(
      { type: "afk", message: "grabbing coffee" },
      handle,
      events,
      socket,
      cleanup,
    );

    expect(handle.sendAfk).toHaveBeenCalledWith("grabbing coffee");
    expect(socket.written()).toBe("OK\n\n");
  });

  test("roll calls sendRoll and writes OK", async () => {
    const handle = createMockHandle();
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand(
      { type: "roll", min: 1, max: 100 },
      handle,
      events,
      socket,
      cleanup,
    );

    expect(handle.sendRoll).toHaveBeenCalledWith(1, 100);
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

  test("read_wait delays then returns window events", async () => {
    jest.useFakeTimers();
    try {
      const handle = createMockHandle();
      const events = new RingBuffer<EventEntry>(10);
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
      events.push({ text: "[say] Alice: hi", json: '{"type":"SAY"}' });
      jest.advanceTimersByTime(1000);
      await promise;
      expect(socket.written()).toBe("[say] Alice: hi\n\n");
    } finally {
      jest.useRealTimers();
    }
  });

  test("read_wait returns only events arriving during wait window", async () => {
    jest.useFakeTimers();
    try {
      const handle = createMockHandle();
      const events = new RingBuffer<EventEntry>(10);
      events.push({ text: "[say] Old: before", json: '{"type":"SAY"}' });
      const socket = createMockSocket();
      const cleanup = jest.fn();

      const promise = dispatchCommand(
        { type: "read_wait", ms: 1000 },
        handle,
        events,
        socket,
        cleanup,
      );

      events.push({ text: "[say] New: during", json: '{"type":"SAY"}' });
      jest.advanceTimersByTime(1000);
      await promise;
      expect(socket.written()).toBe("[say] New: during\n\n");
      expect(events.drain()).toEqual([
        { text: "[say] Old: before", json: '{"type":"SAY"}' },
        { text: "[say] New: during", json: '{"type":"SAY"}' },
      ]);
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

  test("read_wait_json delays then returns window events", async () => {
    jest.useFakeTimers();
    try {
      const handle = createMockHandle();
      const events = new RingBuffer<EventEntry>(10);
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
      events.push({ text: "[say] Alice: hi", json: '{"type":"SAY"}' });
      jest.advanceTimersByTime(500);
      await promise;
      expect(socket.written()).toBe('{"type":"SAY"}\n\n');
    } finally {
      jest.useRealTimers();
    }
  });

  test("read_wait_json returns only events arriving during wait window", async () => {
    jest.useFakeTimers();
    try {
      const handle = createMockHandle();
      const events = new RingBuffer<EventEntry>(10);
      events.push({ text: "[say] Old: before", json: '{"old":true}' });
      const socket = createMockSocket();
      const cleanup = jest.fn();

      const promise = dispatchCommand(
        { type: "read_wait_json", ms: 500 },
        handle,
        events,
        socket,
        cleanup,
      );

      events.push({ text: "[say] New: during", json: '{"new":true}' });
      jest.advanceTimersByTime(500);
      await promise;
      expect(socket.written()).toBe('{"new":true}\n\n');
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

  test("nearby returns formatted entity list", async () => {
    const handle = createMockHandle();
    const testUnit: UnitEntity = {
      guid: 1n,
      objectType: ObjectType.UNIT,
      name: "Thrall",
      level: 80,
      health: 5000,
      maxHealth: 5000,
      entry: 0,
      scale: 1,
      position: { mapId: 1, x: 1.23, y: 4.56, z: 7.89, orientation: 0 },
      rawFields: new Map(),
      factionTemplate: 0,
      displayId: 0,
      npcFlags: 0,
      unitFlags: 0,
      target: 0n,
      race: 0,
      class_: 0,
      gender: 0,
      power: [0, 0, 0, 0, 0, 0, 0],
      maxPower: [0, 0, 0, 0, 0, 0, 0],
    };
    const testGo: GameObjectEntity = {
      guid: 2n,
      objectType: ObjectType.GAMEOBJECT,
      name: "Mailbox",
      entry: 0,
      scale: 1,
      position: { mapId: 1, x: 1.5, y: 4.6, z: 7.89, orientation: 0 },
      rawFields: new Map(),
      displayId: 0,
      flags: 0,
      gameObjectType: 19,
      bytes1: 0,
    };
    (handle.getNearbyEntities as ReturnType<typeof jest.fn>).mockReturnValue([
      testUnit,
      testGo,
    ]);
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand({ type: "nearby" }, handle, events, socket, cleanup);

    const output = socket.written();
    expect(output).toContain(
      "Thrall (NPC, level 80) HP 5000/5000 at 1.23, 4.56, 7.89",
    );
    expect(output).toContain("Mailbox (GameObject) at 1.50, 4.60, 7.89");
  });

  test("nearby_json returns JSONL entity list", async () => {
    const handle = createMockHandle();
    const testUnit: UnitEntity = {
      guid: 1n,
      objectType: ObjectType.UNIT,
      name: "Thrall",
      level: 80,
      health: 5000,
      maxHealth: 5000,
      entry: 0,
      scale: 1,
      position: { mapId: 1, x: 1.23, y: 4.56, z: 7.89, orientation: 0 },
      rawFields: new Map(),
      factionTemplate: 0,
      displayId: 0,
      npcFlags: 0,
      unitFlags: 0,
      target: 0n,
      race: 0,
      class_: 0,
      gender: 0,
      power: [0, 0, 0, 0, 0, 0, 0],
      maxPower: [0, 0, 0, 0, 0, 0, 0],
    };
    (handle.getNearbyEntities as ReturnType<typeof jest.fn>).mockReturnValue([
      testUnit,
    ]);
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand(
      { type: "nearby_json" },
      handle,
      events,
      socket,
      cleanup,
    );

    const lines = socket.written().trim().split("\n").filter(Boolean);
    const parsed = JSON.parse(lines[0]!);
    expect(parsed.guid).toBe("0x1");
    expect(parsed.type).toBe("unit");
    expect(parsed.name).toBe("Thrall");
    expect(parsed.level).toBe(80);
    expect(parsed.health).toBe(5000);
    expect(parsed.maxHealth).toBe(5000);
    expect(parsed.x).toBe(1.23);
    expect(parsed.y).toBe(4.56);
    expect(parsed.z).toBe(7.89);
  });

  test("nearby with no entities returns just terminator", async () => {
    const handle = createMockHandle();
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand({ type: "nearby" }, handle, events, socket, cleanup);

    expect(socket.written()).toBe("\n");
  });

  test("nearby formats player entity", async () => {
    const handle = createMockHandle();
    const testPlayer: UnitEntity = {
      guid: 10n,
      objectType: ObjectType.PLAYER,
      name: "Arthas",
      level: 55,
      health: 3000,
      maxHealth: 4000,
      entry: 0,
      scale: 1,
      position: { mapId: 0, x: 10.0, y: 20.0, z: 30.0, orientation: 0 },
      rawFields: new Map(),
      factionTemplate: 0,
      displayId: 0,
      npcFlags: 0,
      unitFlags: 0,
      target: 0n,
      race: 0,
      class_: 0,
      gender: 0,
      power: [0, 0, 0, 0, 0, 0, 0],
      maxPower: [0, 0, 0, 0, 0, 0, 0],
    };
    (handle.getNearbyEntities as ReturnType<typeof jest.fn>).mockReturnValue([
      testPlayer,
    ]);
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand({ type: "nearby" }, handle, events, socket, cleanup);

    const output = socket.written();
    expect(output).toContain(
      "Arthas (Player, level 55) HP 3000/4000 at 10.00, 20.00, 30.00",
    );
  });

  test("nearby formats unknown entity type", async () => {
    const handle = createMockHandle();
    const testCorpse: BaseEntity = {
      guid: 0xabn,
      objectType: ObjectType.CORPSE,
      entry: 0,
      scale: 1,
      position: undefined,
      rawFields: new Map(),
      name: undefined,
    };
    (handle.getNearbyEntities as ReturnType<typeof jest.fn>).mockReturnValue([
      testCorpse,
    ]);
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand({ type: "nearby" }, handle, events, socket, cleanup);

    const output = socket.written();
    expect(output).toContain("Entity 0xab (type 7)");
  });

  test("nearby_json formats player and gameobject types", async () => {
    const handle = createMockHandle();
    const testPlayer: UnitEntity = {
      guid: 1n,
      objectType: ObjectType.PLAYER,
      name: "Jaina",
      level: 70,
      health: 8000,
      maxHealth: 8000,
      entry: 0,
      scale: 1,
      position: undefined,
      rawFields: new Map(),
      factionTemplate: 0,
      displayId: 0,
      npcFlags: 0,
      unitFlags: 0,
      target: 0n,
      race: 0,
      class_: 0,
      gender: 0,
      power: [0, 0, 0, 0, 0, 0, 0],
      maxPower: [0, 0, 0, 0, 0, 0, 0],
    };
    const testGo: GameObjectEntity = {
      guid: 2n,
      objectType: ObjectType.GAMEOBJECT,
      name: "Chest",
      entry: 0,
      scale: 1,
      position: undefined,
      rawFields: new Map(),
      displayId: 0,
      flags: 0,
      gameObjectType: 3,
      bytes1: 0,
    };
    const testCorpse: BaseEntity = {
      guid: 3n,
      objectType: ObjectType.CORPSE,
      entry: 0,
      scale: 1,
      position: undefined,
      rawFields: new Map(),
      name: undefined,
    };
    (handle.getNearbyEntities as ReturnType<typeof jest.fn>).mockReturnValue([
      testPlayer,
      testGo,
      testCorpse,
    ]);
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand(
      { type: "nearby_json" },
      handle,
      events,
      socket,
      cleanup,
    );

    const lines = socket.written().trim().split("\n").filter(Boolean);
    expect(lines).toHaveLength(3);
    const player = JSON.parse(lines[0]!);
    const go = JSON.parse(lines[1]!);
    const corpse = JSON.parse(lines[2]!);
    expect(player.type).toBe("player");
    expect(player.level).toBe(70);
    expect(player.health).toBe(8000);
    expect(go.type).toBe("gameobject");
    expect(go.gameObjectType).toBe(3);
    expect(corpse.type).toBe("object");
  });

  test("friends calls getFriends and writes friend list", async () => {
    const handle = createMockHandle();
    (handle.getFriends as ReturnType<typeof jest.fn>).mockReturnValue([]);
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand({ type: "friends" }, handle, events, socket, cleanup);

    expect(handle.getFriends).toHaveBeenCalled();
    expect(socket.written()).toContain("No friends on your list");
  });

  test("friends_json calls getFriends and writes JSON", async () => {
    const handle = createMockHandle();
    (handle.getFriends as ReturnType<typeof jest.fn>).mockReturnValue([]);
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand(
      { type: "friends_json" },
      handle,
      events,
      socket,
      cleanup,
    );

    expect(handle.getFriends).toHaveBeenCalled();
    const parsed = JSON.parse(socket.written().replace(/\n+$/, ""));
    expect(parsed.type).toBe("FRIENDS");
    expect(parsed.count).toBe(0);
  });

  test("add_friend calls handle.addFriend and writes OK", async () => {
    const handle = createMockHandle();
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand(
      { type: "add_friend", target: "Arthas" },
      handle,
      events,
      socket,
      cleanup,
    );

    expect(handle.addFriend).toHaveBeenCalledWith("Arthas");
    expect(socket.written()).toBe("OK\n\n");
  });

  test("del_friend calls handle.removeFriend and writes OK", async () => {
    const handle = createMockHandle();
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand(
      { type: "del_friend", target: "Arthas" },
      handle,
      events,
      socket,
      cleanup,
    );

    expect(handle.removeFriend).toHaveBeenCalledWith("Arthas");
    expect(socket.written()).toBe("OK\n\n");
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

describe("onEntityEvent", () => {
  test("pushes appear event to ring buffer with text and json", () => {
    const events = new RingBuffer<EventEntry>(10);
    const entity: UnitEntity = {
      guid: 1n,
      objectType: ObjectType.UNIT,
      name: "Test NPC",
      level: 10,
      health: 100,
      maxHealth: 100,
      entry: 0,
      scale: 1,
      position: undefined,
      rawFields: new Map(),
      factionTemplate: 0,
      displayId: 0,
      npcFlags: 0,
      unitFlags: 0,
      target: 0n,
      race: 0,
      class_: 0,
      gender: 0,
      power: [0, 0, 0, 0, 0, 0, 0],
      maxPower: [0, 0, 0, 0, 0, 0, 0],
    };

    const append = jest.fn(async () => {});
    const log = { append } as unknown as SessionLog;
    onEntityEvent({ type: "appear", entity }, events, log);

    const drained = events.drain();
    expect(drained).toHaveLength(1);
    expect(drained[0]!.text).toContain("Test NPC");
    expect(drained[0]!.text).toContain("appeared");
    const json = JSON.parse(drained[0]!.json);
    expect(json.type).toBe("ENTITY_APPEAR");
    expect(json.name).toBe("Test NPC");
    expect(append).toHaveBeenCalledTimes(1);
  });

  test("pushes disappear event to ring buffer", () => {
    const events = new RingBuffer<EventEntry>(10);
    const append = jest.fn(async () => {});
    const log = { append } as unknown as SessionLog;
    onEntityEvent(
      { type: "disappear", guid: 1n, name: "Gone NPC" },
      events,
      log,
    );

    const drained = events.drain();
    expect(drained).toHaveLength(1);
    expect(drained[0]!.text).toContain("Gone NPC");
    expect(drained[0]!.text).toContain("left range");
    const json = JSON.parse(drained[0]!.json);
    expect(json.type).toBe("ENTITY_DISAPPEAR");
  });

  test("skips update events with no obj", () => {
    const events = new RingBuffer<EventEntry>(10);
    const entity: UnitEntity = {
      guid: 1n,
      objectType: ObjectType.UNIT,
      name: "Test NPC",
      level: 10,
      health: 100,
      maxHealth: 100,
      entry: 0,
      scale: 1,
      position: undefined,
      rawFields: new Map(),
      factionTemplate: 0,
      displayId: 0,
      npcFlags: 0,
      unitFlags: 0,
      target: 0n,
      race: 0,
      class_: 0,
      gender: 0,
      power: [0, 0, 0, 0, 0, 0, 0],
      maxPower: [0, 0, 0, 0, 0, 0, 0],
    };

    const append = jest.fn(async () => {});
    const log = { append } as unknown as SessionLog;
    onEntityEvent({ type: "update", entity, changed: ["health"] }, events, log);

    expect(events.drain()).toHaveLength(0);
    expect(append).not.toHaveBeenCalled();
  });

  test("swallows entity event log append errors", async () => {
    const events = new RingBuffer<EventEntry>(10);
    const append = jest.fn(() => Promise.reject(new Error("disk full")));
    const log: SessionLog = { append } as unknown as SessionLog;

    onEntityEvent(
      { type: "disappear", guid: 1n, name: "Gone NPC" },
      events,
      log,
    );
    await Promise.resolve();

    expect(append).toHaveBeenCalled();
  });
});

describe("onFriendEvent", () => {
  test("pushes friend-online event to ring buffer", () => {
    const events = new RingBuffer<EventEntry>(10);
    const append = jest.fn(async () => {});
    const log = { append } as unknown as SessionLog;

    onFriendEvent(
      {
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
      },
      events,
      log,
    );

    const drained = events.drain();
    expect(drained).toHaveLength(1);
    expect(drained[0]!.text).toContain("Arthas");
    expect(drained[0]!.text).toContain("online");
    const json = JSON.parse(drained[0]!.json);
    expect(json.type).toBe("FRIEND_ONLINE");
    expect(json.name).toBe("Arthas");
    expect(append).toHaveBeenCalledTimes(1);
  });

  test("pushes friend-offline event to ring buffer", () => {
    const events = new RingBuffer<EventEntry>(10);
    const append = jest.fn(async () => {});
    const log = { append } as unknown as SessionLog;

    onFriendEvent(
      { type: "friend-offline", guid: 1n, name: "Arthas" },
      events,
      log,
    );

    const drained = events.drain();
    expect(drained).toHaveLength(1);
    expect(drained[0]!.text).toContain("Arthas");
    expect(drained[0]!.text).toContain("offline");
    const json = JSON.parse(drained[0]!.json);
    expect(json.type).toBe("FRIEND_OFFLINE");
  });

  test("skips friend-list events", () => {
    const events = new RingBuffer<EventEntry>(10);
    const append = jest.fn(async () => {});
    const log = { append } as unknown as SessionLog;

    onFriendEvent({ type: "friend-list", friends: [] }, events, log);

    expect(events.drain()).toHaveLength(0);
    expect(append).not.toHaveBeenCalled();
  });

  test("pushes friend-error event to ring buffer", () => {
    const events = new RingBuffer<EventEntry>(10);
    const append = jest.fn(async () => {});
    const log = { append } as unknown as SessionLog;

    onFriendEvent(
      { type: "friend-error", result: 0x04, name: "Nobody" },
      events,
      log,
    );

    const drained = events.drain();
    expect(drained).toHaveLength(1);
    expect(drained[0]!.text).toContain("player not found");
    const json = JSON.parse(drained[0]!.json);
    expect(json.type).toBe("FRIEND_ERROR");
    expect(json.result).toBe(0x04);
  });

  test("swallows friend event log append errors", async () => {
    const events = new RingBuffer<EventEntry>(10);
    const append = jest.fn(() => Promise.reject(new Error("disk full")));
    const log: SessionLog = { append } as unknown as SessionLog;

    onFriendEvent(
      { type: "friend-offline", guid: 1n, name: "Gone" },
      events,
      log,
    );
    await Promise.resolve();

    expect(append).toHaveBeenCalled();
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

  test("EMOTE returns OK and calls handle", async () => {
    startTestServer();
    const lines = await sendToSocket("EMOTE waves hello", sockPath);
    expect(lines).toEqual(["OK"]);
    expect(handle.sendEmote).toHaveBeenCalledWith("waves hello");
  });

  test("DND returns OK and calls handle", async () => {
    startTestServer();
    const lines = await sendToSocket("DND busy right now", sockPath);
    expect(lines).toEqual(["OK"]);
    expect(handle.sendDnd).toHaveBeenCalledWith("busy right now");
  });

  test("AFK returns OK and calls handle", async () => {
    startTestServer();
    const lines = await sendToSocket("AFK grabbing coffee", sockPath);
    expect(lines).toEqual(["OK"]);
    expect(handle.sendAfk).toHaveBeenCalledWith("grabbing coffee");
  });

  test("WHISPER returns OK", async () => {
    startTestServer();
    const lines = await sendToSocket("WHISPER Xiara hey", sockPath);
    expect(lines).toEqual(["OK"]);
    expect(handle.sendWhisper).toHaveBeenCalledWith("Xiara", "hey");
  });

  test("ROLL returns OK and calls sendRoll", async () => {
    startTestServer();
    const lines = await sendToSocket("ROLL 10 20", sockPath);
    expect(lines).toEqual(["OK"]);
    expect(handle.sendRoll).toHaveBeenCalledWith(10, 20);
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

  test("onFriendEvent wiring pushes to ring buffer", async () => {
    startTestServer();
    handle.triggerFriendEvent({
      type: "friend-online",
      friend: {
        guid: 1n,
        name: "Arthas",
        level: 80,
        playerClass: 1,
        area: 0,
        status: 0,
        note: "",
      },
    });
    const lines = await sendToSocket("READ", sockPath);
    expect(lines[0]).toContain("Arthas");
  });

  test("onEntityEvent wiring pushes to ring buffer", async () => {
    startTestServer();
    handle.triggerEntityEvent({
      type: "appear",
      entity: {
        guid: 1n,
        objectType: ObjectType.UNIT,
        name: "Test NPC",
        level: 10,
        health: 100,
        maxHealth: 100,
        entry: 0,
        scale: 1,
        position: undefined,
        rawFields: new Map(),
        factionTemplate: 0,
        displayId: 0,
        npcFlags: 0,
        unitFlags: 0,
        target: 0n,
        race: 0,
        class_: 0,
        gender: 0,
        power: [0, 0, 0, 0, 0, 0, 0],
        maxPower: [0, 0, 0, 0, 0, 0, 0],
      } satisfies UnitEntity,
    });
    const lines = await sendToSocket("READ", sockPath);
    expect(lines[0]).toContain("Test NPC");
  });

  test("onEntityEvent wiring round-trip via READ_JSON", async () => {
    startTestServer();
    handle.triggerEntityEvent({
      type: "appear",
      entity: {
        guid: 1n,
        objectType: ObjectType.UNIT,
        name: "Test NPC",
        level: 10,
        health: 100,
        maxHealth: 100,
        entry: 0,
        scale: 1,
        position: undefined,
        rawFields: new Map(),
        factionTemplate: 0,
        displayId: 0,
        npcFlags: 0,
        unitFlags: 0,
        target: 0n,
        race: 0,
        class_: 0,
        gender: 0,
        power: [0, 0, 0, 0, 0, 0, 0],
        maxPower: [0, 0, 0, 0, 0, 0, 0],
      } satisfies UnitEntity,
    });
    const lines = await sendToSocket("READ_JSON", sockPath);
    const parsed = JSON.parse(lines[0]!);
    expect(parsed.type).toBe("ENTITY_APPEAR");
    expect(parsed.name).toBe("Test NPC");
  });

  test("NEARBY round-trip returns formatted entities", async () => {
    startTestServer();
    const testUnit: UnitEntity = {
      guid: 1n,
      objectType: ObjectType.UNIT,
      name: "Thrall",
      level: 80,
      health: 5000,
      maxHealth: 5000,
      entry: 0,
      scale: 1,
      position: { mapId: 1, x: 1.23, y: 4.56, z: 7.89, orientation: 0 },
      rawFields: new Map(),
      factionTemplate: 0,
      displayId: 0,
      npcFlags: 0,
      unitFlags: 0,
      target: 0n,
      race: 0,
      class_: 0,
      gender: 0,
      power: [0, 0, 0, 0, 0, 0, 0],
      maxPower: [0, 0, 0, 0, 0, 0, 0],
    };
    (handle.getNearbyEntities as ReturnType<typeof jest.fn>).mockReturnValue([
      testUnit,
    ]);
    const lines = await sendToSocket("NEARBY", sockPath);
    expect(lines[0]).toContain("Thrall");
    expect(lines[0]).toContain("level 80");
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
