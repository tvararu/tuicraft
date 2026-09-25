import { describe, expect, test } from "bun:test";
import { FIXTURE_CHARACTER } from "test/fixtures";
import { startMockWorldServer } from "test/mock-world-server";
import { base, fakeAuth, waitForEchoProbe } from "test/world-handlers-fixtures";
import { type ChatMessage, type WorldConn, worldSession } from "wow/client";
import { ChatType, GameOpcode } from "wow/protocol/opcodes";
import { PacketReader, PacketWriter } from "wow/protocol/packet";
import { handleChatMessage } from "wow/world-handlers-chat";

describe("world handler tests", () => {
  test("cached sender name skips name query on second message", async () => {
    const ws = await startMockWorldServer();
    try {
      const handle = await worldSession(
        { ...base, host: "127.0.0.1", port: ws.port },
        fakeAuth(ws.port),
      );

      await waitForEchoProbe(handle);
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

  test("delivers queued messages after resolving the sender name", async () => {
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

      expect(
        messages.map(({ sender, message }) => ({ sender, message })),
      ).toEqual([
        { sender: FIXTURE_CHARACTER, message: "msg1" },
        { sender: FIXTURE_CHARACTER, message: "msg2" },
      ]);

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
      await waitForEchoProbe(handle);

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
      await waitForEchoProbe(handle);

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
      await waitForEchoProbe(handle);

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
      await waitForEchoProbe(handle);

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

  test("SMSG_CHAT_SERVER_MESSAGE delivers as server-origin system message", async () => {
    const ws = await startMockWorldServer();
    try {
      const handle = await worldSession(
        { ...base, host: "127.0.0.1", port: ws.port },
        fakeAuth(ws.port),
      );
      await waitForEchoProbe(handle);

      const received = new Promise<ChatMessage>((r) => handle.onMessage(r));

      const w = new PacketWriter();
      w.uint32LE(1);
      w.cString("15:00");
      ws.inject(GameOpcode.SMSG_CHAT_SERVER_MESSAGE, w.finish());

      const msg = await received;
      expect(msg.type).toBe(ChatType.SYSTEM);
      expect(msg.sender).toBe("");
      expect(msg.message).toBe("Server shutdown in 15:00");
      expect(msg.origin).toBe("server");

      handle.close();
      await handle.closed;
    } finally {
      ws.stop();
    }
  });

  test("SMSG_NOTIFICATION delivers as notification-origin system message", async () => {
    const ws = await startMockWorldServer();
    try {
      const handle = await worldSession(
        { ...base, host: "127.0.0.1", port: ws.port },
        fakeAuth(ws.port),
      );
      await waitForEchoProbe(handle);

      const received = new Promise<ChatMessage>((r) => handle.onMessage(r));

      const w = new PacketWriter();
      w.cString("Server autobroadcast message");
      ws.inject(GameOpcode.SMSG_NOTIFICATION, w.finish());

      const msg = await received;
      expect(msg.type).toBe(ChatType.SYSTEM);
      expect(msg.sender).toBe("");
      expect(msg.message).toBe("Server autobroadcast message");
      expect(msg.origin).toBe("notification");

      handle.close();
      await handle.closed;
    } finally {
      ws.stop();
    }
  });

  test("handles SMSG_RECEIVED_MAIL", async () => {
    const ws = await startMockWorldServer();
    try {
      const handle = await worldSession(
        { ...base, host: "127.0.0.1", port: ws.port },
        fakeAuth(ws.port),
      );
      await waitForEchoProbe(handle);
      const received = new Promise<ChatMessage>((resolve) =>
        handle.onMessage(resolve),
      );
      const body = new PacketWriter(4);
      body.uint32LE(0);
      ws.inject(GameOpcode.SMSG_RECEIVED_MAIL, body.finish());
      const msg = await received;
      expect(msg.type).toBe(ChatType.SYSTEM);
      expect(msg.message).toBe("You have new mail.");
      expect(msg.origin).toBe("mail");
      handle.close();
      await handle.closed;
    } finally {
      ws.stop();
    }
  });

  test("SMSG_CHAT_RESTRICTED delivers restriction-specific system message", async () => {
    const ws = await startMockWorldServer();
    try {
      const handle = await worldSession(
        { ...base, host: "127.0.0.1", port: ws.port },
        fakeAuth(ws.port),
      );
      await waitForEchoProbe(handle);

      const received = new Promise<ChatMessage>((r) => handle.onMessage(r));

      const w = new PacketWriter();
      w.uint8(1);
      ws.inject(GameOpcode.SMSG_CHAT_RESTRICTED, w.finish());

      const msg = await received;
      expect(msg.type).toBe(ChatType.SYSTEM);
      expect(msg.sender).toBe("");
      expect(msg.message).toBe("Chat is throttled");

      handle.close();
      await handle.closed;
    } finally {
      ws.stop();
    }
  });

  test("SMSG_CHAT_RESTRICTED falls back for unknown restriction type", async () => {
    const ws = await startMockWorldServer();
    try {
      const handle = await worldSession(
        { ...base, host: "127.0.0.1", port: ws.port },
        fakeAuth(ws.port),
      );
      await waitForEchoProbe(handle);

      const received = new Promise<ChatMessage>((r) => handle.onMessage(r));

      const w = new PacketWriter();
      w.uint8(255);
      ws.inject(GameOpcode.SMSG_CHAT_RESTRICTED, w.finish());

      const msg = await received;
      expect(msg.type).toBe(ChatType.SYSTEM);
      expect(msg.sender).toBe("");
      expect(msg.message).toBe("Chat restriction 255");

      handle.close();
      await handle.closed;
    } finally {
      ws.stop();
    }
  });

  test("SMSG_CHAT_WRONG_FACTION delivers system message", async () => {
    const ws = await startMockWorldServer();
    try {
      const handle = await worldSession(
        { ...base, host: "127.0.0.1", port: ws.port },
        fakeAuth(ws.port),
      );
      await waitForEchoProbe(handle);

      const received = new Promise<ChatMessage>((r) => handle.onMessage(r));

      ws.inject(GameOpcode.SMSG_CHAT_WRONG_FACTION, new Uint8Array(0));

      const msg = await received;
      expect(msg.type).toBe(ChatType.SYSTEM);
      expect(msg.sender).toBe("");
      expect(msg.message).toBe(
        "You cannot speak to members of the opposing faction",
      );

      handle.close();
      await handle.closed;
    } finally {
      ws.stop();
    }
  });
});

describe("embedded chat sender names", () => {
  function monsterYell(): PacketReader {
    const w = new PacketWriter();
    w.uint8(ChatType.MONSTER_YELL);
    w.uint32LE(0);
    w.uint32LE(0x42);
    w.uint32LE(0xf1_30_00_00);
    w.uint32LE(0);
    const name = new TextEncoder().encode("Zapetta");
    w.uint32LE(name.byteLength + 1);
    w.rawBytes(name);
    w.uint8(0);
    w.uint32LE(0);
    w.uint32LE(0);
    const body = new TextEncoder().encode("The zeppelin has arrived!");
    w.uint32LE(body.byteLength + 1);
    w.rawBytes(body);
    w.uint8(0);
    w.uint8(0);
    return new PacketReader(w.finish());
  }

  function deliver(ignored: boolean): {
    msg: ChatMessage;
    nameQueries: number;
  } {
    let result!: ChatMessage;
    let nameQueries = 0;
    const conn = {
      onMessage: (m: ChatMessage) => {
        result = m;
      },
      ignoreStore: { has: () => ignored },
      nameCache: {
        get: () => {
          nameQueries++;
        },
      },
    } as unknown as WorldConn;
    handleChatMessage(conn, monsterYell());
    return { msg: result, nameQueries };
  }

  test("a monster yell delivers its embedded sender name", () => {
    const { msg, nameQueries } = deliver(false);
    expect(nameQueries).toBe(0);
    expect(msg.sender).toBe("Zapetta");
    expect(msg.message).toBe("The zeppelin has arrived!");
  });

  test("the embedded name outranks an ignore-store collision", () => {
    const { msg, nameQueries } = deliver(true);
    expect(nameQueries).toBe(0);
    expect(msg.sender).toBe("Zapetta");
  });
});
