import { describe, expect, jest, test } from "bun:test";
import type { EventEntry } from "daemon/commands";
import { onFriendEvent, onIgnoreEvent } from "daemon/events";
import { RingBuffer } from "lib/ring-buffer";
import type { SessionLog } from "lib/session-log";
import { must } from "test/must";
import { FriendStatus } from "wow";

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
    expect(must(drained[0]).text).toContain("Arthas");
    expect(must(drained[0]).text).toContain("online");
    const json = JSON.parse(must(drained[0]).json);
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
    expect(must(drained[0]).text).toContain("Arthas");
    expect(must(drained[0]).text).toContain("offline");
    const json = JSON.parse(must(drained[0]).json);
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
    expect(must(drained[0]).text).toContain("player not found");
    const json = JSON.parse(must(drained[0]).json);
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
    expect(must(drained[0]).text).toContain("Spammer");
    expect(must(drained[0]).text).toContain("added to ignore list");
    const json = JSON.parse(must(drained[0]).json);
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
    expect(must(drained[0]).text).toContain("Spammer");
    expect(must(drained[0]).text).toContain("removed from ignore list");
    const json = JSON.parse(must(drained[0]).json);
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
    expect(must(drained[0]).text).toContain("player not found");
    const json = JSON.parse(must(drained[0]).json);
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
