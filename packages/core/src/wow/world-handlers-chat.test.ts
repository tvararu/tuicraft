import { describe, expect, test } from "bun:test";
import { FIXTURE_CHARACTER } from "#test-support/fixtures";
import { startMockWorldServer } from "#test-support/mock-world-server";
import { must } from "#test-support/must";
import {
  base,
  fakeAuth,
  waitForEchoProbe,
} from "#test-support/world-handlers-fixtures";
import { type ChatMessage, worldSession } from "#wow/client";
import { ChatType, GameOpcode } from "#wow/protocol/opcodes";

describe("world handler tests", () => {
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

      await waitForEchoProbe(handle);
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
      expect(must(results[0]).name).toBe(FIXTURE_CHARACTER);

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
      await waitForEchoProbe(handle);
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
      await waitForEchoProbe(handle);
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
      await waitForEchoProbe(handle);
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
      await waitForEchoProbe(handle);
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
      await waitForEchoProbe(handle);
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

  test("sendEmote sends message and receives echo", async () => {
    const ws = await startMockWorldServer();
    try {
      const handle = await worldSession(
        { ...base, host: "127.0.0.1", port: ws.port },
        fakeAuth(ws.port),
      );
      await waitForEchoProbe(handle);
      const received = new Promise<ChatMessage>((r) => handle.onMessage(r));
      handle.sendEmote("test emote");
      const msg = await received;
      expect(msg.type).toBe(ChatType.EMOTE);
      expect(msg.message).toBe("test emote");
      handle.close();
      await handle.closed;
    } finally {
      ws.stop();
    }
  });

  test("sendDnd sends message and receives echo", async () => {
    const ws = await startMockWorldServer();
    try {
      const handle = await worldSession(
        { ...base, host: "127.0.0.1", port: ws.port },
        fakeAuth(ws.port),
      );
      await waitForEchoProbe(handle);
      const received = new Promise<ChatMessage>((r) => handle.onMessage(r));
      handle.sendDnd("busy right now");
      const msg = await received;
      expect(msg.type).toBe(ChatType.DND);
      expect(msg.message).toBe("busy right now");
      handle.close();
      await handle.closed;
    } finally {
      ws.stop();
    }
  });

  test("sendAfk sends message and receives echo", async () => {
    const ws = await startMockWorldServer();
    try {
      const handle = await worldSession(
        { ...base, host: "127.0.0.1", port: ws.port },
        fakeAuth(ws.port),
      );
      await waitForEchoProbe(handle);
      const received = new Promise<ChatMessage>((r) => handle.onMessage(r));
      handle.sendAfk("grabbing coffee");
      const msg = await received;
      expect(msg.type).toBe(ChatType.AFK);
      expect(msg.message).toBe("grabbing coffee");
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
      await waitForEchoProbe(handle);
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
      expect(must(errors[0]).opcode).toBe(GameOpcode.SMSG_TIME_SYNC_REQ);

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
      await waitForEchoProbe(handle);

      const received = new Promise<ChatMessage>((resolve) => {
        handle.onMessage((chat) => {
          if (chat.message.includes("not yet implemented")) resolve(chat);
        });
      });

      ws.inject(GameOpcode.SMSG_CHAT_PLAYER_AMBIGUOUS, new Uint8Array(0));
      const msg = await received;
      expect(msg.type).toBe(ChatType.SYSTEM);
      expect(msg.message).toContain("Ambiguous player name");

      handle.close();
      await handle.closed;
    } finally {
      ws.stop();
    }
  });
});
