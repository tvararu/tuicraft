import { describe, expect, test } from "bun:test";
import { startMockWorldServer } from "test/mock-world-server";
import { base, fakeAuth, waitForEchoProbe } from "test/world-handlers-fixtures";
import { type ChatMessage, worldSession } from "wow/client";
import type { EntityEvent } from "wow/entity-store";
import { ObjectType, UpdateFlag, UpdateType } from "wow/protocol/entity-fields";
import { GameOpcode } from "wow/protocol/opcodes";
import { PacketWriter } from "wow/protocol/packet";

function observedObjects(...guids: number[]): Uint8Array {
  const packet = new PacketWriter();
  packet.uint32LE(guids.length);
  for (const guid of guids) {
    packet.uint8(UpdateType.CREATE_OBJECT);
    packet.packedGuid(guid, 0);
    packet.uint8(ObjectType.GAMEOBJECT);
    packet.uint16LE(UpdateFlag.HAS_POSITION);
    for (const value of [1, 12, 3, 0]) packet.floatLE(value);
    packet.uint8(0);
  }
  return packet.finish();
}

async function session() {
  const server = await startMockWorldServer({ coalesceSelfCreate: true });
  const handle = await worldSession(
    { ...base, host: "127.0.0.1", port: server.port },
    fakeAuth(server.port),
  );
  return { server, handle };
}

describe("WorldHandle event subscriptions", () => {
  test("two subscribers both receive every message in registration order", async () => {
    const { server, handle } = await session();
    try {
      await waitForEchoProbe(handle);
      const seen: string[] = [];
      const done = Promise.withResolvers<void>();
      handle.onMessage((msg) => seen.push(`first:${msg.message}`));
      handle.onMessage((msg) => {
        seen.push(`second:${msg.message}`);
        if (msg.message === "two") done.resolve();
      });
      handle.sendSay("one");
      handle.sendSay("two");
      await done.promise;
      expect(seen).toEqual([
        "first:one",
        "second:one",
        "first:two",
        "second:two",
      ]);
    } finally {
      handle.close();
      await handle.closed;
      server.stop();
    }
  });

  test("unsubscribing stops delivery to that subscriber only", async () => {
    const { server, handle } = await session();
    try {
      await waitForEchoProbe(handle);
      const dropped: ChatMessage[] = [];
      const kept: ChatMessage[] = [];
      const done = Promise.withResolvers<void>();
      const unsubscribe = handle.onMessage((msg) => dropped.push(msg));
      handle.onMessage((msg) => {
        kept.push(msg);
        if (msg.message === "after") done.resolve();
      });
      unsubscribe();
      handle.sendSay("after");
      await done.promise;
      expect(dropped).toEqual([]);
      expect(kept.map((msg) => msg.message)).toEqual(["after"]);
    } finally {
      handle.close();
      await handle.closed;
      server.stop();
    }
  });

  test("a throwing subscriber is reported as a packet error while others still receive the event", async () => {
    const { server, handle } = await session();
    try {
      await waitForEchoProbe(handle);
      const packetErrors: { opcode: number; message: string }[] = [];
      handle.onPacketError((opcode, err) =>
        packetErrors.push({ opcode, message: err.message }),
      );
      const seen: string[] = [];
      const done = Promise.withResolvers<void>();
      handle.onMessage(() => {
        throw new Error("bad subscriber");
      });
      handle.onMessage((msg) => {
        seen.push(msg.message);
        if (msg.message === "second") done.resolve();
      });
      handle.sendSay("first");
      handle.sendSay("second");
      await done.promise;
      expect(seen).toEqual(["first", "second"]);
      expect(packetErrors).toEqual([
        { opcode: GameOpcode.SMSG_MESSAGE_CHAT, message: "bad subscriber" },
        { opcode: GameOpcode.SMSG_MESSAGE_CHAT, message: "bad subscriber" },
      ]);
    } finally {
      handle.close();
      await handle.closed;
      server.stop();
    }
  });

  test("a subscriber error mid-packet does not abort the rest of the packet", async () => {
    const { server, handle } = await session();
    try {
      const packetErrors: number[] = [];
      handle.onPacketError((opcode) => packetErrors.push(opcode));
      const appeared = Promise.withResolvers<void>();
      handle.onEntityEvent((event) => {
        if (event.type === "appear" && event.entity.guid === 0x98n)
          throw new Error("bad subscriber");
      });
      handle.onEntityEvent((event) => {
        if (event.type === "appear" && event.entity.guid === 0x99n)
          appeared.resolve();
      });
      server.inject(GameOpcode.SMSG_UPDATE_OBJECT, observedObjects(0x98, 0x99));
      await appeared.promise;
      const guids = handle.getNearbyEntities().map((entity) => entity.guid);
      expect(guids).toContain(0x98n);
      expect(guids).toContain(0x99n);
      expect(packetErrors).toEqual([GameOpcode.SMSG_UPDATE_OBJECT]);
    } finally {
      handle.close();
      await handle.closed;
      server.stop();
    }
  });

  test("connection teardown detaches subscribers before clearing entities", async () => {
    const { server, handle } = await session();
    const events: EntityEvent[] = [];
    const appeared = Promise.withResolvers<void>();
    handle.onEntityEvent((event) => {
      events.push(event);
      if (event.type === "appear" && event.entity.guid === 0x99n)
        appeared.resolve();
    });
    server.inject(GameOpcode.SMSG_UPDATE_OBJECT, observedObjects(0x99));
    await appeared.promise;
    expect(handle.getNearbyEntities().length).toBeGreaterThan(0);
    server.stop();
    await handle.closed;
    expect(handle.getNearbyEntities()).toEqual([]);
    expect(events.filter((event) => event.type === "disappear")).toEqual([]);
  });
});
