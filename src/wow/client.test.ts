import { test, expect, describe, beforeAll, afterAll, jest } from "bun:test";
import {
  authHandshake,
  worldSession,
  type ChatMessage,
  type GroupEvent,
  type WorldHandle,
} from "wow/client";
import type { AuthResult } from "wow/client";
import { startMockAuthServer } from "test/mock-auth-server";
import { startMockWorldServer } from "test/mock-world-server";
import { PacketWriter } from "wow/protocol/packet";
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

  test("handler error in drainWorldPackets logs to stderr", async () => {
    const ws = await startMockWorldServer();
    const stderrSpy = jest
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    try {
      const handle = await worldSession(
        { ...base, host: "127.0.0.1", port: ws.port },
        fakeAuth(ws.port),
      );

      ws.inject(GameOpcode.SMSG_TIME_SYNC_REQ, new Uint8Array(0));
      await waitForEchoProbe(handle);

      expect(stderrSpy).toHaveBeenCalled();
      const output = String(stderrSpy.mock.calls[0]![0]);
      expect(output).toContain("0x390");

      handle.close();
      await handle.closed;
    } finally {
      stderrSpy.mockRestore();
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
});
