import { mock, jest, test, expect, describe, afterEach } from "bun:test";
import { mkdir, rm, unlink, writeFile } from "node:fs/promises";

const tmpDir = `./tmp/cli-daemon-${Date.now()}`;
const uid = process.getuid?.() ?? 0;
const rtDir = `${tmpDir}/tuicraft-${uid}`;
const sockPath = `${rtDir}/sock`;

mock.module("paths", () => ({
  configDir: () => `${tmpDir}/config/tuicraft`,
  runtimeDir: () => rtDir,
  stateDir: () => `${tmpDir}/state/tuicraft`,
  socketPath: () => sockPath,
  pidPath: () => `${rtDir}/pid`,
  configPath: () => `${tmpDir}/config/tuicraft/config.toml`,
  logPath: () => `${tmpDir}/state/tuicraft/session.log`,
}));

await mkdir(rtDir, { recursive: true });

const { ensureDaemon } = await import("cli");

const origSpawn = Bun.spawn;
const origSleep = Bun.sleep;

let servers: ReturnType<typeof Bun.listen>[] = [];

type FakeProc = { unref(): void; stderr: ReadableStream };

function fakeProc(stderrText = ""): FakeProc {
  return {
    unref() {},
    stderr: new ReadableStream({
      start(c) {
        if (stderrText) c.enqueue(new TextEncoder().encode(stderrText));
        c.close();
      },
    }),
  };
}

function listenStatus(path: string): ReturnType<typeof Bun.listen> {
  const server = Bun.listen({
    unix: path,
    socket: {
      data(socket) {
        socket.write("CONNECTED\n\n");
        socket.flush();
      },
    },
  });
  servers.push(server);
  return server;
}

afterEach(async () => {
  Bun.spawn = origSpawn;
  Bun.sleep = origSleep;
  for (const s of servers) s.stop(true);
  servers = [];
  await rm(sockPath, { recursive: true, force: true });
});

describe("ensureDaemon", () => {
  test("returns immediately when daemon is already running", async () => {
    listenStatus(sockPath);
    await ensureDaemon();
  });

  test("cleans up stale socket and polls until new socket appears", async () => {
    await writeFile(sockPath, "");

    Bun.spawn = jest.fn(() => fakeProc()) as unknown as typeof Bun.spawn;

    let sleepCount = 0;
    Bun.sleep = jest.fn(async () => {
      sleepCount++;
      if (sleepCount === 3) {
        await unlink(sockPath).catch(() => {});
        listenStatus(sockPath);
      }
    }) as unknown as typeof Bun.sleep;

    await ensureDaemon();
    expect(Bun.spawn).toHaveBeenCalled();
  });

  test("continues startup when stale path cannot be unlinked", async () => {
    await mkdir(sockPath, { recursive: true });

    Bun.spawn = jest.fn(() => fakeProc()) as unknown as typeof Bun.spawn;

    let sleepCount = 0;
    Bun.sleep = jest.fn(async () => {
      sleepCount++;
      if (sleepCount === 2) {
        await rm(sockPath, { recursive: true, force: true });
        listenStatus(sockPath);
      }
    }) as unknown as typeof Bun.sleep;

    await ensureDaemon();
    expect(Bun.spawn).toHaveBeenCalled();
  });

  test("throws after timeout when no socket appears", async () => {
    Bun.spawn = jest.fn(() => fakeProc()) as unknown as typeof Bun.spawn;
    Bun.sleep = jest.fn(async () => {}) as unknown as typeof Bun.sleep;

    await expect(ensureDaemon()).rejects.toThrow(
      "Daemon failed to start within 30 seconds",
    );
  });

  test("includes stderr in timeout error", async () => {
    Bun.spawn = jest.fn(() =>
      fakeProc("bind EADDRINUSE"),
    ) as unknown as typeof Bun.spawn;
    Bun.sleep = jest.fn(async () => {}) as unknown as typeof Bun.sleep;

    await expect(ensureDaemon()).rejects.toThrow(
      "Daemon failed to start within 30 seconds:\nbind EADDRINUSE",
    );
  });
});
