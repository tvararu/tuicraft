import { describe, expect, jest, test } from "bun:test";
import type { EventEntry } from "daemon/commands";
import { onChatMessage } from "daemon/events";
import { RingBuffer } from "lib/ring-buffer";
import type { SessionLog } from "lib/session-log";
import { must } from "test/must";
import { ChatType } from "wow/protocol/opcodes";

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
    expect(must(drained[0]).text).toBe("[say] Alice: hi");
    expect(JSON.parse(must(drained[0]).json)).toEqual({
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
