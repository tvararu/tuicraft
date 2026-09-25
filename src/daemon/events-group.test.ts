import { describe, expect, jest, test } from "bun:test";
import type { EventEntry } from "daemon/commands";
import { onGroupEvent } from "daemon/events";
import { RingBuffer } from "lib/ring-buffer";
import type { SessionLog } from "lib/session-log";
import { must } from "test/must";

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
    expect(must(drained[0]).text).toBeUndefined();
    expect(JSON.parse(must(drained[0]).json)).toMatchObject({
      type: "GROUP_LIST",
    });
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
    expect(must(drained[0]).text).toBe("[group] Bob invites you to a group");
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
    expect(JSON.parse(must(drained[0]).json)).toEqual({
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
