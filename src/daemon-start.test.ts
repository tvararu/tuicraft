import { mock, jest, test, expect, describe, afterEach } from "bun:test";
import { access, rm, mkdir, unlink } from "node:fs/promises";
import { serializeConfig } from "config";
import type { AuthResult, WorldHandle } from "client";
import { sendToSocket } from "cli";

const tmpDir = `./tmp/daemon-start-${Date.now()}`;
const cfgDir = `${tmpDir}/config/tuicraft`;
const uid = process.getuid?.() ?? 0;
const rtDir = `${tmpDir}/tuicraft-${uid}`;
const stDir = `${tmpDir}/state/tuicraft`;

mock.module("paths", () => ({
  configDir: () => cfgDir,
  runtimeDir: () => rtDir,
  stateDir: () => stDir,
  socketPath: () => `${rtDir}/sock`,
  pidPath: () => `${rtDir}/pid`,
  configPath: () => `${cfgDir}/config.toml`,
  logPath: () => `${stDir}/session.log`,
}));

let closedResolve: () => void;

function makeMockClient(): {
  authHandshake: ReturnType<typeof jest.fn>;
  worldSession: ReturnType<typeof jest.fn>;
  mockHandleClose: ReturnType<typeof jest.fn>;
} {
  const mockHandleClose = jest.fn();
  const closed = new Promise<void>((r) => {
    closedResolve = r;
  });
  return {
    authHandshake: jest.fn(
      async (): Promise<AuthResult> => ({
        sessionKey: new Uint8Array(40),
        realmHost: "localhost",
        realmPort: 8085,
        realmId: 1,
      }),
    ),
    worldSession: jest.fn(
      async (): Promise<WorldHandle> => ({
        closed,
        close: mockHandleClose,
        onMessage: jest.fn(),
        sendSay: jest.fn(),
        sendYell: jest.fn(),
        sendGuild: jest.fn(),
        sendParty: jest.fn(),
        sendRaid: jest.fn(),
        sendWhisper: jest.fn(),
        sendChannel: jest.fn(),
        getChannel: jest.fn(),
        who: jest.fn(async () => []),
      }),
    ),
    mockHandleClose,
  };
}

const { startDaemon } = await import("daemon");

const exitSpy = jest
  .spyOn(process, "exit")
  .mockImplementation(() => undefined as never);

const signalListeners: Array<{
  event: string;
  fn: (...args: unknown[]) => void;
}> = [];
const origOn = process.on.bind(process);
process.on = ((event: string, fn: (...args: unknown[]) => void) => {
  if (event === "SIGTERM" || event === "SIGINT") {
    signalListeners.push({ event, fn });
  }
  return origOn(event, fn);
}) as typeof process.on;

async function writeTestConfig(): Promise<void> {
  await mkdir(cfgDir, { recursive: true });
  await Bun.write(
    `${cfgDir}/config.toml`,
    serializeConfig({
      account: "TEST",
      password: "TEST",
      character: "Testchar",
      host: "localhost",
      port: 3724,
      language: 1,
      timeout_minutes: 1,
    }) + "\n",
  );
}

async function waitForSetup(): Promise<void> {
  for (let i = 0; i < 100; i++) {
    try {
      await access(`${rtDir}/sock`);
      return;
    } catch {
      await Bun.sleep(1);
    }
  }
  throw new Error("setup never completed");
}

afterEach(async () => {
  exitSpy.mockClear();
  for (const { event, fn } of signalListeners) {
    process.removeListener(event, fn);
  }
  signalListeners.length = 0;
  await rm(tmpDir, { recursive: true, force: true });
});

describe("startDaemon", () => {
  test("creates pid file and socket, cleans up on closed", async () => {
    await writeTestConfig();
    const client = makeMockClient();
    const promise = startDaemon(client);
    await waitForSetup();

    const pidContent = await Bun.file(`${rtDir}/pid`).text();
    expect(pidContent).toBe(String(process.pid));

    closedResolve();
    await promise;

    await Bun.sleep(1);
    expect(await Bun.file(`${rtDir}/pid`).exists()).toBe(false);
  });

  test("idle timeout triggers process.exit", async () => {
    await writeTestConfig();
    const client = makeMockClient();
    const capturedCallbacks: Array<() => void> = [];
    const realSetInterval = globalThis.setInterval;
    const intervalSpy = jest
      .spyOn(globalThis, "setInterval")
      .mockImplementation(
        (fn: (...args: unknown[]) => void, ..._rest: unknown[]) => {
          capturedCallbacks.push(fn as () => void);
          return realSetInterval(() => {}, 999_999) as ReturnType<
            typeof setInterval
          >;
        },
      );

    try {
      const promise = startDaemon(client);
      await waitForSetup();

      expect(capturedCallbacks).toHaveLength(1);

      const origDateNow = Date.now;
      const frozenTime = origDateNow() + 120_000;
      Date.now = () => frozenTime;
      try {
        capturedCallbacks[0]!();
      } finally {
        Date.now = origDateNow;
      }

      expect(exitSpy).toHaveBeenCalledWith(0);

      closedResolve();
      await promise;
    } finally {
      intervalSpy.mockRestore();
    }
  });

  test("cleanup is idempotent", async () => {
    await writeTestConfig();
    const client = makeMockClient();
    const promise = startDaemon(client);
    await waitForSetup();

    closedResolve();
    await promise;

    expect(client.mockHandleClose).toHaveBeenCalledTimes(1);
  });

  test("registers SIGTERM and SIGINT handlers", async () => {
    await writeTestConfig();
    const client = makeMockClient();
    const promise = startDaemon(client);
    await waitForSetup();

    const events = signalListeners.map((l) => l.event);
    expect(events).toContain("SIGTERM");
    expect(events).toContain("SIGINT");

    closedResolve();
    await promise;
  });

  test("updates activity timestamp from IPC activity", async () => {
    await writeTestConfig();
    const client = makeMockClient();
    const promise = startDaemon(client);
    await waitForSetup();

    const lines = await sendToSocket("STATUS", `${rtDir}/sock`);
    expect(lines).toEqual(["CONNECTED"]);

    closedResolve();
    await promise;
  });

  test("cleanup tolerates missing pid file", async () => {
    await writeTestConfig();
    const client = makeMockClient();
    const promise = startDaemon(client);
    await waitForSetup();

    await unlink(`${rtDir}/pid`);
    closedResolve();
    await promise;
    expect(client.mockHandleClose).toHaveBeenCalledTimes(1);
  });

  test("STOP cleans up pid file before exit", async () => {
    await writeTestConfig();
    const client = makeMockClient();
    const promise = startDaemon(client);
    await waitForSetup();

    const lines = await sendToSocket("STOP", `${rtDir}/sock`);
    expect(lines).toEqual(["OK"]);
    expect(exitSpy).toHaveBeenCalledWith(0);

    for (let i = 0; i < 50; i++) {
      if (!(await Bun.file(`${rtDir}/pid`).exists())) break;
      await Bun.sleep(1);
    }
    expect(await Bun.file(`${rtDir}/pid`).exists()).toBe(false);

    closedResolve();
    await promise;
  });
});
