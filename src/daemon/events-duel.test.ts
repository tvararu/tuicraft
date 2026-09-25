import { describe, expect, jest, test } from "bun:test";
import type { EventEntry } from "daemon/commands";
import { onDuelEvent } from "daemon/events";
import { RingBuffer } from "lib/ring-buffer";
import type { SessionLog } from "lib/session-log";
import { must } from "test/must";

describe("onDuelEvent", () => {
  test("duel_requested formats with challenger name", () => {
    const events = new RingBuffer<EventEntry>(10);
    const log = {
      append: jest.fn(() => Promise.resolve()),
    } as unknown as SessionLog;
    onDuelEvent({ challenger: "Arthas", type: "duel_requested" }, events, log);
    const entries = events.drain();
    expect(entries).toHaveLength(1);
    expect(must(entries[0]).text).toBe(
      "[duel] Arthas challenges you to a duel",
    );
    expect(JSON.parse(must(entries[0]).json)).toEqual({
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
    expect(must(entries[0]).text).toBe("[duel] Duel starting in 3 seconds");
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
    expect(must(entries[0]).text).toBe(
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
    expect(must(entries[0]).text).toBe(
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
    expect(must(entries[0]).text).toBe(
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
    expect(must(entries[0]).text).toBe("[duel] Back in bounds");
  });

  test("duel_complete completed=true is silent text", () => {
    const events = new RingBuffer<EventEntry>(10);
    const log = {
      append: jest.fn(() => Promise.resolve()),
    } as unknown as SessionLog;
    onDuelEvent({ completed: true, type: "duel_complete" }, events, log);
    const entries = events.drain();
    expect(must(entries[0]).text).toBeUndefined();
    expect(JSON.parse(must(entries[0]).json)).toEqual({
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
    expect(must(entries[0]).text).toBe("[duel] Duel interrupted");
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
    const json = JSON.parse(must(events.drain()[0]).json);
    expect(json).toEqual({
      loser: "B",
      reason: "won",
      type: "DUEL_WINNER",
      winner: "A",
    });
  });
});
