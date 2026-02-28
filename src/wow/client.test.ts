import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { deflateSync } from "node:zlib";
import {
  authHandshake,
  authWithRetry,
  worldSession,
  ReconnectRequiredError,
  type ChatMessage,
  type GroupEvent,
  type WorldHandle,
  type FriendEvent,
} from "wow/client";
import type { AuthResult } from "wow/client";
import { startMockAuthServer } from "test/mock-auth-server";
import { startMockWorldServer } from "test/mock-world-server";
import { PacketWriter, PacketReader } from "wow/protocol/packet";
import {
  AuthOpcode,
  GameOpcode,
  ChatType,
  ChannelNotify,
  PartyOperation,
  PartyResult,
  GroupUpdateFlag,
} from "wow/protocol/opcodes";
import { bigIntToLeBytes } from "wow/crypto/srp";
import type { EntityEvent } from "wow/entity-store";
import {
  UpdateFlag,
  OBJECT_FIELDS,
  UNIT_FIELDS,
  GAMEOBJECT_FIELDS,
} from "wow/protocol/entity-fields";
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

async function waitForEchoProbe(
  handle: Pick<WorldHandle, "onMessage" | "sendSay">,
): Promise<void> {
  const received = new Promise<ChatMessage>((resolve) => {
    handle.onMessage(resolve);
  });
  handle.sendSay("probe");
  await received;
}

function waitForGroupEvents(
  handle: Pick<WorldHandle, "onGroupEvent">,
  count: number,
): Promise<GroupEvent[]> {
  const events: GroupEvent[] = [];
  return new Promise((resolve) => {
    handle.onGroupEvent((event) => {
      events.push(event);
      if (events.length === count) resolve(events);
    });
  });
}

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
      await waitForEchoProbe(handle);
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

  test("rejects with named message for system error (0x0d)", async () => {
    const ws = await startMockWorldServer({ authStatus: 0x0d });
    try {
      await expect(
        worldSession(
          { ...base, host: "127.0.0.1", port: ws.port },
          fakeAuth(ws.port),
        ),
      ).rejects.toThrow("World auth failed: system error");
    } finally {
      ws.stop();
    }
  });

  test("rejects with named message for account in use (0x15)", async () => {
    const ws = await startMockWorldServer({ authStatus: 0x15 });
    try {
      await expect(
        worldSession(
          { ...base, host: "127.0.0.1", port: ws.port },
          fakeAuth(ws.port),
        ),
      ).rejects.toThrow("World auth failed: account in use");
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
        { ...base, host: "127.0.0.1", port: ws.port, pingIntervalMs: 1 },
        fakeAuth(ws.port),
      );
      await Bun.sleep(2);
      handle.close();
      await handle.closed;
    } finally {
      ws.stop();
    }
  });

  test("sendWhisper with empty target does not poison sticky mode", async () => {
    const ws = await startMockWorldServer();
    try {
      const handle = await worldSession(
        { ...base, host: "127.0.0.1", port: ws.port },
        fakeAuth(ws.port),
      );
      handle.sendWhisper("", "");
      expect(handle.getLastChatMode()).toEqual({ type: "say" });
      handle.close();
      await handle.closed;
    } finally {
      ws.stop();
    }
  });

  test("sendWhisper sends message and receives echo", async () => {
    const ws = await startMockWorldServer();
    try {
      const handle = await worldSession(
        { ...base, host: "127.0.0.1", port: ws.port },
        fakeAuth(ws.port),
      );

      const messageReceived = new Promise<ChatMessage>((resolve) => {
        handle.onMessage(resolve);
      });

      handle.sendWhisper("Someone", "test whisper");
      const msg = await messageReceived;

      expect(msg.message).toBe("test whisper");

      handle.close();
      await handle.closed;
    } finally {
      ws.stop();
    }
  });

  test("channel tracking populates from SMSG_CHANNEL_NOTIFY", async () => {
    const ws = await startMockWorldServer();
    try {
      const handle = await worldSession(
        { ...base, host: "127.0.0.1", port: ws.port },
        fakeAuth(ws.port),
      );

      await waitForEchoProbe(handle);

      expect(handle.getChannel(1)).toBe("General");
      expect(handle.getChannel(2)).toBe("Trade");
      expect(handle.getChannel(3)).toBeUndefined();

      handle.close();
      await handle.closed;
    } finally {
      ws.stop();
    }
  });

  test("who returns results from mock server", async () => {
    const ws = await startMockWorldServer();
    try {
      const handle = await worldSession(
        { ...base, host: "127.0.0.1", port: ws.port },
        fakeAuth(ws.port),
      );

      const results = await handle.who({});
      expect(results.length).toBe(1);
      expect(results[0]!.name).toBe(FIXTURE_CHARACTER);

      handle.close();
      await handle.closed;
    } finally {
      ws.stop();
    }
  });

  test("sendSay sends message and receives echo", async () => {
    const ws = await startMockWorldServer();
    try {
      const handle = await worldSession(
        { ...base, host: "127.0.0.1", port: ws.port },
        fakeAuth(ws.port),
      );
      const received = new Promise<ChatMessage>((r) => handle.onMessage(r));
      handle.sendSay("test say");
      const msg = await received;
      expect(msg.type).toBe(ChatType.SAY);
      expect(msg.message).toBe("test say");
      handle.close();
      await handle.closed;
    } finally {
      ws.stop();
    }
  });

  test("sendYell sends message and receives echo", async () => {
    const ws = await startMockWorldServer();
    try {
      const handle = await worldSession(
        { ...base, host: "127.0.0.1", port: ws.port },
        fakeAuth(ws.port),
      );
      const received = new Promise<ChatMessage>((r) => handle.onMessage(r));
      handle.sendYell("test yell");
      const msg = await received;
      expect(msg.type).toBe(ChatType.YELL);
      expect(msg.message).toBe("test yell");
      handle.close();
      await handle.closed;
    } finally {
      ws.stop();
    }
  });

  test("sendGuild sends message and receives echo", async () => {
    const ws = await startMockWorldServer();
    try {
      const handle = await worldSession(
        { ...base, host: "127.0.0.1", port: ws.port },
        fakeAuth(ws.port),
      );
      const received = new Promise<ChatMessage>((r) => handle.onMessage(r));
      handle.sendGuild("test guild");
      const msg = await received;
      expect(msg.type).toBe(ChatType.GUILD);
      expect(msg.message).toBe("test guild");
      handle.close();
      await handle.closed;
    } finally {
      ws.stop();
    }
  });

  test("sendParty sends message and receives echo", async () => {
    const ws = await startMockWorldServer();
    try {
      const handle = await worldSession(
        { ...base, host: "127.0.0.1", port: ws.port },
        fakeAuth(ws.port),
      );
      const received = new Promise<ChatMessage>((r) => handle.onMessage(r));
      handle.sendParty("test party");
      const msg = await received;
      expect(msg.type).toBe(ChatType.PARTY);
      expect(msg.message).toBe("test party");
      handle.close();
      await handle.closed;
    } finally {
      ws.stop();
    }
  });

  test("sendRaid sends message and receives echo", async () => {
    const ws = await startMockWorldServer();
    try {
      const handle = await worldSession(
        { ...base, host: "127.0.0.1", port: ws.port },
        fakeAuth(ws.port),
      );
      const received = new Promise<ChatMessage>((r) => handle.onMessage(r));
      handle.sendRaid("test raid");
      const msg = await received;
      expect(msg.type).toBe(ChatType.RAID);
      expect(msg.message).toBe("test raid");
      handle.close();
      await handle.closed;
    } finally {
      ws.stop();
    }
  });

  test("sendChannel sends message and receives echo", async () => {
    const ws = await startMockWorldServer();
    try {
      const handle = await worldSession(
        { ...base, host: "127.0.0.1", port: ws.port },
        fakeAuth(ws.port),
      );
      const received = new Promise<ChatMessage>((r) => handle.onMessage(r));
      handle.sendChannel("General", "test channel");
      const msg = await received;
      expect(msg.type).toBe(ChatType.CHANNEL);
      expect(msg.message).toBe("test channel");
      expect(msg.channel).toBe("General");
      handle.close();
      await handle.closed;
    } finally {
      ws.stop();
    }
  });

  test("cached sender name skips name query on second message", async () => {
    const ws = await startMockWorldServer();
    try {
      const handle = await worldSession(
        { ...base, host: "127.0.0.1", port: ws.port },
        fakeAuth(ws.port),
      );

      const first = new Promise<ChatMessage>((r) => handle.onMessage(r));
      handle.sendSay("first");
      await first;

      const second = new Promise<ChatMessage>((r) => handle.onMessage(r));
      handle.sendSay("second");
      const msg = await second;
      expect(msg.sender).toBe(FIXTURE_CHARACTER);
      expect(msg.message).toBe("second");

      handle.close();
      await handle.closed;
    } finally {
      ws.stop();
    }
  });

  test("multiple pending messages for same guid", async () => {
    const ws = await startMockWorldServer();
    try {
      const handle = await worldSession(
        { ...base, host: "127.0.0.1", port: ws.port },
        fakeAuth(ws.port),
      );

      const messages: ChatMessage[] = [];
      const gotTwo = new Promise<void>((resolve) => {
        handle.onMessage((msg) => {
          messages.push(msg);
          if (messages.length === 2) resolve();
        });
      });

      handle.sendSay("msg1");
      handle.sendSay("msg2");
      await gotTwo;

      expect(messages[0]!.message).toBe("msg1");
      expect(messages[1]!.message).toBe("msg2");

      handle.close();
      await handle.closed;
    } finally {
      ws.stop();
    }
  });

  test("zero-guid system message delivers with empty sender", async () => {
    const ws = await startMockWorldServer();
    try {
      const handle = await worldSession(
        { ...base, host: "127.0.0.1", port: ws.port },
        fakeAuth(ws.port),
      );

      const received = new Promise<ChatMessage>((r) => handle.onMessage(r));

      const w = new PacketWriter();
      w.uint8(ChatType.SYSTEM);
      w.uint32LE(0);
      w.uint32LE(0);
      w.uint32LE(0);
      w.uint32LE(0);
      w.uint32LE(0);
      w.uint32LE(0);
      const msgBytes = new TextEncoder().encode("Server shutting down");
      w.uint32LE(msgBytes.byteLength);
      w.rawBytes(msgBytes);
      w.uint8(0);
      ws.inject(GameOpcode.SMSG_MESSAGE_CHAT, w.finish());

      const msg = await received;
      expect(msg.sender).toBe("");
      expect(msg.message).toBe("Server shutting down");

      handle.close();
      await handle.closed;
    } finally {
      ws.stop();
    }
  });

  test("GM chat message delivers with sender name from packet", async () => {
    const ws = await startMockWorldServer();
    try {
      const handle = await worldSession(
        { ...base, host: "127.0.0.1", port: ws.port },
        fakeAuth(ws.port),
      );

      const received = new Promise<ChatMessage>((r) => handle.onMessage(r));

      const w = new PacketWriter();
      w.uint8(ChatType.SAY);
      w.uint32LE(0);
      w.uint32LE(0x42);
      w.uint32LE(0x00);
      w.uint32LE(0);
      const nameBytes = new TextEncoder().encode("GameMaster");
      w.uint32LE(nameBytes.byteLength);
      w.rawBytes(nameBytes);
      w.uint32LE(0x42);
      w.uint32LE(0x00);
      const msgBytes = new TextEncoder().encode("hello from gm");
      w.uint32LE(msgBytes.byteLength);
      w.rawBytes(msgBytes);
      w.uint8(0);
      ws.inject(GameOpcode.SMSG_GM_MESSAGECHAT, w.finish());

      const msg = await received;
      expect(msg.sender).toBe("GameMaster");
      expect(msg.message).toBe("hello from gm");

      handle.close();
      await handle.closed;
    } finally {
      ws.stop();
    }
  });

  test("player not found delivers system message", async () => {
    const ws = await startMockWorldServer();
    try {
      const handle = await worldSession(
        { ...base, host: "127.0.0.1", port: ws.port },
        fakeAuth(ws.port),
      );

      const received = new Promise<ChatMessage>((r) => handle.onMessage(r));

      const w = new PacketWriter();
      w.cString("Ghostplayer");
      ws.inject(GameOpcode.SMSG_CHAT_PLAYER_NOT_FOUND, w.finish());

      const msg = await received;
      expect(msg.type).toBe(ChatType.SYSTEM);
      expect(msg.message).toBe(
        'No player named "Ghostplayer" is currently playing.',
      );

      handle.close();
      await handle.closed;
    } finally {
      ws.stop();
    }
  });

  test("SMSG_MOTD delivers each line as a system message", async () => {
    const ws = await startMockWorldServer();
    try {
      const handle = await worldSession(
        { ...base, host: "127.0.0.1", port: ws.port },
        fakeAuth(ws.port),
      );

      const received = new Promise<ChatMessage>((r) => handle.onMessage(r));

      const w = new PacketWriter();
      w.uint32LE(2);
      w.cString("Welcome to the server!");
      w.cString("Enjoy your stay.");
      ws.inject(GameOpcode.SMSG_MOTD, w.finish());

      const msg = await received;
      expect(msg.type).toBe(ChatType.SYSTEM);
      expect(msg.message).toBe("Welcome to the server!\nEnjoy your stay.");

      handle.close();
      await handle.closed;
    } finally {
      ws.stop();
    }
  });

  test("channel left removes from channel list", async () => {
    const ws = await startMockWorldServer();
    try {
      const handle = await worldSession(
        { ...base, host: "127.0.0.1", port: ws.port },
        fakeAuth(ws.port),
      );

      await waitForEchoProbe(handle);
      expect(handle.getChannel(1)).toBe("General");

      const w = new PacketWriter();
      w.uint8(ChannelNotify.YOU_LEFT);
      w.cString("General");
      w.uint32LE(0);
      w.uint8(0);
      ws.inject(GameOpcode.SMSG_CHANNEL_NOTIFY, w.finish());

      await waitForEchoProbe(handle);
      expect(handle.getChannel(1)).toBe("Trade");

      handle.close();
      await handle.closed;
    } finally {
      ws.stop();
    }
  });

  test("getLastChatMode defaults to say", async () => {
    const ws = await startMockWorldServer();
    try {
      const handle = await worldSession(
        { ...base, host: "127.0.0.1", port: ws.port },
        fakeAuth(ws.port),
      );
      expect(handle.getLastChatMode()).toEqual({ type: "say" });
      handle.close();
      await handle.closed;
    } finally {
      ws.stop();
    }
  });

  test("setLastChatMode updates mode", async () => {
    const ws = await startMockWorldServer();
    try {
      const handle = await worldSession(
        { ...base, host: "127.0.0.1", port: ws.port },
        fakeAuth(ws.port),
      );
      handle.setLastChatMode({ type: "guild" });
      expect(handle.getLastChatMode()).toEqual({ type: "guild" });
      handle.close();
      await handle.closed;
    } finally {
      ws.stop();
    }
  });

  test("sendInCurrentMode dispatches based on last mode", async () => {
    const ws = await startMockWorldServer();
    try {
      const handle = await worldSession(
        { ...base, host: "127.0.0.1", port: ws.port },
        fakeAuth(ws.port),
      );
      const received = new Promise<ChatMessage>((r) => handle.onMessage(r));
      handle.sendInCurrentMode("hello via say");
      const msg = await received;
      expect(msg.type).toBe(ChatType.SAY);
      expect(msg.message).toBe("hello via say");
      handle.close();
      await handle.closed;
    } finally {
      ws.stop();
    }
  });

  test("sendInCurrentMode dispatches whisper after mode change", async () => {
    const ws = await startMockWorldServer();
    try {
      const handle = await worldSession(
        { ...base, host: "127.0.0.1", port: ws.port },
        fakeAuth(ws.port),
      );
      handle.setLastChatMode({ type: "whisper", target: "Someone" });
      const received = new Promise<ChatMessage>((r) => handle.onMessage(r));
      handle.sendInCurrentMode("whisper test");
      const msg = await received;
      expect(msg.message).toBe("whisper test");
      expect(handle.getLastChatMode()).toEqual({
        type: "whisper",
        target: "Someone",
      });
      handle.close();
      await handle.closed;
    } finally {
      ws.stop();
    }
  });

  test("sendInCurrentMode dispatches yell", async () => {
    const ws = await startMockWorldServer();
    try {
      const handle = await worldSession(
        { ...base, host: "127.0.0.1", port: ws.port },
        fakeAuth(ws.port),
      );
      handle.setLastChatMode({ type: "yell" });
      const received = new Promise<ChatMessage>((r) => handle.onMessage(r));
      handle.sendInCurrentMode("yell test");
      const msg = await received;
      expect(msg.type).toBe(ChatType.YELL);
      expect(msg.message).toBe("yell test");
      handle.close();
      await handle.closed;
    } finally {
      ws.stop();
    }
  });

  test("sendInCurrentMode dispatches guild", async () => {
    const ws = await startMockWorldServer();
    try {
      const handle = await worldSession(
        { ...base, host: "127.0.0.1", port: ws.port },
        fakeAuth(ws.port),
      );
      handle.setLastChatMode({ type: "guild" });
      const received = new Promise<ChatMessage>((r) => handle.onMessage(r));
      handle.sendInCurrentMode("guild test");
      const msg = await received;
      expect(msg.type).toBe(ChatType.GUILD);
      expect(msg.message).toBe("guild test");
      handle.close();
      await handle.closed;
    } finally {
      ws.stop();
    }
  });

  test("sendInCurrentMode dispatches party", async () => {
    const ws = await startMockWorldServer();
    try {
      const handle = await worldSession(
        { ...base, host: "127.0.0.1", port: ws.port },
        fakeAuth(ws.port),
      );
      handle.setLastChatMode({ type: "party" });
      const received = new Promise<ChatMessage>((r) => handle.onMessage(r));
      handle.sendInCurrentMode("party test");
      const msg = await received;
      expect(msg.type).toBe(ChatType.PARTY);
      expect(msg.message).toBe("party test");
      handle.close();
      await handle.closed;
    } finally {
      ws.stop();
    }
  });

  test("sendInCurrentMode dispatches raid", async () => {
    const ws = await startMockWorldServer();
    try {
      const handle = await worldSession(
        { ...base, host: "127.0.0.1", port: ws.port },
        fakeAuth(ws.port),
      );
      handle.setLastChatMode({ type: "raid" });
      const received = new Promise<ChatMessage>((r) => handle.onMessage(r));
      handle.sendInCurrentMode("raid test");
      const msg = await received;
      expect(msg.type).toBe(ChatType.RAID);
      expect(msg.message).toBe("raid test");
      handle.close();
      await handle.closed;
    } finally {
      ws.stop();
    }
  });

  test("sendInCurrentMode dispatches channel", async () => {
    const ws = await startMockWorldServer();
    try {
      const handle = await worldSession(
        { ...base, host: "127.0.0.1", port: ws.port },
        fakeAuth(ws.port),
      );
      handle.setLastChatMode({ type: "channel", channel: "General" });
      const received = new Promise<ChatMessage>((r) => handle.onMessage(r));
      handle.sendInCurrentMode("channel test");
      const msg = await received;
      expect(msg.type).toBe(ChatType.CHANNEL);
      expect(msg.message).toBe("channel test");
      handle.close();
      await handle.closed;
    } finally {
      ws.stop();
    }
  });

  test("handler error in drainWorldPackets calls onPacketError", async () => {
    const ws = await startMockWorldServer();
    try {
      const handle = await worldSession(
        { ...base, host: "127.0.0.1", port: ws.port },
        fakeAuth(ws.port),
      );

      const errors: { opcode: number; message: string }[] = [];
      handle.onPacketError((opcode, err) => {
        errors.push({ opcode, message: err.message });
      });

      ws.inject(GameOpcode.SMSG_TIME_SYNC_REQ, new Uint8Array(0));
      await waitForEchoProbe(handle);

      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]!.opcode).toBe(GameOpcode.SMSG_TIME_SYNC_REQ);

      handle.close();
      await handle.closed;
    } finally {
      ws.stop();
    }
  });

  test("group opcodes emit expected group events", async () => {
    const ws = await startMockWorldServer();
    try {
      const handle = await worldSession(
        { ...base, host: "127.0.0.1", port: ws.port },
        fakeAuth(ws.port),
      );

      const received = waitForGroupEvents(handle, 9);

      const result = new PacketWriter();
      result.uint32LE(PartyOperation.INVITE);
      result.cString("Voidtrix");
      result.uint32LE(PartyResult.SUCCESS);
      result.uint32LE(0);
      ws.inject(GameOpcode.SMSG_PARTY_COMMAND_RESULT, result.finish());

      const invite = new PacketWriter();
      invite.uint8(1);
      invite.cString("Leader");
      invite.uint32LE(0);
      invite.uint8(0);
      invite.uint32LE(0);
      ws.inject(GameOpcode.SMSG_GROUP_INVITE, invite.finish());

      const leader = new PacketWriter();
      leader.cString("Newleader");
      ws.inject(GameOpcode.SMSG_GROUP_SET_LEADER, leader.finish());

      const list = new PacketWriter();
      list.uint8(0);
      list.uint8(0);
      list.uint8(0);
      list.uint8(0);
      list.uint32LE(0);
      list.uint32LE(0);
      list.uint32LE(1);
      list.uint32LE(1);
      list.cString("Voidtrix");
      list.uint32LE(0x10);
      list.uint32LE(0x20);
      list.uint8(1);
      list.uint8(0);
      list.uint8(0);
      list.uint8(0);
      list.uint32LE(0x10);
      list.uint32LE(0x20);
      ws.inject(GameOpcode.SMSG_GROUP_LIST, list.finish());

      ws.inject(GameOpcode.SMSG_GROUP_DESTROYED, new Uint8Array(0));
      ws.inject(GameOpcode.SMSG_GROUP_UNINVITE, new Uint8Array(0));

      const decline = new PacketWriter();
      decline.cString("Decliner");
      ws.inject(GameOpcode.SMSG_GROUP_DECLINE, decline.finish());

      const stats = new PacketWriter();
      stats.uint8(0x01);
      stats.uint8(0x42);
      stats.uint32LE(GroupUpdateFlag.STATUS | GroupUpdateFlag.CUR_HP);
      stats.uint16LE(0x01);
      stats.uint32LE(12000);
      ws.inject(GameOpcode.SMSG_PARTY_MEMBER_STATS, stats.finish());

      const fullStats = new PacketWriter();
      fullStats.uint8(0);
      fullStats.uint8(0x01);
      fullStats.uint8(0x43);
      fullStats.uint32LE(GroupUpdateFlag.STATUS | GroupUpdateFlag.LEVEL);
      fullStats.uint16LE(0x01);
      fullStats.uint16LE(80);
      ws.inject(GameOpcode.SMSG_PARTY_MEMBER_STATS_FULL, fullStats.finish());

      const events = await received;
      expect(events.map((event) => event.type)).toEqual([
        "command_result",
        "invite_received",
        "leader_changed",
        "group_list",
        "group_destroyed",
        "kicked",
        "invite_declined",
        "member_stats",
        "member_stats",
      ]);

      handle.close();
      await handle.closed;
    } finally {
      ws.stop();
    }
  });

  test("group_list resolves self as leader when leader GUID matches", async () => {
    const ws = await startMockWorldServer();
    try {
      const handle = await worldSession(
        { ...base, host: "127.0.0.1", port: ws.port },
        fakeAuth(ws.port),
      );

      const received = new Promise<GroupEvent>((resolve) => {
        handle.onGroupEvent(resolve);
      });

      const list = new PacketWriter();
      list.uint8(0);
      list.uint8(0);
      list.uint8(0);
      list.uint8(0);
      list.uint32LE(0);
      list.uint32LE(0);
      list.uint32LE(1);
      list.uint32LE(1);
      list.cString("Voidtrix");
      list.uint32LE(0x10);
      list.uint32LE(0x00);
      list.uint8(1);
      list.uint8(0);
      list.uint8(0);
      list.uint8(0);
      list.uint32LE(0x42);
      list.uint32LE(0x00);
      ws.inject(GameOpcode.SMSG_GROUP_LIST, list.finish());

      const event = await received;
      expect(event.type).toBe("group_list");
      if (event.type === "group_list") {
        expect(event.leader).toBe("Testchar");
      }

      handle.close();
      await handle.closed;
    } finally {
      ws.stop();
    }
  });

  test("setLeader reports missing party member", async () => {
    const ws = await startMockWorldServer();
    try {
      const handle = await worldSession(
        { ...base, host: "127.0.0.1", port: ws.port },
        fakeAuth(ws.port),
      );

      const received = new Promise<ChatMessage>((resolve) => {
        handle.onMessage(resolve);
      });

      handle.setLeader("Ghostplayer");
      const message = await received;
      expect(message.type).toBe(ChatType.SYSTEM);
      expect(message.message).toBe('"Ghostplayer" is not in your party.');

      handle.close();
      await handle.closed;
    } finally {
      ws.stop();
    }
  });

  test("stubbed opcode notifies via onMessage", async () => {
    const ws = await startMockWorldServer();
    try {
      const handle = await worldSession(
        { ...base, host: "127.0.0.1", port: ws.port },
        fakeAuth(ws.port),
      );

      const received = new Promise<ChatMessage>((resolve) => {
        handle.onMessage((msg) => {
          if (msg.message.includes("not yet implemented")) resolve(msg);
        });
      });

      ws.inject(GameOpcode.SMSG_CHAT_SERVER_MESSAGE, new Uint8Array(0));
      const msg = await received;
      expect(msg.type).toBe(ChatType.SYSTEM);
      expect(msg.message).toContain("Server broadcast message");

      handle.close();
      await handle.closed;
    } finally {
      ws.stop();
    }
  });

  test("group command methods run after login", async () => {
    const ws = await startMockWorldServer();
    try {
      const handle = await worldSession(
        { ...base, host: "127.0.0.1", port: ws.port },
        fakeAuth(ws.port),
      );

      const groupListReady = new Promise<void>((resolve) => {
        handle.onGroupEvent((event) => {
          if (event.type === "group_list") resolve();
        });
      });

      const list = new PacketWriter();
      list.uint8(0);
      list.uint8(0);
      list.uint8(0);
      list.uint8(0);
      list.uint32LE(0);
      list.uint32LE(0);
      list.uint32LE(1);
      list.uint32LE(1);
      list.cString("Voidtrix");
      list.uint32LE(0x10);
      list.uint32LE(0x20);
      list.uint8(1);
      list.uint8(0);
      list.uint8(0);
      list.uint8(0);
      list.uint32LE(0x10);
      list.uint32LE(0x20);
      ws.inject(GameOpcode.SMSG_GROUP_LIST, list.finish());
      await groupListReady;

      handle.invite("Voidtrix");
      handle.uninvite("Voidtrix");
      handle.leaveGroup();
      handle.acceptInvite();
      handle.declineInvite();
      handle.setLeader("Voidtrix");

      handle.close();
      await handle.closed;
    } finally {
      ws.stop();
    }
  });

  describe("entity handling", () => {
    function writePackedGuid(w: PacketWriter, guid: bigint) {
      const low = Number(guid & 0xffffffffn);
      const high = Number((guid >> 32n) & 0xffffffffn);
      let mask = 0;
      const bytes: number[] = [];
      for (let i = 0; i < 4; i++) {
        const b = (low >> (i * 8)) & 0xff;
        if (b !== 0) {
          mask |= 1 << i;
          bytes.push(b);
        }
      }
      for (let i = 0; i < 4; i++) {
        const b = (high >> (i * 8)) & 0xff;
        if (b !== 0) {
          mask |= 1 << (i + 4);
          bytes.push(b);
        }
      }
      w.uint8(mask);
      for (const b of bytes) w.uint8(b);
    }

    function writeLivingMovementBlock(
      w: PacketWriter,
      x: number,
      y: number,
      z: number,
      orientation: number,
    ) {
      w.uint16LE(UpdateFlag.LIVING);
      w.uint32LE(0);
      w.uint16LE(0);
      w.uint32LE(0);
      w.floatLE(x);
      w.floatLE(y);
      w.floatLE(z);
      w.floatLE(orientation);
      w.floatLE(0);
      for (let i = 0; i < 9; i++) w.floatLE(0);
    }

    function writeHasPositionMovementBlock(
      w: PacketWriter,
      x: number,
      y: number,
      z: number,
      orientation: number,
    ) {
      w.uint16LE(UpdateFlag.HAS_POSITION);
      w.floatLE(x);
      w.floatLE(y);
      w.floatLE(z);
      w.floatLE(orientation);
    }

    function writeUpdateMask(w: PacketWriter, fields: Map<number, number>) {
      let maxBit = 0;
      for (const bit of fields.keys()) {
        if (bit > maxBit) maxBit = bit;
      }
      const blockCount =
        maxBit === 0 && fields.size === 0 ? 0 : Math.floor(maxBit / 32) + 1;
      w.uint8(blockCount);
      const masks = new Array<number>(blockCount).fill(0);
      for (const bit of fields.keys()) {
        masks[Math.floor(bit / 32)]! |= 1 << (bit % 32);
      }
      for (const m of masks) w.uint32LE(m);
      for (let block = 0; block < blockCount; block++) {
        for (let bit = 0; bit < 32; bit++) {
          const index = block * 32 + bit;
          if (fields.has(index)) {
            w.uint32LE(fields.get(index)!);
          }
        }
      }
    }

    function buildCreateUnitPacket(
      guid: bigint,
      entry: number,
      health: number,
      maxHealth: number,
    ): Uint8Array {
      const w = new PacketWriter();
      w.uint32LE(1);
      w.uint8(3);
      writePackedGuid(w, guid);
      w.uint8(3);
      writeLivingMovementBlock(w, 100, 200, 300, 1.5);
      const fields = new Map<number, number>([
        [OBJECT_FIELDS.ENTRY.offset, entry],
        [UNIT_FIELDS.HEALTH.offset, health],
        [UNIT_FIELDS.MAXHEALTH.offset, maxHealth],
      ]);
      writeUpdateMask(w, fields);
      return w.finish();
    }

    function waitForEntityEvents(
      handle: Pick<WorldHandle, "onEntityEvent">,
      count: number,
    ): Promise<EntityEvent[]> {
      const events: EntityEvent[] = [];
      return new Promise((resolve) => {
        handle.onEntityEvent((event) => {
          events.push(event);
          if (events.length === count) resolve(events);
        });
      });
    }

    test("entity create and creature query response", async () => {
      const ws = await startMockWorldServer();
      try {
        const handle = await worldSession(
          { ...base, host: "127.0.0.1", port: ws.port },
          fakeAuth(ws.port),
        );

        const events = waitForEntityEvents(handle, 2);

        ws.inject(
          GameOpcode.SMSG_UPDATE_OBJECT,
          buildCreateUnitPacket(100n, 1234, 500, 1000),
        );

        const creatureResp = new PacketWriter();
        creatureResp.uint32LE(1234);
        creatureResp.cString("Young Wolf");
        ws.inject(
          GameOpcode.SMSG_CREATURE_QUERY_RESPONSE,
          creatureResp.finish(),
        );

        const [appear, nameUpdate] = await events;
        expect(appear!.type).toBe("appear");
        if (appear!.type === "appear") {
          expect(appear!.entity.guid).toBe(100n);
          expect(appear!.entity.objectType).toBe(3);
        }
        expect(nameUpdate!.type).toBe("update");
        if (nameUpdate!.type === "update") {
          expect(nameUpdate!.changed).toContain("name");
          expect(nameUpdate!.entity.name).toBe("Young Wolf");
        }

        handle.close();
        await handle.closed;
      } finally {
        ws.stop();
      }
    });

    test("entity values update", async () => {
      const ws = await startMockWorldServer();
      try {
        const handle = await worldSession(
          { ...base, host: "127.0.0.1", port: ws.port },
          fakeAuth(ws.port),
        );

        const appearReady = waitForEntityEvents(handle, 1);
        ws.inject(
          GameOpcode.SMSG_UPDATE_OBJECT,
          buildCreateUnitPacket(200n, 5000, 100, 200),
        );
        await appearReady;

        const updateReady = waitForEntityEvents(handle, 1);

        const w = new PacketWriter();
        w.uint32LE(1);
        w.uint8(0);
        writePackedGuid(w, 200n);
        writeUpdateMask(w, new Map([[UNIT_FIELDS.HEALTH.offset, 50]]));
        ws.inject(GameOpcode.SMSG_UPDATE_OBJECT, w.finish());

        const [update] = await updateReady;
        expect(update!.type).toBe("update");
        if (update!.type === "update") {
          expect(update!.changed).toContain("health");
        }

        handle.close();
        await handle.closed;
      } finally {
        ws.stop();
      }
    });

    test("entity movement", async () => {
      const ws = await startMockWorldServer();
      try {
        const handle = await worldSession(
          { ...base, host: "127.0.0.1", port: ws.port },
          fakeAuth(ws.port),
        );

        const appearReady = waitForEntityEvents(handle, 1);
        ws.inject(
          GameOpcode.SMSG_UPDATE_OBJECT,
          buildCreateUnitPacket(300n, 6000, 100, 200),
        );
        await appearReady;

        const moveReady = waitForEntityEvents(handle, 1);

        const w = new PacketWriter();
        w.uint32LE(1);
        w.uint8(1);
        writePackedGuid(w, 300n);
        writeHasPositionMovementBlock(w, 10.5, 20.5, 30.5, 1.25);
        ws.inject(GameOpcode.SMSG_UPDATE_OBJECT, w.finish());

        const [move] = await moveReady;
        expect(move!.type).toBe("update");
        if (move!.type === "update") {
          expect(move!.changed).toContain("position");
          expect(move!.entity.position!.x).toBeCloseTo(10.5);
          expect(move!.entity.position!.y).toBeCloseTo(20.5);
          expect(move!.entity.position!.z).toBeCloseTo(30.5);
        }

        handle.close();
        await handle.closed;
      } finally {
        ws.stop();
      }
    });

    test("out of range removes entities", async () => {
      const ws = await startMockWorldServer();
      try {
        const handle = await worldSession(
          { ...base, host: "127.0.0.1", port: ws.port },
          fakeAuth(ws.port),
        );

        const appear1 = waitForEntityEvents(handle, 1);
        ws.inject(
          GameOpcode.SMSG_UPDATE_OBJECT,
          buildCreateUnitPacket(400n, 7000, 100, 200),
        );
        await appear1;

        const appear2 = waitForEntityEvents(handle, 1);
        ws.inject(
          GameOpcode.SMSG_UPDATE_OBJECT,
          buildCreateUnitPacket(401n, 7001, 100, 200),
        );
        await appear2;

        expect(handle.getNearbyEntities().length).toBe(2);

        const disappearReady = waitForEntityEvents(handle, 2);

        const w = new PacketWriter();
        w.uint32LE(1);
        w.uint8(4);
        w.uint32LE(2);
        writePackedGuid(w, 400n);
        writePackedGuid(w, 401n);
        ws.inject(GameOpcode.SMSG_UPDATE_OBJECT, w.finish());

        const events = await disappearReady;
        expect(events[0]!.type).toBe("disappear");
        expect(events[1]!.type).toBe("disappear");
        expect(handle.getNearbyEntities().length).toBe(0);

        handle.close();
        await handle.closed;
      } finally {
        ws.stop();
      }
    });

    test("SMSG_DESTROY_OBJECT removes entity", async () => {
      const ws = await startMockWorldServer();
      try {
        const handle = await worldSession(
          { ...base, host: "127.0.0.1", port: ws.port },
          fakeAuth(ws.port),
        );

        const appearReady = waitForEntityEvents(handle, 1);
        ws.inject(
          GameOpcode.SMSG_UPDATE_OBJECT,
          buildCreateUnitPacket(500n, 8000, 100, 200),
        );
        await appearReady;

        const disappearReady = waitForEntityEvents(handle, 1);

        const w = new PacketWriter();
        w.uint64LE(500n);
        w.uint8(0);
        ws.inject(GameOpcode.SMSG_DESTROY_OBJECT, w.finish());

        const [disappear] = await disappearReady;
        expect(disappear!.type).toBe("disappear");
        if (disappear!.type === "disappear") {
          expect(disappear!.guid).toBe(500n);
        }
        expect(handle.getNearbyEntities().length).toBe(0);

        handle.close();
        await handle.closed;
      } finally {
        ws.stop();
      }
    });

    test("game object query response", async () => {
      const ws = await startMockWorldServer();
      try {
        const handle = await worldSession(
          { ...base, host: "127.0.0.1", port: ws.port },
          fakeAuth(ws.port),
        );

        const appearReady = waitForEntityEvents(handle, 1);

        const createW = new PacketWriter();
        createW.uint32LE(1);
        createW.uint8(2);
        writePackedGuid(createW, 600n);
        createW.uint8(5);
        writeHasPositionMovementBlock(createW, 50, 60, 70, 0.5);
        writeUpdateMask(createW, new Map([[OBJECT_FIELDS.ENTRY.offset, 9999]]));
        ws.inject(GameOpcode.SMSG_UPDATE_OBJECT, createW.finish());
        await appearReady;

        const updateReady = waitForEntityEvents(handle, 2);

        const goResp = new PacketWriter();
        goResp.uint32LE(9999);
        goResp.uint32LE(19);
        goResp.uint32LE(0);
        goResp.cString("Mailbox");
        ws.inject(GameOpcode.SMSG_GAMEOBJECT_QUERY_RESPONSE, goResp.finish());

        const events = await updateReady;
        const nameEvent = events.find(
          (e) => e.type === "update" && e.changed.includes("name"),
        );
        const typeEvent = events.find(
          (e) => e.type === "update" && e.changed.includes("gameObjectType"),
        );
        expect(nameEvent).toBeDefined();
        expect(typeEvent).toBeDefined();
        if (nameEvent?.type === "update") {
          expect(nameEvent.entity.name).toBe("Mailbox");
        }

        handle.close();
        await handle.closed;
      } finally {
        ws.stop();
      }
    });

    test("player name backfill via CMSG_NAME_QUERY", async () => {
      const ws = await startMockWorldServer();
      try {
        const handle = await worldSession(
          { ...base, host: "127.0.0.1", port: ws.port },
          fakeAuth(ws.port),
        );

        const events = waitForEntityEvents(handle, 2);

        const createW = new PacketWriter();
        createW.uint32LE(1);
        createW.uint8(3);
        writePackedGuid(createW, 0x42n);
        createW.uint8(4);
        writeLivingMovementBlock(createW, 10, 20, 30, 0);
        writeUpdateMask(createW, new Map([[OBJECT_FIELDS.ENTRY.offset, 0]]));
        ws.inject(GameOpcode.SMSG_UPDATE_OBJECT, createW.finish());

        const [appear, nameUpdate] = await events;
        expect(appear!.type).toBe("appear");
        expect(nameUpdate!.type).toBe("update");
        if (nameUpdate!.type === "update") {
          expect(nameUpdate!.entity.name).toBe(FIXTURE_CHARACTER);
        }

        handle.close();
        await handle.closed;
      } finally {
        ws.stop();
      }
    });

    test("compressed update object", async () => {
      const ws = await startMockWorldServer();
      try {
        const handle = await worldSession(
          { ...base, host: "127.0.0.1", port: ws.port },
          fakeAuth(ws.port),
        );

        const appearReady = waitForEntityEvents(handle, 1);

        const payload = buildCreateUnitPacket(700n, 3333, 250, 500);
        const compressed = deflateSync(payload, { level: 6 });
        const envelope = new PacketWriter();
        envelope.uint32LE(payload.byteLength);
        envelope.rawBytes(new Uint8Array(compressed));
        ws.inject(GameOpcode.SMSG_COMPRESSED_UPDATE_OBJECT, envelope.finish());

        const [appear] = await appearReady;
        expect(appear!.type).toBe("appear");
        if (appear!.type === "appear") {
          expect(appear!.entity.guid).toBe(700n);
        }

        handle.close();
        await handle.closed;
      } finally {
        ws.stop();
      }
    });

    test("cached creature name lookup", async () => {
      const ws = await startMockWorldServer();
      try {
        const handle = await worldSession(
          { ...base, host: "127.0.0.1", port: ws.port },
          fakeAuth(ws.port),
        );

        const firstAppear = waitForEntityEvents(handle, 1);
        ws.inject(
          GameOpcode.SMSG_UPDATE_OBJECT,
          buildCreateUnitPacket(800n, 5555, 100, 200),
        );
        await firstAppear;

        const nameReady = waitForEntityEvents(handle, 1);
        const creatureResp = new PacketWriter();
        creatureResp.uint32LE(5555);
        creatureResp.cString("Stormwind Guard");
        ws.inject(
          GameOpcode.SMSG_CREATURE_QUERY_RESPONSE,
          creatureResp.finish(),
        );
        await nameReady;

        const secondAppear = waitForEntityEvents(handle, 1);
        ws.inject(
          GameOpcode.SMSG_UPDATE_OBJECT,
          buildCreateUnitPacket(801n, 5555, 100, 200),
        );

        const [appear] = await secondAppear;
        expect(appear!.type).toBe("appear");
        if (appear!.type === "appear") {
          expect(appear!.entity.name).toBe("Stormwind Guard");
        }

        handle.close();
        await handle.closed;
      } finally {
        ws.stop();
      }
    });

    test("gameobject values update", async () => {
      const ws = await startMockWorldServer();
      try {
        const handle = await worldSession(
          { ...base, host: "127.0.0.1", port: ws.port },
          fakeAuth(ws.port),
        );

        const appear = waitForEntityEvents(handle, 1);
        const createW = new PacketWriter();
        createW.uint32LE(1);
        createW.uint8(2);
        writePackedGuid(createW, 500n);
        createW.uint8(5);
        writeHasPositionMovementBlock(createW, 1, 2, 3, 0);
        writeUpdateMask(createW, new Map([[OBJECT_FIELDS.ENTRY.offset, 100]]));
        ws.inject(GameOpcode.SMSG_UPDATE_OBJECT, createW.finish());
        await appear;

        const update = waitForEntityEvents(handle, 1);
        const valW = new PacketWriter();
        valW.uint32LE(1);
        valW.uint8(0);
        writePackedGuid(valW, 500n);
        writeUpdateMask(valW, new Map([[GAMEOBJECT_FIELDS.FLAGS.offset, 42]]));
        ws.inject(GameOpcode.SMSG_UPDATE_OBJECT, valW.finish());
        const [evt] = await update;
        expect(evt!.type).toBe("update");

        const nearW = new PacketWriter();
        nearW.uint32LE(1);
        nearW.uint8(5);
        nearW.uint32LE(1);
        writePackedGuid(nearW, 500n);
        ws.inject(GameOpcode.SMSG_UPDATE_OBJECT, nearW.finish());
        await Bun.sleep(1);

        handle.close();
        await handle.closed;
      } finally {
        ws.stop();
      }
    });

    test("compressed size mismatch triggers packet error", async () => {
      const ws = await startMockWorldServer();
      try {
        const handle = await worldSession(
          { ...base, host: "127.0.0.1", port: ws.port },
          fakeAuth(ws.port),
        );

        const gotError = new Promise<Error>((resolve) => {
          handle.onPacketError((_op, err) => resolve(err));
        });

        const payload = buildCreateUnitPacket(300n, 1, 50, 50);
        const compressed = deflateSync(payload);
        const w = new PacketWriter();
        w.uint32LE(payload.byteLength + 999);
        w.rawBytes(new Uint8Array(compressed));
        ws.inject(GameOpcode.SMSG_COMPRESSED_UPDATE_OBJECT, w.finish());

        const err = await gotError;
        expect(err.message).toContain("size mismatch");

        handle.close();
        await handle.closed;
      } finally {
        ws.stop();
      }
    });

    test("corpse entity create uses base entity", async () => {
      const ws = await startMockWorldServer();
      try {
        const handle = await worldSession(
          { ...base, host: "127.0.0.1", port: ws.port },
          fakeAuth(ws.port),
        );

        const appear = waitForEntityEvents(handle, 1);
        const w = new PacketWriter();
        w.uint32LE(1);
        w.uint8(2);
        writePackedGuid(w, 999n);
        w.uint8(7);
        writeHasPositionMovementBlock(w, 10, 20, 30, 0);
        writeUpdateMask(w, new Map([[OBJECT_FIELDS.ENTRY.offset, 42]]));
        ws.inject(GameOpcode.SMSG_UPDATE_OBJECT, w.finish());

        const [evt] = await appear;
        expect(evt!.type).toBe("appear");
        if (evt!.type === "appear") {
          expect(evt!.entity.objectType).toBe(7);
        }

        handle.close();
        await handle.closed;
      } finally {
        ws.stop();
      }
    });

    test("cached game object name lookup", async () => {
      const ws = await startMockWorldServer();
      try {
        const handle = await worldSession(
          { ...base, host: "127.0.0.1", port: ws.port },
          fakeAuth(ws.port),
        );

        const firstAppear = waitForEntityEvents(handle, 1);
        const createW = new PacketWriter();
        createW.uint32LE(1);
        createW.uint8(2);
        writePackedGuid(createW, 900n);
        createW.uint8(5);
        writeHasPositionMovementBlock(createW, 1, 2, 3, 0);
        writeUpdateMask(createW, new Map([[OBJECT_FIELDS.ENTRY.offset, 7777]]));
        ws.inject(GameOpcode.SMSG_UPDATE_OBJECT, createW.finish());
        await firstAppear;

        const nameReady = waitForEntityEvents(handle, 2);
        const goResp = new PacketWriter();
        goResp.uint32LE(7777);
        goResp.uint32LE(19);
        goResp.uint32LE(0);
        goResp.cString("Forge");
        ws.inject(GameOpcode.SMSG_GAMEOBJECT_QUERY_RESPONSE, goResp.finish());
        await nameReady;

        const secondAppear = waitForEntityEvents(handle, 1);
        const create2 = new PacketWriter();
        create2.uint32LE(1);
        create2.uint8(2);
        writePackedGuid(create2, 901n);
        create2.uint8(5);
        writeHasPositionMovementBlock(create2, 4, 5, 6, 0);
        writeUpdateMask(create2, new Map([[OBJECT_FIELDS.ENTRY.offset, 7777]]));
        ws.inject(GameOpcode.SMSG_UPDATE_OBJECT, create2.finish());

        const [appear] = await secondAppear;
        expect(appear!.type).toBe("appear");
        if (appear!.type === "appear") {
          expect(appear!.entity.name).toBe("Forge");
        }

        handle.close();
        await handle.closed;
      } finally {
        ws.stop();
      }
    });
  });

  describe("friend list", () => {
    function buildContactList(
      entries: {
        guid: bigint;
        flags: number;
        note: string;
        status?: number;
        area?: number;
        level?: number;
        playerClass?: number;
      }[],
    ): Uint8Array {
      const w = new PacketWriter();
      w.uint32LE(7);
      w.uint32LE(entries.length);
      for (const e of entries) {
        w.uint64LE(e.guid);
        w.uint32LE(e.flags);
        w.cString(e.note);
        if (e.flags & 0x01) {
          const status = e.status ?? 0;
          w.uint8(status);
          if (status !== 0) {
            w.uint32LE(e.area ?? 0);
            w.uint32LE(e.level ?? 0);
            w.uint32LE(e.playerClass ?? 0);
          }
        }
      }
      return w.finish();
    }

    function buildFriendStatus(opts: {
      result: number;
      guid: bigint;
      note?: string;
      status?: number;
      area?: number;
      level?: number;
      playerClass?: number;
    }): Uint8Array {
      const w = new PacketWriter();
      w.uint8(opts.result);
      w.uint64LE(opts.guid);
      if (opts.result === 0x06 || opts.result === 0x07) {
        w.cString(opts.note ?? "");
      }
      if (opts.result === 0x06 || opts.result === 0x02) {
        w.uint8(opts.status ?? 1);
        w.uint32LE(opts.area ?? 0);
        w.uint32LE(opts.level ?? 0);
        w.uint32LE(opts.playerClass ?? 0);
      }
      return w.finish();
    }

    function buildNameQueryResponse(guidLow: number, name: string): Uint8Array {
      const w = new PacketWriter();
      const mask = guidLow === 0 ? 0 : guidLow <= 0xff ? 0x01 : 0x03;
      w.uint8(mask);
      if (mask & 0x01) w.uint8(guidLow & 0xff);
      if (mask & 0x02) w.uint8((guidLow >> 8) & 0xff);
      w.uint8(0);
      w.cString(name);
      w.cString("");
      w.uint32LE(1);
      w.uint32LE(0);
      w.uint32LE(1);
      return w.finish();
    }

    test("SMSG_CONTACT_LIST with online friend", async () => {
      const ws = await startMockWorldServer();
      try {
        const handle = await worldSession(
          { ...base, host: "127.0.0.1", port: ws.port },
          fakeAuth(ws.port),
        );

        const eventReady = new Promise<FriendEvent>((resolve) => {
          handle.onFriendEvent(resolve);
        });

        ws.inject(
          GameOpcode.SMSG_CONTACT_LIST,
          buildContactList([
            {
              guid: 0x99n,
              flags: 0x01,
              note: "best buddy",
              status: 1,
              area: 1519,
              level: 80,
              playerClass: 1,
            },
          ]),
        );

        const event = await eventReady;
        expect(event.type).toBe("friend-list");

        const friends = handle.getFriends();
        expect(friends).toHaveLength(1);
        expect(friends[0]!.guid).toBe(0x99n);
        expect(friends[0]!.status).toBe(1);
        expect(friends[0]!.area).toBe(1519);
        expect(friends[0]!.level).toBe(80);
        expect(friends[0]!.playerClass).toBe(1);
        expect(friends[0]!.note).toBe("best buddy");

        handle.close();
        await handle.closed;
      } finally {
        ws.stop();
      }
    });

    test("SMSG_CONTACT_LIST filters out ignored entries", async () => {
      const ws = await startMockWorldServer();
      try {
        const handle = await worldSession(
          { ...base, host: "127.0.0.1", port: ws.port },
          fakeAuth(ws.port),
        );

        const eventReady = new Promise<FriendEvent>((resolve) => {
          handle.onFriendEvent(resolve);
        });

        ws.inject(
          GameOpcode.SMSG_CONTACT_LIST,
          buildContactList([
            {
              guid: 0x99n,
              flags: 0x01,
              note: "",
              status: 1,
              area: 10,
              level: 70,
              playerClass: 2,
            },
            {
              guid: 0xaan,
              flags: 0x02,
              note: "ignored person",
            },
          ]),
        );

        await eventReady;

        const friends = handle.getFriends();
        expect(friends).toHaveLength(1);
        expect(friends[0]!.guid).toBe(0x99n);

        handle.close();
        await handle.closed;
      } finally {
        ws.stop();
      }
    });

    test("SMSG_CONTACT_LIST triggers name queries", async () => {
      const ws = await startMockWorldServer();
      try {
        const handle = await worldSession(
          { ...base, host: "127.0.0.1", port: ws.port },
          fakeAuth(ws.port),
        );

        const eventReady = new Promise<FriendEvent>((resolve) => {
          handle.onFriendEvent(resolve);
        });

        ws.inject(
          GameOpcode.SMSG_CONTACT_LIST,
          buildContactList([
            {
              guid: 0x99n,
              flags: 0x01,
              note: "",
              status: 1,
              area: 10,
              level: 80,
              playerClass: 1,
            },
          ]),
        );

        await eventReady;
        await Bun.sleep(1);

        const nameQueries = ws.captured.filter(
          (p) => p.opcode === GameOpcode.CMSG_NAME_QUERY,
        );
        const match = nameQueries.find((p) => {
          const r = new PacketReader(p.body);
          return r.uint32LE() === 0x99;
        });
        expect(match).toBeDefined();

        ws.inject(
          GameOpcode.SMSG_NAME_QUERY_RESPONSE,
          buildNameQueryResponse(0x99, "Arthas"),
        );
        await Bun.sleep(1);

        const friends = handle.getFriends();
        expect(friends[0]!.name).toBe("Arthas");

        handle.close();
        await handle.closed;
      } finally {
        ws.stop();
      }
    });

    test("SMSG_FRIEND_STATUS ADDED_ONLINE", async () => {
      const ws = await startMockWorldServer();
      try {
        const handle = await worldSession(
          { ...base, host: "127.0.0.1", port: ws.port },
          fakeAuth(ws.port),
        );

        const eventReady = new Promise<FriendEvent>((resolve) => {
          handle.onFriendEvent(resolve);
        });

        ws.inject(
          GameOpcode.SMSG_FRIEND_STATUS,
          buildFriendStatus({
            result: 0x06,
            guid: 0xbbn,
            note: "new friend",
            status: 1,
            area: 1537,
            level: 55,
            playerClass: 4,
          }),
        );

        const event = await eventReady;
        expect(event.type).toBe("friend-added");

        const friends = handle.getFriends();
        expect(friends).toHaveLength(1);
        expect(friends[0]!.guid).toBe(0xbbn);
        expect(friends[0]!.note).toBe("new friend");
        expect(friends[0]!.status).toBe(1);
        expect(friends[0]!.area).toBe(1537);
        expect(friends[0]!.level).toBe(55);
        expect(friends[0]!.playerClass).toBe(4);

        handle.close();
        await handle.closed;
      } finally {
        ws.stop();
      }
    });

    test("SMSG_FRIEND_STATUS ONLINE updates existing friend", async () => {
      const ws = await startMockWorldServer();
      try {
        const handle = await worldSession(
          { ...base, host: "127.0.0.1", port: ws.port },
          fakeAuth(ws.port),
        );

        const listReady = new Promise<FriendEvent>((resolve) => {
          handle.onFriendEvent(resolve);
        });

        ws.inject(
          GameOpcode.SMSG_CONTACT_LIST,
          buildContactList([
            {
              guid: 0xccn,
              flags: 0x01,
              note: "",
              status: 0,
            },
          ]),
        );
        await listReady;

        const onlineReady = new Promise<FriendEvent>((resolve) => {
          handle.onFriendEvent(resolve);
        });

        ws.inject(
          GameOpcode.SMSG_FRIEND_STATUS,
          buildFriendStatus({
            result: 0x02,
            guid: 0xccn,
            status: 1,
            area: 400,
            level: 60,
            playerClass: 8,
          }),
        );

        const event = await onlineReady;
        expect(event.type).toBe("friend-online");

        const friends = handle.getFriends();
        expect(friends[0]!.status).toBe(1);
        expect(friends[0]!.area).toBe(400);
        expect(friends[0]!.level).toBe(60);
        expect(friends[0]!.playerClass).toBe(8);

        handle.close();
        await handle.closed;
      } finally {
        ws.stop();
      }
    });

    test("SMSG_FRIEND_STATUS OFFLINE clears status", async () => {
      const ws = await startMockWorldServer();
      try {
        const handle = await worldSession(
          { ...base, host: "127.0.0.1", port: ws.port },
          fakeAuth(ws.port),
        );

        const listReady = new Promise<FriendEvent>((resolve) => {
          handle.onFriendEvent(resolve);
        });

        ws.inject(
          GameOpcode.SMSG_CONTACT_LIST,
          buildContactList([
            {
              guid: 0xddn,
              flags: 0x01,
              note: "",
              status: 1,
              area: 100,
              level: 70,
              playerClass: 5,
            },
          ]),
        );
        await listReady;

        const offlineReady = new Promise<FriendEvent>((resolve) => {
          handle.onFriendEvent(resolve);
        });

        ws.inject(
          GameOpcode.SMSG_FRIEND_STATUS,
          buildFriendStatus({
            result: 0x03,
            guid: 0xddn,
          }),
        );

        const event = await offlineReady;
        expect(event.type).toBe("friend-offline");

        const friends = handle.getFriends();
        expect(friends[0]!.status).toBe(0);

        handle.close();
        await handle.closed;
      } finally {
        ws.stop();
      }
    });

    test("SMSG_FRIEND_STATUS REMOVED deletes from store", async () => {
      const ws = await startMockWorldServer();
      try {
        const handle = await worldSession(
          { ...base, host: "127.0.0.1", port: ws.port },
          fakeAuth(ws.port),
        );

        const listReady = new Promise<FriendEvent>((resolve) => {
          handle.onFriendEvent(resolve);
        });

        ws.inject(
          GameOpcode.SMSG_CONTACT_LIST,
          buildContactList([
            {
              guid: 0xeen,
              flags: 0x01,
              note: "",
              status: 1,
              area: 10,
              level: 80,
              playerClass: 1,
            },
          ]),
        );
        await listReady;

        const removedReady = new Promise<FriendEvent>((resolve) => {
          handle.onFriendEvent(resolve);
        });

        ws.inject(
          GameOpcode.SMSG_FRIEND_STATUS,
          buildFriendStatus({
            result: 0x05,
            guid: 0xeen,
          }),
        );

        const event = await removedReady;
        expect(event.type).toBe("friend-removed");

        expect(handle.getFriends()).toHaveLength(0);

        handle.close();
        await handle.closed;
      } finally {
        ws.stop();
      }
    });

    test("SMSG_FRIEND_STATUS ADDED_OFFLINE adds with zero status", async () => {
      const ws = await startMockWorldServer();
      try {
        const handle = await worldSession(
          { ...base, host: "127.0.0.1", port: ws.port },
          fakeAuth(ws.port),
        );

        const eventReady = new Promise<FriendEvent>((resolve) => {
          handle.onFriendEvent(resolve);
        });

        ws.inject(
          GameOpcode.SMSG_FRIEND_STATUS,
          buildFriendStatus({
            result: 0x07,
            guid: 0xabn,
            note: "offline pal",
          }),
        );

        const event = await eventReady;
        expect(event.type).toBe("friend-added");

        const friends = handle.getFriends();
        expect(friends).toHaveLength(1);
        expect(friends[0]!.guid).toBe(0xabn);
        expect(friends[0]!.note).toBe("offline pal");
        expect(friends[0]!.status).toBe(0);

        handle.close();
        await handle.closed;
      } finally {
        ws.stop();
      }
    });

    test("SMSG_FRIEND_STATUS error fires friend-error event", async () => {
      const ws = await startMockWorldServer();
      try {
        const handle = await worldSession(
          { ...base, host: "127.0.0.1", port: ws.port },
          fakeAuth(ws.port),
        );

        const eventReady = new Promise<FriendEvent>((resolve) => {
          handle.onFriendEvent(resolve);
        });

        ws.inject(
          GameOpcode.SMSG_FRIEND_STATUS,
          buildFriendStatus({
            result: 0x04,
            guid: 0x00n,
          }),
        );

        const event = await eventReady;
        expect(event.type).toBe("friend-error");
        if (event.type === "friend-error") {
          expect(event.result).toBe(0x04);
        }

        handle.close();
        await handle.closed;
      } finally {
        ws.stop();
      }
    });

    test("addFriend sends CMSG_ADD_FRIEND", async () => {
      const ws = await startMockWorldServer();
      try {
        const handle = await worldSession(
          { ...base, host: "127.0.0.1", port: ws.port },
          fakeAuth(ws.port),
        );

        handle.addFriend("Arthas");
        await Bun.sleep(1);

        const addPackets = ws.captured.filter(
          (p) => p.opcode === GameOpcode.CMSG_ADD_FRIEND,
        );
        expect(addPackets).toHaveLength(1);
        const r = new PacketReader(addPackets[0]!.body);
        expect(r.cString()).toBe("Arthas");
        expect(r.cString()).toBe("");

        handle.close();
        await handle.closed;
      } finally {
        ws.stop();
      }
    });

    test("removeFriend sends CMSG_DEL_FRIEND", async () => {
      const ws = await startMockWorldServer();
      try {
        const handle = await worldSession(
          { ...base, host: "127.0.0.1", port: ws.port },
          fakeAuth(ws.port),
        );

        const listReady = new Promise<FriendEvent>((resolve) => {
          handle.onFriendEvent(resolve);
        });

        ws.inject(
          GameOpcode.SMSG_CONTACT_LIST,
          buildContactList([
            {
              guid: 0xffn,
              flags: 0x01,
              note: "",
              status: 1,
              area: 10,
              level: 80,
              playerClass: 1,
            },
          ]),
        );
        await listReady;

        ws.inject(
          GameOpcode.SMSG_NAME_QUERY_RESPONSE,
          buildNameQueryResponse(0xff, "Arthas"),
        );
        await Bun.sleep(1);

        handle.removeFriend("Arthas");
        await Bun.sleep(1);

        const delPackets = ws.captured.filter(
          (p) => p.opcode === GameOpcode.CMSG_DEL_FRIEND,
        );
        expect(delPackets).toHaveLength(1);
        const r = new PacketReader(delPackets[0]!.body);
        expect(r.uint64LE()).toBe(0xffn);

        handle.close();
        await handle.closed;
      } finally {
        ws.stop();
      }
    });

    test("removeFriend for unknown name triggers system message", async () => {
      const ws = await startMockWorldServer();
      try {
        const handle = await worldSession(
          { ...base, host: "127.0.0.1", port: ws.port },
          fakeAuth(ws.port),
        );

        const received = new Promise<ChatMessage>((resolve) => {
          handle.onMessage(resolve);
        });

        handle.removeFriend("Nobody");

        const msg = await received;
        expect(msg.type).toBe(ChatType.SYSTEM);
        expect(msg.message).toBe('"Nobody" is not on your friends list.');

        handle.close();
        await handle.closed;
      } finally {
        ws.stop();
      }
    });
  });
});
