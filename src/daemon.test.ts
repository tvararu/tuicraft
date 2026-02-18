import { test, expect, describe, jest, afterEach } from "bun:test";
import { unlink } from "node:fs/promises";
import {
  parseIpcCommand,
  dispatchCommand,
  onChatMessage,
  writeLines,
  type EventEntry,
} from "daemon";
import { sendToSocket } from "cli";
import { RingBuffer } from "ring-buffer";
import { ChatType } from "protocol/opcodes";
import type { SessionLog } from "session-log";
import { createMockHandle } from "test/mock-handle";

function createMockSocket(): {
  write: ReturnType<typeof jest.fn>;
  end: ReturnType<typeof jest.fn>;
  written(): string;
} {
  const chunks: string[] = [];
  return {
    write: jest.fn((data: string | Uint8Array) => {
      chunks.push(
        typeof data === "string" ? data : Buffer.from(data).toString(),
      );
      return (typeof data === "string" ? data : Buffer.from(data).toString())
        .length;
    }),
    end: jest.fn(),
    written() {
      return chunks.join("");
    },
  };
}

describe("parseIpcCommand", () => {
  test("SAY", () => {
    expect(parseIpcCommand("SAY hello world")).toEqual({
      type: "say",
      message: "hello world",
    });
  });

  test("YELL", () => {
    expect(parseIpcCommand("YELL hey everyone")).toEqual({
      type: "yell",
      message: "hey everyone",
    });
  });

  test("GUILD", () => {
    expect(parseIpcCommand("GUILD inv pls")).toEqual({
      type: "guild",
      message: "inv pls",
    });
  });

  test("PARTY", () => {
    expect(parseIpcCommand("PARTY pull now")).toEqual({
      type: "party",
      message: "pull now",
    });
  });

  test("WHISPER", () => {
    expect(parseIpcCommand("WHISPER Xiara follow me")).toEqual({
      type: "whisper",
      target: "Xiara",
      message: "follow me",
    });
  });

  test("READ", () => {
    expect(parseIpcCommand("READ")).toEqual({ type: "read" });
  });

  test("READ_WAIT", () => {
    expect(parseIpcCommand("READ_WAIT 3000")).toEqual({
      type: "read_wait",
      ms: 3000,
    });
  });

  test("STOP", () => {
    expect(parseIpcCommand("STOP")).toEqual({ type: "stop" });
  });

  test("STATUS", () => {
    expect(parseIpcCommand("STATUS")).toEqual({ type: "status" });
  });

  test("WHO without filter", () => {
    expect(parseIpcCommand("WHO")).toEqual({ type: "who" });
  });

  test("WHO with filter", () => {
    expect(parseIpcCommand("WHO mage")).toEqual({
      type: "who",
      filter: "mage",
    });
  });

  test("READ_JSON", () => {
    expect(parseIpcCommand("READ_JSON")).toEqual({ type: "read_json" });
  });

  test("READ_WAIT_JSON", () => {
    expect(parseIpcCommand("READ_WAIT_JSON 2000")).toEqual({
      type: "read_wait_json",
      ms: 2000,
    });
  });

  test("WHO_JSON without filter", () => {
    expect(parseIpcCommand("WHO_JSON")).toEqual({ type: "who_json" });
  });

  test("WHO_JSON with filter", () => {
    expect(parseIpcCommand("WHO_JSON mage")).toEqual({
      type: "who_json",
      filter: "mage",
    });
  });

  test("unknown command returns undefined", () => {
    expect(parseIpcCommand("DANCE")).toBeUndefined();
  });
});

describe("dispatchCommand", () => {
  test("say calls sendSay and writes OK", async () => {
    const handle = createMockHandle();
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    const result = await dispatchCommand(
      { type: "say", message: "hello" },
      handle,
      events,
      socket,
      cleanup,
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
      { type: "yell", message: "HEY" },
      handle,
      events,
      socket,
      cleanup,
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
      { type: "guild", message: "inv pls" },
      handle,
      events,
      socket,
      cleanup,
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
      { type: "party", message: "pull" },
      handle,
      events,
      socket,
      cleanup,
    );

    expect(handle.sendParty).toHaveBeenCalledWith("pull");
    expect(socket.written()).toBe("OK\n\n");
  });

  test("whisper calls sendWhisper and writes OK", async () => {
    const handle = createMockHandle();
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand(
      { type: "whisper", target: "Xiara", message: "hey" },
      handle,
      events,
      socket,
      cleanup,
    );

    expect(handle.sendWhisper).toHaveBeenCalledWith("Xiara", "hey");
    expect(socket.written()).toBe("OK\n\n");
  });

  test("read drains ring buffer text", async () => {
    const handle = createMockHandle();
    const events = new RingBuffer<EventEntry>(10);
    events.push({ text: "[say] Alice: hi", json: '{"type":"SAY"}' });
    events.push({ text: "[say] Bob: hey", json: '{"type":"SAY"}' });
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand({ type: "read" }, handle, events, socket, cleanup);

    expect(socket.written()).toBe("[say] Alice: hi\n[say] Bob: hey\n\n");
  });

  test("read on empty buffer writes just terminator", async () => {
    const handle = createMockHandle();
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand({ type: "read" }, handle, events, socket, cleanup);

    expect(socket.written()).toBe("\n");
  });

  test("read_wait delays then drains", async () => {
    jest.useFakeTimers();
    try {
      const handle = createMockHandle();
      const events = new RingBuffer<EventEntry>(10);
      events.push({ text: "[say] Alice: hi", json: '{"type":"SAY"}' });
      const socket = createMockSocket();
      const cleanup = jest.fn();

      const promise = dispatchCommand(
        { type: "read_wait", ms: 1000 },
        handle,
        events,
        socket,
        cleanup,
      );

      expect(socket.written()).toBe("");
      jest.advanceTimersByTime(1000);
      await promise;
      expect(socket.written()).toBe("[say] Alice: hi\n\n");
    } finally {
      jest.useRealTimers();
    }
  });

  test("status writes CONNECTED", async () => {
    const handle = createMockHandle();
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand({ type: "status" }, handle, events, socket, cleanup);

    expect(socket.written()).toBe("CONNECTED\n\n");
  });

  test("stop calls cleanup and returns true", async () => {
    const handle = createMockHandle();
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    const result = await dispatchCommand(
      { type: "stop" },
      handle,
      events,
      socket,
      cleanup,
    );

    expect(result).toBe(true);
    expect(cleanup).toHaveBeenCalled();
    expect(socket.written()).toBe("OK\n\n");
  });

  test("who passes filter and formats results", async () => {
    const handle = createMockHandle();
    (handle.who as ReturnType<typeof jest.fn>).mockResolvedValue([
      {
        name: "Test",
        guild: "G",
        level: 80,
        classId: 1,
        race: 1,
        gender: 0,
        zone: 1,
      },
    ]);
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand(
      { type: "who", filter: "mage" },
      handle,
      events,
      socket,
      cleanup,
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

    await dispatchCommand({ type: "who" }, handle, events, socket, cleanup);

    expect(handle.who).toHaveBeenCalledWith({});
  });

  test("read_json drains ring buffer json", async () => {
    const handle = createMockHandle();
    const events = new RingBuffer<EventEntry>(10);
    events.push({
      text: "[say] Alice: hi",
      json: '{"type":"SAY","sender":"Alice","message":"hi"}',
    });
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand(
      { type: "read_json" },
      handle,
      events,
      socket,
      cleanup,
    );

    expect(socket.written()).toBe(
      '{"type":"SAY","sender":"Alice","message":"hi"}\n\n',
    );
  });

  test("read_wait_json delays then drains json", async () => {
    jest.useFakeTimers();
    try {
      const handle = createMockHandle();
      const events = new RingBuffer<EventEntry>(10);
      events.push({
        text: "[say] Alice: hi",
        json: '{"type":"SAY"}',
      });
      const socket = createMockSocket();
      const cleanup = jest.fn();

      const promise = dispatchCommand(
        { type: "read_wait_json", ms: 500 },
        handle,
        events,
        socket,
        cleanup,
      );

      expect(socket.written()).toBe("");
      jest.advanceTimersByTime(500);
      await promise;
      expect(socket.written()).toBe('{"type":"SAY"}\n\n');
    } finally {
      jest.useRealTimers();
    }
  });

  test("who_json returns JSON formatted results", async () => {
    const handle = createMockHandle();
    (handle.who as ReturnType<typeof jest.fn>).mockResolvedValue([
      {
        name: "Test",
        guild: "G",
        level: 80,
        classId: 1,
        race: 1,
        gender: 0,
        zone: 1,
      },
    ]);
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand(
      { type: "who_json", filter: "mage" },
      handle,
      events,
      socket,
      cleanup,
    );

    expect(handle.who).toHaveBeenCalledWith({ name: "mage" });
    const parsed = JSON.parse(socket.written().replace(/\n+$/, ""));
    expect(parsed.type).toBe("WHO");
    expect(parsed.count).toBe(1);
    expect(parsed.results[0].name).toBe("Test");
  });
});

describe("writeLines", () => {
  test("writes each line with newline then blank terminator", () => {
    const socket = createMockSocket();
    writeLines(socket, ["line1", "line2"]);
    expect(socket.written()).toBe("line1\nline2\n\n");
  });

  test("empty array writes just terminator", () => {
    const socket = createMockSocket();
    writeLines(socket, []);
    expect(socket.written()).toBe("\n");
  });
});

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
});

describe("IPC round-trip", () => {
  let sockCounter = 0;
  let sockPath: string;
  let server: ReturnType<typeof Bun.listen>;
  let handle: ReturnType<typeof createMockHandle>;
  let events: RingBuffer<EventEntry>;

  function startTestServer() {
    sockPath = `./tmp/test-daemon-${++sockCounter}-${Date.now()}.sock`;
    handle = createMockHandle();
    events = new RingBuffer<EventEntry>(100);
    const cleanup = jest.fn();

    server = Bun.listen({
      unix: sockPath,
      socket: {
        data(socket, data) {
          const line = Buffer.from(data).toString().trim();
          const cmd = parseIpcCommand(line);
          if (!cmd) {
            writeLines(socket, ["ERR unknown command"]);
            socket.end();
            return;
          }
          dispatchCommand(cmd, handle, events, socket, cleanup)
            .catch(() => writeLines(socket, ["ERR internal"]))
            .finally(() => {
              socket.flush();
              socket.end();
            });
        },
      },
    });
  }

  afterEach(async () => {
    server?.stop(true);
    await unlink(sockPath).catch(() => {});
  });

  function sendCommand(command: string): Promise<string[]> {
    return new Promise((resolve, reject) => {
      let buf = "";
      Bun.connect({
        unix: sockPath,
        socket: {
          open(s) {
            s.write(command + "\n");
            s.flush();
          },
          data(s, data) {
            buf += Buffer.from(data).toString();
            if (buf.endsWith("\n\n") || buf === "\n") {
              const result: string[] = [];
              for (const l of buf.split("\n")) {
                if (l === "") break;
                result.push(l);
              }
              s.end();
              resolve(result);
            }
          },
          error(_s, err) {
            reject(err);
          },
        },
      });
    });
  }

  test("STATUS returns CONNECTED", async () => {
    startTestServer();
    const lines = await sendCommand("STATUS");
    expect(lines).toEqual(["CONNECTED"]);
  });

  test("SAY returns OK and calls handle", async () => {
    startTestServer();
    const lines = await sendCommand("SAY hello world");
    expect(lines).toEqual(["OK"]);
    expect(handle.sendSay).toHaveBeenCalledWith("hello world");
  });

  test("WHISPER returns OK", async () => {
    startTestServer();
    const lines = await sendCommand("WHISPER Xiara hey");
    expect(lines).toEqual(["OK"]);
    expect(handle.sendWhisper).toHaveBeenCalledWith("Xiara", "hey");
  });

  test("READ returns buffered events", async () => {
    startTestServer();
    events.push({ text: "[say] Alice: hi", json: '{"type":"SAY"}' });
    events.push({ text: "[say] Bob: hey", json: '{"type":"SAY"}' });
    const lines = await sendCommand("READ");
    expect(lines).toEqual(["[say] Alice: hi", "[say] Bob: hey"]);
  });

  test("unknown command returns ERR", async () => {
    startTestServer();
    const lines = await sendCommand("DANCE");
    expect(lines).toEqual(["ERR unknown command"]);
  });

  test("sendToSocket rejects on missing socket", async () => {
    await expect(
      sendToSocket("STATUS", "./tmp/nonexistent.sock"),
    ).rejects.toThrow();
  });
});
