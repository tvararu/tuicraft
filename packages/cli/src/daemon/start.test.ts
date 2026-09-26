import { afterEach, describe, expect, jest, test } from "bun:test";
import { access, mkdir, rm, unlink } from "node:fs/promises";
import type { AuthResult, WorldHandle } from "@tuicraft/core";
import { serializeConfig } from "@tuicraft/core/lib/config";
import { createMockHandle } from "@tuicraft/core/test-support/mock-handle";
import { must } from "@tuicraft/core/test-support/must";
import { pathsUnder } from "@tuicraft/core/test-support/temp-paths";
import { sendToSocket } from "#cli/ipc";
import { startDaemon } from "#daemon/server";

const tmpDir = `./tmp/daemon-start-${Date.now()}`;
const paths = pathsUnder(tmpDir);
const cfgDir = paths.configDir;
const rtDir = paths.runtimeDir;

let closedResolve: () => void;

function makeMockClient(): {
  authHandshake: ReturnType<typeof jest.fn>;
  worldSession: ReturnType<typeof jest.fn>;
  mockHandleLogout: ReturnType<typeof jest.fn>;
} {
  const mockHandleLogout = jest.fn();
  const closed = new Promise<void>((r) => {
    closedResolve = r;
  });
  return {
    authHandshake: jest.fn(
      async (): Promise<AuthResult> => ({
        realmHost: "localhost",
        realmId: 1,
        realmPort: 8085,
        sessionKey: new Uint8Array(40),
      }),
    ),
    mockHandleLogout,
    worldSession: jest.fn(
      async (): Promise<WorldHandle> => ({
        ...createMockHandle(),
        closed,
        logout: mockHandleLogout,
      }),
    ),
  };
}

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
    `${serializeConfig({
      account: "TEST",
      character: "Testchar",
      host: "localhost",
      language: 1,
      password: "TEST",
      port: 3724,
      timeout_minutes: 1,
    })}\n`,
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
  await rm(tmpDir, { force: true, recursive: true });
});

describe("startDaemon", () => {
  test("creates pid file and socket, cleans up on closed", async () => {
    await writeTestConfig();
    const client = makeMockClient();
    const promise = startDaemon(client, paths);
    await waitForSetup();

    const pidContent = await Bun.file(`${rtDir}/pid`).text();
    expect(pidContent).toBe(String(process.pid));

    closedResolve();
    await promise;

    await Bun.sleep(1);
    expect(await Bun.file(`${rtDir}/pid`).exists()).toBe(false);
  });

  test("idle timeout logs out, then exits once the session closes", async () => {
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
      const promise = startDaemon(client, paths);
      await waitForSetup();

      expect(capturedCallbacks).toHaveLength(1);

      const origDateNow = Date.now;
      const frozenTime = origDateNow() + 120_000;
      Date.now = () => frozenTime;
      try {
        must(capturedCallbacks[0])();
      } finally {
        Date.now = origDateNow;
      }

      expect(client.mockHandleLogout).toHaveBeenCalledTimes(1);
      expect(exitSpy).not.toHaveBeenCalled();

      closedResolve();
      await promise;
      expect(exitSpy).toHaveBeenCalledWith(0);
    } finally {
      intervalSpy.mockRestore();
    }
  });

  test("cleanup is idempotent", async () => {
    await writeTestConfig();
    const client = makeMockClient();
    const promise = startDaemon(client, paths);
    await waitForSetup();

    closedResolve();
    await promise;

    expect(client.mockHandleLogout).toHaveBeenCalledTimes(1);
  });

  test("registers SIGTERM and SIGINT handlers", async () => {
    await writeTestConfig();
    const client = makeMockClient();
    const promise = startDaemon(client, paths);
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
    const promise = startDaemon(client, paths);
    await waitForSetup();

    const lines = await sendToSocket("STATUS", `${rtDir}/sock`);
    expect(lines).toEqual(["CONNECTED"]);

    closedResolve();
    await promise;
  });

  test("cleanup tolerates missing pid file", async () => {
    await writeTestConfig();
    const client = makeMockClient();
    const promise = startDaemon(client, paths);
    await waitForSetup();

    await unlink(`${rtDir}/pid`);
    closedResolve();
    await promise;
    expect(client.mockHandleLogout).toHaveBeenCalledTimes(1);
  });

  test("STOP logs out and exits only after the session closes", async () => {
    await writeTestConfig();
    const client = makeMockClient();
    const promise = startDaemon(client, paths);
    await waitForSetup();

    const lines = await sendToSocket("STOP", `${rtDir}/sock`);
    expect(lines).toEqual(["OK"]);
    expect(client.mockHandleLogout).toHaveBeenCalledTimes(1);

    for (let i = 0; i < 50; i++) {
      if (!(await Bun.file(`${rtDir}/pid`).exists())) break;
      await Bun.sleep(1);
    }
    expect(await Bun.file(`${rtDir}/pid`).exists()).toBe(false);

    expect(exitSpy).not.toHaveBeenCalled();

    closedResolve();
    await promise;
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  test("HALT does not disconnect the daemon", async () => {
    await writeTestConfig();
    const client = makeMockClient();
    const promise = startDaemon(client, paths);
    await waitForSetup();

    const haltLines = await sendToSocket("HALT", `${rtDir}/sock`);
    expect(haltLines).toEqual(["OK"]);
    expect(exitSpy).not.toHaveBeenCalled();

    const status = await sendToSocket("STATUS", `${rtDir}/sock`);
    expect(status).toEqual(["CONNECTED"]);

    closedResolve();
    await promise;
  });
});
