import { describe, expect, test } from "bun:test";
import { startMockWorldServer } from "#test-support/mock-world-server";
import {
  base,
  fakeAuth,
  waitForEchoProbe,
} from "#test-support/world-handlers-fixtures";
import { type ChatMessage, worldSession } from "#wow/client";
import { ChannelNotify, ChatType, GameOpcode } from "#wow/protocol/opcodes";
import { PacketReader, PacketWriter } from "#wow/protocol/packet";

describe("world handler tests", () => {
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

  test("channel join emits system message", async () => {
    const ws = await startMockWorldServer();
    try {
      const handle = await worldSession(
        { ...base, host: "127.0.0.1", port: ws.port },
        fakeAuth(ws.port),
      );
      await waitForEchoProbe(handle);

      const messages: ChatMessage[] = [];
      const probeReceived = new Promise<void>((resolve) => {
        handle.onMessage((msg) => {
          messages.push(msg);
          if (msg.message === "probe") resolve();
        });
      });

      const w = new PacketWriter();
      w.uint8(ChannelNotify.YOU_JOINED);
      w.cString("MyChannel");
      w.uint8(0);
      w.uint32LE(5);
      w.uint32LE(0);
      ws.inject(GameOpcode.SMSG_CHANNEL_NOTIFY, w.finish());

      handle.sendSay("probe");
      await probeReceived;
      expect(messages.some((m) => m.message.includes("MyChannel"))).toBe(true);
      expect(handle.getChannel(3)).toBe("MyChannel");

      handle.close();
      await handle.closed;
    } finally {
      ws.stop();
    }
  });

  test("channel notify error emits system message", async () => {
    const ws = await startMockWorldServer();
    try {
      const handle = await worldSession(
        { ...base, host: "127.0.0.1", port: ws.port },
        fakeAuth(ws.port),
      );
      await waitForEchoProbe(handle);

      const messages: ChatMessage[] = [];
      const probeReceived = new Promise<void>((resolve) => {
        handle.onMessage((msg) => {
          messages.push(msg);
          if (msg.message === "probe") resolve();
        });
      });

      const w = new PacketWriter();
      w.uint8(ChannelNotify.WRONG_PASSWORD);
      w.cString("Secret");
      ws.inject(GameOpcode.SMSG_CHANNEL_NOTIFY, w.finish());

      handle.sendSay("probe");
      await probeReceived;
      expect(
        messages.some((m) => m.message === "Wrong password for Secret"),
      ).toBe(true);

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
      await waitForEchoProbe(handle);
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
      await waitForEchoProbe(handle);
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
      await waitForEchoProbe(handle);
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
      await waitForEchoProbe(handle);
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
      await waitForEchoProbe(handle);
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
      await waitForEchoProbe(handle);
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

  test("sendInCurrentMode dispatches emote", async () => {
    const ws = await startMockWorldServer();
    try {
      const handle = await worldSession(
        { ...base, host: "127.0.0.1", port: ws.port },
        fakeAuth(ws.port),
      );
      await waitForEchoProbe(handle);
      handle.setLastChatMode({ type: "emote" });
      const received = new Promise<ChatMessage>((r) => handle.onMessage(r));
      handle.sendInCurrentMode("emote test");
      const msg = await received;
      expect(msg.type).toBe(ChatType.EMOTE);
      expect(msg.message).toBe("emote test");
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
      await waitForEchoProbe(handle);
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

  test("joinChannel sends CMSG_JOIN_CHANNEL", async () => {
    const ws = await startMockWorldServer();
    try {
      const handle = await worldSession(
        { ...base, host: "127.0.0.1", port: ws.port },
        fakeAuth(ws.port),
      );
      await waitForEchoProbe(handle);

      handle.joinChannel("MyCustom", "pass123");

      const captured = await ws.waitForCapture(
        (p) => p.opcode === GameOpcode.CMSG_JOIN_CHANNEL,
      );
      const r = new PacketReader(captured.body);
      expect(r.uint32LE()).toBe(0);
      expect(r.uint8()).toBe(0);
      expect(r.uint8()).toBe(0);
      expect(r.cString()).toBe("MyCustom");
      expect(r.cString()).toBe("pass123");

      handle.close();
      await handle.closed;
    } finally {
      ws.stop();
    }
  });

  test("leaveChannel sends CMSG_LEAVE_CHANNEL", async () => {
    const ws = await startMockWorldServer();
    try {
      const handle = await worldSession(
        { ...base, host: "127.0.0.1", port: ws.port },
        fakeAuth(ws.port),
      );
      await waitForEchoProbe(handle);

      handle.leaveChannel("General");

      const captured = await ws.waitForCapture(
        (p) => p.opcode === GameOpcode.CMSG_LEAVE_CHANNEL,
      );
      const r = new PacketReader(captured.body);
      expect(r.uint32LE()).toBe(0);
      expect(r.cString()).toBe("General");

      handle.close();
      await handle.closed;
    } finally {
      ws.stop();
    }
  });
});
