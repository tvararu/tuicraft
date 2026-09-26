import { describe, expect, test } from "bun:test";
import {
  BOUGHT_WATER,
  BUY_FAILED_NO_MONEY,
  BUY_THREE_BAGS,
  BUY_WATER,
  LIST_MARNIEL,
  MARNIEL,
  MARNIEL_LIST_INVENTORY,
  REPAIR_ALL_SATHIEL,
  SATHIEL,
  SELL_FAILED_HEARTHSTONE,
  SELL_FAILED_NO_VENDOR,
  SELL_ROBE,
} from "#test-support/vendor-fixtures";
import { PacketReader } from "./packet";
import {
  buildBuyItem,
  buildListInventory,
  buildRepairAll,
  buildSellItem,
  buyResultName,
  parseBuyFailed,
  parseBuyItem,
  parseListInventory,
  parseSellItemFailure,
  sellResultName,
} from "./vendor";

describe("vendor requests match the captured client packets", () => {
  test("list, sell and buy", () => {
    expect(buildListInventory(MARNIEL)).toEqual(LIST_MARNIEL);
    expect(buildSellItem(MARNIEL, 0x4000_0000_000f_2da9n, 1)).toEqual(
      SELL_ROBE,
    );
    expect(buildBuyItem(MARNIEL, 159, 2, 1)).toEqual(BUY_WATER);
    expect(buildBuyItem(MARNIEL, 4497, 15, 3)).toEqual(BUY_THREE_BAGS);
  });

  test("repair all sends a zero item guid and no guild bank", () => {
    expect(buildRepairAll(SATHIEL)).toEqual(REPAIR_ALL_SATHIEL);
  });
});

describe("vendor replies from AzerothCore", () => {
  test("an innkeeper's list keeps the server's 1-based slots and unlimited stock", () => {
    const list = parseListInventory(new PacketReader(MARNIEL_LIST_INVENTORY));
    expect(list.guid).toBe(MARNIEL);
    expect(list.emptyReason).toBeUndefined();
    expect(list.items).toHaveLength(28);
    expect(list.items[1]).toEqual({
      slot: 2,
      itemId: 159,
      displayId: 18_084,
      stock: null,
      price: 23,
      maxDurability: 0,
      buyCount: 5,
      extendedCost: 0,
    });
    expect(list.items.at(-1)).toMatchObject({
      slot: 28,
      itemId: 29_014,
      price: 760,
      maxDurability: 200,
      buyCount: 1,
    });
  });

  test("an empty list carries the no-inventory code", () => {
    const empty = new Uint8Array([...LIST_MARNIEL, 0, 0]);
    expect(parseListInventory(new PacketReader(empty))).toEqual({
      guid: MARNIEL,
      items: [],
      emptyReason: 0,
    });
  });

  test("sell refusals name the out-of-range vendor and the unsellable item", () => {
    const far = parseSellItemFailure(new PacketReader(SELL_FAILED_NO_VENDOR));
    expect(far).toEqual({
      vendorGuid: 0n,
      itemGuid: 0n,
      param: undefined,
      result: 3,
    });
    expect(sellResultName(far.result)).toBe("cant_find_vendor");
    const stone = parseSellItemFailure(
      new PacketReader(SELL_FAILED_HEARTHSTONE),
    );
    expect(stone.itemGuid).toBe(0x4000_0000_000f_2daan);
    expect(sellResultName(stone.result)).toBe("cant_sell_item");
  });

  test("a purchase reports slot, unlimited stock and count", () => {
    expect(parseBuyItem(new PacketReader(BOUGHT_WATER))).toEqual({
      vendorGuid: MARNIEL,
      slot: 2,
      stock: null,
      count: 1,
    });
  });

  test("a refused purchase names the missing money", () => {
    const failed = parseBuyFailed(new PacketReader(BUY_FAILED_NO_MONEY));
    expect(failed).toEqual({
      vendorGuid: MARNIEL,
      itemId: 4497,
      param: undefined,
      result: 2,
    });
    expect(buyResultName(failed.result)).toBe("not_enough_money");
    expect(buyResultName(99)).toBe("buy_result_99");
  });
});
