import { describe, expect, test } from "bun:test";
import type { InventoryRegion, InventoryState } from "wow/inventory";
import { keepsReserve, slotsNeeded } from "wow/loot-room";

const COLLAR = 20_797;

function bags(
  stacks: { entry: number; count: number; region?: InventoryRegion }[],
) {
  const inventory: InventoryState = {
    bags: [],
    coinage: 0,
    freeSlots: 10,
    issues: [],
    scope: "carried",
    selfGuid: 1n,
    slots: stacks.map((stack, index) => {
      const guid = BigInt(index + 2);
      return {
        bag: 255,
        guid,
        item: {
          contained: 1n,
          count: stack.count,
          durability: 0,
          entry: stack.entry,
          flags: 0,
          guid,
          maxDurability: 0,
          owner: 1n,
          randomPropertyId: 0,
        },
        region: stack.region ?? "backpack",
        slot: 23 + index,
        status: "occupied",
      };
    }),
    status: "complete",
  };
  return inventory;
}

describe("slotsNeeded", () => {
  test("an item that fits into a carried stack needs no new slot", () => {
    const inventory = bags([{ count: 3, entry: COLLAR }]);
    expect(slotsNeeded(inventory, { count: 2, itemId: COLLAR }, 20)).toBe(0);
  });

  test("a full stack, another entry or an unknown stack size needs a slot", () => {
    const full = bags([{ count: 20, entry: COLLAR }]);
    expect(slotsNeeded(full, { count: 1, itemId: COLLAR }, 20)).toBe(1);
    const other = bags([{ count: 1, entry: 750 }]);
    expect(slotsNeeded(other, { count: 1, itemId: COLLAR }, 20)).toBe(1);
    const partial = bags([{ count: 3, entry: COLLAR }]);
    expect(slotsNeeded(partial, { count: 1, itemId: COLLAR }, undefined)).toBe(
      1,
    );
  });

  test("an overflow past the room in carried stacks needs whole new stacks", () => {
    const inventory = bags([
      { count: 4, entry: COLLAR },
      { count: 5, entry: COLLAR },
    ]);
    expect(slotsNeeded(inventory, { count: 3, itemId: COLLAR }, 5)).toBe(1);
    expect(slotsNeeded(inventory, { count: 7, itemId: COLLAR }, 5)).toBe(2);
  });

  test("a stack outside the bags does not take the item", () => {
    const inventory = bags([{ count: 1, entry: COLLAR, region: "equipment" }]);
    expect(slotsNeeded(inventory, { count: 1, itemId: COLLAR }, 20)).toBe(1);
  });
});

describe("keepsReserve", () => {
  const room = { freeAtOpen: 3, usedSinceOpen: 0 };

  test("refuses the last free slot and allows the one before it", () => {
    expect(keepsReserve({ ...room, free: 1, needed: 1 })).toBe(false);
    expect(keepsReserve({ ...room, free: 2, needed: 1 })).toBe(true);
    expect(keepsReserve({ ...room, free: 2, needed: 2 })).toBe(false);
  });

  test("counts slots used in the open window before the bags show them", () => {
    const stale = { free: 3, freeAtOpen: 3, needed: 1 };
    expect(keepsReserve({ ...stale, usedSinceOpen: 1 })).toBe(true);
    expect(keepsReserve({ ...stale, usedSinceOpen: 2 })).toBe(false);
  });

  test("unobserved free slots allow only items that need no slot", () => {
    expect(keepsReserve({ ...room, free: undefined, needed: 1 })).toBe(false);
    expect(keepsReserve({ ...room, free: undefined, needed: 0 })).toBe(true);
    expect(keepsReserve({ ...room, free: 0, needed: 0 })).toBe(true);
  });
});
