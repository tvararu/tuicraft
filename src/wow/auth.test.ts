import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { authHandshake, authWithRetry, ReconnectRequiredError } from "wow/auth";
import { startMockAuthServer } from "test/mock-auth-server";
import { startMockWorldServer } from "test/mock-world-server";
import { PacketWriter } from "wow/protocol/packet";
import { AuthOpcode } from "wow/protocol/opcodes";
import { bigIntToLeBytes } from "wow/crypto/srp";
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
  reconnectChallengeData,
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
            setTimeout(() => socket.write(challengeData.slice(splitAt)), 0);
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

  test("reconnect challenge succeeds with cached session key", async () => {
    const authServer = await startMockAuthServer({
      realmAddress: "127.0.0.1:1234",
      reconnect: {
        challengeData: reconnectChallengeData,
        sessionKey,
      },
    });

    try {
      const auth = await authHandshake({
        ...base,
        host: "127.0.0.1",
        port: authServer.port,
        cachedSessionKey: sessionKey,
      });

      expect(auth.sessionKey).toEqual(sessionKey);
      expect(auth.realmHost).toBe("127.0.0.1");
      expect(auth.realmPort).toBe(1234);
    } finally {
      authServer.stop();
    }
  });

  test("rejects when reconnect challenge status is non-zero", async () => {
    const server = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      socket: {
        data(socket) {
          const w = new PacketWriter();
          w.uint8(AuthOpcode.RECONNECT_CHALLENGE);
          w.uint8(0x04);
          socket.write(w.finish());
        },
        open() {},
        close() {},
        error() {},
      },
    });

    try {
      await expect(
        authHandshake({
          ...base,
          host: "127.0.0.1",
          port: server.port,
          cachedSessionKey: sessionKey,
        }),
      ).rejects.toThrow("Reconnect challenge failed: status 0x4");
    } finally {
      server.stop(true);
    }
  });

  test("rejects when reconnect proof status is non-zero", async () => {
    const server = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      socket: {
        data(socket, data) {
          const opcode = new Uint8Array(data)[0];
          if (opcode === AuthOpcode.LOGON_CHALLENGE) {
            const w = new PacketWriter();
            w.uint8(AuthOpcode.RECONNECT_CHALLENGE);
            w.uint8(0x00);
            w.rawBytes(reconnectChallengeData);
            w.rawBytes(new Uint8Array(16));
            socket.write(w.finish());
          } else if (opcode === AuthOpcode.RECONNECT_PROOF) {
            const w = new PacketWriter();
            w.uint8(AuthOpcode.RECONNECT_PROOF);
            w.uint8(0x0b);
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
        authHandshake({
          ...base,
          host: "127.0.0.1",
          port: server.port,
          cachedSessionKey: sessionKey,
        }),
      ).rejects.toThrow("Reconnect proof failed: status 0xb");
    } finally {
      server.stop(true);
    }
  });

  test("reconnect challenge without cached key throws ReconnectRequiredError", async () => {
    const authServer = await startMockAuthServer({
      realmAddress: "127.0.0.1:1234",
      reconnect: {
        challengeData: reconnectChallengeData,
        sessionKey,
      },
    });

    try {
      await expect(
        authHandshake({ ...base, host: "127.0.0.1", port: authServer.port }),
      ).rejects.toThrow(ReconnectRequiredError);
    } finally {
      authServer.stop();
    }
  });

  test("authWithRetry succeeds on first attempt with cached key", async () => {
    const authServer = await startMockAuthServer({
      realmAddress: "127.0.0.1:1234",
      reconnect: {
        challengeData: reconnectChallengeData,
        sessionKey,
      },
    });

    try {
      const auth = await authWithRetry(
        {
          ...base,
          host: "127.0.0.1",
          port: authServer.port,
          cachedSessionKey: sessionKey,
        },
        { maxAttempts: 3, baseDelayMs: 1 },
      );

      expect(auth.sessionKey).toEqual(sessionKey);
    } finally {
      authServer.stop();
    }
  });

  test("authWithRetry gives up after maxAttempts", async () => {
    const authServer = await startMockAuthServer({
      realmAddress: "127.0.0.1:1234",
      reconnect: {
        challengeData: reconnectChallengeData,
        sessionKey,
      },
    });

    try {
      await expect(
        authWithRetry(
          { ...base, host: "127.0.0.1", port: authServer.port },
          { maxAttempts: 2, baseDelayMs: 1 },
        ),
      ).rejects.toThrow(ReconnectRequiredError);
    } finally {
      authServer.stop();
    }
  });

  test("authWithRetry propagates non-reconnect errors immediately", async () => {
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
        authWithRetry(
          { ...base, host: "127.0.0.1", port: server.port },
          { maxAttempts: 3, baseDelayMs: 1 },
        ),
      ).rejects.toThrow("Auth challenge failed: status 0x5");
    } finally {
      server.stop(true);
    }
  });
});
