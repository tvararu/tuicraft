import { describe, expect, test } from "bun:test";
import type { Entity } from "wow/entity-store";
import { readInventory } from "wow/inventory";
import { ObjectType } from "wow/protocol/entity-fields";

function entity(
  guid: bigint,
  objectType: ObjectType,
  fields: [number, number][],
  complete = true,
): Entity {
  return {
    guid,
    objectType,
    entry: 0,
    scale: 1,
    position: undefined,
    rawFields: new Map(fields),
    name: undefined,
    createComplete: complete,
  };
}

function view(entities: Entity[], selfGuid = 1n) {
  const byGuid = new Map(entities.map((value) => [value.guid, value]));
  return readInventory(selfGuid, (guid) => byGuid.get(guid));
}

describe("carried inventory authority", () => {
  test("distinguishes missing self, partial private fields, and complete empty inventory", () => {
    expect(view([]).status).toBe("unknown");
    const partial = view([entity(1n, ObjectType.PLAYER, [], false)]);
    expect(partial.status).toBe("partial");
    expect(partial.coinage).toBeUndefined();
    expect(partial.freeSlots).toBeUndefined();
    expect(
      partial.slots.find((slot) => slot.bag === 255 && slot.slot === 23)
        ?.status,
    ).toBe("unknown");
    const complete = view([entity(1n, ObjectType.PLAYER, [])]);
    expect(complete.status).toBe("complete");
    expect(complete.coinage).toBe(0);
    expect(complete.freeSlots).toBe(16);
    expect(
      complete.slots.find((slot) => slot.bag === 255 && slot.slot === 23)
        ?.status,
    ).toBe("empty");
    expect(view([entity(1n, ObjectType.UNIT, [[0x4_92, 100]])]).status).toBe(
      "unknown",
    );
    expect(
      readInventory(1n, () => entity(2n, ObjectType.PLAYER, [[0x4_92, 100]])),
    ).toMatchObject({ status: "unknown", coinage: undefined });
  });

  test("reads literal player, item, and container offsets without inventing stack count one", () => {
    const self = entity(1n, ObjectType.PLAYER, [
      [0x4_92, 987],
      [0x1_6a, 2],
      [0x1_72, 3],
    ]);
    const bag = entity(2n, ObjectType.CONTAINER, [
      [3, 100],
      [6, 1],
      [8, 1],
      [14, 1],
      [0x40, 2],
      [0x42, 4],
    ]);
    const packItem = entity(3n, ObjectType.ITEM, [
      [3, 200],
      [6, 1],
      [8, 1],
      [14, 7],
    ]);
    const bagItem = entity(4n, ObjectType.ITEM, [
      [3, 300],
      [6, 1],
      [8, 2],
      [14, 12],
    ]);
    const inventory = view([self, bag, packItem, bagItem]);
    expect(inventory.status).toBe("complete");
    expect(inventory.coinage).toBe(987);
    expect(inventory.freeSlots).toBe(16);
    expect(
      inventory.slots.find((slot) => slot.bag === 255 && slot.slot === 23),
    ).toMatchObject({
      status: "occupied",
      guid: 3n,
      item: { entry: 200, count: 7 },
    });
    expect(
      inventory.slots.find((slot) => slot.bag === 19 && slot.slot === 0),
    ).toMatchObject({
      status: "occupied",
      guid: 4n,
      item: { entry: 300, count: 12, contained: 2n },
    });
    expect(
      inventory.slots.find((slot) => slot.bag === 19 && slot.slot === 1)
        ?.status,
    ).toBe("empty");
    const missingItem = view([self, bag, packItem]);
    expect(missingItem.status).toBe("partial");
    expect(
      missingItem.slots.find((slot) => slot.bag === 19 && slot.slot === 0),
    ).toMatchObject({
      status: "occupied",
      guid: 4n,
      item: { count: undefined },
    });
  });

  test("requires both GUID halves unless complete CREATE establishes omitted zeros", () => {
    const self = entity(1n, ObjectType.PLAYER, [[0x1_72, 3]], false);
    expect(view([self]).slots.find((slot) => slot.slot === 23)?.status).toBe(
      "unknown",
    );
    self.rawFields.set(0x1_73, 0x80_00_00_00);
    expect(view([self]).slots.find((slot) => slot.slot === 23)).toMatchObject({
      status: "occupied",
      guid: 0x8000000000000003n,
    });
  });

  test("rejects other owners, wrong contained chains, aliased items and impossible bag sizes", () => {
    const self = entity(1n, ObjectType.PLAYER, [
      [0x1_6a, 2],
      [0x1_72, 3],
      [0x1_74, 3],
    ]);
    const bag = entity(2n, ObjectType.CONTAINER, [
      [3, 100],
      [6, 1],
      [8, 1],
      [14, 1],
      [0x40, 37],
    ]);
    const otherItem = entity(3n, ObjectType.ITEM, [
      [3, 200],
      [6, 9],
      [8, 8],
      [14, 7],
    ]);
    const inventory = view([self, bag, otherItem]);
    expect(inventory.status).toBe("partial");
    expect(inventory.freeSlots).toBeUndefined();
    expect(inventory.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "owner_mismatch",
        "contained_mismatch",
        "duplicate_guid",
        "invalid_bag_size",
      ]),
    );
    expect(inventory.slots.find((slot) => slot.slot === 23)).toMatchObject({
      status: "occupied",
      item: { count: undefined },
    });
    expect(inventory.slots.some((slot) => slot.bag === 19)).toBe(false);
  });

  test("does not recursively follow a container cycle or count bank storage as carried", () => {
    const self = entity(1n, ObjectType.PLAYER, [
      [0x1_6a, 2],
      [0x1_92, 9],
      [0x1_f0, 3],
      [0x2_30, 4],
    ]);
    const bag = entity(2n, ObjectType.CONTAINER, [
      [3, 100],
      [6, 1],
      [8, 1],
      [14, 1],
      [0x40, 1],
      [0x42, 2],
    ]);
    const state = view([self, bag]);
    expect(state.issues.some((issue) => issue.code === "duplicate_guid")).toBe(
      true,
    );
    expect(
      state.slots.some((slot) => slot.bag === 255 && slot.slot === 39),
    ).toBe(false);
    expect(state.slots.find((slot) => slot.slot === 86)).toMatchObject({
      status: "occupied",
      guid: 3n,
    });
    expect(state.slots.find((slot) => slot.slot === 118)).toMatchObject({
      status: "occupied",
      guid: 4n,
    });
  });

  test("does not count one equipped bag twice through two ambiguous addresses", () => {
    const self = entity(1n, ObjectType.PLAYER, [
      [0x1_6a, 2],
      [0x1_6c, 2],
    ]);
    const bag = entity(2n, ObjectType.CONTAINER, [
      [3, 100],
      [6, 1],
      [8, 1],
      [14, 1],
      [0x40, 2],
    ]);
    const state = view([self, bag]);
    expect(state.status).toBe("partial");
    expect(state.freeSlots).toBeUndefined();
    expect(
      state.bags.filter((bag) => bag.guid === 2n).map((bag) => bag.status),
    ).toEqual(["unknown", "unknown"]);
    expect(state.slots.some((slot) => slot.region === "bag_item")).toBe(false);
  });

  test("tracks raw count and coinage updates without mutating a prior snapshot", () => {
    const self = entity(1n, ObjectType.PLAYER, [
      [0x4_92, 10],
      [0x1_72, 3],
    ]);
    const item = entity(3n, ObjectType.ITEM, [
      [3, 200],
      [6, 1],
      [8, 1],
      [14, 2],
    ]);
    const before = view([self, item]);
    self.rawFields.set(0x4_92, 19);
    item.rawFields.set(14, 5);
    const after = view([self, item]);
    expect(before.coinage).toBe(10);
    expect(after.coinage).toBe(19);
    expect(before.slots.find((slot) => slot.slot === 23)).toMatchObject({
      item: { count: 2 },
    });
    expect(after.slots.find((slot) => slot.slot === 23)).toMatchObject({
      item: { count: 5 },
    });
  });
});
