import { test, expect, describe, jest, afterEach } from "bun:test";
import { mkdir, unlink } from "node:fs/promises";
import type { EventEntry } from "daemon/commands";
import { startDaemonServer } from "daemon/server";
import { SessionLog } from "lib/session-log";
import { createMockHandle } from "test/mock-handle";
import { ObjectType } from "wow/protocol/entity-fields";
import type { BaseEntity } from "wow/entity-store";

describe("main CLI against a daemon socket", () => {
  let sockCounter = 0;
  let sockPath: string;
  let handle = createMockHandle();
  let result: ReturnType<typeof startDaemonServer>;
  let exitSpy: ReturnType<typeof jest.fn>;

  afterEach(async () => {
    exitSpy?.mockRestore();
    result?.cleanup();
  });

  async function runMain(
    args: string[],
    buffered: EventEntry[] = [],
    onActivity?: () => void,
  ) {
    const xdg = `${process.cwd()}/tmp/cli-main-${++sockCounter}-${Date.now()}`;
    await mkdir(`${xdg}/tuicraft`, { recursive: true });
    sockPath = `${xdg}/tuicraft/sock`;
    const log = new SessionLog(`${xdg}/session.jsonl`);
    exitSpy = jest
      .spyOn(process, "exit")
      .mockImplementation(() => undefined as never);
    result = startDaemonServer({ handle, sock: sockPath, log, onActivity });
    for (const event of buffered) result.events.push(event);
    const proc = Bun.spawn({
      cmd: [process.execPath, `${import.meta.dir}/main.ts`, ...args],
      cwd: `${import.meta.dir}/..`,
      env: { ...process.env, XDG_RUNTIME_DIR: xdg },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [code, out, error] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    return { code, out, error };
  }

  test("empty JSON read returns one parseable event envelope", async () => {
    handle = createMockHandle();
    const { code, out } = await runMain(["read", "--json"]);
    expect(code).toBe(0);
    expect(out).not.toBe("");
    expect(out.trim().split("\n")).toHaveLength(1);
    expect(JSON.parse(out)).toEqual({
      command: "read",
      kind: "events",
      data: null,
      events: [],
      error: null,
    });
  });

  test("JSON read returns decoded events in one document", async () => {
    handle = createMockHandle();
    const { code, out } = await runMain(
      ["read", "--json"],
      [{ text: undefined, json: '{"type":"SAY","sender":"A","message":"hi"}' }],
    );
    expect(code).toBe(0);
    expect(JSON.parse(out)).toEqual({
      command: "read",
      kind: "events",
      data: null,
      events: [{ type: "SAY", sender: "A", message: "hi" }],
      error: null,
    });
  });

  test("JSON who keeps nonempty daemon result data", async () => {
    handle = createMockHandle();
    const player = {
      name: "Aria",
      guild: "Wanderers",
      level: 42,
      classId: 8,
      race: 1,
      gender: 0,
      zone: 12,
    };
    handle.who = async () => [player];
    const { code, out } = await runMain(["who", "Aria", "--json"]);
    expect(code).toBe(0);
    expect(JSON.parse(out)).toEqual({
      command: "who",
      kind: "result",
      data: { type: "WHO", count: 1, results: [player] },
      events: [],
      error: null,
    });
  });

  test("empty JSON nearby is a result with an empty array", async () => {
    handle = createMockHandle();
    const { code, out } = await runMain(["nearby", "--json"]);
    expect(code).toBe(0);
    expect(JSON.parse(out)).toEqual({
      command: "nearby",
      kind: "result",
      data: [],
      events: [],
      error: null,
    });
  });

  test("JSON nearby keeps nonempty daemon entity data", async () => {
    handle = createMockHandle();
    const entity: BaseEntity = {
      guid: 0x11n,
      objectType: ObjectType.OBJECT,
      name: "Marker",
      entry: 17,
      scale: 1,
      position: undefined,
      rawFields: new Map(),
    };
    (handle.getNearbyEntities as ReturnType<typeof jest.fn>).mockReturnValue([
      entity,
    ]);
    const { code, out } = await runMain(["nearby", "--json"]);
    expect(code).toBe(0);
    expect(JSON.parse(out)).toEqual({
      command: "nearby",
      kind: "result",
      data: [
        {
          guid: "0x11",
          type: "object",
          name: "Marker",
          entry: 17,
          self: false,
          distance: null,
          horizontalDistance: null,
          bearingRadians: null,
          turnRadians: null,
          originSource: null,
          originUpdatedAt: null,
        },
      ],
      events: [],
      error: null,
    });
  });

  test("JSON send wait returns one intent document without events", async () => {
    handle = createMockHandle();
    const { code, out } = await runMain([
      "send",
      "hello",
      "--json",
      "--wait",
      "0",
    ]);
    expect(code).toBe(0);
    expect(out.trim().split("\n")).toHaveLength(1);
    expect(JSON.parse(out)).toEqual({
      command: "send",
      kind: "intent",
      data: null,
      events: [],
      error: null,
    });
  });

  test("JSON send wait collects events in its single envelope", async () => {
    handle = createMockHandle();
    let requests = 0;
    const event = {
      text: undefined,
      json: '{"type":"SAY","sender":"B","message":"reply"}',
    };
    const { code, out } = await runMain(
      ["send", "hello", "--json", "--wait", "0.02"],
      [],
      () => {
        if (++requests === 3) queueMicrotask(() => result.events.push(event));
      },
    );
    expect(code).toBe(0);
    expect(out.trim().split("\n")).toHaveLength(1);
    expect(JSON.parse(out)).toEqual({
      command: "send",
      kind: "intent",
      data: null,
      events: [{ type: "SAY", sender: "B", message: "reply" }],
      error: null,
    });
  });

  test("JSON send wait preserves intent when event read fails", async () => {
    const xdg = `${process.cwd()}/tmp/cli-wait-${++sockCounter}-${Date.now()}`;
    await mkdir(`${xdg}/tuicraft`, { recursive: true });
    const server = Bun.listen({
      unix: `${xdg}/tuicraft/sock`,
      socket: {
        data(socket, bytes) {
          const command = Buffer.from(bytes).toString().trim();
          const reply =
            command === "STATUS"
              ? "CONNECTED\n\n"
              : command.startsWith("SAY ")
                ? "OK\n\n"
                : "ERR event_read_lost\n\n";
          socket.write(reply);
          socket.flush();
        },
      },
    });
    try {
      const proc = Bun.spawn({
        cmd: [
          process.execPath,
          `${import.meta.dir}/main.ts`,
          "send",
          "hello",
          "--json",
          "--wait",
          "0",
        ],
        cwd: `${import.meta.dir}/..`,
        env: { ...process.env, XDG_RUNTIME_DIR: xdg },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [code, out] = await Promise.all([
        proc.exited,
        new Response(proc.stdout).text(),
      ]);
      expect(code).toBe(1);
      expect(out.trim().split("\n")).toHaveLength(1);
      expect(JSON.parse(out)).toEqual({
        command: "send",
        kind: "intent",
        data: null,
        events: [],
        error: { stage: "wait", message: "event_read_lost" },
      });
    } finally {
      server.stop(true);
    }
  });

  test("tail JSON skips empty polls and envelopes each event", async () => {
    const xdg = `${process.cwd()}/tmp/cli-tail-${++sockCounter}-${Date.now()}`;
    await mkdir(`${xdg}/tuicraft`, { recursive: true });
    const path = `${xdg}/tuicraft/sock`;
    let polls = 0;
    const server = Bun.listen({
      unix: path,
      socket: {
        data(socket, bytes) {
          const command = Buffer.from(bytes).toString().trim();
          if (command === "STATUS") socket.write("CONNECTED\n\n");
          else if (command.startsWith("READ_WAIT_JSON")) {
            polls++;
            if (polls === 1) socket.write("\n");
            else if (polls === 2)
              socket.write(
                '{"type":"SAY","sender":"C","message":"tail"}\n{"type":"WHISPER","sender":"D","message":"reply"}\n\n',
              );
            else {
              socket.write("ERR stopped\n\n");
              socket.flush();
              server.stop(true);
            }
          }
          socket.flush();
        },
      },
    });
    try {
      const proc = Bun.spawn({
        cmd: [process.execPath, `${import.meta.dir}/main.ts`, "tail", "--json"],
        cwd: `${import.meta.dir}/..`,
        env: { ...process.env, XDG_RUNTIME_DIR: xdg },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [code, out] = await Promise.all([
        proc.exited,
        new Response(proc.stdout).text(),
      ]);
      expect(code).toBe(1);
      const replies = out
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      expect(replies).toHaveLength(3);
      expect(replies[0]).toEqual({
        command: "tail",
        kind: "events",
        data: null,
        events: [{ type: "SAY", sender: "C", message: "tail" }],
        error: null,
      });
      expect(replies[1]).toEqual({
        command: "tail",
        kind: "events",
        data: null,
        events: [{ type: "WHISPER", sender: "D", message: "reply" }],
        error: null,
      });
      expect(replies[2]).toMatchObject({
        command: "tail",
        kind: "error",
        error: { stage: "command" },
      });
    } finally {
      server.stop(true);
    }
  });

  test("JSON status reports the daemon socket, not world health", async () => {
    handle = createMockHandle();
    const { code, out } = await runMain(["status", "--json"]);
    expect(code).toBe(0);
    expect(JSON.parse(out)).toEqual({
      command: "status",
      kind: "result",
      data: { socket: "responsive" },
      events: [],
      error: null,
    });
  });

  test("JSON stop reports a broken existing socket as an error", async () => {
    const xdg = `${process.cwd()}/tmp/cli-stop-${++sockCounter}-${Date.now()}`;
    const path = `${xdg}/tuicraft/sock`;
    await mkdir(`${xdg}/tuicraft`, { recursive: true });
    await Bun.write(path, "not a socket");
    try {
      const proc = Bun.spawn({
        cmd: [process.execPath, `${import.meta.dir}/main.ts`, "stop", "--json"],
        cwd: `${import.meta.dir}/..`,
        env: { ...process.env, XDG_RUNTIME_DIR: xdg },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [code, out] = await Promise.all([
        proc.exited,
        new Response(proc.stdout).text(),
      ]);
      expect(code).toBe(1);
      expect(JSON.parse(out)).toMatchObject({
        command: "stop",
        kind: "error",
        data: null,
        events: [],
        error: { stage: "command" },
      });
    } finally {
      await unlink(path);
    }
  });

  test("JSON send does not fabricate success on daemon error", async () => {
    handle = createMockHandle();
    handle.sendSay = () => {
      throw new Error("send rejected");
    };
    let requests = 0;
    const { code, out } = await runMain(
      ["send", "hello", "--json", "--wait", "0"],
      [],
      () => {
        requests++;
      },
    );
    expect(code).toBe(1);
    expect(requests).toBe(2);
    expect(JSON.parse(out)).toEqual({
      command: "send",
      kind: "error",
      data: null,
      events: [],
      error: { stage: "command", message: "internal" },
    });
  });

  test("JSON fight acknowledges intent without claiming victory", async () => {
    handle = createMockHandle();
    const { code, out } = await runMain(["fight", "0xa", "--json"]);
    expect(code).toBe(0);
    expect(JSON.parse(out)).toEqual({
      command: "fight",
      kind: "intent",
      data: null,
      events: [],
      error: null,
    });
  });

  test("missing wait value fails before sending JSON chat", async () => {
    handle = createMockHandle();
    const { code, out, error } = await runMain([
      "send",
      "hi",
      "--wait",
      "--json",
    ]);
    expect(code).toBe(1);
    expect(error).toBe("");
    expect(handle.sendSay).not.toHaveBeenCalled();
    expect(JSON.parse(out)).toMatchObject({
      command: "send",
      kind: "error",
      data: null,
      events: [],
      error: { stage: "arguments" },
    });
  });

  test("malformed JSON-mode arguments return one error envelope", async () => {
    handle = createMockHandle();
    const { code, out, error } = await runMain([
      "goto",
      "NaN",
      "1",
      "2",
      "--json",
    ]);
    expect(code).toBe(1);
    expect(error).toBe("");
    const reply = JSON.parse(out);
    expect(reply).toMatchObject({
      command: "goto",
      kind: "error",
      data: null,
      events: [],
      error: { stage: "arguments" },
    });
  });

  test("unknown JSON command has no invented public name", async () => {
    handle = createMockHandle();
    const { code, out } = await runMain(["frobnicate", "--json"]);
    expect(code).toBe(1);
    expect(JSON.parse(out)).toMatchObject({
      command: null,
      kind: "error",
      error: { stage: "arguments" },
    });
  });

  test("MOVE ERR exits nonzero from src/main.ts", async () => {
    handle = createMockHandle();
    jest.spyOn(handle, "move").mockImplementation(() => {
      throw new Error("rooted");
    });
    const { code, out } = await runMain(["move", "forward"]);
    expect(code).toBe(1);
    expect(out).toContain("ERR rooted");
  });

  test("spellbook inspection errors exit nonzero from the CLI", async () => {
    handle = createMockHandle();
    jest.spyOn(handle, "getSpellbook").mockImplementation(async () => {
      throw new Error("missing_spell_data");
    });
    const { code, out } = await runMain(["spells", "--json"]);
    expect(code).toBe(1);
    expect(JSON.parse(out)).toEqual({
      command: "spells",
      kind: "error",
      data: null,
      events: [],
      error: { stage: "command", message: "missing_spell_data" },
    });
  });

  test("start reports already running if daemon is active", async () => {
    handle = createMockHandle();
    const { code, out } = await runMain(["start"]);
    expect(code).toBe(0);
    expect(out.trim()).toBe("Daemon is already running.");
  });

  test("multiline fight instructions cannot execute injected controls", async () => {
    handle = createMockHandle();
    const startTactics = jest.fn(async () => {});
    handle.startTactics = startTactics;
    const { code } = await runMain([
      "fight",
      "0xa",
      "stay alive\nMOVE forward 10000",
    ]);
    expect(handle.move).not.toHaveBeenCalled();
    expect(startTactics).not.toHaveBeenCalled();
    expect(code).toBe(1);
  });
});
