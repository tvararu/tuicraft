import { expect, test } from "bun:test";
import { fakeRecovery } from "test/cycle-recovery-fixtures";
import {
  fakeControl,
  fakeLoot,
  fakeTactics,
  makeCycle,
  type Wired,
} from "test/encounter-cycle-fixtures";
import type { CycleDeps } from "wow/encounter-cycle";
import type { InventorySlot } from "wow/inventory";
import type { RewardsEvent } from "wow/rewards";

function cycle(
  loot: CycleDeps["rewards"] & Wired<RewardsEvent>,
  bags?: CycleDeps["bags"],
) {
  return makeCycle({
    bags,
    control: fakeControl(),
    loot,
    now: () => 0,
    recovery: fakeRecovery({ life: ["alive"] }),
    tactics: fakeTactics([]),
  });
}

function questItems(ids: number[], stackSize?: number): CycleDeps["bags"] {
  return { questItems: () => new Set(ids), stackSize: async () => stackSize };
}

function carried(entry: number, count: number): InventorySlot {
  const guid = 0x40_00_00_00_00_0f_0b_a2n;
  return {
    bag: 255,
    guid,
    item: {
      contained: 1n,
      count,
      durability: 0,
      entry,
      flags: 0,
      guid,
      maxDurability: 0,
      owner: 1n,
      randomPropertyId: 0,
    },
    region: "backpack",
    slot: 27,
    status: "occupied",
  };
}

test("leaves loot that would take the last free bag slot and keeps going", async () => {
  const loot = fakeLoot({ freeSlots: 2, items: [4, 7] });
  const runtime = cycle(loot);
  await runtime.start({ guids: [2n], instruction: "fight" });
  expect(loot.taken()).toEqual([4]);
  expect(runtime.snapshot()).toMatchObject({
    lastLoot: { slotsLeft: [7], slotsTaken: [4] },
    stopCause: "queue_exhausted",
  });
});

test("takes a quest item before other loot uses the free slots", async () => {
  const loot = fakeLoot({ freeSlots: 2, items: [4, 7] });
  const runtime = cycle(loot, questItems([1007]));
  await runtime.start({ guids: [2n], instruction: "fight" });
  expect(loot.taken()).toEqual([7]);
  expect(runtime.snapshot().lastLoot).toMatchObject({
    slotsLeft: [4],
    slotsTaken: [7],
  });
});

test("stops with the window closed before a quest item takes the last slot", async () => {
  const loot = fakeLoot({ freeSlots: 1, items: [4] });
  let closed = false;
  loot.closing.then(() => {
    closed = true;
  });
  const runtime = cycle(loot, questItems([1004], 20));
  await runtime.start({ guids: [2n, 3n], instruction: "fight" });
  expect(loot.taken()).toEqual([]);
  expect(closed).toBe(true);
  expect(runtime.snapshot()).toMatchObject({
    queue: [
      { guid: 2n, status: "done" },
      { guid: 3n, status: "queued" },
    ],
    stopCause: "inventory_reserve_reached",
    stopDetail: { freeSlots: 1, itemId: 1004, lootSlot: 4, reserve: 1 },
  });
});

test("takes a quest item that stacks onto a carried stack at the reserve", async () => {
  const loot = fakeLoot({
    carried: [carried(1004, 3)],
    freeSlots: 1,
    items: [4],
  });
  const runtime = cycle(loot, questItems([1004], 20));
  await runtime.start({ guids: [2n], instruction: "fight" });
  expect(loot.taken()).toEqual([4]);
  expect(runtime.snapshot().stopCause).toBe("queue_exhausted");
});

test("a halt during the stack size lookup sends no take", async () => {
  const loot = fakeLoot({ items: [4] });
  const requested = Promise.withResolvers<void>();
  const lookup = Promise.withResolvers<number | undefined>();
  const runtime = cycle(loot, {
    questItems: () => new Set(),
    stackSize: () => {
      requested.resolve();
      return lookup.promise;
    },
  });
  const run = runtime.start({ guids: [2n], instruction: "fight" });
  await requested.promise;
  runtime.stop("halt");
  lookup.resolve(20);
  await run;
  expect(loot.taken()).toEqual([]);
  expect(runtime.snapshot().stopCause).toBe("halt");
});
