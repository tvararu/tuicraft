import { describe, expect, test } from "bun:test";
import { bytes } from "test/hex";
import type { Entity } from "wow/entity-store";
import { RewardsRuntime, type RewardsEvent } from "wow/rewards";
import { ObjectType } from "wow/protocol/entity-fields";
import { PacketReader } from "wow/protocol/packet";

function entity(
  guid: bigint,
  objectType: ObjectType,
  fields: [number, number][],
): Entity {
  return {
    guid,
    objectType,
    entry: 0,
    scale: 1,
    position: undefined,
    rawFields: new Map(fields),
    name: undefined,
    createComplete: true,
  };
}

function fixture() {
  const self = entity(1n, ObjectType.PLAYER, [
    [0x18, 100],
    [0x492, 10],
  ]);
  const target = entity(2n, ObjectType.UNIT, [[0x4f, 1]]);
  const entities = new Map([
    [1n, self],
    [2n, target],
    [3n, entity(3n, ObjectType.UNIT, [[0x4f, 1]])],
  ]);
  const sent: { opcode: number; body: Uint8Array | undefined }[] = [];
  const events: RewardsEvent[] = [];
  const runtime = new RewardsRuntime({
    send: (opcode, body) => {
      sent.push({ opcode, body });
    },
    now: () => 1000,
    selfGuid: () => 1n,
    getEntity: (guid) => entities.get(guid),
  });
  runtime.onEvent((event) => events.push(event));
  return { runtime, self, target, entities, sent, events };
}

const loot = `
  0200000000000000 01 09000000 03
  04 c8000000 03000000 00000000 00000000 00000000 00
  07 2c010000 01000000 00000000 00000000 00000000 04
  08 90010000 01000000 00000000 00000000 00000000 02
`;
const push = `
  0100000000000000 00000000 00000000 01000000 ff ffffffff
  c8000000 00000000 00000000 03000000 03000000
`;

describe("authoritative loot runtime", () => {
  test("opening is intent until a matching server offer and does not allow a replacement window", () => {
    const f = fixture();
    expect(f.runtime.open(2n).loot.phase).toBe("opening");
    expect(f.sent).toEqual([
      { opcode: 0x15d, body: bytes("0200000000000000") },
    ]);
    expect(() => f.runtime.open(3n)).toThrow();
    expect(() => f.runtime.take(4)).toThrow();
    const wrong = bytes(loot);
    wrong[0] = 3;
    f.runtime.handleLootResponse(new PacketReader(wrong));
    expect(f.runtime.snapshot().loot.phase).toBe("opening");
    f.runtime.handleLootResponse(new PacketReader(bytes(loot)));
    expect(f.runtime.snapshot().loot).toMatchObject({
      phase: "open",
      guid: 2n,
      money: 9,
    });
    expect(f.runtime.snapshot().pending).toBeUndefined();
  });

  test("requires actual corpse eligibility and only takes offered owner/allow slots", () => {
    const f = fixture();
    f.self.rawFields.set(0x96, 0x10);
    expect(() => f.runtime.open(2n)).toThrow();
    f.self.rawFields.set(0x96, 0);
    f.target.createComplete = false;
    expect(() => f.runtime.open(2n)).toThrow();
    f.target.createComplete = true;
    f.target.rawFields.set(0x4f, 0);
    expect(() => f.runtime.open(2n)).toThrow();
    f.target.rawFields.set(0x4f, 1);
    f.runtime.open(2n);
    f.runtime.handleLootResponse(new PacketReader(bytes(loot)));
    expect(() => f.runtime.take(1)).toThrow();
    expect(() => f.runtime.take(8)).toThrow();
    f.runtime.take(7);
    expect(f.sent.at(-1)).toEqual({ opcode: 0x108, body: bytes("07") });
    expect(() => f.runtime.take(4)).toThrow();
  });

  test("slot removal and own item pushes remain separate from actual slot/count changes", () => {
    const f = fixture();
    f.runtime.open(2n);
    f.runtime.handleLootResponse(new PacketReader(bytes(loot)));
    f.runtime.take(4);
    f.runtime.handleLootRemoved(new PacketReader(bytes("04")));
    expect(
      f.runtime.snapshot().inventory.slots.find((slot) => slot.slot === 23)
        ?.status,
    ).toBe("empty");
    const other = bytes(push);
    other[0] = 9;
    f.runtime.handleItemPushResult(new PacketReader(other));
    expect(f.runtime.snapshot().lastItemPush).toBeUndefined();
    f.runtime.handleItemPushResult(new PacketReader(bytes(push)));
    expect(f.runtime.snapshot().lastItemPush).toMatchObject({
      guid: 1n,
      count: 3,
      slot: 0xffffffff,
    });
    expect(
      f.runtime.snapshot().inventory.slots.find((slot) => slot.slot === 23)
        ?.status,
    ).toBe("empty");
    const item = entity(5n, ObjectType.ITEM, [
      [3, 200],
      [6, 1],
      [8, 1],
      [14, 3],
    ]);
    f.entities.set(5n, item);
    f.self.rawFields.set(0x172, 5);
    f.runtime.observeEntity({ type: "appear", entity: item });
    expect(
      f.runtime.snapshot().inventory.slots.find((slot) => slot.slot === 23),
    ).toMatchObject({
      status: "occupied",
      guid: 5n,
      item: { count: 3, entry: 200 },
    });
    expect(f.events.some((event) => event.type === "inventory_observed")).toBe(
      true,
    );
  });

  test("observes a child item introduced by a later equipped-bag create", () => {
    const f = fixture();
    f.self.rawFields.set(0x16a, 8);
    f.runtime.observeEntity({ type: "appear", entity: f.self });
    expect(
      f.runtime.snapshot().inventory.bags.find((bag) => bag.slot === 19)
        ?.status,
    ).toBe("unknown");
    const bag = entity(8n, ObjectType.CONTAINER, [
      [3, 500],
      [6, 1],
      [8, 1],
      [14, 1],
      [0x40, 1],
      [0x42, 5],
    ]);
    f.entities.set(8n, bag);
    f.runtime.observeEntity({ type: "appear", entity: bag });
    expect(
      f.runtime
        .snapshot()
        .inventory.slots.find((slot) => slot.bag === 19 && slot.slot === 0),
    ).toMatchObject({
      status: "occupied",
      guid: 5n,
      item: { count: undefined },
    });
    const item = entity(5n, ObjectType.ITEM, [
      [3, 200],
      [6, 1],
      [8, 8],
      [14, 3],
    ]);
    f.entities.set(5n, item);
    f.runtime.observeEntity({ type: "appear", entity: item });
    expect(
      f.events
        .at(-1)
        ?.state.inventory.slots.find(
          (slot) => slot.bag === 19 && slot.slot === 0,
        ),
    ).toMatchObject({ status: "occupied", guid: 5n, item: { count: 3 } });
  });

  test("resuming inventory observation refreshes membership changed while the listener was absent", () => {
    const f = fixture();
    f.runtime.observeEntity({ type: "appear", entity: f.self });
    f.runtime.onEvent(undefined);
    f.self.rawFields.set(0x172, 5);
    f.runtime.observeEntity({
      type: "update",
      entity: f.self,
      changed: ["rawFields"],
    });
    f.runtime.onEvent((event) => f.events.push(event));
    const item = entity(5n, ObjectType.ITEM, [
      [3, 200],
      [6, 1],
      [8, 1],
      [14, 3],
    ]);
    f.entities.set(5n, item);
    f.runtime.observeEntity({ type: "appear", entity: item });
    expect(
      f.events.at(-1)?.state.inventory.slots.find((slot) => slot.slot === 23),
    ).toMatchObject({ status: "occupied", guid: 5n, item: { count: 3 } });
  });

  test("does not label zero-GUID packets as owned before player identity is known", () => {
    const f = fixture();
    const runtime = new RewardsRuntime({
      send: () => {},
      now: () => 1000,
      selfGuid: () => 0n,
      getEntity: (guid) => f.entities.get(guid),
    });
    const unknown = bytes(push);
    unknown[0] = 0;
    runtime.handleItemPushResult(new PacketReader(unknown));
    runtime.handleLootMoneyNotify(new PacketReader(bytes("09000000 01")));
    expect(runtime.snapshot().lastItemPush).toBeUndefined();
    expect(runtime.snapshot().lastMoneyNotice).toBeUndefined();
  });

  test("money clearance and money notices never increment coinage optimistically", () => {
    const f = fixture();
    f.runtime.open(2n);
    f.runtime.handleLootResponse(new PacketReader(bytes(loot)));
    f.runtime.takeMoney();
    expect(f.sent.at(-1)).toEqual({ opcode: 0x15e, body: undefined });
    f.runtime.handleLootClearMoney(new PacketReader(bytes("")));
    expect(f.runtime.snapshot().loot).toMatchObject({ money: 0 });
    expect(f.runtime.snapshot().inventory.coinage).toBe(10);
    f.runtime.handleLootMoneyNotify(new PacketReader(bytes("09000000 01")));
    expect(f.runtime.snapshot().lastMoneyNotice).toMatchObject({
      money: 9,
      alone: true,
    });
    expect(f.runtime.snapshot().inventory.coinage).toBe(10);
    f.self.rawFields.set(0x492, 19);
    f.runtime.observeEntity({
      type: "update",
      entity: f.self,
      changed: ["rawFields"],
    });
    expect(f.runtime.snapshot().inventory.coinage).toBe(19);
    f.runtime.handleLootMoneyNotify(new PacketReader(bytes("09000000 01")));
    expect(f.runtime.snapshot().inventory.coinage).toBe(19);
  });

  test("inventory-full is an observed error and does not remove an item or resolve an unkeyed take", () => {
    const f = fixture();
    f.runtime.open(2n);
    f.runtime.handleLootResponse(new PacketReader(bytes(loot)));
    f.runtime.take(4);
    f.runtime.handleInventoryChangeFailure(
      new PacketReader(bytes("32 0000000000000000 0000000000000000 00")),
    );
    const state = f.runtime.snapshot();
    expect(state.lastInventoryError).toMatchObject({
      inventoryFull: true,
      packet: { result: 50 },
    });
    expect(state.pending).toMatchObject({
      action: "take",
      slot: 4,
      status: "unanswered",
    });
    if (state.loot.phase === "open")
      expect(state.loot.items.map((item) => item.slot)).toEqual([4, 7, 8]);
    expect(() => f.runtime.take(7)).toThrow();
    expect(f.runtime.close().loot.phase).toBe("closing");
    f.runtime.handleLootReleaseResponse(
      new PacketReader(bytes("0200000000000000 01")),
    );
    expect(f.runtime.snapshot().loot.phase).toBe("closed");
  });

  test("matching release is a barrier even when a pending slot disappears or status is unsuccessful", () => {
    const f = fixture();
    f.runtime.open(2n);
    f.runtime.handleLootResponse(new PacketReader(bytes(loot)));
    f.runtime.take(4);
    f.runtime.close();
    f.runtime.handleLootRemoved(new PacketReader(bytes("04")));
    expect(f.runtime.snapshot().pending?.action).toBe("close");
    expect(() => f.runtime.open(3n)).toThrow();
    f.runtime.handleLootReleaseResponse(
      new PacketReader(bytes("0300000000000000 01")),
    );
    f.runtime.handleLootReleaseResponse(
      new PacketReader(bytes("0200000000000000 00")),
    );
    expect(f.runtime.snapshot().loot.phase).toBe("closing");
    f.runtime.handleLootReleaseResponse(
      new PacketReader(bytes("0200000000000000 01")),
    );
    f.runtime.open(3n);
    f.runtime.handleLootResponse(new PacketReader(bytes(loot)));
    f.runtime.handleLootRemoved(new PacketReader(bytes("07")));
    expect(f.runtime.snapshot().loot).toMatchObject({
      phase: "opening",
      guid: 3n,
    });
  });

  test("accepts a same-GUID offer after an unsolicited release and preliminary ownership cleanup", () => {
    const f = fixture();
    f.runtime.open(2n);
    f.runtime.handleLootResponse(new PacketReader(bytes(loot)));
    f.runtime.take(4);
    f.runtime.handleLootReleaseResponse(
      new PacketReader(bytes("0200000000000000 01")),
    );
    expect(f.runtime.snapshot().loot.phase).toBe("closed");
    f.runtime.open(2n);
    f.runtime.handleLootReleaseResponse(
      new PacketReader(bytes("0200000000000000 01")),
    );
    expect(f.runtime.snapshot()).toMatchObject({
      loot: { phase: "opening", guid: 2n },
      pending: { action: "open", status: "unanswered" },
    });
    f.runtime.handleLootResponse(new PacketReader(bytes(loot)));
    expect(f.runtime.snapshot().loot.phase).toBe("open");
    f.runtime.take(7);
    expect(f.sent.at(-1)).toEqual({ opcode: 0x108, body: bytes("07") });
  });

  test("a release-only opening response is unanswered, not an offer or permission to retry", () => {
    const f = fixture();
    f.runtime.open(2n);
    f.runtime.handleLootReleaseResponse(
      new PacketReader(bytes("0200000000000000 01")),
    );
    expect(f.runtime.snapshot()).toMatchObject({
      loot: { phase: "opening" },
      pending: { action: "open", status: "unanswered" },
      lastRelease: { status: 1 },
    });
    expect(() => f.runtime.take(4)).toThrow();
    expect(() => f.runtime.open(2n)).toThrow();
    expect(f.sent).toEqual([
      { opcode: 0x15d, body: bytes("0200000000000000") },
    ]);
  });

  test("rejected opens and empty loot report actual outcomes without fake reward progress", () => {
    const f = fixture();
    f.runtime.open(2n);
    f.runtime.handleLootResponse(
      new PacketReader(bytes("0200000000000000 00 04")),
    );
    expect(f.runtime.snapshot()).toMatchObject({
      loot: { phase: "closed" },
      lastLootError: { guid: 2n, error: 4 },
    });
    f.runtime.open(3n);
    f.runtime.handleLootResponse(
      new PacketReader(bytes("0300000000000000 01 00000000 00")),
    );
    expect(() => f.runtime.takeMoney()).toThrow();
    expect(() => f.runtime.take(0)).toThrow();
    expect(f.runtime.snapshot().lastItemPush).toBeUndefined();
    expect(f.runtime.snapshot().lastMoneyNotice).toBeUndefined();
  });

  test("self or source disappearance invalidates the window but does not fabricate a release ACK", () => {
    const f = fixture();
    f.runtime.open(2n);
    f.runtime.handleLootResponse(new PacketReader(bytes(loot)));
    f.runtime.observeEntity({ type: "disappear", guid: 2n });
    expect(f.runtime.snapshot().loot).toMatchObject({
      phase: "open",
      invalidatedReason: "loot_source_unavailable",
    });
    expect(() => f.runtime.take(4)).toThrow();
    expect(() => f.runtime.open(3n)).toThrow();
    f.runtime.close();
    expect(f.runtime.snapshot().loot.phase).toBe("closing");
  });

  test("self disappearance hides old private inventory before the store clears its object", () => {
    const f = fixture();
    f.runtime.open(2n);
    f.runtime.handleLootResponse(new PacketReader(bytes(loot)));
    f.runtime.observeEntity({ type: "disappear", guid: 1n });
    expect(f.runtime.snapshot().inventory).toMatchObject({
      status: "unknown",
      coinage: undefined,
    });
    expect(() => f.runtime.take(4)).toThrow();
    f.runtime.observeEntity({ type: "appear", entity: f.self });
    expect(f.runtime.snapshot().inventory.coinage).toBe(10);
    expect(() => f.runtime.take(4)).toThrow();
  });

  test("snapshots cannot inject offered items and disposal prevents stale handlers or actions", () => {
    const f = fixture();
    f.runtime.open(2n);
    f.runtime.handleLootResponse(new PacketReader(bytes(loot)));
    const state = f.runtime.snapshot();
    if (state.loot.phase === "open") state.loot.items[0]!.slot = 99;
    expect(() => f.runtime.take(99)).toThrow();
    f.runtime.dispose();
    const count = f.events.length;
    f.runtime.handleItemPushResult(new PacketReader(bytes(push)));
    f.runtime.handleLootResponse(new PacketReader(bytes(loot)));
    expect(f.events.length).toBe(count);
    expect(f.runtime.snapshot()).toMatchObject({
      disposed: true,
      pending: undefined,
      lastItemPush: undefined,
    });
    expect(() => f.runtime.open(2n)).toThrow();
  });

  test("malformed packets and failed sends preserve existing authorization", () => {
    const f = fixture();
    f.runtime.open(2n);
    expect(() =>
      f.runtime.handleLootResponse(
        new PacketReader(bytes("0200000000000000 01")),
      ),
    ).toThrow(RangeError);
    expect(f.runtime.snapshot().loot.phase).toBe("opening");
    const runtime = new RewardsRuntime({
      send: () => {
        throw new Error("socket closed");
      },
      now: () => 1000,
      selfGuid: () => 1n,
      getEntity: (guid) => f.entities.get(guid),
    });
    expect(() => runtime.open(2n)).toThrow("socket closed");
    expect(runtime.snapshot()).toMatchObject({
      loot: { phase: "closed" },
      pending: undefined,
    });
  });
});
