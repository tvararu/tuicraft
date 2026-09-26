import { afterEach, beforeEach, describe, expect, jest, test } from "bun:test";
import {
  BOUGHT_WATER,
  BUY_FAILED_NO_MONEY,
  BUY_WATER,
  LIST_MARNIEL,
  MARNIEL,
  MARNIEL_LIST_INVENTORY,
  SELL_FAILED_HEARTHSTONE,
  SELL_FAILED_NO_VENDOR,
  SELL_ROBE,
} from "test/vendor-fixtures";
import type { Entity } from "wow/entity-store";
import { ObjectType } from "wow/protocol/entity-fields";
import { GameOpcode } from "wow/protocol/opcodes";
import { PacketReader } from "wow/protocol/packet";
import {
  parseBuyFailed,
  parseBuyItem,
  parseListInventory,
  parseSellItemFailure,
} from "wow/protocol/vendor";
import { VENDOR_ANSWER_MS, type VendorEvent, VendorRuntime } from "wow/vendor";

const ROBE = 0x4000_0000_000f_2da9n;
const STONE = 0x4000_0000_000f_2daan;
const CHEST = 0x4000_0000_000f_0001n;
const WAND = 0x4000_0000_000f_0002n;
const COINAGE = 0x4_92;
const BACKPACK = 0x1_72;
const EQUIPMENT = 0x1_44;
const COUNT = 14;
const DURABILITY = 0x3c;

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

function item(guid: bigint, entry: number, extra: number[][]) {
  return entity(guid, ObjectType.ITEM, [[3, entry], [6, 1], [8, 1], ...extra]);
}

function slotFields(offset: number, guid: bigint): number[][] {
  return [
    [offset, Number(guid & 0xffff_ffffn)],
    [offset + 1, Number(guid >> 32n)],
  ];
}

function fixture(npcFlags = 0x10_81) {
  const self = entity(1n, ObjectType.PLAYER, [
    [0x18, 100],
    [COINAGE, 50_000],
    ...slotFields(BACKPACK, ROBE),
    ...slotFields(BACKPACK + 2, STONE),
    ...slotFields(EQUIPMENT + 8, CHEST),
    ...slotFields(EQUIPMENT + 34, WAND),
  ]);
  const vendor = { ...entity(MARNIEL, ObjectType.UNIT, []), npcFlags };
  const entities = new Map<bigint, Entity>([
    [1n, self],
    [MARNIEL, vendor],
    [ROBE, item(ROBE, 20_891, [[COUNT, 5]])],
    [STONE, item(STONE, 6948, [[COUNT, 1]])],
    [
      CHEST,
      item(CHEST, 9749, [
        [DURABILITY, 50],
        [DURABILITY + 1, 50],
      ]),
    ],
    [
      WAND,
      item(WAND, 5071, [
        [DURABILITY, 35],
        [DURABILITY + 1, 35],
      ]),
    ],
  ]);
  const sent: { opcode: number; body: Uint8Array | undefined }[] = [];
  const events: VendorEvent[] = [];
  const runtime = new VendorRuntime({
    send: (opcode, body) => sent.push({ opcode, body }),
    now: () => 1000,
    selfGuid: () => 1n,
    getEntity: (guid) => entities.get(guid),
  });
  runtime.onEvent((event) => events.push(event));
  const set = (guid: bigint, field: number, value: number) => {
    const target = entities.get(guid);
    target?.rawFields.set(field, value);
    if (target)
      runtime.observeEntity({ type: "update", entity: target, changed: [] });
  };
  const listed = () => {
    runtime.list(MARNIEL);
    runtime.receiveInventory(
      parseListInventory(new PacketReader(MARNIEL_LIST_INVENTORY)),
    );
  };
  const types = () => events.map((event) => event.type);
  return { runtime, self, entities, sent, events, set, listed, types };
}

describe("vendor listing", () => {
  test("lists an observed vendor and opens its window from the reply", () => {
    const f = fixture();
    f.runtime.list(MARNIEL);
    expect(f.sent).toEqual([
      { opcode: GameOpcode.CMSG_LIST_INVENTORY, body: LIST_MARNIEL },
    ]);
    expect(() => f.runtime.list(MARNIEL)).toThrow("remains unanswered");
    f.runtime.receiveInventory(
      parseListInventory(new PacketReader(MARNIEL_LIST_INVENTORY)),
    );
    const state = f.runtime.snapshot();
    expect(state.window?.items).toHaveLength(28);
    expect(state.pending).toBeUndefined();
    expect(state.lastOutcome).toMatchObject({
      action: "list",
      status: "confirmed",
    });
    expect(f.types()).toEqual(["list_requested", "listed"]);
  });

  test("refuses creatures that are not vendors without sending", () => {
    const f = fixture(0x01);
    expect(() => f.runtime.list(MARNIEL)).toThrow("not an observed vendor");
    expect(() => f.runtime.list(2n)).toThrow("not an observed vendor");
    expect(f.sent).toEqual([]);
  });

  test("an out-of-range vendor is refused by name", () => {
    const f = fixture();
    f.runtime.list(MARNIEL);
    f.runtime.receiveSellFailure(
      parseSellItemFailure(new PacketReader(SELL_FAILED_NO_VENDOR)),
    );
    expect(f.runtime.snapshot()).toMatchObject({
      window: undefined,
      pending: undefined,
      lastOutcome: {
        action: "list",
        status: "refused",
        reason: "cant_find_vendor",
      },
    });
  });

  test("a gossip-opened list opens the window without a request", () => {
    const f = fixture();
    f.runtime.receiveInventory(
      parseListInventory(new PacketReader(MARNIEL_LIST_INVENTORY)),
    );
    expect(f.runtime.snapshot().window?.guid).toBe(MARNIEL);
    expect(f.types()).toEqual(["listed"]);
  });

  test("the vendor disappearing invalidates the window", () => {
    const f = fixture();
    f.listed();
    f.runtime.observeEntity({ type: "disappear", guid: MARNIEL });
    expect(f.runtime.snapshot().window?.invalidatedReason).toBe(
      "vendor_unavailable",
    );
    expect(() => f.runtime.sell(255, 23)).toThrow("vendor_unavailable");
  });
});

describe("selling", () => {
  test("a sale is confirmed only once the stack leaves and money arrives", () => {
    const f = fixture();
    f.listed();
    f.runtime.sell(255, 23, 1);
    expect(f.sent.at(-1)).toEqual({
      opcode: GameOpcode.CMSG_SELL_ITEM,
      body: SELL_ROBE,
    });
    f.set(ROBE, COUNT, 4);
    expect(f.runtime.snapshot().pending?.action).toBe("sell");
    f.set(1n, COINAGE, 50_001);
    expect(f.runtime.snapshot().lastOutcome).toMatchObject({
      action: "sell",
      status: "confirmed",
      moneyDelta: 1,
      coinageAfter: 50_001,
      request: { itemId: 20_891, count: 1, stackBefore: 5 },
    });
    expect(f.types().slice(-1)).toEqual(["sold"]);
  });

  test("a whole stack is sold when its slot empties", () => {
    const f = fixture();
    f.listed();
    f.runtime.sell(255, 23);
    expect(f.runtime.snapshot().pending).toMatchObject({ count: 5 });
    f.set(1n, COINAGE, 50_005);
    expect(f.runtime.snapshot().pending).toBeDefined();
    f.set(1n, BACKPACK, 0);
    f.set(1n, BACKPACK + 1, 0);
    expect(f.runtime.snapshot().lastOutcome?.status).toBe("confirmed");
  });

  test("the server refusing the item names the reason", () => {
    const f = fixture();
    f.listed();
    f.runtime.sell(255, 24);
    f.runtime.receiveSellFailure(
      parseSellItemFailure(new PacketReader(SELL_FAILED_HEARTHSTONE)),
    );
    expect(f.runtime.snapshot().lastOutcome).toMatchObject({
      status: "refused",
      reason: "cant_sell_item",
      moneyDelta: 0,
    });
  });

  test("equipped, missing and oversized sales are refused locally", () => {
    const f = fixture();
    expect(() => f.runtime.sell(255, 23)).toThrow("No listed vendor");
    f.listed();
    expect(() => f.runtime.sell(255, 4)).toThrow("No carried bag item");
    expect(() => f.runtime.sell(255, 30)).toThrow("No carried bag item");
    expect(() => f.runtime.sell(255, 23, 6)).toThrow("exceeds the stack");
  });
});

describe("buying", () => {
  test("a purchase needs the server's confirmation and the money leaving", () => {
    const f = fixture();
    f.listed();
    f.runtime.buy(2);
    expect(f.sent.at(-1)).toEqual({
      opcode: GameOpcode.CMSG_BUY_ITEM,
      body: BUY_WATER,
    });
    f.set(1n, COINAGE, 49_977);
    expect(f.runtime.snapshot().pending?.action).toBe("buy");
    f.runtime.receiveBuyItem(parseBuyItem(new PacketReader(BOUGHT_WATER)));
    expect(f.runtime.snapshot().lastOutcome).toMatchObject({
      action: "buy",
      status: "confirmed",
      moneyDelta: -23,
      request: { itemId: 159, minPrice: 23, maxPrice: 23 },
    });
  });

  test("unoffered slots are refused locally", () => {
    const f = fixture();
    f.listed();
    expect(() => f.runtime.buy(29)).toThrow("not offered");
  });

  test("a listed-0 good bounds its charge by gold pricing", () => {
    const f = fixture();
    const good = {
      slot: 1,
      itemId: 5051,
      displayId: 0,
      stock: null,
      price: 0,
      maxDurability: 0,
      buyCount: 1,
    };
    f.runtime.list(MARNIEL);
    f.runtime.receiveInventory({
      guid: MARNIEL,
      items: [
        { ...good, extendedCost: 0 },
        { ...good, slot: 2, itemId: 29_434, extendedCost: 2587 },
      ],
      emptyReason: undefined,
    });
    f.runtime.buy(1, 3);
    expect(f.runtime.snapshot().pending).toMatchObject({
      minPrice: 0,
      maxPrice: 2,
    });
    f.runtime.receiveBuyItem({
      vendorGuid: MARNIEL,
      slot: 1,
      stock: null,
      count: 3,
    });
    f.runtime.buy(2, 3);
    f.runtime.receiveBuyItem({
      vendorGuid: MARNIEL,
      slot: 2,
      stock: null,
      count: 3,
    });
    expect(f.runtime.snapshot().lastOutcome).toMatchObject({
      status: "confirmed",
      request: { itemId: 29_434, minPrice: 0, maxPrice: 0 },
    });
  });

  test("buy failures and bag errors name the reason", () => {
    const f = fixture();
    f.listed();
    f.runtime.buy(15, 3);
    f.runtime.receiveBuyFailure(
      parseBuyFailed(new PacketReader(BUY_FAILED_NO_MONEY)),
    );
    expect(f.runtime.snapshot().lastOutcome).toMatchObject({
      status: "refused",
      reason: "not_enough_money",
      request: { minPrice: 57_000, maxPrice: 57_002 },
    });
    f.runtime.buy(2);
    f.runtime.receiveInventoryFailure({
      kind: "error",
      result: 50,
      item1: 0n,
      item2: 0n,
      bagType: 0,
      detail: { kind: "none" },
    });
    expect(f.runtime.snapshot().lastOutcome?.reason).toBe("inventory_full");
  });
});

describe("repairing", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  test("repair is confirmed when every damaged item is back to full", () => {
    const f = fixture();
    f.listed();
    expect(() => f.runtime.repair()).toThrow("Nothing needs repair");
    f.set(CHEST, DURABILITY, 45);
    f.set(WAND, DURABILITY, 30);
    f.runtime.repair();
    expect(f.sent.at(-1)?.opcode).toBe(GameOpcode.CMSG_REPAIR_ITEM);
    expect(f.runtime.snapshot().pending).toMatchObject({
      action: "repair",
      damaged: [
        { slot: 4, durability: 45, maxDurability: 50 },
        { slot: 17, durability: 30, maxDurability: 35 },
      ],
    });
    f.set(CHEST, DURABILITY, 50);
    f.set(WAND, DURABILITY, 35);
    expect(f.runtime.snapshot().pending).toBeDefined();
    f.set(1n, COINAGE, 49_990);
    expect(f.runtime.snapshot().lastOutcome).toMatchObject({
      status: "confirmed",
      moneyDelta: -10,
    });
  });

  test("a vendor without the repair flag is refused locally", () => {
    const f = fixture(0x80);
    f.listed();
    f.set(CHEST, DURABILITY, 45);
    expect(() => f.runtime.repair()).toThrow("does not repair");
  });

  test("silence ends as partial or unanswered after the answer window", () => {
    const f = fixture();
    f.listed();
    f.set(CHEST, DURABILITY, 45);
    f.set(WAND, DURABILITY, 30);
    f.runtime.repair();
    f.set(CHEST, DURABILITY, 50);
    jest.advanceTimersByTime(VENDOR_ANSWER_MS);
    expect(f.runtime.snapshot().lastOutcome).toMatchObject({
      status: "partial",
      reason: "not_repaired",
    });
    f.runtime.sell(255, 23);
    jest.advanceTimersByTime(VENDOR_ANSWER_MS);
    expect(f.runtime.snapshot().lastOutcome).toMatchObject({
      action: "sell",
      status: "unanswered",
      reason: "server_unanswered",
    });
    expect(f.types().slice(-1)).toEqual(["unanswered"]);
  });
});
