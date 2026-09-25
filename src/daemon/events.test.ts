import { describe, expect, jest, test } from "bun:test";
import type { EventEntry } from "daemon/commands";
import {
  onChatMessage,
  onControlEvent,
  onDuelEvent,
  onEntityEvent,
  onFriendEvent,
  onGroupEvent,
  onGuildEvent,
  onIgnoreEvent,
} from "daemon/events";
import { RingBuffer } from "lib/ring-buffer";
import type { SessionLog } from "lib/session-log";
import type { ControlState } from "wow/control";
import type { UnitEntity } from "wow/entity-store";
import { ObjectType } from "wow/protocol/entity-fields";
import { ChatType } from "wow/protocol/opcodes";
import { FriendStatus } from "wow/protocol/social";

function sampleState(overrides: Partial<ControlState> = {}): ControlState {
  return {
    blockedReason: undefined,
    direction: "forward",
    movementAllowed: true,
    moving: true,
    owner: "manual",
    pose: {
      mapId: 530,
      orientation: 1.5,
      source: "predicted",
      updatedAt: 1000,
      x: 8709.46,
      y: -6671.76,
      z: 70.34,
    },
    requestedTarget: 0xan,
    selfGuid: 0xabcden,
    serverPose: {
      mapId: 530,
      orientation: 1.57,
      source: "server",
      updatedAt: 900,
      x: 8709.46,
      y: -6671.76,
      z: 70.34,
    },
    speed: 7,
    target: 0xan,
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
      { message: "hi", sender: "Alice", type: ChatType.SAY },
      events,
      log,
    );

    const drained = events.drain();
    expect(drained[0]!.text).toBe("[say] Alice: hi");
    expect(JSON.parse(drained[0]!.json)).toEqual({
      message: "hi",
      sender: "Alice",
      type: "SAY",
    });
  });

  test("appends JSON to session log", () => {
    const events = new RingBuffer<EventEntry>(10);
    const append = jest.fn(() => Promise.resolve());
    const log: SessionLog = { append } as unknown as SessionLog;

    onChatMessage(
      { message: "psst", sender: "Eve", type: ChatType.WHISPER },
      events,
      log,
    );

    expect(append).toHaveBeenCalledWith({
      message: "psst",
      sender: "Eve",
      type: "WHISPER_FROM",
    });
  });

  test("swallows session log append errors", async () => {
    const events = new RingBuffer<EventEntry>(10);
    const append = jest.fn(() => Promise.reject(new Error("disk full")));
    const log: SessionLog = { append } as unknown as SessionLog;

    onChatMessage(
      { message: "psst", sender: "Eve", type: ChatType.WHISPER },
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
        leader: "Alice",
        members: [{ guidHigh: 0, guidLow: 1, name: "Alice", online: true }],
        type: "group_list",
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
      { guidLow: 42, hp: 100, maxHp: 200, type: "member_stats" },
      events,
      log,
    );

    expect(append).toHaveBeenCalledWith(
      expect.objectContaining({ guidLow: 42, type: "PARTY_MEMBER_STATS" }),
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

    onGroupEvent({ from: "Bob", type: "invite_received" }, events, log);

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
        operation: 1,
        result: 0,
        target: "Voidtrix",
        type: "command_result",
      },
      events,
      log,
    );

    const drained = events.drain();
    expect(JSON.parse(drained[0]!.json)).toEqual({
      operation: 1,
      result: 0,
      target: "Voidtrix",
      type: "GROUP_COMMAND_RESULT",
    });
  });

  test("serializes leader/group lifecycle events", () => {
    const events = new RingBuffer<EventEntry>(10);
    const log: SessionLog = {
      append: jest.fn(() => Promise.resolve()),
    } as unknown as SessionLog;

    onGroupEvent({ name: "Alice", type: "leader_changed" }, events, log);
    onGroupEvent({ type: "group_destroyed" }, events, log);
    onGroupEvent({ type: "kicked" }, events, log);
    onGroupEvent({ name: "Bob", type: "invite_declined" }, events, log);

    const drained = events.drain().map((entry) => JSON.parse(entry.json));
    expect(drained).toEqual([
      { name: "Alice", type: "GROUP_LEADER_CHANGED" },
      { type: "GROUP_DESTROYED" },
      { type: "GROUP_KICKED" },
      { name: "Bob", type: "GROUP_INVITE_DECLINED" },
    ]);
  });
});

describe("onEntityEvent", () => {
  test("pushes appear event to ring buffer with text and json", () => {
    const events = new RingBuffer<EventEntry>(10);
    const entity: UnitEntity = {
      class_: 0,
      displayId: 0,
      entry: 0,
      factionTemplate: 0,
      gender: 0,
      guid: 1n,
      health: 100,
      level: 10,
      maxHealth: 100,
      maxPower: [0, 0, 0, 0, 0, 0, 0],
      name: "Test NPC",
      npcFlags: 0,
      objectType: ObjectType.UNIT,
      position: undefined,
      power: [0, 0, 0, 0, 0, 0, 0],
      race: 0,
      rawFields: new Map(),
      scale: 1,
      target: 0n,
      unitFlags: 0,
    };

    const append = jest.fn(async () => {});
    const log = { append } as unknown as SessionLog;
    onEntityEvent({ entity, type: "appear" }, events, log);

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
      { guid: 1n, name: "Gone NPC", type: "disappear" },
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
      class_: 0,
      displayId: 0,
      entry: 0,
      factionTemplate: 0,
      gender: 0,
      guid: 1n,
      health: 100,
      level: 10,
      maxHealth: 100,
      maxPower: [0, 0, 0, 0, 0, 0, 0],
      name: "Test NPC",
      npcFlags: 0,
      objectType: ObjectType.UNIT,
      position: undefined,
      power: [0, 0, 0, 0, 0, 0, 0],
      race: 0,
      rawFields: new Map(),
      scale: 1,
      target: 0n,
      unitFlags: 0,
    };

    const append = jest.fn(async () => {});
    const log = { append } as unknown as SessionLog;
    onEntityEvent({ changed: ["health"], entity, type: "update" }, events, log);

    expect(events.drain()).toHaveLength(0);
    expect(append).not.toHaveBeenCalled();
  });

  test("swallows entity event log append errors", async () => {
    const events = new RingBuffer<EventEntry>(10);
    const append = jest.fn(() => Promise.reject(new Error("disk full")));
    const log: SessionLog = { append } as unknown as SessionLog;

    onEntityEvent(
      { guid: 1n, name: "Gone NPC", type: "disappear" },
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
        friend: {
          area: 0,
          guid: 1n,
          level: 80,
          name: "Arthas",
          note: "",
          playerClass: 6,
          status: FriendStatus.ONLINE,
        },
        type: "friend-online",
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
      { guid: 1n, name: "Arthas", type: "friend-offline" },
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

    onFriendEvent({ friends: [], type: "friend-list" }, events, log);

    expect(events.drain()).toHaveLength(0);
    expect(append).not.toHaveBeenCalled();
  });

  test("pushes friend-error event to ring buffer", () => {
    const events = new RingBuffer<EventEntry>(10);
    const append = jest.fn(async () => {});
    const log = { append } as unknown as SessionLog;

    onFriendEvent(
      { name: "Nobody", result: 0x04, type: "friend-error" },
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
      { guid: 1n, name: "Gone", type: "friend-offline" },
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
      { entry: { guid: 1n, name: "Spammer" }, type: "ignore-added" },
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
      { guid: 1n, name: "Spammer", type: "ignore-removed" },
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

    onIgnoreEvent({ entries: [], type: "ignore-list" }, events, log);

    expect(events.drain()).toHaveLength(0);
    expect(append).not.toHaveBeenCalled();
  });

  test("pushes ignore-error event to ring buffer", () => {
    const events = new RingBuffer<EventEntry>(10);
    const append = jest.fn(async () => {});
    const log = { append } as unknown as SessionLog;

    onIgnoreEvent(
      { name: "Nobody", result: 0x0d, type: "ignore-error" },
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
      { guid: 1n, name: "Gone", type: "ignore-removed" },
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
        roster: {
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
        },
        type: "guild-roster",
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
        roster: {
          guildInfo: "",
          guildName: "",
          members: [],
          motd: "",
          rankNames: [],
        },
        type: "guild-roster",
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
        member: "Garrosh",
        officer: "Thrall",
        rank: "Officer",
        type: "promotion",
      },
      events,
      log,
    );
    const d = events.drain();
    expect(d[0]!.text).toBe("[guild] Thrall promoted Garrosh to Officer");
    expect(JSON.parse(d[0]!.json)).toEqual({
      member: "Garrosh",
      officer: "Thrall",
      rank: "Officer",
      type: "GUILD_PROMOTION",
    });
  });

  test("demotion formats text and JSON", () => {
    const events = new RingBuffer<EventEntry>(10);
    const log = { append: jest.fn(async () => {}) } as unknown as SessionLog;
    onGuildEvent(
      {
        member: "Garrosh",
        officer: "Thrall",
        rank: "Member",
        type: "demotion",
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
    onGuildEvent({ text: "Raid tonight!", type: "motd" }, events, log);
    const d = events.drain();
    expect(d[0]!.text).toBe("[guild] MOTD: Raid tonight!");
    expect(JSON.parse(d[0]!.json).type).toBe("GUILD_MOTD");
  });

  test("joined formats text and JSON", () => {
    const events = new RingBuffer<EventEntry>(10);
    const log = { append: jest.fn(async () => {}) } as unknown as SessionLog;
    onGuildEvent({ name: "Arthas", type: "joined" }, events, log);
    const d = events.drain();
    expect(d[0]!.text).toBe("[guild] Arthas has joined the guild");
    expect(JSON.parse(d[0]!.json).type).toBe("GUILD_JOINED");
  });

  test("left formats text and JSON", () => {
    const events = new RingBuffer<EventEntry>(10);
    const log = { append: jest.fn(async () => {}) } as unknown as SessionLog;
    onGuildEvent({ name: "Sylvanas", type: "left" }, events, log);
    const d = events.drain();
    expect(d[0]!.text).toBe("[guild] Sylvanas has left the guild");
    expect(JSON.parse(d[0]!.json).type).toBe("GUILD_LEFT");
  });

  test("removed formats text and JSON", () => {
    const events = new RingBuffer<EventEntry>(10);
    const log = { append: jest.fn(async () => {}) } as unknown as SessionLog;
    onGuildEvent(
      { member: "Garrosh", officer: "Thrall", type: "removed" },
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
    onGuildEvent({ name: "Thrall", type: "leader_is" }, events, log);
    const d = events.drain();
    expect(d[0]!.text).toBe("[guild] Thrall is the guild leader");
    expect(JSON.parse(d[0]!.json).type).toBe("GUILD_LEADER_IS");
  });

  test("leader_changed formats text and JSON", () => {
    const events = new RingBuffer<EventEntry>(10);
    const log = { append: jest.fn(async () => {}) } as unknown as SessionLog;
    onGuildEvent(
      { newLeader: "Garrosh", oldLeader: "Thrall", type: "leader_changed" },
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
    onGuildEvent({ name: "Jaina", type: "signed_on" }, events, log);
    const d = events.drain();
    expect(d[0]!.text).toBe("[guild] Jaina has come online");
    expect(JSON.parse(d[0]!.json).type).toBe("GUILD_SIGNED_ON");
  });

  test("signed_off formats text and JSON", () => {
    const events = new RingBuffer<EventEntry>(10);
    const log = { append: jest.fn(async () => {}) } as unknown as SessionLog;
    onGuildEvent({ name: "Varian", type: "signed_off" }, events, log);
    const d = events.drain();
    expect(d[0]!.text).toBe("[guild] Varian has gone offline");
    expect(JSON.parse(d[0]!.json).type).toBe("GUILD_SIGNED_OFF");
  });

  test("command_result formats error text and JSON", () => {
    const events = new RingBuffer<EventEntry>(10);
    const log = { append: jest.fn(async () => {}) } as unknown as SessionLog;
    onGuildEvent(
      { command: 1, name: "Thrall", result: 0x03, type: "command_result" },
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
      { guildName: "Horde Heroes", inviter: "Thrall", type: "guild_invite" },
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
    onDuelEvent({ challenger: "Arthas", type: "duel_requested" }, events, log);
    const entries = events.drain();
    expect(entries).toHaveLength(1);
    expect(entries[0]!.text).toBe("[duel] Arthas challenges you to a duel");
    expect(JSON.parse(entries[0]!.json)).toEqual({
      challenger: "Arthas",
      type: "DUEL_REQUESTED",
    });
  });

  test("duel_countdown formats with seconds", () => {
    const events = new RingBuffer<EventEntry>(10);
    const log = {
      append: jest.fn(() => Promise.resolve()),
    } as unknown as SessionLog;
    onDuelEvent({ timeMs: 3000, type: "duel_countdown" }, events, log);
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
        loser: "Garrosh",
        reason: "won",
        type: "duel_winner",
        winner: "Thrall",
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
        loser: "Garrosh",
        reason: "fled",
        type: "duel_winner",
        winner: "Thrall",
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
    onDuelEvent({ completed: true, type: "duel_complete" }, events, log);
    const entries = events.drain();
    expect(entries[0]!.text).toBeUndefined();
    expect(JSON.parse(entries[0]!.json)).toEqual({
      completed: true,
      type: "DUEL_COMPLETE",
    });
  });

  test("duel_complete completed=false shows interrupted", () => {
    const events = new RingBuffer<EventEntry>(10);
    const log = {
      append: jest.fn(() => Promise.resolve()),
    } as unknown as SessionLog;
    onDuelEvent({ completed: false, type: "duel_complete" }, events, log);
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
        loser: "B",
        reason: "won",
        type: "duel_winner",
        winner: "A",
      },
      events,
      log,
    );
    const json = JSON.parse(events.drain()[0]!.json);
    expect(json).toEqual({
      loser: "B",
      reason: "won",
      type: "DUEL_WINNER",
      winner: "A",
    });
  });
});

describe("onControlEvent", () => {
  test("pushes event to ring and session log with hex ids", () => {
    const events = new RingBuffer<EventEntry>(10);
    const append = jest.fn(() => Promise.resolve());
    const log = { append } as unknown as SessionLog;
    onControlEvent(
      { reason: "select", state: sampleState(), type: "target_requested" },
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
        orientation: 0,
        source: "server",
        updatedAt: 5,
        x: 1,
        y: 2,
        z: 3,
      },
    });
    onControlEvent({ state, type: "server_correction" }, events, log);
    const entry = events.drain()[0]!;
    expect(JSON.parse(entry.json).pose.source).toBe("server");
    expect(entry.text).toContain("server");
  });
});
