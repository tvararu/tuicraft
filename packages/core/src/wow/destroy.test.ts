import { describe, expect, jest, test } from "bun:test";
import { bytes } from "#test-support/hex";
import { DESTROY_ANSWER_MS, ItemDestroyRuntime } from "#wow/destroy";
import type { Entity } from "#wow/entity-store";
import { ObjectType } from "#wow/protocol/entity-fields";
import { GameOpcode } from "#wow/protocol/opcodes";

const JUNK = 0x4000_0000_0000_0010n;
const PILE = 0x4000_0000_0000_0011n;
const SHIRT = 0x4000_0000_0000_0012n;
const BACKPACK = 0x1_72;
const COUNT = 14;

function entity(guid: bigint, objectType: ObjectType, fields: number[][]) {
  return {
    guid,
    objectType,
    entry: 0,
    scale: 1,
    position: undefined,
    rawFields: new Map(fields.map(([k = 0, v = 0]) => [k, v])),
    name: undefined,
    createComplete: true,
  } as Entity;
}

function slotFields(offset: number, guid: bigint): number[][] {
  return [
    [offset, Number(guid & 0xffff_ffffn)],
    [offset + 1, Number(guid >> 32n)],
  ];
}

function item(guid: bigint, entry: number, count: number) {
  return entity(guid, ObjectType.ITEM, [
    [3, entry],
    [6, 1],
    [8, 1],
    [COUNT, count],
  ]);
}

function fixture() {
  const self = entity(1n, ObjectType.PLAYER, [
    [0x18, 51],
    ...slotFields(BACKPACK, JUNK),
    ...slotFields(BACKPACK + 2, PILE),
    ...slotFields(0x1_44 + 8, SHIRT),
  ]);
  const entities = new Map<bigint, Entity>([
    [1n, self],
    [JUNK, item(JUNK, 20_812, 1)],
    [PILE, item(PILE, 20_846, 300)],
    [SHIRT, item(SHIRT, 53, 1)],
  ]);
  const sent: { opcode: number; body: Uint8Array | undefined }[] = [];
  const runtime = new ItemDestroyRuntime({
    send: (opcode, body) => sent.push({ opcode, body }),
    now: () => 1000,
    selfGuid: () => 1n,
    getEntity: (guid) => entities.get(guid),
  });
  const types: string[] = [];
  runtime.onEvent((event) => types.push(event.type));
  const set = (guid: bigint, field: number, value: number) => {
    entities.get(guid)?.rawFields.set(field, value);
    runtime.observeInventory();
  };
  return { runtime, sent, set, types };
}

describe("destroying a carried item", () => {
  test("a whole stack is destroyed only once its slot is observed empty", () => {
    const f = fixture();
    f.runtime.destroy(255, 23);
    expect(f.sent).toEqual([
      { opcode: GameOpcode.CMSG_DESTROYITEM, body: bytes("ff 17 00 000000") },
    ]);
    expect(f.runtime.snapshot().pending).toMatchObject({
      itemId: 20_812,
      count: 1,
      stackBefore: 1,
    });
    expect(() => f.runtime.destroy(255, 24)).toThrow("remains unanswered");
    f.set(1n, BACKPACK, 0);
    f.set(1n, BACKPACK + 1, 0);
    expect(f.runtime.snapshot()).toMatchObject({
      pending: undefined,
      lastOutcome: { status: "confirmed", stackAfter: 0 },
    });
    expect(f.types).toEqual(["requested", "destroyed"]);
  });

  test("part of a stack sends the count and waits for the smaller stack", () => {
    const f = fixture();
    f.runtime.destroy(255, 24, 5);
    expect(f.sent[0]?.body).toEqual(bytes("ff 18 05 000000"));
    f.set(PILE, COUNT, 297);
    expect(f.runtime.snapshot().pending).toBeDefined();
    f.set(PILE, COUNT, 295);
    expect(f.runtime.snapshot().lastOutcome).toMatchObject({
      status: "confirmed",
      stackAfter: 295,
    });
  });

  test("empty, unknown, equipped and oversized requests are refused locally", () => {
    const f = fixture();
    expect(() => f.runtime.destroy(255, 30)).toThrow("No carried bag item");
    expect(() => f.runtime.destroy(19, 0)).toThrow("No carried bag item");
    expect(() => f.runtime.destroy(255, 4)).toThrow("No carried bag item");
    expect(() => f.runtime.destroy(255, 23, 2)).toThrow("exceeds the stack");
    expect(() => f.runtime.destroy(255, 24, 256)).toThrow("limited to 255");
    expect(f.sent).toEqual([]);
  });

  test("a server refusal is named and silence ends unanswered", () => {
    jest.useFakeTimers();
    try {
      const f = fixture();
      f.runtime.destroy(255, 23);
      f.runtime.receiveInventoryFailure({
        kind: "error",
        result: 24,
        item1: 0n,
        item2: 0n,
        bagType: 0,
        detail: { kind: "none" },
      });
      expect(f.runtime.snapshot().lastOutcome).toMatchObject({
        status: "refused",
        reason: "cant_drop_soulbound",
        stackAfter: 1,
      });
      f.runtime.destroy(255, 23);
      jest.advanceTimersByTime(DESTROY_ANSWER_MS);
      expect(f.runtime.snapshot().lastOutcome).toMatchObject({
        status: "unanswered",
        reason: "server_unanswered",
      });
    } finally {
      jest.useRealTimers();
    }
  });
});
