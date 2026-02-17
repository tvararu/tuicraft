import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { authHandshake, worldSession } from "client";
import type { AuthResult } from "client";
import { startMockAuthServer } from "test/mock-auth-server";
import { startMockWorldServer } from "test/mock-world-server";
import { PacketWriter } from "protocol/packet";
import { AuthOpcode } from "protocol/opcodes";
import { bigIntToLeBytes } from "crypto/srp";
import {
  FIXTURE_ACCOUNT,
  FIXTURE_PASSWORD,
  FIXTURE_CHARACTER,
  clientPrivateKey,
  clientSeed,
  sessionKey,
  salt,
  g,
  N,
  B_LE,
  M2_bytes,
} from "test/fixtures";

const base = {
  account: FIXTURE_ACCOUNT,
  password: FIXTURE_PASSWORD,
  character: FIXTURE_CHARACTER,
  srpPrivateKey: clientPrivateKey,
  clientSeed,
};

function buildChallengeResponse(): Uint8Array {
  const w = new PacketWriter();
  w.uint8(AuthOpcode.LOGON_CHALLENGE);
  w.uint8(0x00);
  w.uint8(0x00);
  w.rawBytes(B_LE);
  w.uint8(1);
  w.uint8(Number(g));
  w.uint8(32);
  w.rawBytes(bigIntToLeBytes(N, 32));
  w.rawBytes(salt);
  w.rawBytes(new Uint8Array(16));
  w.uint8(0x00);
  return w.finish();
}

function buildSuccessProofResponse(): Uint8Array {
  const w = new PacketWriter();
  w.uint8(AuthOpcode.LOGON_PROOF);
  w.uint8(0x00);
  w.rawBytes(M2_bytes);
  w.uint32LE(0x00800000);
  w.uint32LE(0);
  w.uint16LE(0);
  return w.finish();
}

describe("mock integration", () => {
  let authServer: { port: number; stop(): void };
  let worldServer: { port: number; stop(): void };

  beforeAll(async () => {
    worldServer = await startMockWorldServer();
    authServer = await startMockAuthServer({
      realmAddress: `127.0.0.1:${worldServer.port}`,
    });
  });

  afterAll(() => {
    authServer?.stop();
    worldServer?.stop();
  });

  test("authHandshake completes SRP and returns session key", async () => {
    const auth = await authHandshake({
      ...base,
      host: "127.0.0.1",
      port: authServer.port,
    });

    expect(auth.sessionKey).toEqual(sessionKey);
    expect(auth.realmHost).toBe("127.0.0.1");
    expect(auth.realmPort).toBe(worldServer.port);
    expect(auth.realmId).toBe(1);
  });

  test("full login flow: auth → world → character select → login", async () => {
    const auth = await authHandshake({
      ...base,
      host: "127.0.0.1",
      port: authServer.port,
    });
    const handle = await worldSession(
      { ...base, host: "127.0.0.1", port: worldServer.port },
      auth,
    );

    handle.close();
    await handle.closed;
  });
});

describe("auth error paths", () => {
  test("rejects when challenge status is non-zero", async () => {
    const server = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      socket: {
        data(socket) {
          socket.write(new Uint8Array([0x00, 0x00, 0x05]));
        },
        open() {},
        close() {},
        error() {},
      },
    });

    try {
      await expect(
        authHandshake({ ...base, host: "127.0.0.1", port: server.port }),
      ).rejects.toThrow("Auth challenge failed: status 0x5");
    } finally {
      server.stop(true);
    }
  });

  test("rejects when proof status is non-zero", async () => {
    const server = await startMockAuthServer({
      realmAddress: "127.0.0.1:1234",
    });

    try {
      await expect(
        authHandshake({
          ...base,
          account: "WRONG",
          srpPrivateKey:
            0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefn,
          host: "127.0.0.1",
          port: server.port,
        }),
      ).rejects.toThrow("Auth proof failed: status 0x5");
    } finally {
      server.stop();
    }
  });

  test("rejects when server M2 does not match", async () => {
    const server = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      socket: {
        data(socket, data) {
          const opcode = new Uint8Array(data)[0];
          if (opcode === AuthOpcode.LOGON_CHALLENGE) {
            socket.write(buildChallengeResponse());
          } else if (opcode === AuthOpcode.LOGON_PROOF) {
            const w = new PacketWriter();
            w.uint8(AuthOpcode.LOGON_PROOF);
            w.uint8(0x00);
            w.rawBytes(new Uint8Array(20));
            w.uint32LE(0x00800000);
            w.uint32LE(0);
            w.uint16LE(0);
            socket.write(w.finish());
          }
        },
        open() {},
        close() {},
        error() {},
      },
    });

    try {
      await expect(
        authHandshake({ ...base, host: "127.0.0.1", port: server.port }),
      ).rejects.toThrow("Server M2 mismatch");
    } finally {
      server.stop(true);
    }
  });

  test("handles fragmented challenge response", async () => {
    const challengeData = buildChallengeResponse();
    const splitAt = 50;
    const server = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      socket: {
        data(socket, data) {
          const opcode = new Uint8Array(data)[0];
          if (opcode === AuthOpcode.LOGON_CHALLENGE) {
            socket.write(challengeData.slice(0, splitAt));
            setTimeout(() => socket.write(challengeData.slice(splitAt)), 10);
          } else if (opcode === AuthOpcode.LOGON_PROOF) {
            socket.write(buildSuccessProofResponse());
          } else if (opcode === AuthOpcode.REALM_LIST) {
            const w = new PacketWriter();
            w.uint8(AuthOpcode.REALM_LIST);
            w.uint16LE(8);
            w.uint32LE(0);
            w.uint16LE(0);
            socket.write(w.finish());
          }
        },
        open() {},
        close() {},
        error() {},
      },
    });

    try {
      await expect(
        authHandshake({ ...base, host: "127.0.0.1", port: server.port }),
      ).rejects.toThrow("No realms available");
    } finally {
      server.stop(true);
    }
  });

  test("rejects when no realms are available", async () => {
    const server = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      socket: {
        data(socket, data) {
          const opcode = new Uint8Array(data)[0];
          if (opcode === AuthOpcode.LOGON_CHALLENGE) {
            socket.write(buildChallengeResponse());
          } else if (opcode === AuthOpcode.LOGON_PROOF) {
            socket.write(buildSuccessProofResponse());
          } else if (opcode === AuthOpcode.REALM_LIST) {
            const w = new PacketWriter();
            w.uint8(AuthOpcode.REALM_LIST);
            w.uint16LE(8);
            w.uint32LE(0);
            w.uint16LE(0);
            socket.write(w.finish());
          }
        },
        open() {},
        close() {},
        error() {},
      },
    });

    try {
      await expect(
        authHandshake({ ...base, host: "127.0.0.1", port: server.port }),
      ).rejects.toThrow("No realms available");
    } finally {
      server.stop(true);
    }
  });
});

describe("world error paths", () => {
  function fakeAuth(port: number): AuthResult {
    return {
      sessionKey,
      realmHost: "127.0.0.1",
      realmPort: port,
      realmId: 1,
    };
  }

  test("handles SMSG_TIME_SYNC_REQ", async () => {
    const ws = await startMockWorldServer({ sendTimeSyncAfterLogin: true });
    try {
      const handle = await worldSession(
        { ...base, host: "127.0.0.1", port: ws.port },
        fakeAuth(ws.port),
      );
      await Bun.sleep(50);
      handle.close();
      await handle.closed;
    } finally {
      ws.stop();
    }
  });

  test("rejects when world auth status is not 0x0c", async () => {
    const ws = await startMockWorldServer({ authStatus: 0x01 });
    try {
      await expect(
        worldSession(
          { ...base, host: "127.0.0.1", port: ws.port },
          fakeAuth(ws.port),
        ),
      ).rejects.toThrow("World auth failed: status 0x1");
    } finally {
      ws.stop();
    }
  });

  test("rejects when character is not found", async () => {
    const ws = await startMockWorldServer();
    try {
      await expect(
        worldSession(
          {
            ...base,
            character: "Nonexistent",
            host: "127.0.0.1",
            port: ws.port,
          },
          fakeAuth(ws.port),
        ),
      ).rejects.toThrow('Character "Nonexistent" not found');
    } finally {
      ws.stop();
    }
  });

  test("ping interval fires and server handles CMSG_PING", async () => {
    const ws = await startMockWorldServer();
    try {
      const handle = await worldSession(
        { ...base, host: "127.0.0.1", port: ws.port, pingIntervalMs: 50 },
        fakeAuth(ws.port),
      );
      await Bun.sleep(120);
      handle.close();
      await handle.closed;
    } finally {
      ws.stop();
    }
  });
});
