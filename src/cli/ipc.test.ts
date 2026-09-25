import { afterEach, describe, expect, jest, test } from "bun:test";
import { mkdir, rm, unlink, writeFile } from "node:fs/promises";
import { ensureDaemon, sendToSocket } from "cli/ipc";
import { pathsUnder } from "test/temp-paths";

const paths = pathsUnder(`./tmp/cli-ipc-${Date.now()}`);
const rtDir = paths.runtimeDir;
const sockPath = paths.socketPath;

await mkdir(rtDir, { recursive: true });

const origSpawn = Bun.spawn;
const origSleep = Bun.sleep;

let servers: ReturnType<typeof Bun.listen>[] = [];

type FakeProc = { unref(): void; stderr: ReadableStream };

function fakeProc(stderrText = ""): FakeProc {
  return {
    stderr: new ReadableStream({
      start(c) {
        if (stderrText) c.enqueue(new TextEncoder().encode(stderrText));
        c.close();
      },
    }),
    unref() {},
  };
}

function fakeProcWithOpenStderr(): FakeProc {
  return {
    stderr: new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode("bind EADDRINUSE"));
      },
    }),
    unref() {},
  };
}

function fakeProcWithErroredStderr(): FakeProc {
  return {
    stderr: new ReadableStream({
      start(c) {
        c.error(new Error("stderr read failed"));
      },
    }),
    unref() {},
  };
}

function listenStatus(path: string): ReturnType<typeof Bun.listen> {
  const server = Bun.listen({
    socket: {
      data(socket) {
        socket.write("CONNECTED\n\n");
        socket.flush();
      },
    },
    unix: path,
  });
  servers.push(server);
  return server;
}

afterEach(async () => {
  Bun.spawn = origSpawn;
  Bun.sleep = origSleep;
  for (const s of servers) s.stop(true);
  servers = [];
  await rm(sockPath, { force: true, recursive: true });
});

type ClosingSocket = { end(): void };
type ClosingResponse = {
  socket: {
    data(socket: ClosingSocket, data: Uint8Array): void;
    close(): void;
  };
};

async function replyThenClose(reply: string): Promise<string[]> {
  const originalConnect = Bun.connect;
  Bun.connect = jest.fn(async (options: ClosingResponse) => {
    const socket: ClosingSocket = { end() {} };
    if (reply) options.socket.data(socket, Buffer.from(reply));
    options.socket.close();
    return socket;
  }) as unknown as typeof Bun.connect;
  try {
    return await sendToSocket("STATUS", "./tmp/closing.sock");
  } finally {
    Bun.connect = originalConnect;
  }
}

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
      socket: {
        data(socket) {
          socket.write("OK\n\n");
          socket.flush();
        },
      },
      unix: path,
    });
    try {
      const lines = await sendToSocket("SAY hi", path);
      expect(lines).toEqual(["OK"]);
    } finally {
      server.stop(true);
      await unlink(path).catch(() => {});
    }
  });

  test("rejects a partial reply when the socket closes", async () => {
    await expect(replyThenClose("OK\n")).rejects.toThrow();
  });

  test("rejects an empty reply when the socket closes", async () => {
    await expect(replyThenClose("")).rejects.toThrow();
  });

  test("accepts a terminated empty response frame", async () => {
    const path = `./tmp/test-empty-${Date.now()}.sock`;
    const server = Bun.listen({
      socket: {
        data(socket) {
          socket.write("\n");
          socket.flush();
        },
      },
      unix: path,
    });
    try {
      expect(await sendToSocket("READ_JSON", path)).toEqual([]);
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

describe("ensureDaemon", () => {
  test("returns immediately when daemon is already running", async () => {
    listenStatus(sockPath);
    await ensureDaemon(paths);
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

    await ensureDaemon(paths);
    expect(Bun.spawn).toHaveBeenCalled();
  });

  test("continues startup when stale path cannot be unlinked", async () => {
    await mkdir(sockPath, { recursive: true });

    Bun.spawn = jest.fn(() => fakeProc()) as unknown as typeof Bun.spawn;

    let sleepCount = 0;
    Bun.sleep = jest.fn(async () => {
      sleepCount++;
      if (sleepCount === 2) {
        await rm(sockPath, { force: true, recursive: true });
        listenStatus(sockPath);
      }
    }) as unknown as typeof Bun.sleep;

    await ensureDaemon(paths);
    expect(Bun.spawn).toHaveBeenCalled();
  });

  test("throws after timeout when no socket appears", async () => {
    Bun.spawn = jest.fn(() => fakeProc()) as unknown as typeof Bun.spawn;
    Bun.sleep = jest.fn(async () => {}) as unknown as typeof Bun.sleep;

    await expect(ensureDaemon(paths)).rejects.toThrow(
      "Daemon failed to start within 30 seconds",
    );
  });

  test("includes stderr in timeout error", async () => {
    Bun.spawn = jest.fn(() =>
      fakeProc("bind EADDRINUSE"),
    ) as unknown as typeof Bun.spawn;
    Bun.sleep = jest.fn(async () => {}) as unknown as typeof Bun.sleep;

    await expect(ensureDaemon(paths)).rejects.toThrow(
      "Daemon failed to start within 30 seconds:\nbind EADDRINUSE",
    );
  });

  test("times out even when stderr stream stays open", async () => {
    Bun.spawn = jest.fn(() =>
      fakeProcWithOpenStderr(),
    ) as unknown as typeof Bun.spawn;
    Bun.sleep = jest.fn(async () => {}) as unknown as typeof Bun.sleep;

    await expect(ensureDaemon(paths)).rejects.toThrow(
      "Daemon failed to start within 30 seconds:\nbind EADDRINUSE",
    );
  });

  test("times out when stderr stream errors", async () => {
    Bun.spawn = jest.fn(() =>
      fakeProcWithErroredStderr(),
    ) as unknown as typeof Bun.spawn;
    Bun.sleep = jest.fn(async () => {}) as unknown as typeof Bun.sleep;

    await expect(ensureDaemon(paths)).rejects.toThrow(
      "Daemon failed to start within 30 seconds",
    );
  });
});
