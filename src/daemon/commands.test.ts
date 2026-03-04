import { test, expect, describe, jest, afterEach } from "bun:test";
import { unlink } from "node:fs/promises";
import {
  parseIpcCommand,
  dispatchCommand,
  onChatMessage,
  onGroupEvent,
  onEntityEvent,
  onFriendEvent,
  onIgnoreEvent,
  onGuildEvent,
  onDuelEvent,
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

  test("slash /ignore maps to add_ignore", () => {
    expect(parseIpcCommand("/ignore someone")).toEqual({
      type: "add_ignore",
      target: "someone",
    });
  });

  test("slash /ignore bare maps to ignored", () => {
    expect(parseIpcCommand("/ignore")).toEqual({ type: "ignored" });
  });

  test("slash /ignorelist maps to ignored", () => {
    expect(parseIpcCommand("/ignorelist")).toEqual({ type: "ignored" });
  });

  test("slash /unignore maps to del_ignore", () => {
    expect(parseIpcCommand("/unignore someone")).toEqual({
      type: "del_ignore",
      target: "someone",
    });
  });

  test("slash /join maps to join_channel", () => {
    expect(parseIpcCommand("/join Trade")).toEqual({
      type: "join_channel",
      channel: "Trade",
    });
  });

  test("slash /leave channel maps to leave_channel", () => {
    expect(parseIpcCommand("/leave Trade")).toEqual({
      type: "leave_channel",
      channel: "Trade",
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

  test("JOIN parses channel", () => {
    expect(parseIpcCommand("JOIN Trade")).toEqual({
      type: "join_channel",
      channel: "Trade",
    });
  });

  test("JOIN parses channel with password", () => {
    expect(parseIpcCommand("JOIN Secret hunter2")).toEqual({
      type: "join_channel",
      channel: "Secret",
      password: "hunter2",
    });
  });

  test("JOIN with no channel returns undefined", () => {
    expect(parseIpcCommand("JOIN")).toBeUndefined();
  });

  test("LEAVE with channel parses leave_channel", () => {
    expect(parseIpcCommand("LEAVE Trade")).toEqual({
      type: "leave_channel",
      channel: "Trade",
    });
  });

  test("LEAVE without channel parses leave", () => {
    expect(parseIpcCommand("LEAVE")).toEqual({ type: "leave" });
  });

  describe("mail IPC commands", () => {
    test("MAIL parses as mail_list", () => {
      expect(parseIpcCommand("MAIL")).toEqual({ type: "mail_list" });
    });

    test("MAIL_JSON parses as mail_list_json", () => {
      expect(parseIpcCommand("MAIL_JSON")).toEqual({ type: "mail_list_json" });
    });

    test("MAIL_READ 1 parses as mail_read", () => {
      expect(parseIpcCommand("MAIL_READ 1")).toEqual({ type: "mail_read", index: 1 });
    });

    test("MAIL_READ_JSON 2 parses as mail_read_json", () => {
      expect(parseIpcCommand("MAIL_READ_JSON 2")).toEqual({ type: "mail_read_json", index: 2 });
    });

    test("MAIL_READ without number returns undefined", () => {
      expect(parseIpcCommand("MAIL_READ")).toBeUndefined();
    });

    test("MAIL_SEND parses quoted subject", () => {
      expect(parseIpcCommand('MAIL_SEND Thrall "Hello" Body text')).toEqual({
        type: "mail_send",
        target: "Thrall",
        subject: "Hello",
        body: "Body text",
      });
    });

    test("MAIL_DELETE 3 parses as mail_delete", () => {
      expect(parseIpcCommand("MAIL_DELETE 3")).toEqual({ type: "mail_delete", index: 3 });
    });

    test("/mail routes to mail_list", () => {
      expect(parseIpcCommand("/mail")).toEqual({ type: "mail_list" });
    });

    test("/mail read 1 routes to mail_read", () => {
      expect(parseIpcCommand("/mail read 1")).toEqual({ type: "mail_read", index: 1 });
    });

    test('/mail send Thrall "Hi" body routes to mail_send', () => {
      expect(parseIpcCommand('/mail send Thrall "Hi" body')).toEqual({
        type: "mail_send",
        target: "Thrall",
        subject: "Hi",
        body: "body",
      });
    });

    test("/mail delete 2 routes to mail_delete", () => {
      expect(parseIpcCommand("/mail delete 2")).toEqual({ type: "mail_delete", index: 2 });
    });
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

  test("IGNORED", () => {
    expect(parseIpcCommand("IGNORED")).toEqual({ type: "ignored" });
  });

  test("IGNORED_JSON", () => {
    expect(parseIpcCommand("IGNORED_JSON")).toEqual({ type: "ignored_json" });
  });

  test("ADD_IGNORE", () => {
    expect(parseIpcCommand("ADD_IGNORE Spammer")).toEqual({
      type: "add_ignore",
      target: "Spammer",
    });
  });

  test("ADD_IGNORE with no target returns undefined", () => {
    expect(parseIpcCommand("ADD_IGNORE")).toBeUndefined();
  });

  test("DEL_IGNORE", () => {
    expect(parseIpcCommand("DEL_IGNORE Spammer")).toEqual({
      type: "del_ignore",
      target: "Spammer",
    });
  });

  test("DEL_IGNORE with no target returns undefined", () => {
    expect(parseIpcCommand("DEL_IGNORE")).toBeUndefined();
  });

  test("GUILD_ROSTER", () => {
    expect(parseIpcCommand("GUILD_ROSTER")).toEqual({ type: "guild_roster" });
  });

  test("GUILD_ROSTER_JSON", () => {
    expect(parseIpcCommand("GUILD_ROSTER_JSON")).toEqual({
      type: "guild_roster_json",
    });
  });

  test("/groster", () => {
    expect(parseIpcCommand("/groster")).toEqual({ type: "guild_roster" });
  });

  test("GINVITE parses guild invite", () => {
    expect(parseIpcCommand("GINVITE Thrall")).toEqual({
      type: "guild_invite",
      target: "Thrall",
    });
  });

  test("GINVITE without target returns undefined", () => {
    expect(parseIpcCommand("GINVITE")).toBeUndefined();
  });

  test("GKICK parses guild kick", () => {
    expect(parseIpcCommand("GKICK Garrosh")).toEqual({
      type: "guild_kick",
      target: "Garrosh",
    });
  });

  test("GLEAVE parses guild leave", () => {
    expect(parseIpcCommand("GLEAVE")).toEqual({ type: "guild_leave" });
  });

  test("GPROMOTE parses guild promote", () => {
    expect(parseIpcCommand("GPROMOTE Jaina")).toEqual({
      type: "guild_promote",
      target: "Jaina",
    });
  });

  test("GDEMOTE parses guild demote", () => {
    expect(parseIpcCommand("GDEMOTE Arthas")).toEqual({
      type: "guild_demote",
      target: "Arthas",
    });
  });

  test("GLEADER parses guild leader", () => {
    expect(parseIpcCommand("GLEADER Sylvanas")).toEqual({
      type: "guild_leader",
      target: "Sylvanas",
    });
  });

  test("GMOTD parses guild motd", () => {
    expect(parseIpcCommand("GMOTD Raid tonight")).toEqual({
      type: "guild_motd",
      message: "Raid tonight",
    });
  });

  test("GMOTD with empty message clears motd", () => {
    expect(parseIpcCommand("GMOTD")).toEqual({
      type: "guild_motd",
      message: "",
    });
  });

  test("GACCEPT parses guild accept", () => {
    expect(parseIpcCommand("GACCEPT")).toEqual({ type: "guild_accept" });
  });

  test("GDECLINE parses guild decline", () => {
    expect(parseIpcCommand("GDECLINE")).toEqual({ type: "guild_decline" });
  });

  test("/ginvite via slash parses guild invite", () => {
    expect(parseIpcCommand("/ginvite Thrall")).toEqual({
      type: "guild_invite",
      target: "Thrall",
    });
  });

  test("/gaccept via slash parses guild accept", () => {
    expect(parseIpcCommand("/gaccept")).toEqual({ type: "guild_accept" });
  });

  test("/gdecline via slash parses guild decline", () => {
    expect(parseIpcCommand("/gdecline")).toEqual({ type: "guild_decline" });
  });

  test("/gkick via slash parses guild kick", () => {
    expect(parseIpcCommand("/gkick Garrosh")).toEqual({
      type: "guild_kick",
      target: "Garrosh",
    });
  });

  test("/gleave via slash parses guild leave", () => {
    expect(parseIpcCommand("/gleave")).toEqual({ type: "guild_leave" });
  });

  test("/gpromote via slash parses guild promote", () => {
    expect(parseIpcCommand("/gpromote Jaina")).toEqual({
      type: "guild_promote",
      target: "Jaina",
    });
  });

  test("/gdemote via slash parses guild demote", () => {
    expect(parseIpcCommand("/gdemote Arthas")).toEqual({
      type: "guild_demote",
      target: "Arthas",
    });
  });

  test("/gleader via slash parses guild leader", () => {
    expect(parseIpcCommand("/gleader Sylvanas")).toEqual({
      type: "guild_leader",
      target: "Sylvanas",
    });
  });

  test("/gmotd via slash parses guild motd", () => {
    expect(parseIpcCommand("/gmotd Raid tonight")).toEqual({
      type: "guild_motd",
      message: "Raid tonight",
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

  test("join_channel calls handle.joinChannel and writes OK", async () => {
    const handle = createMockHandle();
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand(
      { type: "join_channel", channel: "Trade" },
      handle,
      events,
      socket,
      cleanup,
    );

    expect(handle.joinChannel).toHaveBeenCalledWith("Trade", undefined);
    expect(socket.written()).toBe("OK\n\n");
  });

  test("join_channel with password passes it through", async () => {
    const handle = createMockHandle();
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand(
      { type: "join_channel", channel: "Secret", password: "hunter2" },
      handle,
      events,
      socket,
      cleanup,
    );

    expect(handle.joinChannel).toHaveBeenCalledWith("Secret", "hunter2");
    expect(socket.written()).toBe("OK\n\n");
  });

  test("leave_channel calls handle.leaveChannel and writes OK", async () => {
    const handle = createMockHandle();
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand(
      { type: "leave_channel", channel: "Trade" },
      handle,
      events,
      socket,
      cleanup,
    );

    expect(handle.leaveChannel).toHaveBeenCalledWith("Trade");
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

  test("ignored calls getIgnored and writes ignore list", async () => {
    const handle = createMockHandle();
    (handle.getIgnored as ReturnType<typeof jest.fn>).mockReturnValue([]);
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand({ type: "ignored" }, handle, events, socket, cleanup);

    expect(handle.getIgnored).toHaveBeenCalled();
    expect(socket.written()).toContain("Ignore list is empty");
  });

  test("ignored_json calls getIgnored and writes JSON", async () => {
    const handle = createMockHandle();
    (handle.getIgnored as ReturnType<typeof jest.fn>).mockReturnValue([]);
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand(
      { type: "ignored_json" },
      handle,
      events,
      socket,
      cleanup,
    );

    expect(handle.getIgnored).toHaveBeenCalled();
    const parsed = JSON.parse(socket.written().replace(/\n+$/, ""));
    expect(parsed.type).toBe("IGNORED");
    expect(parsed.count).toBe(0);
  });

  test("add_ignore calls handle.addIgnore and writes OK", async () => {
    const handle = createMockHandle();
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand(
      { type: "add_ignore", target: "Spammer" },
      handle,
      events,
      socket,
      cleanup,
    );

    expect(handle.addIgnore).toHaveBeenCalledWith("Spammer");
    expect(socket.written()).toBe("OK\n\n");
  });

  test("del_ignore calls handle.removeIgnore and writes OK", async () => {
    const handle = createMockHandle();
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand(
      { type: "del_ignore", target: "Spammer" },
      handle,
      events,
      socket,
      cleanup,
    );

    expect(handle.removeIgnore).toHaveBeenCalledWith("Spammer");
    expect(socket.written()).toBe("OK\n\n");
  });

  test("guild_roster calls requestGuildRoster and writes roster", async () => {
    const handle = createMockHandle();
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand(
      { type: "guild_roster" },
      handle,
      events,
      socket,
      cleanup,
    );

    expect(handle.requestGuildRoster).toHaveBeenCalled();
    expect(socket.written()).toContain("No guild roster available");
  });

  test("guild_roster_json calls requestGuildRoster and writes JSON", async () => {
    const handle = createMockHandle();
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand(
      { type: "guild_roster_json" },
      handle,
      events,
      socket,
      cleanup,
    );

    expect(handle.requestGuildRoster).toHaveBeenCalled();
    const parsed = JSON.parse(socket.written().replace(/\n+$/, ""));
    expect(parsed.type).toBe("GUILD_ROSTER");
    expect(parsed.members).toEqual([]);
  });

  test("guild_roster with data writes formatted roster", async () => {
    const handle = createMockHandle();
    const roster = {
      guildName: "Horde Elite",
      motd: "Welcome!",
      guildInfo: "",
      rankNames: ["GM"],
      members: [
        {
          guid: 1n,
          name: "Thrall",
          rankIndex: 0,
          level: 80,
          playerClass: 7,
          gender: 0,
          area: 10,
          status: 1,
          timeOffline: 0,
          publicNote: "",
          officerNote: "",
        },
      ],
    };
    (handle.requestGuildRoster as ReturnType<typeof jest.fn>).mockResolvedValue(
      roster,
    );
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand(
      { type: "guild_roster" },
      handle,
      events,
      socket,
      cleanup,
    );

    expect(socket.written()).toContain("Horde Elite");
    expect(socket.written()).toContain("Thrall");
  });

  test("guild_roster_json with data writes JSON roster", async () => {
    const handle = createMockHandle();
    const roster = {
      guildName: "Horde Elite",
      motd: "Welcome!",
      guildInfo: "",
      rankNames: ["GM"],
      members: [
        {
          guid: 1n,
          name: "Thrall",
          rankIndex: 0,
          level: 80,
          playerClass: 7,
          gender: 0,
          area: 10,
          status: 1,
          timeOffline: 0,
          publicNote: "",
          officerNote: "",
        },
      ],
    };
    (handle.requestGuildRoster as ReturnType<typeof jest.fn>).mockResolvedValue(
      roster,
    );
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand(
      { type: "guild_roster_json" },
      handle,
      events,
      socket,
      cleanup,
    );

    const parsed = JSON.parse(socket.written().replace(/\n+$/, ""));
    expect(parsed.type).toBe("GUILD_ROSTER");
    expect(parsed.guildName).toBe("Horde Elite");
    expect(parsed.count).toBe(1);
  });

  test("guild_invite calls handle.guildInvite and writes OK", async () => {
    const handle = createMockHandle();
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand(
      { type: "guild_invite", target: "Thrall" },
      handle,
      events,
      socket,
      cleanup,
    );

    expect(handle.guildInvite).toHaveBeenCalledWith("Thrall");
    expect(socket.written()).toBe("OK\n\n");
  });

  test("guild_kick calls handle.guildRemove and writes OK", async () => {
    const handle = createMockHandle();
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand(
      { type: "guild_kick", target: "Garrosh" },
      handle,
      events,
      socket,
      cleanup,
    );

    expect(handle.guildRemove).toHaveBeenCalledWith("Garrosh");
    expect(socket.written()).toBe("OK\n\n");
  });

  test("guild_leave calls handle.guildLeave and writes OK", async () => {
    const handle = createMockHandle();
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand(
      { type: "guild_leave" },
      handle,
      events,
      socket,
      cleanup,
    );

    expect(handle.guildLeave).toHaveBeenCalled();
    expect(socket.written()).toBe("OK\n\n");
  });

  test("guild_promote calls handle.guildPromote and writes OK", async () => {
    const handle = createMockHandle();
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand(
      { type: "guild_promote", target: "Jaina" },
      handle,
      events,
      socket,
      cleanup,
    );

    expect(handle.guildPromote).toHaveBeenCalledWith("Jaina");
    expect(socket.written()).toBe("OK\n\n");
  });

  test("guild_demote calls handle.guildDemote and writes OK", async () => {
    const handle = createMockHandle();
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand(
      { type: "guild_demote", target: "Arthas" },
      handle,
      events,
      socket,
      cleanup,
    );

    expect(handle.guildDemote).toHaveBeenCalledWith("Arthas");
    expect(socket.written()).toBe("OK\n\n");
  });

  test("guild_leader calls handle.guildLeader and writes OK", async () => {
    const handle = createMockHandle();
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand(
      { type: "guild_leader", target: "Sylvanas" },
      handle,
      events,
      socket,
      cleanup,
    );

    expect(handle.guildLeader).toHaveBeenCalledWith("Sylvanas");
    expect(socket.written()).toBe("OK\n\n");
  });

  test("guild_motd calls handle.guildMotd and writes OK", async () => {
    const handle = createMockHandle();
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand(
      { type: "guild_motd", message: "Raid tonight" },
      handle,
      events,
      socket,
      cleanup,
    );

    expect(handle.guildMotd).toHaveBeenCalledWith("Raid tonight");
    expect(socket.written()).toBe("OK\n\n");
  });

  test("guild_accept calls handle.acceptGuildInvite and writes OK", async () => {
    const handle = createMockHandle();
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand(
      { type: "guild_accept" },
      handle,
      events,
      socket,
      cleanup,
    );

    expect(handle.acceptGuildInvite).toHaveBeenCalled();
    expect(socket.written()).toBe("OK\n\n");
  });

  test("guild_decline calls handle.declineGuildInvite and writes OK", async () => {
    const handle = createMockHandle();
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand(
      { type: "guild_decline" },
      handle,
      events,
      socket,
      cleanup,
    );

    expect(handle.declineGuildInvite).toHaveBeenCalled();
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

describe("onIgnoreEvent", () => {
  test("pushes ignore-added event to ring buffer", () => {
    const events = new RingBuffer<EventEntry>(10);
    const append = jest.fn(async () => {});
    const log = { append } as unknown as SessionLog;

    onIgnoreEvent(
      { type: "ignore-added", entry: { guid: 1n, name: "Spammer" } },
      events,
      log,
    );

    const drained = events.drain();
    expect(drained).toHaveLength(1);
    expect(drained[0]!.text).toContain("Spammer");
    expect(drained[0]!.text).toContain("added to ignore list");
    const json = JSON.parse(drained[0]!.json);
    expect(json.type).toBe("IGNORE_ADDED");
    expect(json.name).toBe("Spammer");
    expect(append).toHaveBeenCalledTimes(1);
  });

  test("pushes ignore-removed event to ring buffer", () => {
    const events = new RingBuffer<EventEntry>(10);
    const append = jest.fn(async () => {});
    const log = { append } as unknown as SessionLog;

    onIgnoreEvent(
      { type: "ignore-removed", guid: 1n, name: "Spammer" },
      events,
      log,
    );

    const drained = events.drain();
    expect(drained).toHaveLength(1);
    expect(drained[0]!.text).toContain("Spammer");
    expect(drained[0]!.text).toContain("removed from ignore list");
    const json = JSON.parse(drained[0]!.json);
    expect(json.type).toBe("IGNORE_REMOVED");
  });

  test("skips ignore-list events", () => {
    const events = new RingBuffer<EventEntry>(10);
    const append = jest.fn(async () => {});
    const log = { append } as unknown as SessionLog;

    onIgnoreEvent({ type: "ignore-list", entries: [] }, events, log);

    expect(events.drain()).toHaveLength(0);
    expect(append).not.toHaveBeenCalled();
  });

  test("pushes ignore-error event to ring buffer", () => {
    const events = new RingBuffer<EventEntry>(10);
    const append = jest.fn(async () => {});
    const log = { append } as unknown as SessionLog;

    onIgnoreEvent(
      { type: "ignore-error", result: 0x0d, name: "Nobody" },
      events,
      log,
    );

    const drained = events.drain();
    expect(drained).toHaveLength(1);
    expect(drained[0]!.text).toContain("player not found");
    const json = JSON.parse(drained[0]!.json);
    expect(json.type).toBe("IGNORE_ERROR");
    expect(json.result).toBe(0x0d);
  });

  test("swallows ignore event log append errors", async () => {
    const events = new RingBuffer<EventEntry>(10);
    const append = jest.fn(() => Promise.reject(new Error("disk full")));
    const log: SessionLog = { append } as unknown as SessionLog;

    onIgnoreEvent(
      { type: "ignore-removed", guid: 1n, name: "Gone" },
      events,
      log,
    );
    await Promise.resolve();

    expect(append).toHaveBeenCalled();
  });
});

describe("onGuildEvent", () => {
  test("pushes guild-roster event to ring buffer", () => {
    const events = new RingBuffer<EventEntry>(10);
    const append = jest.fn(async () => {});
    const log = { append } as unknown as SessionLog;

    onGuildEvent(
      {
        type: "guild-roster",
        roster: {
          guildName: "Horde Elite",
          motd: "Welcome!",
          guildInfo: "",
          rankNames: ["GM"],
          members: [
            {
              guid: 1n,
              name: "Thrall",
              rankIndex: 0,
              level: 80,
              playerClass: 7,
              gender: 0,
              area: 10,
              status: 1,
              timeOffline: 0,
              publicNote: "",
              officerNote: "",
            },
          ],
        },
      },
      events,
      log,
    );

    const drained = events.drain();
    expect(drained).toHaveLength(1);
    expect(drained[0]!.text).toContain("Roster updated");
    expect(drained[0]!.text).toContain("1 members");
    const json = JSON.parse(drained[0]!.json);
    expect(json.type).toBe("GUILD_ROSTER_UPDATED");
    expect(append).toHaveBeenCalledTimes(1);
  });

  test("swallows guild event log append errors", async () => {
    const events = new RingBuffer<EventEntry>(10);
    const append = jest.fn(() => Promise.reject(new Error("disk full")));
    const log = { append } as unknown as SessionLog;

    onGuildEvent(
      {
        type: "guild-roster",
        roster: {
          guildName: "",
          motd: "",
          guildInfo: "",
          rankNames: [],
          members: [],
        },
      },
      events,
      log,
    );
    await Promise.resolve();

    expect(append).toHaveBeenCalled();
  });

  test("promotion formats text and JSON", () => {
    const events = new RingBuffer<EventEntry>(10);
    const log = { append: jest.fn(async () => {}) } as unknown as SessionLog;
    onGuildEvent(
      {
        type: "promotion",
        officer: "Thrall",
        member: "Garrosh",
        rank: "Officer",
      },
      events,
      log,
    );
    const d = events.drain();
    expect(d[0]!.text).toBe("[guild] Thrall promoted Garrosh to Officer");
    expect(JSON.parse(d[0]!.json)).toEqual({
      type: "GUILD_PROMOTION",
      officer: "Thrall",
      member: "Garrosh",
      rank: "Officer",
    });
  });

  test("demotion formats text and JSON", () => {
    const events = new RingBuffer<EventEntry>(10);
    const log = { append: jest.fn(async () => {}) } as unknown as SessionLog;
    onGuildEvent(
      {
        type: "demotion",
        officer: "Thrall",
        member: "Garrosh",
        rank: "Member",
      },
      events,
      log,
    );
    const d = events.drain();
    expect(d[0]!.text).toBe("[guild] Thrall demoted Garrosh to Member");
    expect(JSON.parse(d[0]!.json).type).toBe("GUILD_DEMOTION");
  });

  test("motd formats text and JSON", () => {
    const events = new RingBuffer<EventEntry>(10);
    const log = { append: jest.fn(async () => {}) } as unknown as SessionLog;
    onGuildEvent({ type: "motd", text: "Raid tonight!" }, events, log);
    const d = events.drain();
    expect(d[0]!.text).toBe("[guild] MOTD: Raid tonight!");
    expect(JSON.parse(d[0]!.json).type).toBe("GUILD_MOTD");
  });

  test("joined formats text and JSON", () => {
    const events = new RingBuffer<EventEntry>(10);
    const log = { append: jest.fn(async () => {}) } as unknown as SessionLog;
    onGuildEvent({ type: "joined", name: "Arthas" }, events, log);
    const d = events.drain();
    expect(d[0]!.text).toBe("[guild] Arthas has joined the guild");
    expect(JSON.parse(d[0]!.json).type).toBe("GUILD_JOINED");
  });

  test("left formats text and JSON", () => {
    const events = new RingBuffer<EventEntry>(10);
    const log = { append: jest.fn(async () => {}) } as unknown as SessionLog;
    onGuildEvent({ type: "left", name: "Sylvanas" }, events, log);
    const d = events.drain();
    expect(d[0]!.text).toBe("[guild] Sylvanas has left the guild");
    expect(JSON.parse(d[0]!.json).type).toBe("GUILD_LEFT");
  });

  test("removed formats text and JSON", () => {
    const events = new RingBuffer<EventEntry>(10);
    const log = { append: jest.fn(async () => {}) } as unknown as SessionLog;
    onGuildEvent(
      { type: "removed", member: "Garrosh", officer: "Thrall" },
      events,
      log,
    );
    const d = events.drain();
    expect(d[0]!.text).toBe("[guild] Thrall removed Garrosh from the guild");
    expect(JSON.parse(d[0]!.json).type).toBe("GUILD_REMOVED");
  });

  test("leader_is formats text and JSON", () => {
    const events = new RingBuffer<EventEntry>(10);
    const log = { append: jest.fn(async () => {}) } as unknown as SessionLog;
    onGuildEvent({ type: "leader_is", name: "Thrall" }, events, log);
    const d = events.drain();
    expect(d[0]!.text).toBe("[guild] Thrall is the guild leader");
    expect(JSON.parse(d[0]!.json).type).toBe("GUILD_LEADER_IS");
  });

  test("leader_changed formats text and JSON", () => {
    const events = new RingBuffer<EventEntry>(10);
    const log = { append: jest.fn(async () => {}) } as unknown as SessionLog;
    onGuildEvent(
      { type: "leader_changed", oldLeader: "Thrall", newLeader: "Garrosh" },
      events,
      log,
    );
    const d = events.drain();
    expect(d[0]!.text).toBe(
      "[guild] Thrall has made Garrosh the new guild leader",
    );
    expect(JSON.parse(d[0]!.json).type).toBe("GUILD_LEADER_CHANGED");
  });

  test("disbanded formats text and JSON", () => {
    const events = new RingBuffer<EventEntry>(10);
    const log = { append: jest.fn(async () => {}) } as unknown as SessionLog;
    onGuildEvent({ type: "disbanded" }, events, log);
    const d = events.drain();
    expect(d[0]!.text).toBe("[guild] Guild has been disbanded");
    expect(JSON.parse(d[0]!.json).type).toBe("GUILD_DISBANDED");
  });

  test("signed_on formats text and JSON", () => {
    const events = new RingBuffer<EventEntry>(10);
    const log = { append: jest.fn(async () => {}) } as unknown as SessionLog;
    onGuildEvent({ type: "signed_on", name: "Jaina" }, events, log);
    const d = events.drain();
    expect(d[0]!.text).toBe("[guild] Jaina has come online");
    expect(JSON.parse(d[0]!.json).type).toBe("GUILD_SIGNED_ON");
  });

  test("signed_off formats text and JSON", () => {
    const events = new RingBuffer<EventEntry>(10);
    const log = { append: jest.fn(async () => {}) } as unknown as SessionLog;
    onGuildEvent({ type: "signed_off", name: "Varian" }, events, log);
    const d = events.drain();
    expect(d[0]!.text).toBe("[guild] Varian has gone offline");
    expect(JSON.parse(d[0]!.json).type).toBe("GUILD_SIGNED_OFF");
  });

  test("command_result formats error text and JSON", () => {
    const events = new RingBuffer<EventEntry>(10);
    const log = { append: jest.fn(async () => {}) } as unknown as SessionLog;
    onGuildEvent(
      { type: "command_result", command: 1, name: "Thrall", result: 0x03 },
      events,
      log,
    );
    const d = events.drain();
    expect(d[0]!.text).toBe("[guild] Thrall is already in a guild");
    const json = JSON.parse(d[0]!.json);
    expect(json.type).toBe("GUILD_COMMAND_RESULT");
    expect(json.command).toBe(1);
    expect(json.name).toBe("Thrall");
    expect(json.result).toBe(0x03);
  });

  test("guild_invite formats text and JSON", () => {
    const events = new RingBuffer<EventEntry>(10);
    const log = { append: jest.fn(async () => {}) } as unknown as SessionLog;
    onGuildEvent(
      { type: "guild_invite", inviter: "Thrall", guildName: "Horde Heroes" },
      events,
      log,
    );
    const d = events.drain();
    expect(d[0]!.text).toBe(
      "[guild] Thrall has invited you to join Horde Heroes. Use /gaccept or /gdecline",
    );
    const json = JSON.parse(d[0]!.json);
    expect(json.type).toBe("GUILD_INVITE_RECEIVED");
    expect(json.inviter).toBe("Thrall");
    expect(json.guildName).toBe("Horde Heroes");
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

  test("onIgnoreEvent wiring pushes to ring buffer", async () => {
    startTestServer();
    handle.triggerIgnoreEvent({
      type: "ignore-added",
      entry: { guid: 1n, name: "Spammer" },
    });
    const lines = await sendToSocket("READ", sockPath);
    expect(lines[0]).toContain("Spammer");
    expect(lines[0]).toContain("added to ignore list");
  });

  test("IGNORED round-trip returns empty list", async () => {
    startTestServer();
    const lines = await sendToSocket("IGNORED", sockPath);
    expect(lines).toEqual(["[ignore] Ignore list is empty"]);
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

  test("onGuildEvent wiring pushes to ring buffer", async () => {
    startTestServer();
    handle.triggerGuildEvent({
      type: "guild-roster",
      roster: {
        guildName: "Horde Elite",
        motd: "Welcome!",
        guildInfo: "",
        rankNames: ["GM"],
        members: [
          {
            guid: 1n,
            name: "Thrall",
            rankIndex: 0,
            level: 80,
            playerClass: 7,
            gender: 0,
            area: 10,
            status: 1,
            timeOffline: 0,
            publicNote: "",
            officerNote: "",
          },
        ],
      },
    });
    const lines = await sendToSocket("READ", sockPath);
    expect(lines[0]).toContain("Roster updated");
  });

  test("GUILD_ROSTER round-trip with data", async () => {
    startTestServer();
    const roster = {
      guildName: "Horde Elite",
      motd: "Welcome!",
      guildInfo: "",
      rankNames: ["GM"],
      members: [
        {
          guid: 1n,
          name: "Thrall",
          rankIndex: 0,
          level: 80,
          playerClass: 7,
          gender: 0,
          area: 10,
          status: 1,
          timeOffline: 0,
          publicNote: "",
          officerNote: "",
        },
      ],
    };
    (handle.requestGuildRoster as ReturnType<typeof jest.fn>).mockResolvedValue(
      roster,
    );
    const lines = await sendToSocket("GUILD_ROSTER", sockPath);
    expect(lines[0]).toContain("Horde Elite");
    expect(lines.join("\n")).toContain("Thrall");
  });

  test("dispatch error returns ERR internal", async () => {
    startTestServer();
    (handle.who as ReturnType<typeof jest.fn>).mockRejectedValue(
      new Error("db fail"),
    );
    const lines = await sendToSocket("WHO", sockPath);
    expect(lines).toEqual(["ERR internal"]);
  });

  test("onDuelEvent wiring pushes to ring buffer", async () => {
    startTestServer();
    handle.triggerDuelEvent({
      type: "duel_requested",
      challenger: "Arthas",
    });
    const lines = await sendToSocket("READ", sockPath);
    expect(lines).toEqual(["[duel] Arthas challenges you to a duel"]);
  });
});

describe("onDuelEvent", () => {
  test("duel_requested formats with challenger name", () => {
    const events = new RingBuffer<EventEntry>(10);
    const log = {
      append: jest.fn(() => Promise.resolve()),
    } as unknown as SessionLog;
    onDuelEvent({ type: "duel_requested", challenger: "Arthas" }, events, log);
    const entries = events.drain();
    expect(entries).toHaveLength(1);
    expect(entries[0]!.text).toBe("[duel] Arthas challenges you to a duel");
    expect(JSON.parse(entries[0]!.json)).toEqual({
      type: "DUEL_REQUESTED",
      challenger: "Arthas",
    });
  });

  test("duel_countdown formats with seconds", () => {
    const events = new RingBuffer<EventEntry>(10);
    const log = {
      append: jest.fn(() => Promise.resolve()),
    } as unknown as SessionLog;
    onDuelEvent({ type: "duel_countdown", timeMs: 3000 }, events, log);
    const entries = events.drain();
    expect(entries[0]!.text).toBe("[duel] Duel starting in 3 seconds");
  });

  test("duel_winner won formats correctly", () => {
    const events = new RingBuffer<EventEntry>(10);
    const log = {
      append: jest.fn(() => Promise.resolve()),
    } as unknown as SessionLog;
    onDuelEvent(
      {
        type: "duel_winner",
        reason: "won",
        winner: "Thrall",
        loser: "Garrosh",
      },
      events,
      log,
    );
    const entries = events.drain();
    expect(entries[0]!.text).toBe(
      "[duel] Thrall has defeated Garrosh in a duel",
    );
  });

  test("duel_winner fled formats correctly", () => {
    const events = new RingBuffer<EventEntry>(10);
    const log = {
      append: jest.fn(() => Promise.resolve()),
    } as unknown as SessionLog;
    onDuelEvent(
      {
        type: "duel_winner",
        reason: "fled",
        winner: "Thrall",
        loser: "Garrosh",
      },
      events,
      log,
    );
    const entries = events.drain();
    expect(entries[0]!.text).toBe(
      "[duel] Garrosh has fled from Thrall in a duel",
    );
  });

  test("duel_out_of_bounds formats warning", () => {
    const events = new RingBuffer<EventEntry>(10);
    const log = {
      append: jest.fn(() => Promise.resolve()),
    } as unknown as SessionLog;
    onDuelEvent({ type: "duel_out_of_bounds" }, events, log);
    const entries = events.drain();
    expect(entries[0]!.text).toBe(
      "[duel] Out of bounds \u2014 return to the duel area",
    );
  });

  test("duel_in_bounds formats notice", () => {
    const events = new RingBuffer<EventEntry>(10);
    const log = {
      append: jest.fn(() => Promise.resolve()),
    } as unknown as SessionLog;
    onDuelEvent({ type: "duel_in_bounds" }, events, log);
    const entries = events.drain();
    expect(entries[0]!.text).toBe("[duel] Back in bounds");
  });

  test("duel_complete completed=true is silent text", () => {
    const events = new RingBuffer<EventEntry>(10);
    const log = {
      append: jest.fn(() => Promise.resolve()),
    } as unknown as SessionLog;
    onDuelEvent({ type: "duel_complete", completed: true }, events, log);
    const entries = events.drain();
    expect(entries[0]!.text).toBeUndefined();
    expect(JSON.parse(entries[0]!.json)).toEqual({
      type: "DUEL_COMPLETE",
      completed: true,
    });
  });

  test("duel_complete completed=false shows interrupted", () => {
    const events = new RingBuffer<EventEntry>(10);
    const log = {
      append: jest.fn(() => Promise.resolve()),
    } as unknown as SessionLog;
    onDuelEvent({ type: "duel_complete", completed: false }, events, log);
    const entries = events.drain();
    expect(entries[0]!.text).toBe("[duel] Duel interrupted");
  });

  test("swallows duel event log append errors", async () => {
    const events = new RingBuffer<EventEntry>(10);
    const append = jest.fn(() => Promise.reject(new Error("disk full")));
    const log = { append } as unknown as SessionLog;
    onDuelEvent({ type: "duel_in_bounds" }, events, log);
    await Promise.resolve();
    expect(append).toHaveBeenCalled();
  });

  test("duel JSON objects include all fields", () => {
    const events = new RingBuffer<EventEntry>(10);
    const log = {
      append: jest.fn(() => Promise.resolve()),
    } as unknown as SessionLog;
    onDuelEvent(
      {
        type: "duel_winner",
        reason: "won",
        winner: "A",
        loser: "B",
      },
      events,
      log,
    );
    const json = JSON.parse(events.drain()[0]!.json);
    expect(json).toEqual({
      type: "DUEL_WINNER",
      reason: "won",
      winner: "A",
      loser: "B",
    });
  });
});
