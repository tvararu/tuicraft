import { describe, expect, jest, test } from "bun:test";
import { createMockHandle } from "@tuicraft/core/test-support/mock-handle";
import { dispatchCommand, type EventEntry } from "#daemon/commands";
import { parseIpcCommand } from "#daemon/parse";
import { RingBuffer } from "#lib/ring-buffer";
import {
  attachControl,
  createMockSocket,
} from "#test-support/commands-fixtures";

describe("quest IPC boundary", () => {
  test("JSON gossip code preserves omitted, null, empty and whitespace values", () => {
    expect(parseIpcCommand("SELECT_OPTION 0")).toEqual({
      code: undefined,
      optionId: 0,
      type: "select_option",
    });
    expect(parseIpcCommand("SELECT_OPTION 0 null")).toEqual({
      code: undefined,
      optionId: 0,
      type: "select_option",
    });
    expect(parseIpcCommand('SELECT_OPTION 0 ""')).toEqual({
      code: "",
      optionId: 0,
      type: "select_option",
    });
    const code = '  hello "friend"\nHALT  ';
    expect(parseIpcCommand(`SELECT_OPTION 0 ${JSON.stringify(code)}`)).toEqual({
      code,
      optionId: 0,
      type: "select_option",
    });
  });

  test("rejects malformed gossip JSON, nonstrings, NUL and trailing tokens", () => {
    for (const code of [
      "raw text",
      "true",
      "3",
      "{}",
      "[]",
      '"ok" "extra"',
      '"unterminated',
      JSON.stringify("bad\0code"),
    ])
      expect(parseIpcCommand(`SELECT_OPTION 0 ${code}`)?.type).toBe("invalid");
    for (const line of [
      "TALK 0",
      "QUERY_QUEST 0",
      "SELECT_QUEST 4294967296",
      "COMPLETE_QUEST 1.5",
      "CHOOSE_REWARD 6",
      "ABANDON_QUEST 25",
      "ACCEPT_QUEST extra",
      "REQUEST_REWARD 0",
      "CANCEL_INTERACTION extra",
    ])
      expect(parseIpcCommand(line)?.type).toBe("invalid");
  });

  test("an unanswered interaction error cannot produce a success acknowledgement", async () => {
    const handle = Object.assign(attachControl(createMockHandle()), {
      acceptQuest: () => {
        throw new Error("quest_reply_unanswered");
      },
    });
    const socket = createMockSocket();
    await dispatchCommand(
      { type: "accept_quest" },
      {
        cleanup: jest.fn(),
        events: new RingBuffer<EventEntry>(10),
        handle,
        socket,
      },
    );
    expect(socket.written()).toBe("ERR quest_reply_unanswered\n\n");
  });

  test("quest JSON keeps unanswered metadata separate from accepted state", async () => {
    const handle = Object.assign(attachControl(createMockHandle()), {
      getQuestState: () => ({
        giver: 0xffff_ffff_ffff_ffffn,
        log: {
          complete: false,
          slots: [
            { counters: [undefined, 1, 0, 0], questId: undefined, slot: 0 },
          ],
        },
        pending: { action: "accept", questId: 42 },
        queries: [{ questId: 42, sentAt: 1000, status: "unanswered" }],
      }),
    });
    const socket = createMockSocket();
    await dispatchCommand(
      { type: "quests_json" },
      {
        cleanup: jest.fn(),
        events: new RingBuffer<EventEntry>(10),
        handle,
        socket,
      },
    );
    const state = JSON.parse(socket.written());
    expect(state.giver).toBe("0xffffffffffffffff");
    expect(state.queries[0].status).toBe("unanswered");
    expect(state.log.slots[0]).not.toHaveProperty("questId");
    expect(state.log.slots[0].counters).toEqual([null, 1, 0, 0]);
    expect(state.pending.action).toBe("accept");
  });
});

describe("loot IPC boundary", () => {
  test("uses nonzero uint64 targets and actual uint8 slot range", () => {
    expect(parseIpcCommand("OPEN_LOOT 18446744073709551615")).toEqual({
      guid: 0xffff_ffff_ffff_ffffn,
      type: "open_loot",
    });
    expect(parseIpcCommand("LOOT_ROLL 0xa 3 pass")).toEqual({
      guid: 10n,
      slot: 3,
      type: "loot_roll",
      vote: "pass",
    });
    expect(parseIpcCommand("TAKE_LOOT 255")).toEqual({
      slot: 255,
      type: "take_loot",
    });
    expect(parseIpcCommand("DESTROY 255 30 2")).toEqual({
      bag: 255,
      count: 2,
      slot: 30,
      type: "destroy",
    });
    for (const line of [
      "OPEN_LOOT 0",
      "OPEN_LOOT 18446744073709551616",
      "TAKE_LOOT -1",
      "TAKE_LOOT 256",
      "TAKE_LOOT 0 extra",
      "TAKE_MONEY extra",
      "RELEASE_LOOT 1",
      "LOOT_ROLL 0xa 0",
      "LOOT_ROLL 0 0 need",
      "LOOT_ROLL 0xa 0 greedy",
      "DESTROY 255",
      "DESTROY 255 -1",
      "DESTROY 255 1 0",
    ])
      expect(parseIpcCommand(line)?.type).toBe("invalid");
  });

  test("USE carries a uint8 bag and slot to the handle", async () => {
    expect(parseIpcCommand("USE 255 29")).toEqual({
      bag: 255,
      slot: 29,
      type: "use",
    });
    for (const line of ["USE", "USE 255", "USE 256 1", "USE 1 2 3"])
      expect(parseIpcCommand(line)).toEqual({
        reason: "invalid item slot",
        type: "invalid",
      });
    const handle = Object.assign(attachControl(createMockHandle()), {
      useItem: async () => {
        throw new Error("no_use_spell");
      },
    });
    const socket = createMockSocket();
    await dispatchCommand(
      { bag: 255, slot: 26, type: "use" },
      {
        cleanup: jest.fn(),
        events: new RingBuffer<EventEntry>(10),
        handle,
        socket,
      },
    );
    expect(socket.written()).toBe("ERR no_use_spell\n\n");
  });

  test("unoffered loot is an error, not a success or chat action", async () => {
    const handle = Object.assign(attachControl(createMockHandle()), {
      takeLoot: () => {
        throw new Error("Loot slot was not offered");
      },
    });
    const socket = createMockSocket();
    await dispatchCommand(
      { slot: 0, type: "take_loot" },
      {
        cleanup: jest.fn(),
        events: new RingBuffer<EventEntry>(10),
        handle,
        socket,
      },
    );
    expect(socket.written()).toBe("ERR Loot slot was not offered\n\n");
    expect(handle.sendInCurrentMode).not.toHaveBeenCalled();
  });

  test("a refused loot roll is an error", async () => {
    const handle = Object.assign(attachControl(createMockHandle()), {
      rollLoot: () => {
        throw new Error("No pending loot roll for that GUID and slot");
      },
    });
    const socket = createMockSocket();
    await dispatchCommand(
      { guid: 10n, slot: 0, type: "loot_roll", vote: "need" },
      {
        cleanup: jest.fn(),
        events: new RingBuffer<EventEntry>(10),
        handle,
        socket,
      },
    );
    expect(socket.written()).toBe(
      "ERR No pending loot roll for that GUID and slot\n\n",
    );
  });

  test("release-only opening remains unanswered in serialized loot inspection", async () => {
    const guid = 0xffff_ffff_ffff_ffffn;
    const handle = Object.assign(attachControl(createMockHandle()), {
      getRewardsState: () => ({
        lastRelease: { guid, observedAt: 1100, status: 1 },
        loot: { guid, phase: "opening", requestedAt: 1000 },
        pending: {
          action: "open",
          guid,
          requestedAt: 1000,
          status: "unanswered",
        },
      }),
    });
    const socket = createMockSocket();
    await dispatchCommand(
      { type: "loot_json" },
      {
        cleanup: jest.fn(),
        events: new RingBuffer<EventEntry>(10),
        handle,
        socket,
      },
    );
    const state = JSON.parse(socket.written());
    expect(state.loot.phase).toBe("opening");
    expect(state.pending.status).toBe("unanswered");
    expect(state.lastRelease.guid).toBe("0xffffffffffffffff");
    expect(state.lastRelease.status).toBe(1);
  });

  test("inventory serialization does not turn unknown counts or capacity into defaults", async () => {
    const guid = 0xffff_ffff_ffff_ffffn;
    const handle = Object.assign(attachControl(createMockHandle()), {
      getInventoryState: () => ({
        bags: [],
        coinage: undefined,
        freeSlots: undefined,
        issues: [],
        scope: "carried",
        selfGuid: 1n,
        slots: [
          {
            bag: 255,
            guid,
            item: { count: undefined, guid },
            region: "backpack",
            slot: 23,
            status: "occupied",
          },
        ],
        status: "partial",
      }),
    });
    const socket = createMockSocket();
    await dispatchCommand(
      { type: "inventory_json" },
      {
        cleanup: jest.fn(),
        events: new RingBuffer<EventEntry>(10),
        handle,
        socket,
      },
    );
    const state = JSON.parse(socket.written());
    expect(state.slots[0].guid).toBe("0xffffffffffffffff");
    expect(state.slots[0].item).not.toHaveProperty("count");
    expect(state).not.toHaveProperty("coinage");
    expect(state).not.toHaveProperty("freeSlots");
  });

  test("loot inspection errors retain ERR semantics", async () => {
    const handle = Object.assign(attachControl(createMockHandle()), {
      getRewardsState: () => {
        throw new Error("session_closed");
      },
    });
    const socket = createMockSocket();
    await dispatchCommand(
      { type: "loot" },
      {
        cleanup: jest.fn(),
        events: new RingBuffer<EventEntry>(10),
        handle,
        socket,
      },
    );
    expect(socket.written()).toBe("ERR session_closed\n\n");
  });
});
