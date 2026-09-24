import { test, expect, describe, jest } from "bun:test";
import {
  onChatMessage,
  onGroupEvent,
  onEntityEvent,
  onFriendEvent,
  onIgnoreEvent,
  onGuildEvent,
  onDuelEvent,
  onControlEvent,
} from "daemon/events";
import type { EventEntry } from "daemon/commands";
import { ChatType } from "wow/protocol/opcodes";
import { FriendStatus } from "wow/protocol/social";
import { ObjectType } from "wow/protocol/entity-fields";
import type { UnitEntity } from "wow/entity-store";
import { SessionLog } from "lib/session-log";
import { RingBuffer } from "lib/ring-buffer";
import type { ControlState } from "wow/control";

function sampleState(overrides: Partial<ControlState> = {}): ControlState {
  return {
    selfGuid: 0xabcden,
    pose: {
      mapId: 530,
      x: 8709.46,
      y: -6671.76,
      z: 70.34,
      orientation: 1.5,
      source: "predicted",
      updatedAt: 1000,
    },
    serverPose: {
      mapId: 530,
      x: 8709.46,
      y: -6671.76,
      z: 70.34,
      orientation: 1.57,
      source: "server",
      updatedAt: 900,
    },
    target: 0xan,
    requestedTarget: 0xan,
    moving: true,
    direction: "forward",
    movementAllowed: true,
    blockedReason: undefined,
    speed: 7,
    owner: "manual",
    ...overrides,
  };
}

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

describe("onControlEvent", () => {
  test("pushes event to ring and session log with hex ids", () => {
    const events = new RingBuffer<EventEntry>(10);
    const append = jest.fn(() => Promise.resolve());
    const log = { append } as unknown as SessionLog;
    onControlEvent(
      { type: "target_requested", state: sampleState(), reason: "select" },
      events,
      log,
    );
    const drained = events.drain();
    expect(drained).toHaveLength(1);
    expect(drained[0]!.text).toContain("[control]");
    expect(drained[0]!.text).toContain("predicted");
    const json = JSON.parse(drained[0]!.json);
    expect(json.type).toBe("CONTROL");
    expect(json.event).toBe("target_requested");
    expect(json.selfGuid).toBe("0xabcde");
    expect(json.target).toBe("0xa");
    expect(json.pose.source).toBe("predicted");
    expect(json.serverPose.source).toBe("server");
    expect(append).toHaveBeenCalledTimes(1);
  });

  test("server correction keeps server pose labelled server", () => {
    const events = new RingBuffer<EventEntry>(10);
    const log = {
      append: jest.fn(() => Promise.resolve()),
    } as unknown as SessionLog;
    const state = sampleState({
      pose: {
        mapId: 530,
        x: 1,
        y: 2,
        z: 3,
        orientation: 0,
        source: "server",
        updatedAt: 5,
      },
    });
    onControlEvent({ type: "server_correction", state }, events, log);
    const entry = events.drain()[0]!;
    expect(JSON.parse(entry.json).pose.source).toBe("server");
    expect(entry.text).toContain("server");
  });
});
