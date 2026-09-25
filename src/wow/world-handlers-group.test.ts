import { describe, expect, test } from "bun:test";
import { FIXTURE_CHARACTER } from "test/fixtures";
import { startMockWorldServer } from "test/mock-world-server";
import { must } from "test/must";
import {
  base,
  fakeAuth,
  waitForEchoProbe,
  waitForGroupEvents,
} from "test/world-handlers-fixtures";
import { type ChatMessage, type GroupEvent, worldSession } from "wow/client";
import {
  ChatType,
  GameOpcode,
  GroupUpdateFlag,
  PartyOperation,
  PartyResult,
} from "wow/protocol/opcodes";
import { PacketReader, PacketWriter } from "wow/protocol/packet";

describe("world handler tests", () => {
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
      stats.uint32LE(12_000);
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
      await waitForEchoProbe(handle);

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
      const r = new PacketReader(must(roll).body);
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
      await waitForEchoProbe(handle);

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
});
