import { describe, expect, jest, test } from "bun:test";
import { dispatchCommand, type EventEntry } from "daemon/commands";
import { RingBuffer } from "lib/ring-buffer";
import { createMockSocket } from "test/commands-fixtures";
import { createMockHandle } from "test/mock-handle";

describe("dispatchCommand", () => {
  test("guild_roster calls requestGuildRoster and writes roster", async () => {
    const handle = createMockHandle();
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand(
      { type: "guild_roster" },
      { cleanup, events, handle, socket },
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
      { cleanup, events, handle, socket },
    );

    expect(handle.requestGuildRoster).toHaveBeenCalled();
    const parsed = JSON.parse(socket.written().replace(/\n+$/, ""));
    expect(parsed.type).toBe("GUILD_ROSTER");
    expect(parsed.members).toEqual([]);
  });

  test("guild_roster with data writes formatted roster", async () => {
    const handle = createMockHandle();
    const roster = {
      guildInfo: "",
      guildName: "Horde Elite",
      members: [
        {
          area: 10,
          gender: 0,
          guid: 1n,
          level: 80,
          name: "Thrall",
          officerNote: "",
          playerClass: 7,
          publicNote: "",
          rankIndex: 0,
          status: 1,
          timeOffline: 0,
        },
      ],
      motd: "Welcome!",
      rankNames: ["GM"],
    };
    (handle.requestGuildRoster as ReturnType<typeof jest.fn>).mockResolvedValue(
      roster,
    );
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand(
      { type: "guild_roster" },
      { cleanup, events, handle, socket },
    );

    expect(socket.written()).toContain("Horde Elite");
    expect(socket.written()).toContain("Thrall");
  });

  test("guild_roster_json with data writes JSON roster", async () => {
    const handle = createMockHandle();
    const roster = {
      guildInfo: "",
      guildName: "Horde Elite",
      members: [
        {
          area: 10,
          gender: 0,
          guid: 1n,
          level: 80,
          name: "Thrall",
          officerNote: "",
          playerClass: 7,
          publicNote: "",
          rankIndex: 0,
          status: 1,
          timeOffline: 0,
        },
      ],
      motd: "Welcome!",
      rankNames: ["GM"],
    };
    (handle.requestGuildRoster as ReturnType<typeof jest.fn>).mockResolvedValue(
      roster,
    );
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand(
      { type: "guild_roster_json" },
      { cleanup, events, handle, socket },
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
      { target: "Thrall", type: "guild_invite" },
      { cleanup, events, handle, socket },
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
      { target: "Garrosh", type: "guild_kick" },
      { cleanup, events, handle, socket },
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
      { cleanup, events, handle, socket },
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
      { target: "Jaina", type: "guild_promote" },
      { cleanup, events, handle, socket },
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
      { target: "Arthas", type: "guild_demote" },
      { cleanup, events, handle, socket },
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
      { target: "Sylvanas", type: "guild_leader" },
      { cleanup, events, handle, socket },
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
      { message: "Raid tonight", type: "guild_motd" },
      { cleanup, events, handle, socket },
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
      { cleanup, events, handle, socket },
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
      { cleanup, events, handle, socket },
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
      { feature: "Friends list", type: "unimplemented" },
      { cleanup, events, handle, socket },
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
      { message: "hello", type: "chat" },
      { cleanup, events, handle, socket },
    );

    expect(result).toBe(false);
    expect(handle.sendInCurrentMode).toHaveBeenCalledWith("hello");
    expect(socket.written()).toBe("OK SAY\n\n");
  });

  test("chat mode label includes whisper target", async () => {
    const handle = createMockHandle();
    (handle.getLastChatMode as ReturnType<typeof jest.fn>).mockReturnValue({
      target: "Xiara",
      type: "whisper",
    });
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand(
      { message: "follow me", type: "chat" },
      { cleanup, events, handle, socket },
    );

    expect(socket.written()).toBe("OK WHISPER Xiara\n\n");
  });

  test("chat mode label includes channel name", async () => {
    const handle = createMockHandle();
    (handle.getLastChatMode as ReturnType<typeof jest.fn>).mockReturnValue({
      channel: "General",
      type: "channel",
    });
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand(
      { message: "hello general", type: "chat" },
      { cleanup, events, handle, socket },
    );

    expect(socket.written()).toBe("OK CHANNEL General\n\n");
  });
});
