import { mock, jest, test, expect, describe, afterEach } from "bun:test";
import { writeFile, mkdir, rm, unlink } from "node:fs/promises";

const tmpDir = `./tmp/cli-ipc-${Date.now()}`;
const uid = process.getuid?.() ?? 0;
const rtDir = `${tmpDir}/tuicraft-${uid}`;
const sockPath = `${rtDir}/sock`;

mock.module("lib/paths", () => ({
  configDir: () => `${tmpDir}/config/tuicraft`,
  runtimeDir: () => rtDir,
  stateDir: () => `${tmpDir}/state/tuicraft`,
  socketPath: () => sockPath,
  pidPath: () => `${rtDir}/pid`,
  configPath: () => `${tmpDir}/config/tuicraft/config.toml`,
  logPath: () => `${tmpDir}/state/tuicraft/session.log`,
}));

await mkdir(rtDir, { recursive: true });

const { sendToSocket, ensureDaemon, streamFromSocket } =
  await import("cli/ipc");

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

function fakeProcWithOpenStderr(): FakeProc {
  return {
    unref() {},
    stderr: new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode("bind EADDRINUSE"));
      },
    }),
  };
}

function fakeProcWithErroredStderr(): FakeProc {
  return {
    unref() {},
    stderr: new ReadableStream({
      start(c) {
        c.error(new Error("stderr read failed"));
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

describe("sendToSocket", () => {
  test("rejects on stale socket file", async () => {
    const path = `./tmp/stale-sock-${Date.now()}.sock`;
    await writeFile(path, "");
    try {
      await expect(sendToSocket("STATUS", path)).rejects.toThrow();
    } finally {
      await unlink(path).catch(() => {});
    }
  });

  test("resolves on terminator without waiting for close", async () => {
    const path = `./tmp/test-terminator-${Date.now()}.sock`;
    const server = Bun.listen({
      unix: path,
      socket: {
        data(socket) {
          socket.write("OK\n\n");
          socket.flush();
        },
      },
    });
    try {
      const lines = await sendToSocket("SAY hi", path);
      expect(lines).toEqual(["OK"]);
    } finally {
      server.stop(true);
      await unlink(path).catch(() => {});
    }
  });

  test("resolves buffered lines on socket close without terminator", async () => {
    const path = `./tmp/test-close-${Date.now()}.sock`;
    const server = Bun.listen({
      unix: path,
      socket: {
        data(socket) {
          socket.write("OK\n");
          socket.end();
        },
      },
    });
    try {
      const lines = await sendToSocket("STATUS", path);
      expect(lines).toEqual(["OK"]);
    } finally {
      server.stop(true);
      await unlink(path).catch(() => {});
    }
  });

  test("rejects when socket error callback fires", async () => {
    const originalConnect = Bun.connect;
    Bun.connect = jest.fn(async (options: any) => {
      options.socket.error({}, new Error("connect boom"));
      return {} as any;
    }) as unknown as typeof Bun.connect;
    try {
      await expect(
        sendToSocket("STATUS", "./tmp/missing.sock"),
      ).rejects.toThrow("connect boom");
    } finally {
      Bun.connect = originalConnect;
    }
  });
});

describe("streamFromSocket", () => {
  test("sends command once and emits streamed lines", async () => {
    const path = `./tmp/test-stream-${Date.now()}.sock`;
    let command = "";
    const server = Bun.listen({
      unix: path,
      socket: {
        data(socket, data) {
          command += Buffer.from(data).toString();
          socket.write("one\n");
          socket.write("two\n");
          socket.flush();
        },
      },
    });
    try {
      const lines: string[] = [];
      const stream = await streamFromSocket(
        "SUBSCRIBE",
        (line) => lines.push(line),
        path,
      );
      await Bun.sleep(1);
      expect(command).toBe("SUBSCRIBE\n");
      expect(lines).toEqual(["one", "two"]);
      stream.close();
      await stream.closed;
    } finally {
      server.stop(true);
      await unlink(path).catch(() => {});
    }
  });

  test("close ends the stream and resolves closed", async () => {
    const path = `./tmp/test-stream-close-${Date.now()}.sock`;
    const server = Bun.listen({
      unix: path,
      socket: {
        data() {},
      },
    });
    try {
      const stream = await streamFromSocket("SUBSCRIBE", () => {}, path);
      stream.close();
      await expect(stream.closed).resolves.toBeUndefined();
    } finally {
      server.stop(true);
      await unlink(path).catch(() => {});
    }
  });
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

  test("times out even when stderr stream stays open", async () => {
    Bun.spawn = jest.fn(() =>
      fakeProcWithOpenStderr(),
    ) as unknown as typeof Bun.spawn;
    Bun.sleep = jest.fn(async () => {}) as unknown as typeof Bun.sleep;

    await expect(ensureDaemon()).rejects.toThrow(
      "Daemon failed to start within 30 seconds:\nbind EADDRINUSE",
    );
  });

  test("times out when stderr stream errors", async () => {
    Bun.spawn = jest.fn(() =>
      fakeProcWithErroredStderr(),
    ) as unknown as typeof Bun.spawn;
    Bun.sleep = jest.fn(async () => {}) as unknown as typeof Bun.sleep;

    await expect(ensureDaemon()).rejects.toThrow(
      "Daemon failed to start within 30 seconds",
    );
  });
});
