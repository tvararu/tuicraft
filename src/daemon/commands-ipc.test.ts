import { describe, expect, jest, test } from "bun:test";
import { unlink } from "node:fs/promises";
import { sendToSocket } from "cli/ipc";
import { startDaemonServer } from "daemon/server";
import { SessionLog } from "lib/session-log";
import {
  attachControl,
  createMockSocket,
  sampleState,
  useIpcServer,
} from "test/commands-fixtures";
import { createMockHandle } from "test/mock-handle";
import { must } from "test/must";
import type { ControlEvent } from "wow";

describe("IPC round-trip", () => {
  const ipc = useIpcServer();

  test("STATUS returns CONNECTED", async () => {
    ipc.start();
    const lines = await sendToSocket("STATUS", ipc.sockPath);
    expect(lines).toEqual(["CONNECTED"]);
  });

  test("SAY returns OK and calls handle", async () => {
    ipc.start();
    const lines = await sendToSocket("SAY hello world", ipc.sockPath);
    expect(lines).toEqual(["OK"]);
    expect(ipc.handle.sendSay).toHaveBeenCalledWith("hello world");
  });

  test("EMOTE returns OK and calls handle", async () => {
    ipc.start();
    const lines = await sendToSocket("EMOTE waves hello", ipc.sockPath);
    expect(lines).toEqual(["OK"]);
    expect(ipc.handle.sendEmote).toHaveBeenCalledWith("waves hello");
  });

  test("DND returns OK and calls handle", async () => {
    ipc.start();
    const lines = await sendToSocket("DND busy right now", ipc.sockPath);
    expect(lines).toEqual(["OK"]);
    expect(ipc.handle.sendDnd).toHaveBeenCalledWith("busy right now");
  });

  test("AFK returns OK and calls handle", async () => {
    ipc.start();
    const lines = await sendToSocket("AFK grabbing coffee", ipc.sockPath);
    expect(lines).toEqual(["OK"]);
    expect(ipc.handle.sendAfk).toHaveBeenCalledWith("grabbing coffee");
  });

  test("WHISPER returns OK", async () => {
    ipc.start();
    const lines = await sendToSocket("WHISPER Xiara hey", ipc.sockPath);
    expect(lines).toEqual(["OK"]);
    expect(ipc.handle.sendWhisper).toHaveBeenCalledWith("Xiara", "hey");
  });

  test("ROLL returns OK and calls sendRoll", async () => {
    ipc.start();
    const lines = await sendToSocket("ROLL 10 20", ipc.sockPath);
    expect(lines).toEqual(["OK"]);
    expect(ipc.handle.sendRoll).toHaveBeenCalledWith(10, 20);
  });

  test("READ returns buffered events", async () => {
    ipc.start();
    ipc.result.events.push({ json: '{"type":"SAY"}', text: "[say] Alice: hi" });
    ipc.result.events.push({ json: '{"type":"SAY"}', text: "[say] Bob: hey" });
    const lines = await sendToSocket("READ", ipc.sockPath);
    expect(lines).toEqual(["[say] Alice: hi", "[say] Bob: hey"]);
  });

  test("READ_JSON delivers a response larger than the socket buffer", async () => {
    ipc.start();
    const events = Array.from(
      { length: 40 },
      (_, i) => `{"type":"QUEST","n":${i},"pad":"${"x".repeat(100_000)}"}`,
    );
    for (const json of events)
      ipc.result.events.push({ json, text: undefined });
    const lines = await sendToSocket("READ_JSON", ipc.sockPath);
    expect(lines).toEqual(events);
  });

  test("bare text sends via sticky mode", async () => {
    ipc.start();
    const lines = await sendToSocket("hello world", ipc.sockPath);
    expect(lines[0]).toMatch(/^OK /);
    expect(ipc.handle.sendInCurrentMode).toHaveBeenCalledWith("hello world");
  });

  test("empty command returns ERR", async () => {
    ipc.start();
    const lines = await sendToSocket("", ipc.sockPath);
    expect(lines).toEqual(["ERR unknown command"]);
  });

  test("sendToSocket rejects on missing socket", async () => {
    await expect(
      sendToSocket("STATUS", "./tmp/nonexistent.sock"),
    ).rejects.toThrow();
  });

  test("onActivity fires on each IPC command", async () => {
    const activity = jest.fn();
    ipc.start({ onActivity: activity });
    await sendToSocket("STATUS", ipc.sockPath);
    await sendToSocket("STATUS", ipc.sockPath);
    expect(activity).toHaveBeenCalledTimes(2);
  });

  test("cleanup closes handle and stops server", async () => {
    ipc.start();
    await sendToSocket("STATUS", ipc.sockPath);
    ipc.result.cleanup();
    expect(ipc.handle.close).toHaveBeenCalled();
    await expect(sendToSocket("STATUS", ipc.sockPath)).rejects.toThrow();
  });

  test("cleanup is idempotent", async () => {
    ipc.start();
    ipc.result.cleanup();
    ipc.result.cleanup();
    expect(ipc.handle.close).toHaveBeenCalledTimes(1);
  });

  test("cleanup ignores missing socket file", async () => {
    ipc.start();
    await sendToSocket("STATUS", ipc.sockPath);
    await unlink(ipc.sockPath);
    ipc.result.cleanup();
    expect(ipc.handle.close).toHaveBeenCalledTimes(1);
  });

  test("STOP triggers process.exit", async () => {
    ipc.start();
    const lines = await sendToSocket("STOP", ipc.sockPath);
    expect(lines).toEqual(["OK"]);
    await Bun.sleep(0);
    expect(ipc.exitSpy).toHaveBeenCalledWith(0);
  });

  test("HALT stays connected while STOP exits", async () => {
    ipc.start();
    const haltLines = await sendToSocket("HALT", ipc.sockPath);
    expect(haltLines).toEqual(["OK"]);
    expect(ipc.handle.halt).toHaveBeenCalled();
    expect(ipc.exitSpy).not.toHaveBeenCalled();
    const status = await sendToSocket("STATUS", ipc.sockPath);
    expect(status).toEqual(["CONNECTED"]);
    const stopLines = await sendToSocket("STOP", ipc.sockPath);
    expect(stopLines).toEqual(["OK"]);
    await Bun.sleep(0);
    expect(ipc.exitSpy).toHaveBeenCalledWith(0);
  });

  test("malformed MOVE does not start movement", async () => {
    ipc.start();
    const lines = await sendToSocket("MOVE up", ipc.sockPath);
    expect(lines[0]?.startsWith("ERR")).toBe(true);
    expect(ipc.handle.move).not.toHaveBeenCalled();
  });

  test("MOVE FACE TARGET round-trip call handle", async () => {
    ipc.start();
    expect(await sendToSocket("MOVE right 2000", ipc.sockPath)).toEqual(["OK"]);
    expect(ipc.handle.move).toHaveBeenCalledWith("right", 2000);
    expect(await sendToSocket("FACE 0.25", ipc.sockPath)).toEqual(["OK"]);
    expect(ipc.handle.face).toHaveBeenCalledWith(0.25);
    expect(await sendToSocket("TARGET 0xa", ipc.sockPath)).toEqual(["OK"]);
    expect(ipc.handle.selectTarget).toHaveBeenCalledWith(0xan);
  });

  test("CONTROL_JSON round-trip keeps pose provenance", async () => {
    ipc.start();
    ipc.handle.getControlState.mockReturnValue(sampleState());
    const lines = await sendToSocket("CONTROL_JSON", ipc.sockPath);
    const parsed = JSON.parse(must(lines[0]));
    expect(parsed.pose.source).toBe("predicted");
    expect(parsed.serverPose.source).toBe("server");
    expect(parsed.selfGuid).toBe("0xabcde");
  });

  test("control events reach the ring buffer", async () => {
    ipc.start();
    const cb = must(ipc.handle.onControlEvent.mock.calls[0])[0] as (
      event: ControlEvent,
    ) => void;
    cb({ state: sampleState(), type: "movement_started" });
    const jsonLines = await sendToSocket("READ_JSON", ipc.sockPath);
    const parsed = JSON.parse(must(jsonLines[0]));
    expect(parsed.type).toBe("CONTROL");
    expect(parsed.event).toBe("movement_started");
    expect(parsed.pose.source).toBe("predicted");
  });

  test("buffers split command chunks before parsing", async () => {
    const origListen = Bun.listen;
    let capturedData:
      | ((
          socket: {
            write: (data: string | Uint8Array) => number;
            end: () => void;
          },
          data: ArrayBuffer | ArrayBufferView,
        ) => void | Promise<void>)
      | undefined;
    let stopFn: ReturnType<typeof jest.fn> | undefined;

    Bun.listen = jest.fn((opts: { socket: { data: typeof capturedData } }) => {
      capturedData = opts.socket.data;
      stopFn = jest.fn();
      return { stop: stopFn } as unknown as ReturnType<typeof Bun.listen>;
    }) as unknown as typeof Bun.listen;

    try {
      const handle = attachControl(createMockHandle());
      const log = new SessionLog(`./tmp/test-daemon-split-${Date.now()}.jsonl`);
      const { cleanup } = startDaemonServer({
        handle,
        log,
        sock: `./tmp/test-daemon-split-${Date.now()}.sock`,
      });
      const socket = createMockSocket();

      must(capturedData)(socket, Buffer.from("STA"));
      must(capturedData)(socket, Buffer.from("TUS\n"));
      await Promise.resolve();

      expect(socket.written()).toBe("CONNECTED\n\n");

      cleanup();
      expect(stopFn).toHaveBeenCalled();
    } finally {
      Bun.listen = origListen;
    }
  });

  test("keeps a split next command after a completed command", async () => {
    const origListen = Bun.listen;
    let capturedData:
      | ((
          socket: {
            write: (data: string | Uint8Array) => number;
            end: () => void;
          },
          data: ArrayBuffer | ArrayBufferView,
        ) => void | Promise<void>)
      | undefined;
    let stopFn: ReturnType<typeof jest.fn> | undefined;

    Bun.listen = jest.fn((opts: { socket: { data: typeof capturedData } }) => {
      capturedData = opts.socket.data;
      stopFn = jest.fn();
      return { stop: stopFn } as unknown as ReturnType<typeof Bun.listen>;
    }) as unknown as typeof Bun.listen;

    try {
      const handle = attachControl(createMockHandle());
      const log = new SessionLog(
        `./tmp/test-daemon-split-next-${Date.now()}.jsonl`,
      );
      const { cleanup } = startDaemonServer({
        handle,
        log,
        sock: `./tmp/test-daemon-split-next-${Date.now()}.sock`,
      });
      const socket = createMockSocket();

      must(capturedData)(socket, Buffer.from("STATUS\nSTA"));
      await Bun.sleep(0);
      expect(socket.written()).toBe("CONNECTED\n\n");

      must(capturedData)(socket, Buffer.from("TUS\n"));
      await Bun.sleep(0);
      expect(socket.written()).toBe("CONNECTED\n\nCONNECTED\n\n");

      cleanup();
      expect(stopFn).toHaveBeenCalled();
    } finally {
      Bun.listen = origListen;
    }
  });

  test("processes multiple commands from a single chunk", async () => {
    const origListen = Bun.listen;
    let capturedData:
      | ((
          socket: {
            write: (data: string | Uint8Array) => number;
            end: () => void;
          },
          data: ArrayBuffer | ArrayBufferView,
        ) => void | Promise<void>)
      | undefined;
    let stopFn: ReturnType<typeof jest.fn> | undefined;

    Bun.listen = jest.fn((opts: { socket: { data: typeof capturedData } }) => {
      capturedData = opts.socket.data;
      stopFn = jest.fn();
      return { stop: stopFn } as unknown as ReturnType<typeof Bun.listen>;
    }) as unknown as typeof Bun.listen;

    try {
      const handle = attachControl(createMockHandle());
      const log = new SessionLog(`./tmp/test-daemon-multi-${Date.now()}.jsonl`);
      const { cleanup } = startDaemonServer({
        handle,
        log,
        sock: `./tmp/test-daemon-multi-${Date.now()}.sock`,
      });
      const socket = createMockSocket();

      must(capturedData)(socket, Buffer.from("STATUS\nSTATUS\n"));
      await Bun.sleep(0);

      expect(socket.written()).toBe("CONNECTED\n\nCONNECTED\n\n");

      cleanup();
      expect(stopFn).toHaveBeenCalled();
    } finally {
      Bun.listen = origListen;
    }
  });
});
