import { describe, expect, jest, test } from "bun:test";
import {
  LESSER_HEALING_POTION_RESPONSE,
  UNKNOWN_ITEM_999999_RESPONSE,
} from "#test-support/item-query-fixtures";
import { createMockHandle } from "#test-support/mock-handle";
import { EntityStore } from "#wow/entity-store";
import { labelRewards } from "#wow/item-labels";
import { ItemTemplates } from "#wow/item-use";
import { ObjectType } from "#wow/protocol/entity-fields";
import { parseItemQueryResponse } from "#wow/protocol/item";
import { PacketReader } from "#wow/protocol/packet";
import type { RewardsState } from "#wow/rewards";

function fixture() {
  const queried: number[] = [];
  const templates = new ItemTemplates({
    send: (_opcode, body) => {
      if (body) queried.push(new PacketReader(body).uint32LE());
    },
  });
  const answer = (packet: Uint8Array) =>
    templates.receive(parseItemQueryResponse(new PacketReader(packet)));
  return { queried, templates, answer };
}

const unanswered = { name: null, quality: null };

describe("item labels", () => {
  test("queries an entry once and names it after the answer", () => {
    const f = fixture();
    expect(f.templates.label(858)).toEqual(unanswered);
    expect(f.templates.label(858)).toEqual(unanswered);
    expect(f.queried).toEqual([858]);
    f.answer(LESSER_HEALING_POTION_RESPONSE);
    expect(f.templates.label(858)).toEqual({
      name: "Lesser Healing Potion",
      quality: 1,
    });
    expect(f.queried).toEqual([858]);
  });

  test("keeps an unknown item null after the server denies it", () => {
    const f = fixture();
    f.templates.label(999_999);
    f.answer(UNKNOWN_ITEM_999999_RESPONSE);
    expect(f.templates.label(999_999)).toEqual(unanswered);
    expect(f.queried).toEqual([999_999]);
  });

  test("never queries an absent entry", () => {
    const f = fixture();
    expect(f.templates.label(undefined)).toEqual(unanswered);
    expect(f.templates.label(0)).toEqual(unanswered);
    expect(f.queried).toEqual([]);
  });

  test("keeps an unanswered entry null and asks again only after the wait", async () => {
    jest.useFakeTimers();
    try {
      const f = fixture();
      f.templates.label(2687);
      jest.advanceTimersByTime(1000);
      expect(f.templates.label(2687)).toEqual(unanswered);
      expect(f.queried).toEqual([2687]);
      jest.advanceTimersByTime(5000);
      for (let tick = 0; tick < 5; tick++) await Promise.resolve();
      expect(f.templates.label(2687)).toEqual(unanswered);
      expect(f.queried).toEqual([2687, 2687]);
    } finally {
      jest.useRealTimers();
    }
  });

  test("retries an entry whose query could not be sent", () => {
    let fail = true;
    const queried: number[] = [];
    const templates = new ItemTemplates({
      send: (_opcode, body) => {
        if (fail) throw new Error("World socket is not connected");
        if (body) queried.push(new PacketReader(body).uint32LE());
      },
    });
    templates.label(858);
    fail = false;
    templates.label(858);
    expect(queried).toEqual([858]);
  });

  test("queries carried items as they appear, not creatures", () => {
    const f = fixture();
    const store = new EntityStore();
    store.onEvent((event) => f.templates.observeEntity(event));
    store.create(1n, ObjectType.ITEM, { entry: 801 });
    store.create(2n, ObjectType.CONTAINER, { entry: 802 });
    store.create(3n, ObjectType.UNIT, { entry: 3 });
    store.update(1n, { entry: 801 });
    expect(f.queried).toEqual([801, 802]);
  });

  test("queries loot offers when the window opens", () => {
    const f = fixture();
    const base = createMockHandle().getRewardsState();
    const item = {
      count: 1,
      displayId: 0,
      randomPropertyId: 0,
      randomSuffix: 0,
      slotType: 0,
    };
    const state: RewardsState = {
      ...base,
      inventory: { ...base.inventory, slots: [] },
      loot: {
        guid: 5n,
        invalidatedReason: undefined,
        items: [
          { ...item, itemId: 4775, slot: 0 },
          { ...item, itemId: 858, slot: 1 },
        ],
        lootType: 1,
        money: 0,
        openedAt: 1,
        phase: "open",
      },
    };
    f.templates.observeRewards({ at: 1, state, type: "loot_removed" });
    expect(f.queried).toEqual([]);
    f.templates.observeRewards({ at: 1, state, type: "loot_opened" });
    expect(f.queried).toEqual([4775, 858]);
    f.answer(LESSER_HEALING_POTION_RESPONSE);
    const named = labelRewards(state, (entry) => f.templates.label(entry));
    expect(named.loot).toMatchObject({
      items: [
        { itemId: 4775, name: null, quality: null },
        { itemId: 858, name: "Lesser Healing Potion", quality: 1 },
      ],
    });
  });
});
