import { expect, jest, test } from "bun:test";
import { CombatCasts } from "wow/combat-casts";
import { CooldownStore } from "wow/cooldown-store";
import type { InventorySlot, InventoryState } from "wow/inventory";
import { ItemTemplates, useItem } from "wow/item-use";
import type { ItemTemplate } from "wow/protocol/item";
import { GameOpcode } from "wow/protocol/opcodes";

const RIBS = 0x4000_0000_000f_17a9n;

const ribs: ItemTemplate = {
  entry: 2687,
  name: "Dry Pork Ribs",
  quality: 1,
  itemClass: 0,
  subclass: 5,
  spells: [
    {
      id: 99,
      trigger: 1,
      charges: 0,
      cooldownMs: 0,
      category: 0,
      categoryCooldownMs: 0,
    },
    {
      id: 5005,
      trigger: 0,
      charges: -1,
      cooldownMs: -1,
      category: 11,
      categoryCooldownMs: 1000,
    },
  ],
};

function occupied(slot: number, guid: bigint, entry = 2687): InventorySlot {
  return {
    bag: 255,
    slot,
    region: "backpack",
    status: "occupied",
    guid,
    item: {
      guid,
      entry,
      owner: undefined,
      contained: undefined,
      count: 20,
      flags: undefined,
      randomPropertyId: undefined,
      durability: undefined,
      maxDurability: undefined,
    },
  };
}

function inventory(slots: InventorySlot[]): InventoryState {
  return {
    selfGuid: 1n,
    scope: "carried",
    status: "complete",
    coinage: 0,
    slots,
    bags: [],
    freeSlots: 0,
    issues: [],
  };
}

function setup(slots: InventorySlot[], template: ItemTemplate | undefined) {
  const used: [number, unknown][] = [];
  let current = inventory(slots);
  const deps = {
    inventory: () => current,
    templates: {
      lookup: jest.fn(async () => template),
    },
    override: jest.fn(),
    combat: {
      useItem: (spellId: number, target: unknown) => {
        used.push([spellId, target]);
      },
    },
  };
  return {
    deps,
    used,
    replace(next: InventorySlot[]) {
      current = inventory(next);
    },
  };
}

test("uses the on-use spell of the observed item in that slot", async () => {
  const s = setup([occupied(29, RIBS)], ribs);
  await useItem(s.deps, 255, 29);
  expect(s.deps.templates.lookup).toHaveBeenCalledWith(2687);
  expect(s.deps.override).toHaveBeenCalledTimes(1);
  expect(s.used).toEqual([
    [5005, { entry: 2687, bag: 255, slot: 29, guid: RIBS }],
  ]);
});

test("refuses slots and items it cannot use without taking control", async () => {
  const empty: InventorySlot = {
    bag: 255,
    slot: 28,
    region: "backpack",
    status: "empty",
  };
  const unknown: InventorySlot = { ...empty, slot: 27, status: "unknown" };
  const s = setup([occupied(29, RIBS), empty, unknown], ribs);
  await expect(useItem(s.deps, 255, 40)).rejects.toThrow("unknown_slot");
  await expect(useItem(s.deps, 255, 28)).rejects.toThrow("empty_slot");
  await expect(useItem(s.deps, 255, 27)).rejects.toThrow("slot_unobserved");
  const passive = setup([occupied(29, RIBS)], { ...ribs, spells: [] });
  await expect(useItem(passive.deps, 255, 29)).rejects.toThrow("no_use_spell");
  const missing = setup([occupied(29, RIBS)], undefined);
  await expect(useItem(missing.deps, 255, 29)).rejects.toThrow("unknown_item");
  expect([...s.used, ...passive.used, ...missing.used]).toEqual([]);
  for (const refused of [s, passive, missing])
    expect(refused.deps.override).not.toHaveBeenCalled();
});

test("refuses when the slot changed while the template was queried", async () => {
  const s = setup([occupied(29, RIBS)], ribs);
  s.deps.templates.lookup.mockImplementationOnce(async () => {
    s.replace([occupied(29, 7n)]);
    return ribs;
  });
  await expect(useItem(s.deps, 255, 29)).rejects.toThrow("slot_changed");
  expect(s.used).toEqual([]);
});

test("item templates are queried once and cached, including unknown items", async () => {
  const sent: number[] = [];
  const templates = new ItemTemplates({ send: (opcode) => sent.push(opcode) });
  const first = templates.lookup(2687);
  const second = templates.lookup(2687);
  templates.receive({ entry: 2687, template: ribs });
  expect(await first).toEqual(ribs);
  expect(await second).toEqual(ribs);
  expect(await templates.lookup(2687)).toEqual(ribs);
  const unknown = templates.lookup(9);
  templates.receive({ entry: 9, template: undefined });
  expect(await unknown).toBeUndefined();
  expect(await templates.lookup(9)).toBeUndefined();
  expect(sent).toEqual([
    GameOpcode.CMSG_ITEM_QUERY_SINGLE,
    GameOpcode.CMSG_ITEM_QUERY_SINGLE,
  ]);
});

test("an unanswered template query times out and can be asked again", async () => {
  const sent: number[] = [];
  const templates = new ItemTemplates({
    send: (opcode) => sent.push(opcode),
    timeoutMs: 5,
  });
  await expect(templates.lookup(2687)).rejects.toThrow("item_query_timeout");
  const retry = templates.lookup(2687);
  templates.receive({ entry: 2687, template: ribs });
  expect(await retry).toEqual(ribs);
  expect(sent).toHaveLength(2);
});

function casts() {
  const sent: [number, number[]][] = [];
  const store = new CooldownStore(
    () => 0,
    () => undefined,
  );
  const c = new CombatCasts({
    send: (opcode, body) => sent.push([opcode, [...(body ?? [])]]),
    now: () => 0,
    learned: new Set(),
    cooldowns: store,
  });
  return { c, sent };
}

const item = { entry: 2687, bag: 255, slot: 29, guid: RIBS };

test("an item cast carries its item through the server cast result", () => {
  const { c, sent } = casts();
  expect(c.sendItem(5005, item)).toMatchObject({ status: "sent", item });
  expect(sent[0]?.[0]).toBe(GameOpcode.CMSG_USE_ITEM);
  expect(() => c.sendItem(5005, item)).toThrow("cast_in_progress");
  expect(c.fail(5005, 1, 12, "failed")).toMatchObject({
    status: "failed",
    result: 12,
    item,
  });
  expect(c.pending).toBeUndefined();
});

test("an inventory error for the used item fails the pending item cast", () => {
  const { c } = casts();
  c.sendItem(5005, item);
  expect(c.rejectItem(8n, 60)).toBeUndefined();
  expect(c.rejectItem(RIBS, 60)).toEqual({
    kind: "cast",
    status: "failed",
    spellId: 5005,
    inventoryResult: 60,
    at: 0,
    item,
  });
  expect(c.pending).toBeUndefined();
  c.sendItem(5005, item);
  expect(c.rejectItem(0n, 22)).toMatchObject({ inventoryResult: 22 });
});

test("a potion can be used over a cast that is being cancelled, not over a live one", () => {
  const { c, sent } = casts();
  c.sendItem(5005, item);
  expect(() => c.sendItem(440, item)).toThrow("cast_in_progress");
  c.cancel();
  expect(c.sendItem(440, item)).toMatchObject({ status: "sent", spellId: 440 });
  expect(sent.map(([opcode]) => opcode)).toEqual([
    GameOpcode.CMSG_USE_ITEM,
    GameOpcode.CMSG_CANCEL_CAST,
    GameOpcode.CMSG_USE_ITEM,
  ]);
  expect(c.fail(5005, 1, 40, "interrupted")).toBeUndefined();
  expect(c.pending).toMatchObject({ spellId: 440, count: 2 });
});
