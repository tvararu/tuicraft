import { describe, expect, jest, test } from "bun:test";
import type { EventEntry } from "daemon/commands";
import { onGuildEvent } from "daemon/events";
import { RingBuffer } from "lib/ring-buffer";
import type { SessionLog } from "lib/session-log";
import { must } from "test/must";

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
    expect(must(drained[0]).text).toContain("Roster updated");
    expect(must(drained[0]).text).toContain("1 members");
    const json = JSON.parse(must(drained[0]).json);
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
    expect(must(d[0]).text).toBe("[guild] Thrall promoted Garrosh to Officer");
    expect(JSON.parse(must(d[0]).json)).toEqual({
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
    expect(must(d[0]).text).toBe("[guild] Thrall demoted Garrosh to Member");
    expect(JSON.parse(must(d[0]).json).type).toBe("GUILD_DEMOTION");
  });

  test("motd formats text and JSON", () => {
    const events = new RingBuffer<EventEntry>(10);
    const log = { append: jest.fn(async () => {}) } as unknown as SessionLog;
    onGuildEvent({ text: "Raid tonight!", type: "motd" }, events, log);
    const d = events.drain();
    expect(must(d[0]).text).toBe("[guild] MOTD: Raid tonight!");
    expect(JSON.parse(must(d[0]).json).type).toBe("GUILD_MOTD");
  });

  test("joined formats text and JSON", () => {
    const events = new RingBuffer<EventEntry>(10);
    const log = { append: jest.fn(async () => {}) } as unknown as SessionLog;
    onGuildEvent({ name: "Arthas", type: "joined" }, events, log);
    const d = events.drain();
    expect(must(d[0]).text).toBe("[guild] Arthas has joined the guild");
    expect(JSON.parse(must(d[0]).json).type).toBe("GUILD_JOINED");
  });

  test("left formats text and JSON", () => {
    const events = new RingBuffer<EventEntry>(10);
    const log = { append: jest.fn(async () => {}) } as unknown as SessionLog;
    onGuildEvent({ name: "Sylvanas", type: "left" }, events, log);
    const d = events.drain();
    expect(must(d[0]).text).toBe("[guild] Sylvanas has left the guild");
    expect(JSON.parse(must(d[0]).json).type).toBe("GUILD_LEFT");
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
    expect(must(d[0]).text).toBe(
      "[guild] Thrall removed Garrosh from the guild",
    );
    expect(JSON.parse(must(d[0]).json).type).toBe("GUILD_REMOVED");
  });

  test("leader_is formats text and JSON", () => {
    const events = new RingBuffer<EventEntry>(10);
    const log = { append: jest.fn(async () => {}) } as unknown as SessionLog;
    onGuildEvent({ name: "Thrall", type: "leader_is" }, events, log);
    const d = events.drain();
    expect(must(d[0]).text).toBe("[guild] Thrall is the guild leader");
    expect(JSON.parse(must(d[0]).json).type).toBe("GUILD_LEADER_IS");
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
    expect(must(d[0]).text).toBe(
      "[guild] Thrall has made Garrosh the new guild leader",
    );
    expect(JSON.parse(must(d[0]).json).type).toBe("GUILD_LEADER_CHANGED");
  });

  test("disbanded formats text and JSON", () => {
    const events = new RingBuffer<EventEntry>(10);
    const log = { append: jest.fn(async () => {}) } as unknown as SessionLog;
    onGuildEvent({ type: "disbanded" }, events, log);
    const d = events.drain();
    expect(must(d[0]).text).toBe("[guild] Guild has been disbanded");
    expect(JSON.parse(must(d[0]).json).type).toBe("GUILD_DISBANDED");
  });

  test("signed_on formats text and JSON", () => {
    const events = new RingBuffer<EventEntry>(10);
    const log = { append: jest.fn(async () => {}) } as unknown as SessionLog;
    onGuildEvent({ name: "Jaina", type: "signed_on" }, events, log);
    const d = events.drain();
    expect(must(d[0]).text).toBe("[guild] Jaina has come online");
    expect(JSON.parse(must(d[0]).json).type).toBe("GUILD_SIGNED_ON");
  });

  test("signed_off formats text and JSON", () => {
    const events = new RingBuffer<EventEntry>(10);
    const log = { append: jest.fn(async () => {}) } as unknown as SessionLog;
    onGuildEvent({ name: "Varian", type: "signed_off" }, events, log);
    const d = events.drain();
    expect(must(d[0]).text).toBe("[guild] Varian has gone offline");
    expect(JSON.parse(must(d[0]).json).type).toBe("GUILD_SIGNED_OFF");
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
    expect(must(d[0]).text).toBe("[guild] Thrall is already in a guild");
    const json = JSON.parse(must(d[0]).json);
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
    expect(must(d[0]).text).toBe(
      "[guild] Thrall has invited you to join Horde Heroes. Use /gaccept or /gdecline",
    );
    const json = JSON.parse(must(d[0]).json);
    expect(json.type).toBe("GUILD_INVITE_RECEIVED");
    expect(json.inviter).toBe("Thrall");
    expect(json.guildName).toBe("Horde Heroes");
  });
});
