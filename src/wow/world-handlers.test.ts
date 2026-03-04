import { test, expect, describe } from "bun:test";
import { deflateSync } from "node:zlib";
import {
  worldSession,
  type ChatMessage,
  type GroupEvent,
  type DuelEvent,
  type WorldHandle,
  type FriendEvent,
  type IgnoreEvent,
  type GuildEvent,
  type WorldConn,
} from "wow/client";
import {
  handleGuildEvent,
  handleGuildCommandResult,
  handleGuildInvitePacket,
} from "wow/world-handlers";
import type { AuthResult } from "wow/auth";
import { startMockWorldServer } from "test/mock-world-server";
import { PacketWriter, PacketReader } from "wow/protocol/packet";
import {
  GameOpcode,
  ChatType,
  ChannelNotify,
  PartyOperation,
  PartyResult,
  GroupUpdateFlag,
} from "wow/protocol/opcodes";
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
} from "test/fixtures";

const base = {
  account: FIXTURE_ACCOUNT,
  password: FIXTURE_PASSWORD,
  character: FIXTURE_CHARACTER,
  srpPrivateKey: clientPrivateKey,
  clientSeed,
};

function fakeAuth(port: number): AuthResult {
  return {
    sessionKey,
    realmHost: "127.0.0.1",
    realmPort: port,
    realmId: 1,
  };
}

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

function waitForDuelEvents(
  handle: Pick<WorldHandle, "onDuelEvent">,
  count: number,
): Promise<DuelEvent[]> {
  const events: DuelEvent[] = [];
  return new Promise((resolve) => {
    handle.onDuelEvent((event) => {
      events.push(event);
      if (events.length === count) resolve(events);
    });
  });
}

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

  test("sendEmote sends message and receives echo", async () => {
    const ws = await startMockWorldServer();
    try {
      const handle = await worldSession(
        { ...base, host: "127.0.0.1", port: ws.port },
        fakeAuth(ws.port),
      );
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

  test("SMSG_CHAT_SERVER_MESSAGE delivers as server-origin system message", async () => {
    const ws = await startMockWorldServer();
    try {
      const handle = await worldSession(
        { ...base, host: "127.0.0.1", port: ws.port },
        fakeAuth(ws.port),
      );

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

  test("duel opcodes emit expected duel events", async () => {
    const ws = await startMockWorldServer();
    try {
      const handle = await worldSession(
        { ...base, host: "127.0.0.1", port: ws.port },
        fakeAuth(ws.port),
      );

      const received = waitForDuelEvents(handle, 6);

      const requested = new PacketWriter();
      requested.uint64LE(100n);
      requested.uint64LE(200n);
      ws.inject(GameOpcode.SMSG_DUEL_REQUESTED, requested.finish());

      const countdown = new PacketWriter();
      countdown.uint32LE(3000);
      ws.inject(GameOpcode.SMSG_DUEL_COUNTDOWN, countdown.finish());

      ws.inject(GameOpcode.SMSG_DUEL_OUTOFBOUNDS, new Uint8Array(0));
      ws.inject(GameOpcode.SMSG_DUEL_INBOUNDS, new Uint8Array(0));

      const complete = new PacketWriter();
      complete.uint8(1);
      ws.inject(GameOpcode.SMSG_DUEL_COMPLETE, complete.finish());

      const winner = new PacketWriter();
      winner.uint8(0);
      winner.cString("Loser");
      winner.cString("Winner");
      ws.inject(GameOpcode.SMSG_DUEL_WINNER, winner.finish());

      const events = await received;
      expect(events.map((e) => e.type)).toEqual([
        "duel_requested",
        "duel_countdown",
        "duel_out_of_bounds",
        "duel_in_bounds",
        "duel_complete",
        "duel_winner",
      ]);

      const req = events[0] as { type: "duel_requested"; challenger: string };
      expect(req.challenger).toBe("Unknown");

      const cd = events[1] as { type: "duel_countdown"; timeMs: number };
      expect(cd.timeMs).toBe(3000);

      const win = events[5] as {
        type: "duel_winner";
        reason: string;
        winner: string;
        loser: string;
      };
      expect(win.reason).toBe("won");
      expect(win.winner).toBe("Winner");
      expect(win.loser).toBe("Loser");

      handle.close();
      await handle.closed;
    } finally {
      ws.stop();
    }
  });

  test("SMSG_DUEL_REQUESTED resolves name from nameCache", async () => {
    const ws = await startMockWorldServer();
    try {
      const handle = await worldSession(
        { ...base, host: "127.0.0.1", port: ws.port },
        fakeAuth(ws.port),
      );
      await waitForEchoProbe(handle);

      const duelEvent = new Promise<DuelEvent>((resolve) =>
        handle.onDuelEvent(resolve),
      );

      const nameResp = new PacketWriter();
      nameResp.uint8(0x01);
      nameResp.uint8(0x2a);
      nameResp.uint8(0);
      nameResp.cString("Arthas");
      nameResp.cString("");
      nameResp.uint32LE(1);
      nameResp.uint32LE(0);
      nameResp.uint32LE(1);
      ws.inject(GameOpcode.SMSG_NAME_QUERY_RESPONSE, nameResp.finish());

      await Bun.sleep(1);

      const requested = new PacketWriter();
      requested.uint64LE(42n);
      requested.uint64LE(200n);
      ws.inject(GameOpcode.SMSG_DUEL_REQUESTED, requested.finish());

      const event = await duelEvent;
      expect(event.type).toBe("duel_requested");
      if (event.type === "duel_requested") {
        expect(event.challenger).toBe("Arthas");
      }

      handle.close();
      await handle.closed;
    } finally {
      ws.stop();
    }
  });

  test("context-aware accept sends CMSG_DUEL_ACCEPTED after duel request", async () => {
    const ws = await startMockWorldServer();
    try {
      const handle = await worldSession(
        { ...base, host: "127.0.0.1", port: ws.port },
        fakeAuth(ws.port),
      );
      await waitForEchoProbe(handle);

      const duelEvent = new Promise<DuelEvent>((resolve) =>
        handle.onDuelEvent(resolve),
      );

      const requested = new PacketWriter();
      requested.uint64LE(100n);
      requested.uint64LE(200n);
      ws.inject(GameOpcode.SMSG_DUEL_REQUESTED, requested.finish());
      await duelEvent;

      const sent = ws.waitForCapture(
        (p) => p.opcode === GameOpcode.CMSG_DUEL_ACCEPTED,
      );
      handle.acceptInvite();
      const packet = await sent;
      const r = new PacketReader(packet.body);
      expect(r.uint64LE()).toBe(200n);

      handle.close();
      await handle.closed;
    } finally {
      ws.stop();
    }
  });

  test("context-aware decline sends CMSG_DUEL_CANCELLED after duel request", async () => {
    const ws = await startMockWorldServer();
    try {
      const handle = await worldSession(
        { ...base, host: "127.0.0.1", port: ws.port },
        fakeAuth(ws.port),
      );
      await waitForEchoProbe(handle);

      const duelEvent = new Promise<DuelEvent>((resolve) =>
        handle.onDuelEvent(resolve),
      );

      const requested = new PacketWriter();
      requested.uint64LE(100n);
      requested.uint64LE(200n);
      ws.inject(GameOpcode.SMSG_DUEL_REQUESTED, requested.finish());
      await duelEvent;

      const sent = ws.waitForCapture(
        (p) => p.opcode === GameOpcode.CMSG_DUEL_CANCELLED,
      );
      handle.declineInvite();
      const packet = await sent;
      const r = new PacketReader(packet.body);
      expect(r.uint64LE()).toBe(200n);

      handle.close();
      await handle.closed;
    } finally {
      ws.stop();
    }
  });

  test("context-aware accept sends CMSG_GROUP_ACCEPT after group invite", async () => {
    const ws = await startMockWorldServer();
    try {
      const handle = await worldSession(
        { ...base, host: "127.0.0.1", port: ws.port },
        fakeAuth(ws.port),
      );
      await waitForEchoProbe(handle);

      const groupEvent = new Promise<GroupEvent>((resolve) =>
        handle.onGroupEvent(resolve),
      );

      const invite = new PacketWriter();
      invite.uint8(1);
      invite.cString("Leader");
      invite.uint32LE(0);
      invite.uint8(0);
      invite.uint32LE(0);
      ws.inject(GameOpcode.SMSG_GROUP_INVITE, invite.finish());
      await groupEvent;

      const sent = ws.waitForCapture(
        (p) => p.opcode === GameOpcode.CMSG_GROUP_ACCEPT,
      );
      handle.acceptInvite();
      const packet = await sent;
      const r = new PacketReader(packet.body);
      expect(r.uint32LE()).toBe(0);

      handle.close();
      await handle.closed;
    } finally {
      ws.stop();
    }
  });

  test("context-aware decline sends CMSG_GROUP_DECLINE after group invite", async () => {
    const ws = await startMockWorldServer();
    try {
      const handle = await worldSession(
        { ...base, host: "127.0.0.1", port: ws.port },
        fakeAuth(ws.port),
      );
      await waitForEchoProbe(handle);

      const groupEvent = new Promise<GroupEvent>((resolve) =>
        handle.onGroupEvent(resolve),
      );

      const invite = new PacketWriter();
      invite.uint8(1);
      invite.cString("Leader");
      invite.uint32LE(0);
      invite.uint8(0);
      invite.uint32LE(0);
      ws.inject(GameOpcode.SMSG_GROUP_INVITE, invite.finish());
      await groupEvent;

      const sent = ws.waitForCapture(
        (p) => p.opcode === GameOpcode.CMSG_GROUP_DECLINE,
      );
      handle.declineInvite();
      const packet = await sent;
      expect(packet.body.byteLength).toBe(0);

      handle.close();
      await handle.closed;
    } finally {
      ws.stop();
    }
  });

  test("accept with no pending request fires system message", async () => {
    const ws = await startMockWorldServer();
    try {
      const handle = await worldSession(
        { ...base, host: "127.0.0.1", port: ws.port },
        fakeAuth(ws.port),
      );
      await waitForEchoProbe(handle);

      const msg = new Promise<ChatMessage>((resolve) =>
        handle.onMessage(resolve),
      );
      handle.acceptInvite();
      const result = await msg;
      expect(result.message).toBe("Nothing to accept.");

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

  test("sendInCurrentMode dispatches emote", async () => {
    const ws = await startMockWorldServer();
    try {
      const handle = await worldSession(
        { ...base, host: "127.0.0.1", port: ws.port },
        fakeAuth(ws.port),
      );
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

  test("sendRoll sends MSG_RANDOM_ROLL with min and max", async () => {
    const ws = await startMockWorldServer();
    try {
      const handle = await worldSession(
        { ...base, host: "127.0.0.1", port: ws.port },
        fakeAuth(ws.port),
      );

      handle.sendRoll(1, 100);
      await Bun.sleep(1);

      const roll = ws.captured.find(
        (p) => p.opcode === GameOpcode.MSG_RANDOM_ROLL,
      );
      expect(roll).toBeDefined();
      const r = new PacketReader(roll!.body);
      expect(r.uint32LE()).toBe(1);
      expect(r.uint32LE()).toBe(100);

      handle.close();
      await handle.closed;
    } finally {
      ws.stop();
    }
  });

  test("MSG_RANDOM_ROLL delivers roll result as message", async () => {
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
      w.uint32LE(100);
      w.uint32LE(42);
      w.uint32LE(0x42);
      w.uint32LE(0x00);
      ws.inject(GameOpcode.MSG_RANDOM_ROLL, w.finish());

      const msg = await received;
      expect(msg.type).toBe(ChatType.ROLL);
      expect(msg.sender).toBe(FIXTURE_CHARACTER);
      expect(msg.message).toBe("rolled 42 (1-100)");

      handle.close();
      await handle.closed;
    } finally {
      ws.stop();
    }
  });

  test("MSG_RANDOM_ROLL resolves unknown roller via name query", async () => {
    const ws = await startMockWorldServer();
    try {
      const handle = await worldSession(
        { ...base, host: "127.0.0.1", port: ws.port },
        fakeAuth(ws.port),
      );

      const received = new Promise<ChatMessage>((r) => handle.onMessage(r));

      const w = new PacketWriter();
      w.uint32LE(5);
      w.uint32LE(50);
      w.uint32LE(25);
      w.uint32LE(0x42);
      w.uint32LE(0x00);
      ws.inject(GameOpcode.MSG_RANDOM_ROLL, w.finish());

      const msg = await received;
      expect(msg.type).toBe(ChatType.ROLL);
      expect(msg.sender).toBe(FIXTURE_CHARACTER);
      expect(msg.message).toBe("rolled 25 (5-50)");

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

    test("SMSG_CONTACT_LIST populates ignoreStore", async () => {
      const ws = await startMockWorldServer();
      try {
        const handle = await worldSession(
          { ...base, host: "127.0.0.1", port: ws.port },
          fakeAuth(ws.port),
        );

        const eventReady = new Promise<IgnoreEvent>((resolve) => {
          handle.onIgnoreEvent(resolve);
        });

        ws.inject(
          GameOpcode.SMSG_CONTACT_LIST,
          buildContactList([
            {
              guid: 0xaan,
              flags: 0x02,
              note: "",
            },
          ]),
        );

        const event = await eventReady;
        expect(event.type).toBe("ignore-list");

        const ignored = handle.getIgnored();
        expect(ignored).toHaveLength(1);
        expect(ignored[0]!.guid).toBe(0xaan);

        handle.close();
        await handle.closed;
      } finally {
        ws.stop();
      }
    });

    test("SMSG_CONTACT_LIST triggers name queries for ignored entries", async () => {
      const ws = await startMockWorldServer();
      try {
        const handle = await worldSession(
          { ...base, host: "127.0.0.1", port: ws.port },
          fakeAuth(ws.port),
        );

        const eventReady = new Promise<IgnoreEvent>((resolve) => {
          handle.onIgnoreEvent(resolve);
        });

        ws.inject(
          GameOpcode.SMSG_CONTACT_LIST,
          buildContactList([
            {
              guid: 0xabn,
              flags: 0x02,
              note: "",
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
          return r.uint32LE() === 0xab;
        });
        expect(match).toBeDefined();

        ws.inject(
          GameOpcode.SMSG_NAME_QUERY_RESPONSE,
          buildNameQueryResponse(0xab, "Spammer"),
        );
        await Bun.sleep(1);

        const ignored = handle.getIgnored();
        expect(ignored[0]!.name).toBe("Spammer");

        handle.close();
        await handle.closed;
      } finally {
        ws.stop();
      }
    });

    test("SMSG_FRIEND_STATUS IGNORE_ADDED adds to ignoreStore", async () => {
      const ws = await startMockWorldServer();
      try {
        const handle = await worldSession(
          { ...base, host: "127.0.0.1", port: ws.port },
          fakeAuth(ws.port),
        );

        const eventReady = new Promise<IgnoreEvent>((resolve) => {
          handle.onIgnoreEvent(resolve);
        });

        ws.inject(
          GameOpcode.SMSG_FRIEND_STATUS,
          buildFriendStatus({
            result: 0x0f,
            guid: 0xddn,
          }),
        );

        const event = await eventReady;
        expect(event.type).toBe("ignore-added");

        const ignored = handle.getIgnored();
        expect(ignored).toHaveLength(1);
        expect(ignored[0]!.guid).toBe(0xddn);

        handle.close();
        await handle.closed;
      } finally {
        ws.stop();
      }
    });

    test("SMSG_FRIEND_STATUS IGNORE_REMOVED removes from ignoreStore", async () => {
      const ws = await startMockWorldServer();
      try {
        const handle = await worldSession(
          { ...base, host: "127.0.0.1", port: ws.port },
          fakeAuth(ws.port),
        );

        const listReady = new Promise<IgnoreEvent>((resolve) => {
          handle.onIgnoreEvent(resolve);
        });

        ws.inject(
          GameOpcode.SMSG_CONTACT_LIST,
          buildContactList([
            {
              guid: 0xeen,
              flags: 0x02,
              note: "",
            },
          ]),
        );
        await listReady;

        const removedReady = new Promise<IgnoreEvent>((resolve) => {
          handle.onIgnoreEvent(resolve);
        });

        ws.inject(
          GameOpcode.SMSG_FRIEND_STATUS,
          buildFriendStatus({
            result: 0x10,
            guid: 0xeen,
          }),
        );

        const event = await removedReady;
        expect(event.type).toBe("ignore-removed");
        expect(handle.getIgnored()).toHaveLength(0);

        handle.close();
        await handle.closed;
      } finally {
        ws.stop();
      }
    });

    test("SMSG_FRIEND_STATUS ignore error fires ignore-error event", async () => {
      const ws = await startMockWorldServer();
      try {
        const handle = await worldSession(
          { ...base, host: "127.0.0.1", port: ws.port },
          fakeAuth(ws.port),
        );

        const eventReady = new Promise<IgnoreEvent>((resolve) => {
          handle.onIgnoreEvent(resolve);
        });

        ws.inject(
          GameOpcode.SMSG_FRIEND_STATUS,
          buildFriendStatus({
            result: 0x0b,
            guid: 0x00n,
          }),
        );

        const event = await eventReady;
        expect(event.type).toBe("ignore-error");
        if (event.type === "ignore-error") {
          expect(event.result).toBe(0x0b);
        }

        handle.close();
        await handle.closed;
      } finally {
        ws.stop();
      }
    });

    test("messages from ignored sender are silently dropped", async () => {
      const ws = await startMockWorldServer();
      try {
        const handle = await worldSession(
          { ...base, host: "127.0.0.1", port: ws.port },
          fakeAuth(ws.port),
        );

        const listReady = new Promise<IgnoreEvent>((resolve) => {
          handle.onIgnoreEvent(resolve);
        });

        ws.inject(
          GameOpcode.SMSG_CONTACT_LIST,
          buildContactList([
            {
              guid: 0x42n,
              flags: 0x02,
              note: "",
            },
          ]),
        );
        await listReady;

        const messages: ChatMessage[] = [];
        handle.onMessage((msg) => messages.push(msg));

        handle.sendSay("hello");
        await Bun.sleep(50);

        expect(messages).toHaveLength(0);

        handle.close();
        await handle.closed;
      } finally {
        ws.stop();
      }
    });

    test("addIgnore sends CMSG_ADD_IGNORE", async () => {
      const ws = await startMockWorldServer();
      try {
        const handle = await worldSession(
          { ...base, host: "127.0.0.1", port: ws.port },
          fakeAuth(ws.port),
        );

        handle.addIgnore("Spammer");
        await Bun.sleep(1);

        const addPackets = ws.captured.filter(
          (p) => p.opcode === GameOpcode.CMSG_ADD_IGNORE,
        );
        expect(addPackets).toHaveLength(1);
        const r = new PacketReader(addPackets[0]!.body);
        expect(r.cString()).toBe("Spammer");

        handle.close();
        await handle.closed;
      } finally {
        ws.stop();
      }
    });

    test("removeIgnore sends CMSG_DEL_IGNORE", async () => {
      const ws = await startMockWorldServer();
      try {
        const handle = await worldSession(
          { ...base, host: "127.0.0.1", port: ws.port },
          fakeAuth(ws.port),
        );

        const listReady = new Promise<IgnoreEvent>((resolve) => {
          handle.onIgnoreEvent(resolve);
        });

        ws.inject(
          GameOpcode.SMSG_CONTACT_LIST,
          buildContactList([
            {
              guid: 0xffn,
              flags: 0x02,
              note: "",
            },
          ]),
        );
        await listReady;

        ws.inject(
          GameOpcode.SMSG_NAME_QUERY_RESPONSE,
          buildNameQueryResponse(0xff, "Spammer"),
        );
        await Bun.sleep(1);

        handle.removeIgnore("Spammer");
        await Bun.sleep(1);

        const delPackets = ws.captured.filter(
          (p) => p.opcode === GameOpcode.CMSG_DEL_IGNORE,
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

    test("removeIgnore for unknown name triggers system message", async () => {
      const ws = await startMockWorldServer();
      try {
        const handle = await worldSession(
          { ...base, host: "127.0.0.1", port: ws.port },
          fakeAuth(ws.port),
        );

        const received = new Promise<ChatMessage>((resolve) => {
          handle.onMessage(resolve);
        });

        handle.removeIgnore("Nobody");

        const msg = await received;
        expect(msg.type).toBe(ChatType.SYSTEM);
        expect(msg.message).toBe('"Nobody" is not on your ignore list.');

        handle.close();
        await handle.closed;
      } finally {
        ws.stop();
      }
    });
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

  describe("guild handlers", () => {
    function buildGuildRosterPacket(): Uint8Array {
      const w = new PacketWriter();
      w.uint32LE(1);
      w.cString("Welcome!");
      w.cString("Guild info");
      w.uint32LE(1);
      w.uint32LE(0);
      w.uint32LE(0);
      for (let j = 0; j < 6; j++) {
        w.uint32LE(0);
        w.uint32LE(0);
      }
      w.uint64LE(10n);
      w.uint8(1);
      w.cString("Thrall");
      w.uint32LE(0);
      w.uint8(80);
      w.uint8(7);
      w.uint8(0);
      w.uint32LE(1519);
      w.cString("Warchief");
      w.cString("");
      return w.finish();
    }

    function buildGuildQueryResponsePacket(): Uint8Array {
      const w = new PacketWriter();
      w.uint32LE(1);
      w.cString("Horde Elite");
      w.cString("Guild Master");
      w.cString("Officer");
      for (let i = 0; i < 8; i++) {
        w.cString("");
      }
      return w.finish();
    }

    test("SMSG_GUILD_ROSTER populates guildStore", async () => {
      const ws = await startMockWorldServer();
      try {
        const handle = await worldSession(
          { ...base, host: "127.0.0.1", port: ws.port },
          fakeAuth(ws.port),
        );

        const guildReady = new Promise<GuildEvent>((resolve) => {
          handle.onGuildEvent(resolve);
        });

        ws.inject(GameOpcode.SMSG_GUILD_ROSTER, buildGuildRosterPacket());

        const event = await guildReady;
        expect(event.type).toBe("guild-roster");
        if (event.type !== "guild-roster") throw new Error("expected roster");
        expect(event.roster.motd).toBe("Welcome!");
        expect(event.roster.members).toHaveLength(1);
        expect(event.roster.members[0]!.name).toBe("Thrall");

        handle.close();
        await handle.closed;
      } finally {
        ws.stop();
      }
    });

    test("SMSG_GUILD_QUERY_RESPONSE updates guild meta", async () => {
      const ws = await startMockWorldServer();
      try {
        const handle = await worldSession(
          { ...base, host: "127.0.0.1", port: ws.port },
          fakeAuth(ws.port),
        );

        const firstEvent = new Promise<GuildEvent>((resolve) => {
          handle.onGuildEvent(resolve);
        });
        ws.inject(GameOpcode.SMSG_GUILD_ROSTER, buildGuildRosterPacket());
        await firstEvent;

        const metaEvent = new Promise<GuildEvent>((resolve) => {
          handle.onGuildEvent(resolve);
        });
        ws.inject(
          GameOpcode.SMSG_GUILD_QUERY_RESPONSE,
          buildGuildQueryResponsePacket(),
        );
        const event = await metaEvent;
        if (event.type !== "guild-roster") throw new Error("expected roster");

        expect(event.roster.guildName).toBe("Horde Elite");
        expect(event.roster.rankNames[0]).toBe("Guild Master");
        expect(event.roster.rankNames[1]).toBe("Officer");

        handle.close();
        await handle.closed;
      } finally {
        ws.stop();
      }
    });

    test("requestGuildRoster sends CMSG_GUILD_ROSTER and returns roster", async () => {
      const ws = await startMockWorldServer();
      try {
        const handle = await worldSession(
          { ...base, host: "127.0.0.1", port: ws.port },
          fakeAuth(ws.port),
        );
        await waitForEchoProbe(handle);

        const rosterPromise = handle.requestGuildRoster();

        const captured = await ws.waitForCapture(
          (p) => p.opcode === GameOpcode.CMSG_GUILD_ROSTER,
        );
        expect(captured).toBeDefined();

        ws.inject(GameOpcode.SMSG_GUILD_ROSTER, buildGuildRosterPacket());

        const roster = await rosterPromise;
        expect(roster).toBeDefined();
        expect(roster!.members).toHaveLength(1);
        expect(roster!.members[0]!.name).toBe("Thrall");

        handle.close();
        await handle.closed;
      } finally {
        ws.stop();
      }
    });

    test("requestGuildRoster with guildId also sends CMSG_GUILD_QUERY", async () => {
      const ws = await startMockWorldServer({ guildId: 42 });
      try {
        const handle = await worldSession(
          { ...base, host: "127.0.0.1", port: ws.port },
          fakeAuth(ws.port),
        );
        await waitForEchoProbe(handle);

        const rosterPromise = handle.requestGuildRoster();

        const rosterCapture = await ws.waitForCapture(
          (p) => p.opcode === GameOpcode.CMSG_GUILD_ROSTER,
        );
        expect(rosterCapture).toBeDefined();

        const queryCapture = await ws.waitForCapture(
          (p) => p.opcode === GameOpcode.CMSG_GUILD_QUERY,
        );
        const qr = new PacketReader(queryCapture.body);
        expect(qr.uint32LE()).toBe(42);

        ws.inject(GameOpcode.SMSG_GUILD_ROSTER, buildGuildRosterPacket());
        ws.inject(
          GameOpcode.SMSG_GUILD_QUERY_RESPONSE,
          buildGuildQueryResponsePacket(),
        );

        const roster = await rosterPromise;
        expect(roster).toBeDefined();
        expect(roster!.guildName).toBe("Horde Elite");
        expect(roster!.members).toHaveLength(1);

        handle.close();
        await handle.closed;
      } finally {
        ws.stop();
      }
    });

    test("SMSG_GUILD_EVENT signed_on fires guild event", async () => {
      const ws = await startMockWorldServer();
      try {
        const handle = await worldSession(
          { ...base, host: "127.0.0.1", port: ws.port },
          fakeAuth(ws.port),
        );

        const eventReady = new Promise<GuildEvent>((resolve) => {
          handle.onGuildEvent(resolve);
        });

        const w = new PacketWriter();
        w.uint8(12);
        w.uint8(1);
        w.cString("Thrall");
        w.uint64LE(10n);
        ws.inject(GameOpcode.SMSG_GUILD_EVENT, w.finish());

        const event = await eventReady;
        expect(event.type).toBe("signed_on");
        if (event.type === "signed_on") {
          expect(event.name).toBe("Thrall");
        }

        handle.close();
        await handle.closed;
      } finally {
        ws.stop();
      }
    });

    test("SMSG_GUILD_EVENT promotion fires guild event", async () => {
      const ws = await startMockWorldServer();
      try {
        const handle = await worldSession(
          { ...base, host: "127.0.0.1", port: ws.port },
          fakeAuth(ws.port),
        );

        const eventReady = new Promise<GuildEvent>((resolve) => {
          handle.onGuildEvent(resolve);
        });

        const w = new PacketWriter();
        w.uint8(0);
        w.uint8(3);
        w.cString("Thrall");
        w.cString("Garrosh");
        w.cString("Officer");
        ws.inject(GameOpcode.SMSG_GUILD_EVENT, w.finish());

        const event = await eventReady;
        expect(event.type).toBe("promotion");
        if (event.type === "promotion") {
          expect(event.officer).toBe("Thrall");
          expect(event.member).toBe("Garrosh");
          expect(event.rank).toBe("Officer");
        }

        handle.close();
        await handle.closed;
      } finally {
        ws.stop();
      }
    });

    test("SMSG_GUILD_EVENT unknown type is silently ignored", async () => {
      const ws = await startMockWorldServer();
      try {
        const handle = await worldSession(
          { ...base, host: "127.0.0.1", port: ws.port },
          fakeAuth(ws.port),
        );

        const events: GuildEvent[] = [];
        handle.onGuildEvent((e) => events.push(e));

        const w = new PacketWriter();
        w.uint8(9);
        w.uint8(0);
        ws.inject(GameOpcode.SMSG_GUILD_EVENT, w.finish());

        await Bun.sleep(50);
        expect(events).toHaveLength(0);

        handle.close();
        await handle.closed;
      } finally {
        ws.stop();
      }
    });

    test("guild management methods send correct packets", async () => {
      const ws = await startMockWorldServer();
      try {
        const handle = await worldSession(
          { ...base, host: "127.0.0.1", port: ws.port },
          fakeAuth(ws.port),
        );

        handle.guildInvite("Thrall");
        handle.guildRemove("Garrosh");
        handle.guildLeave();
        handle.guildPromote("Jaina");
        handle.guildDemote("Arthas");
        handle.guildLeader("Sylvanas");
        handle.guildMotd("Raid tonight");
        handle.acceptGuildInvite();
        handle.declineGuildInvite();
        await Bun.sleep(1);

        const opcodes = ws.captured.map((p) => p.opcode);
        expect(opcodes).toContain(GameOpcode.CMSG_GUILD_INVITE);
        expect(opcodes).toContain(GameOpcode.CMSG_GUILD_REMOVE);
        expect(opcodes).toContain(GameOpcode.CMSG_GUILD_LEAVE);
        expect(opcodes).toContain(GameOpcode.CMSG_GUILD_PROMOTE);
        expect(opcodes).toContain(GameOpcode.CMSG_GUILD_DEMOTE);
        expect(opcodes).toContain(GameOpcode.CMSG_GUILD_LEADER);
        expect(opcodes).toContain(GameOpcode.CMSG_GUILD_MOTD);
        expect(opcodes).toContain(GameOpcode.CMSG_GUILD_ACCEPT);
        expect(opcodes).toContain(GameOpcode.CMSG_GUILD_DECLINE);

        const invite = ws.captured.find(
          (p) => p.opcode === GameOpcode.CMSG_GUILD_INVITE,
        )!;
        expect(new PacketReader(invite.body).cString()).toBe("Thrall");

        const motd = ws.captured.find(
          (p) => p.opcode === GameOpcode.CMSG_GUILD_MOTD,
        )!;
        expect(new PacketReader(motd.body).cString()).toBe("Raid tonight");

        const leave = ws.captured.find(
          (p) => p.opcode === GameOpcode.CMSG_GUILD_LEAVE,
        )!;
        expect(leave.body.length).toBe(0);

        handle.close();
        await handle.closed;
      } finally {
        ws.stop();
      }
    });

    test("SMSG_GUILD_COMMAND_RESULT fires guild event", async () => {
      const ws = await startMockWorldServer();
      try {
        const handle = await worldSession(
          { ...base, host: "127.0.0.1", port: ws.port },
          fakeAuth(ws.port),
        );

        const eventReady = new Promise<GuildEvent>((resolve) => {
          handle.onGuildEvent(resolve);
        });

        const w = new PacketWriter();
        w.uint32LE(1);
        w.cString("Thrall");
        w.uint32LE(0x03);
        ws.inject(GameOpcode.SMSG_GUILD_COMMAND_RESULT, w.finish());

        const event = await eventReady;
        expect(event.type).toBe("command_result");
        if (event.type === "command_result") {
          expect(event.command).toBe(1);
          expect(event.name).toBe("Thrall");
          expect(event.result).toBe(0x03);
        }

        handle.close();
        await handle.closed;
      } finally {
        ws.stop();
      }
    });

    test("SMSG_GUILD_INVITE fires guild invite event", async () => {
      const ws = await startMockWorldServer();
      try {
        const handle = await worldSession(
          { ...base, host: "127.0.0.1", port: ws.port },
          fakeAuth(ws.port),
        );

        const eventReady = new Promise<GuildEvent>((resolve) => {
          handle.onGuildEvent(resolve);
        });

        const w = new PacketWriter();
        w.cString("Thrall");
        w.cString("Horde Heroes");
        ws.inject(GameOpcode.SMSG_GUILD_INVITE, w.finish());

        const event = await eventReady;
        expect(event.type).toBe("guild_invite");
        if (event.type === "guild_invite") {
          expect(event.inviter).toBe("Thrall");
          expect(event.guildName).toBe("Horde Heroes");
        }

        handle.close();
        await handle.closed;
      } finally {
        ws.stop();
      }
    });
  });
});

describe("handleGuildEvent unit", () => {
  function fireEvent(
    eventType: number,
    params: string[],
    guid?: bigint,
  ): GuildEvent {
    const w = new PacketWriter();
    w.uint8(eventType);
    w.uint8(params.length);
    for (const p of params) w.cString(p);
    if (guid !== undefined) w.uint64LE(guid);
    let result!: GuildEvent;
    const conn = {
      onGuildEvent: (e: GuildEvent) => {
        result = e;
      },
    } as unknown as WorldConn;
    handleGuildEvent(conn, new PacketReader(w.finish()));
    return result;
  }

  test("demotion", () => {
    const e = fireEvent(1, ["Thrall", "Garrosh", "Member"]);
    expect(e).toEqual({
      type: "demotion",
      officer: "Thrall",
      member: "Garrosh",
      rank: "Member",
    });
  });

  test("motd", () => {
    const e = fireEvent(2, ["Raid tonight!"]);
    expect(e).toEqual({ type: "motd", text: "Raid tonight!" });
  });

  test("joined", () => {
    const e = fireEvent(3, ["Arthas"], 99n);
    expect(e).toEqual({ type: "joined", name: "Arthas" });
  });

  test("left", () => {
    const e = fireEvent(4, ["Sylvanas"], 7n);
    expect(e).toEqual({ type: "left", name: "Sylvanas" });
  });

  test("removed", () => {
    const e = fireEvent(5, ["Garrosh", "Thrall"]);
    expect(e).toEqual({
      type: "removed",
      member: "Garrosh",
      officer: "Thrall",
    });
  });

  test("leader_is", () => {
    const e = fireEvent(6, ["Thrall"]);
    expect(e).toEqual({ type: "leader_is", name: "Thrall" });
  });

  test("leader_changed", () => {
    const e = fireEvent(7, ["Thrall", "Garrosh"]);
    expect(e).toEqual({
      type: "leader_changed",
      oldLeader: "Thrall",
      newLeader: "Garrosh",
    });
  });

  test("disbanded", () => {
    const e = fireEvent(8, []);
    expect(e).toEqual({ type: "disbanded" });
  });

  test("signed_off", () => {
    const e = fireEvent(13, ["Varian"], 55n);
    expect(e).toEqual({ type: "signed_off", name: "Varian" });
  });
});

describe("handleGuildCommandResult", () => {
  test("fires command_result event for error", () => {
    const w = new PacketWriter();
    w.uint32LE(1);
    w.cString("Thrall");
    w.uint32LE(0x03);
    let result!: GuildEvent;
    const conn = {
      onGuildEvent: (e: GuildEvent) => {
        result = e;
      },
    } as unknown as WorldConn;
    handleGuildCommandResult(conn, new PacketReader(w.finish()));
    expect(result).toEqual({
      type: "command_result",
      command: 1,
      name: "Thrall",
      result: 0x03,
    });
  });

  test("suppresses success result (code 0)", () => {
    const w = new PacketWriter();
    w.uint32LE(1);
    w.cString("Thrall");
    w.uint32LE(0x00);
    let called = false;
    const conn = {
      onGuildEvent: () => {
        called = true;
      },
    } as unknown as WorldConn;
    handleGuildCommandResult(conn, new PacketReader(w.finish()));
    expect(called).toBe(false);
  });

  test("works when onGuildEvent is not set", () => {
    const w = new PacketWriter();
    w.uint32LE(1);
    w.cString("X");
    w.uint32LE(0x0b);
    const conn = {} as unknown as WorldConn;
    expect(() =>
      handleGuildCommandResult(conn, new PacketReader(w.finish())),
    ).not.toThrow();
  });
});

describe("handleGuildInvitePacket", () => {
  test("fires guild_invite event", () => {
    const w = new PacketWriter();
    w.cString("Thrall");
    w.cString("Horde Heroes");
    let result!: GuildEvent;
    const conn = {
      onGuildEvent: (e: GuildEvent) => {
        result = e;
      },
    } as unknown as WorldConn;
    handleGuildInvitePacket(conn, new PacketReader(w.finish()));
    expect(result).toEqual({
      type: "guild_invite",
      inviter: "Thrall",
      guildName: "Horde Heroes",
    });
  });

  test("works when onGuildEvent is not set", () => {
    const w = new PacketWriter();
    w.cString("A");
    w.cString("B");
    const conn = {} as unknown as WorldConn;
    expect(() =>
      handleGuildInvitePacket(conn, new PacketReader(w.finish())),
    ).not.toThrow();
  });
});
