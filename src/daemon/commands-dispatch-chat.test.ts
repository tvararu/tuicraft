import { describe, expect, jest, test } from "bun:test";
import { dispatchCommand, type EventEntry } from "daemon/commands";
import { RingBuffer } from "lib/ring-buffer";
import { createMockSocket } from "test/commands-fixtures";
import { createMockHandle } from "test/mock-handle";

describe("dispatchCommand", () => {
  test("say calls sendSay and writes OK", async () => {
    const handle = createMockHandle();
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    const result = await dispatchCommand(
      { message: "hello", type: "say" },
      { cleanup, events, handle, socket },
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
      { message: "HEY", type: "yell" },
      { cleanup, events, handle, socket },
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
      { message: "inv pls", type: "guild" },
      { cleanup, events, handle, socket },
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
      { message: "pull", type: "party" },
      { cleanup, events, handle, socket },
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
      { message: "waves hello", type: "emote" },
      { cleanup, events, handle, socket },
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
      { message: "busy", type: "dnd" },
      { cleanup, events, handle, socket },
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
      { message: "grabbing coffee", type: "afk" },
      { cleanup, events, handle, socket },
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
      { max: 100, min: 1, type: "roll" },
      { cleanup, events, handle, socket },
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
      { message: "hey", target: "Xiara", type: "whisper" },
      { cleanup, events, handle, socket },
    );

    expect(handle.sendWhisper).toHaveBeenCalledWith("Xiara", "hey");
    expect(socket.written()).toBe("OK\n\n");
  });

  test("read drains ring buffer text", async () => {
    const handle = createMockHandle();
    const events = new RingBuffer<EventEntry>(10);
    events.push({ json: '{"type":"SAY"}', text: "[say] Alice: hi" });
    events.push({ json: '{"type":"SAY"}', text: "[say] Bob: hey" });
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand(
      { type: "read" },
      { cleanup, events, handle, socket },
    );

    expect(socket.written()).toBe("[say] Alice: hi\n[say] Bob: hey\n\n");
  });

  test("read on empty buffer writes just terminator", async () => {
    const handle = createMockHandle();
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand(
      { type: "read" },
      { cleanup, events, handle, socket },
    );

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
        { ms: 1000, type: "read_wait" },
        { cleanup, events, handle, socket },
      );

      expect(socket.written()).toBe("");
      events.push({ json: '{"type":"SAY"}', text: "[say] Alice: hi" });
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
      events.push({ json: '{"type":"SAY"}', text: "[say] Old: before" });
      const socket = createMockSocket();
      const cleanup = jest.fn();

      const promise = dispatchCommand(
        { ms: 1000, type: "read_wait" },
        { cleanup, events, handle, socket },
      );

      events.push({ json: '{"type":"SAY"}', text: "[say] New: during" });
      jest.advanceTimersByTime(1000);
      await promise;
      expect(socket.written()).toBe("[say] New: during\n\n");
      expect(events.drain()).toEqual([
        { json: '{"type":"SAY"}', text: "[say] Old: before" },
        { json: '{"type":"SAY"}', text: "[say] New: during" },
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

    await dispatchCommand(
      { type: "status" },
      { cleanup, events, handle, socket },
    );

    expect(socket.written()).toBe("CONNECTED\n\n");
  });

  test("stop calls cleanup and returns true", async () => {
    const handle = createMockHandle();
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    const result = await dispatchCommand(
      { type: "stop" },
      { cleanup, events, handle, socket },
    );

    expect(result).toBe(true);
    expect(cleanup).toHaveBeenCalled();
    expect(socket.written()).toBe("OK\n\n");
  });

  test("who passes filter and formats results", async () => {
    const handle = createMockHandle();
    (handle.who as ReturnType<typeof jest.fn>).mockResolvedValue([
      {
        classId: 1,
        gender: 0,
        guild: "G",
        level: 80,
        name: "Test",
        race: 1,
        zone: 1,
      },
    ]);
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand(
      { filter: "mage", type: "who" },
      { cleanup, events, handle, socket },
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

    await dispatchCommand({ type: "who" }, { cleanup, events, handle, socket });

    expect(handle.who).toHaveBeenCalledWith({});
  });

  test("read_json drains ring buffer json", async () => {
    const handle = createMockHandle();
    const events = new RingBuffer<EventEntry>(10);
    events.push({
      json: '{"type":"SAY","sender":"Alice","message":"hi"}',
      text: "[say] Alice: hi",
    });
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand(
      { type: "read_json" },
      { cleanup, events, handle, socket },
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
        { ms: 500, type: "read_wait_json" },
        { cleanup, events, handle, socket },
      );

      expect(socket.written()).toBe("");
      events.push({ json: '{"type":"SAY"}', text: "[say] Alice: hi" });
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
      events.push({ json: '{"old":true}', text: "[say] Old: before" });
      const socket = createMockSocket();
      const cleanup = jest.fn();

      const promise = dispatchCommand(
        { ms: 500, type: "read_wait_json" },
        { cleanup, events, handle, socket },
      );

      events.push({ json: '{"new":true}', text: "[say] New: during" });
      jest.advanceTimersByTime(500);
      await promise;
      expect(socket.written()).toBe('{"new":true}\n\n');
    } finally {
      jest.useRealTimers();
    }
  });
});
