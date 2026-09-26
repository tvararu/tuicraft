import { afterEach, describe, expect, jest, test } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { type BaseEntity, ObjectType } from "@tuicraft/core";
import { createMockHandle } from "@tuicraft/core/test-support/mock-handle";
import type { EventEntry } from "#daemon/commands";
import { startDaemonServer } from "#daemon/server";
import { SessionLog } from "#lib/session-log";

describe("main CLI against a daemon socket", () => {
  let sockCounter = 0;
  let sockPath: string;
  let handle = createMockHandle();
  let result: ReturnType<typeof startDaemonServer>;
  let exitSpy: ReturnType<typeof jest.fn>;
  let scratch: string[] = [];
  let log: SessionLog | undefined;

  afterEach(async () => {
    exitSpy?.mockRestore();
    result?.cleanup();
    await log?.flush();
    await Promise.all(
      scratch.map((dir) => rm(dir, { force: true, recursive: true })),
    );
    scratch = [];
  });

  async function scratchDir(prefix: string): Promise<string> {
    const xdg = `${process.cwd()}/tmp/${prefix}-${++sockCounter}-${Date.now()}`;
    scratch.push(xdg);
    await mkdir(`${xdg}/tuicraft`, { recursive: true });
    return xdg;
  }

  async function runMain(
    args: string[],
    buffered: EventEntry[] = [],
    onActivity?: () => void,
  ) {
    const xdg = await scratchDir("cli-main");
    sockPath = `${xdg}/tuicraft/sock`;
    log = new SessionLog(`${xdg}/session.jsonl`);
    exitSpy = jest
      .spyOn(process, "exit")
      .mockImplementation(() => undefined as never);
    result = startDaemonServer({ handle, log, onActivity, sock: sockPath });
    for (const event of buffered) result.events.push(event);
    const proc = Bun.spawn({
      cmd: [process.execPath, `${import.meta.dir}/main.ts`, ...args],
      cwd: `${import.meta.dir}/..`,
      env: { ...process.env, XDG_RUNTIME_DIR: xdg },
      stderr: "pipe",
      stdout: "pipe",
    });
    const [code, out, error] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    return { code, error, out };
  }

  test("empty JSON read returns one parseable event envelope", async () => {
    handle = createMockHandle();
    const { code, out } = await runMain(["read", "--json"]);
    expect(code).toBe(0);
    expect(out).not.toBe("");
    expect(out.trim().split("\n")).toHaveLength(1);
    expect(JSON.parse(out)).toEqual({
      command: "read",
      data: null,
      error: null,
      events: [],
      kind: "events",
    });
  });

  test("JSON read returns decoded events in one document", async () => {
    handle = createMockHandle();
    const { code, out } = await runMain(
      ["read", "--json"],
      [{ json: '{"type":"SAY","sender":"A","message":"hi"}', text: undefined }],
    );
    expect(code).toBe(0);
    expect(JSON.parse(out)).toEqual({
      command: "read",
      data: null,
      error: null,
      events: [{ message: "hi", sender: "A", type: "SAY" }],
      kind: "events",
    });
  });

  test("JSON who keeps nonempty daemon result data", async () => {
    handle = createMockHandle();
    const player = {
      classId: 8,
      gender: 0,
      guild: "Wanderers",
      level: 42,
      name: "Aria",
      race: 1,
      zone: 12,
    };
    handle.who = async () => [player];
    const { code, out } = await runMain(["who", "Aria", "--json"]);
    expect(code).toBe(0);
    expect(JSON.parse(out)).toEqual({
      command: "who",
      data: { count: 1, results: [player], type: "WHO" },
      error: null,
      events: [],
      kind: "result",
    });
  });

  test("empty JSON nearby is a result with an empty array", async () => {
    handle = createMockHandle();
    const { code, out } = await runMain(["nearby", "--json"]);
    expect(code).toBe(0);
    expect(JSON.parse(out)).toEqual({
      command: "nearby",
      data: [],
      error: null,
      events: [],
      kind: "result",
    });
  });

  test("JSON nearby keeps nonempty daemon entity data", async () => {
    handle = createMockHandle();
    const entity: BaseEntity = {
      entry: 17,
      guid: 0x11n,
      name: "Marker",
      objectType: ObjectType.OBJECT,
      position: undefined,
      rawFields: new Map(),
      scale: 1,
    };
    (handle.getNearbyEntities as ReturnType<typeof jest.fn>).mockReturnValue([
      entity,
    ]);
    const { code, out } = await runMain(["nearby", "--json"]);
    expect(code).toBe(0);
    expect(JSON.parse(out)).toEqual({
      command: "nearby",
      data: [
        {
          bearingRadians: null,
          distance: null,
          entry: 17,
          guid: "0x11",
          horizontalDistance: null,
          name: "Marker",
          originSource: null,
          originUpdatedAt: null,
          self: false,
          turnRadians: null,
          type: "object",
        },
      ],
      error: null,
      events: [],
      kind: "result",
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
      data: null,
      error: null,
      events: [],
      kind: "intent",
    });
  });

  test("JSON send wait collects only events after its send", async () => {
    handle = createMockHandle();
    let requests = 0;
    const stale = { json: '{"type":"SAY","message":"stale"}', text: "stale" };
    const event = {
      json: '{"type":"SAY","sender":"B","message":"reply"}',
      text: undefined,
    };
    const { code, out } = await runMain(
      ["send", "hello", "--json", "--wait", "5"],
      [stale],
      () => {
        if (++requests === 4) queueMicrotask(() => result.events.push(event));
      },
    );
    expect(code).toBe(0);
    expect(out.trim().split("\n")).toHaveLength(1);
    expect(JSON.parse(out)).toEqual({
      command: "send",
      data: null,
      error: null,
      events: [{ message: "reply", sender: "B", type: "SAY" }],
      kind: "intent",
    });
    expect(result.events.drain()).toEqual([stale]);
  });

  test("JSON send wait preserves intent when event read fails", async () => {
    const xdg = await scratchDir("cli-wait");
    const server = Bun.listen({
      socket: {
        data(socket, bytes) {
          const command = Buffer.from(bytes).toString().trim();
          let reply = "ERR event_read_lost\n\n";
          if (command === "STATUS") {
            reply = "CONNECTED\n\n";
          } else if (command === "EVENT_MARK") {
            reply = "0\n\n";
          } else if (command.startsWith("SAY ")) {
            reply = "OK\n\n";
          }
          socket.write(reply);
          socket.flush();
        },
      },
      unix: `${xdg}/tuicraft/sock`,
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
        stderr: "pipe",
        stdout: "pipe",
      });
      const [code, out] = await Promise.all([
        proc.exited,
        new Response(proc.stdout).text(),
      ]);
      expect(code).toBe(1);
      expect(out.trim().split("\n")).toHaveLength(1);
      expect(JSON.parse(out)).toEqual({
        command: "send",
        data: null,
        error: { message: "event_read_lost", stage: "wait" },
        events: [],
        kind: "intent",
      });
    } finally {
      server.stop(true);
    }
  });

  test("tail JSON skips empty polls and envelopes each event", async () => {
    const xdg = await scratchDir("cli-tail");
    const path = `${xdg}/tuicraft/sock`;
    let polls = 0;
    const server = Bun.listen({
      socket: {
        data(socket, bytes) {
          const command = Buffer.from(bytes).toString().trim();
          if (command === "STATUS") socket.write("CONNECTED\n\n");
          else if (command.startsWith("TAIL_WAIT_JSON")) {
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
      unix: path,
    });
    try {
      const proc = Bun.spawn({
        cmd: [process.execPath, `${import.meta.dir}/main.ts`, "tail", "--json"],
        cwd: `${import.meta.dir}/..`,
        env: { ...process.env, XDG_RUNTIME_DIR: xdg },
        stderr: "pipe",
        stdout: "pipe",
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
        data: null,
        error: null,
        events: [{ message: "tail", sender: "C", type: "SAY" }],
        kind: "events",
      });
      expect(replies[1]).toEqual({
        command: "tail",
        data: null,
        error: null,
        events: [{ message: "reply", sender: "D", type: "WHISPER" }],
        kind: "events",
      });
      expect(replies[2]).toMatchObject({
        command: "tail",
        error: { stage: "command" },
        kind: "error",
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
      data: { socket: "responsive" },
      error: null,
      events: [],
      kind: "result",
    });
  });

  test("JSON stop reports a broken existing socket as an error", async () => {
    const xdg = await scratchDir("cli-stop");
    await Bun.write(`${xdg}/tuicraft/sock`, "not a socket");
    const proc = Bun.spawn({
      cmd: [process.execPath, `${import.meta.dir}/main.ts`, "stop", "--json"],
      cwd: `${import.meta.dir}/..`,
      env: { ...process.env, XDG_RUNTIME_DIR: xdg },
      stderr: "pipe",
      stdout: "pipe",
    });
    const [code, out] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
    ]);
    expect(code).toBe(1);
    expect(JSON.parse(out)).toMatchObject({
      command: "stop",
      data: null,
      error: { stage: "command" },
      events: [],
      kind: "error",
    });
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
    expect(requests).toBe(3);
    expect(JSON.parse(out)).toEqual({
      command: "send",
      data: null,
      error: { message: "internal", stage: "command" },
      events: [],
      kind: "error",
    });
  });

  test("JSON fight acknowledges intent without claiming victory", async () => {
    handle = createMockHandle();
    const { code, out } = await runMain(["fight", "0xa", "--json"]);
    expect(code).toBe(0);
    expect(JSON.parse(out)).toEqual({
      command: "fight",
      data: null,
      error: null,
      events: [],
      kind: "intent",
    });
  });

  test("JSON cycle resume reports as cycle and surfaces the refusal", async () => {
    handle = createMockHandle();
    const { code, out } = await runMain(["cycle", "--resume", "--json"]);
    expect(code).toBe(1);
    expect(JSON.parse(out)).toEqual({
      command: "cycle",
      data: null,
      error: { message: "cycle_nothing_to_resume", stage: "command" },
      events: [],
      kind: "error",
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
      data: null,
      error: { stage: "arguments" },
      events: [],
      kind: "error",
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
      data: null,
      error: { stage: "arguments" },
      events: [],
      kind: "error",
    });
  });

  test("unknown JSON command has no invented public name", async () => {
    handle = createMockHandle();
    const { code, out } = await runMain(["frobnicate", "--json"]);
    expect(code).toBe(1);
    expect(JSON.parse(out)).toMatchObject({
      command: null,
      error: { stage: "arguments" },
      kind: "error",
    });
  });

  test("MOVE ERR exits nonzero from main.ts", async () => {
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
      data: null,
      error: { message: "missing_spell_data", stage: "command" },
      events: [],
      kind: "error",
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
