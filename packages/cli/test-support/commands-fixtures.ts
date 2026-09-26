import { afterEach, jest } from "bun:test";
import { rm } from "node:fs/promises";
import type { ControlState } from "@tuicraft/core";
import { createMockHandle } from "@tuicraft/core/test-support/mock-handle";
import { startDaemonServer } from "#daemon/server";
import { SessionLog } from "#lib/session-log";

export function createMockSocket(): {
  write: ReturnType<typeof jest.fn>;
  end: ReturnType<typeof jest.fn>;
  written: () => string;
} {
  const chunks: string[] = [];
  return {
    end: jest.fn(),
    write: jest.fn((data: string | Uint8Array) => {
      chunks.push(
        typeof data === "string" ? data : Buffer.from(data).toString(),
      );
      return (typeof data === "string" ? data : Buffer.from(data).toString())
        .length;
    }),
    written() {
      return chunks.join("");
    },
  };
}

export async function sendRawCommands(
  path: string,
  chunks: string[],
  gapMs = 0,
): Promise<string[]> {
  let buffer = "";
  return new Promise<string[]>((resolve, reject) => {
    Bun.connect({
      socket: {
        close() {
          resolve(buffer.split("\n").filter((line) => line !== ""));
        },
        data(socket, data) {
          buffer += Buffer.from(data).toString();
          if (buffer.endsWith("\n\n") || buffer === "\n") {
            socket.end();
            resolve(buffer.split("\n").filter((line) => line !== ""));
          }
        },
        error(_socket, err) {
          reject(err);
        },
        async open(socket) {
          for (const [i, chunk] of chunks.entries()) {
            if (i > 0 && gapMs > 0) await Bun.sleep(gapMs);
            socket.write(chunk);
            socket.flush();
          }
        },
      },
      unix: path,
    }).catch(reject);
  });
}

export async function sendRawUntilClose(
  path: string,
  chunks: string[],
  gapMs = 0,
): Promise<string[]> {
  let buffer = "";
  return new Promise<string[]>((resolve, reject) => {
    Bun.connect({
      socket: {
        close() {
          resolve(buffer.split("\n").filter((line) => line !== ""));
        },
        data(_socket, data) {
          buffer += Buffer.from(data).toString();
        },
        error(_socket, err) {
          reject(err);
        },
        async open(socket) {
          for (const [i, chunk] of chunks.entries()) {
            if (i > 0 && gapMs > 0) await Bun.sleep(gapMs);
            socket.write(chunk);
            socket.flush();
          }
        },
      },
      unix: path,
    }).catch(reject);
  });
}

export type ControlMock = ReturnType<typeof createMockHandle> & {
  getControlState: ReturnType<typeof jest.fn>;
  move: ReturnType<typeof jest.fn>;
  face: ReturnType<typeof jest.fn>;
  selectTarget: ReturnType<typeof jest.fn>;
  halt: ReturnType<typeof jest.fn>;
  onControlEvent: ReturnType<typeof jest.fn>;
  getCombatState: ReturnType<typeof jest.fn>;
  getSpellbook: ReturnType<typeof jest.fn>;
  cast: ReturnType<typeof jest.fn>;
  attack: ReturnType<typeof jest.fn>;
  cancelCast: ReturnType<typeof jest.fn>;
  stopAttack: ReturnType<typeof jest.fn>;
  startTactics: ReturnType<typeof jest.fn>;
  getTacticsState: ReturnType<typeof jest.fn>;
  goTo: ReturnType<typeof jest.fn>;
  getNavigationState: ReturnType<typeof jest.fn>;
  onCombatEvent: ReturnType<typeof jest.fn>;
  onTacticsEvent: ReturnType<typeof jest.fn>;
};

export function attachControl(
  handle: ReturnType<typeof createMockHandle>,
): ControlMock {
  Object.assign(handle, {
    attack: jest.fn(),
    cancelCast: jest.fn(),
    cast: jest.fn(),
    face: jest.fn(),
    getCombatState: jest.fn(() => ({})),
    getControlState: jest.fn(
      (): ControlState => ({
        blockedReason: undefined,
        direction: undefined,
        movementAllowed: true,
        moving: false,
        owner: "none",
        pose: undefined,
        requestedTarget: undefined,
        selfGuid: 1n,
        serverPose: undefined,
        speed: 0,
        target: undefined,
      }),
    ),
    getNavigationState: jest.fn(() => ({})),
    getSpellbook: jest.fn(async () => []),
    getTacticsState: jest.fn(() => ({})),
    goTo: jest.fn(),
    halt: jest.fn(),
    move: jest.fn(),
    onCombatEvent: jest.fn(),
    onControlEvent: jest.fn(),
    onTacticsEvent: jest.fn(),
    selectTarget: jest.fn(),
    startTactics: jest.fn(async () => {}),
    stopAttack: jest.fn(),
  });
  return handle as ControlMock;
}

export function sampleState(
  overrides: Partial<ControlState> = {},
): ControlState {
  return {
    blockedReason: undefined,
    direction: "forward",
    movementAllowed: true,
    moving: true,
    owner: "manual",
    pose: {
      mapId: 530,
      orientation: 1.5,
      source: "predicted",
      updatedAt: 1000,
      x: 8709.46,
      y: -6671.76,
      z: 70.34,
    },
    requestedTarget: 0xan,
    selfGuid: 0xabcden,
    serverPose: {
      mapId: 530,
      orientation: 1.57,
      source: "server",
      updatedAt: 900,
      x: 8709.46,
      y: -6671.76,
      z: 70.34,
    },
    speed: 7,
    target: 0xan,
    ...overrides,
  };
}

let sockCounter = 0;

export type IpcServer = {
  sockPath: string;
  handle: ControlMock;
  result: ReturnType<typeof startDaemonServer>;
  exitSpy: ReturnType<typeof jest.fn>;
  start: (opts?: { onActivity?: () => void }) => void;
};

export function useIpcServer(): IpcServer {
  let exitSpy: ReturnType<typeof jest.fn> | undefined;
  let result: ReturnType<typeof startDaemonServer> | undefined;
  let log: SessionLog | undefined;
  let logPath: string | undefined;
  const server = {
    start(opts?: { onActivity?: () => void }) {
      const base = `./tmp/test-daemon-${++sockCounter}-${Date.now()}`;
      server.sockPath = `${base}.sock`;
      logPath = `${base}.jsonl`;
      server.handle = attachControl(createMockHandle());
      log = new SessionLog(logPath);
      exitSpy = jest
        .spyOn(process, "exit")
        .mockImplementation(() => undefined as never);
      server.exitSpy = exitSpy;
      result = startDaemonServer({
        handle: server.handle,
        log,
        sock: server.sockPath,
        ...opts,
      });
      server.result = result;
    },
  } as IpcServer;

  afterEach(async () => {
    exitSpy?.mockRestore();
    result?.cleanup();
    await log?.flush();
    if (logPath) {
      await Promise.all([
        rm(logPath, { force: true }),
        rm(server.sockPath, { force: true }),
      ]);
      logPath = undefined;
    }
  });

  return server;
}
