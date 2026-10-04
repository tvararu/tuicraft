import { describe, expect, test } from "bun:test";
import { writeFile } from "node:fs/promises";
import { scratchDir } from "@peon/core/test-support/scratch";
import {
  observedChecks,
  observeTruth,
  truthSummary,
} from "#harness/grader/draft-fill";
import type { CheckEvidence, ScenarioCheck } from "#harness/grader/scenarios";
import type { Truth, TruthItem } from "#harness/grader/truth";
import { totalXp } from "#harness/grader/xp-table";

const truth = (overrides: Partial<Truth> = {}): Truth => ({
  account: "FAC0123456789",
  alive: true,
  class: 5,
  deathState: "alive",
  guid: 1,
  health: 100,
  inventory: [
    {
      bag: 255,
      count: 20,
      item: 159,
      name: "Refreshing Spring Water",
      slot: 23,
    },
    { bag: 0, count: 5, item: 159, name: "Refreshing Spring Water", slot: 1 },
    { bag: 255, count: 1, item: 2092, name: "Worn Dagger", slot: 15 },
  ],
  level: 10,
  money: 50_000,
  name: "Fevala",
  ok: true,
  online: false,
  position: { map: 530, o: 0, x: 8735, y: -6685, z: 70.5, zone: 3430 },
  quests: [
    { itemCounts: [], mobCounts: [3], quest: 8325, rewarded: false, status: 3 },
  ],
  race: 10,
  rewardedQuests: [],
  savedAt: "2026-09-26T21:00:00.000Z",
  spells: [585],
  xp: 40,
  ...overrides,
});

async function runDir(files: Record<string, string>): Promise<string> {
  const dir = scratchDir("fill-truth");
  for (const [name, text] of Object.entries(files))
    await writeFile(`${dir}/${name}`, text);
  return dir;
}

const tr = (id: string, evidence?: CheckEvidence): ScenarioCheck => ({
  evidence,
  expect: id,
  id,
  source: "truth",
});

describe("truthSummary", () => {
  test("keeps the graded fields and sums items over every row", () => {
    expect(truthSummary(truth())).toEqual({
      alive: true,
      deathState: "alive",
      items: { "159": 25, "2092": 1 },
      level: 10,
      money: 50_000,
      position: { map: 530, o: 0, x: 8735, y: -6685, z: 70.5, zone: 3430 },
      quests: [{ quest: 8325, status: 3 }],
      rewardedQuests: [],
      xp: 40,
    });
  });
});

describe("observedChecks on truth", () => {
  const files = (final: Partial<Truth>) => ({
    "baseline.json": JSON.stringify(truth()),
    "final.json": JSON.stringify(truth(final)),
  });

  test("a delta total XP check gets level, xp and the computed delta only", async () => {
    const dir = await runDir(files({ level: 11, xp: 100 }));
    const [check] = await observedChecks(dir, [
      tr("total-xp", { delta: ["totalXp"], truth: ["totalXp"] }),
    ]);
    expect(check?.observed).toEqual({
      baseline: { level: 10, totalXp: totalXp(10, 40), xp: 40 },
      delta: { totalXp: 7660 },
      final: { level: 11, totalXp: totalXp(11, 100), xp: 100 },
    });
  });

  test("a rewarded check gets the quest lists only", async () => {
    const dir = await runDir(files({ quests: [], rewardedQuests: [8325] }));
    const [check] = await observedChecks(dir, [
      tr("rewarded", { truth: ["quests"] }),
    ]);
    expect(check?.observed).toEqual({
      baseline: { quests: [{ quest: 8325, status: 3 }], rewardedQuests: [] },
      final: { quests: [], rewardedQuests: [8325] },
    });
  });

  test("an item check gets the changed and listed items with deltas", async () => {
    const dir = await runDir(
      files({
        inventory: [
          {
            bag: 0,
            count: 10,
            item: 159,
            name: "Refreshing Spring Water",
            slot: 1,
          },
          { bag: 0, count: 1, item: 20_997, name: "Reward", slot: 2 },
          { bag: 255, count: 1, item: 2092, name: "Worn Dagger", slot: 15 },
        ],
      }),
    );
    const [check] = await observedChecks(dir, [tr("water", { items: [159] })]);
    expect(check?.observed).toEqual({
      items: {
        "159": {
          baseline: 25,
          delta: -15,
          final: 10,
          name: "Refreshing Spring Water",
        },
        "20997": { baseline: 0, delta: 1, final: 1, name: "Reward" },
      },
    });
  });

  test("a listed item is kept even when its count is unchanged or zero", async () => {
    const dir = await runDir(files({}));
    const [check] = await observedChecks(dir, [
      tr("dagger", { items: [2092, 2515] }),
    ]);
    expect(check?.observed).toEqual({
      items: {
        "2092": { baseline: 1, delta: 0, final: 1, name: "Worn Dagger" },
        "2515": { baseline: 0, delta: 0, final: 0 },
      },
    });
  });

  test("a position check gets the final position and its 2D distance to the point", async () => {
    const dir = await runDir(
      files({
        position: {
          map: 530,
          o: 0,
          x: 8703.4,
          y: -6642.4,
          z: 72.8,
          zone: 3430,
        },
      }),
    );
    const [check] = await observedChecks(dir, [
      tr("at-marniel", { point: { x: 8700.4, y: -6638.4 } }),
    ]);
    expect(check?.observed).toEqual({
      distance2d: 5,
      final: {
        position: {
          map: 530,
          o: 0,
          x: 8703.4,
          y: -6642.4,
          z: 72.8,
          zone: 3430,
        },
      },
      point: { x: 8700.4, y: -6638.4 },
    });
  });

  test("an alive check gets alive and deathState", async () => {
    const dir = await runDir(files({}));
    const [check] = await observedChecks(dir, [
      tr("alive", { truth: ["alive"] }),
    ]);
    expect(check?.observed).toEqual({
      baseline: { alive: true, deathState: "alive" },
      final: { alive: true, deathState: "alive" },
    });
  });

  test("a money check gets money and its delta", async () => {
    const dir = await runDir(files({ money: 50_030 }));
    const [check] = await observedChecks(dir, [
      tr("money", { delta: ["money"], truth: ["money"] }),
    ]);
    expect(check?.observed).toEqual({
      baseline: { money: 50_000 },
      delta: { money: 30 },
      final: { money: 50_030 },
    });
  });

  test("a missing final truth leaves final null and no delta", async () => {
    const dir = await runDir({ "baseline.json": JSON.stringify(truth()) });
    const [check] = await observedChecks(dir, [
      tr("level", { delta: ["money"], truth: ["level"] }),
    ]);
    expect(check?.observed).toEqual({ baseline: { level: 10 }, final: null });
  });

  test("no truth at all leaves the check null", async () => {
    const dir = await runDir({});
    const [check] = await observedChecks(dir, [
      tr("level", { truth: ["level"] }),
    ]);
    expect(check?.observed).toBeNull();
  });

  test("a spells check gets the sorted spell lists", async () => {
    const dir = await runDir(files({ spells: [2050, 585, 139] }));
    const [check] = await observedChecks(dir, [
      tr("spells", { truth: ["spells"] }),
    ]);
    expect(check?.observed).toEqual({
      baseline: { spells: [585] },
      final: { spells: [139, 585, 2050] },
    });
  });

  const held = (bag: number, slot: number, item: number) => ({
    bag,
    count: 1,
    item,
    name: `Item ${item}`,
    slot,
  });
  const gear = {
    inventory: [
      held(255, 0, 37_594),
      held(255, 18, 5976),
      held(255, 19, 51_809),
      held(255, 23, 6948),
      held(255, 39, 2589),
      held(255, 66, 2592),
      held(255, 73, 4500),
      held(255, 74, 117),
      held(255, 86, 30_633),
      held(0, 0, 159),
      held(-1, 4, 2770),
    ],
  };
  test("an equipment check gets only the bag 255 rows of slot 0-18", async () => {
    const dir = await runDir(files(gear));
    const [check] = await observedChecks(dir, [
      tr("gear", { truth: ["equipment"] }),
    ]);
    expect(check?.observed).toEqual({
      baseline: {
        equipment: [
          {
            bag: 255,
            count: 1,
            item: 2092,
            name: "Worn Dagger",
            slot: 15,
          },
        ],
      },
      final: {
        equipment: [held(255, 0, 37_594), held(255, 18, 5976)],
      },
    });
  });

  test("a bank check gets the bank bag rows and bag 255 slots 39-73", async () => {
    const dir = await runDir(files(gear));
    const [check] = await observedChecks(dir, [
      tr("bank", { truth: ["bank"] }),
    ]);
    expect(check?.observed).toEqual({
      baseline: { bank: [] },
      final: {
        bank: [
          held(255, 39, 2589),
          held(255, 66, 2592),
          held(255, 73, 4500),
          held(-1, 4, 2770),
        ],
      },
    });
  });

  test("hearth, reputation and mail picks show baseline and final", async () => {
    const hearth = { map: 530, x: 10_349.6, y: -6357.29, z: 33.4, zone: 3431 };
    const dir = await runDir(
      files({
        hearth,
        mail: [
          { id: 1404, items: 0, money: 150, subject: "Peon" },
          { id: 1403, items: 1, money: 0, subject: "Peon" },
        ],
        reputation: [
          { faction: 1156, flags: 16, standing: 0 },
          { faction: 21, flags: 64, standing: 2500 },
        ],
      }),
    );
    const [check] = await observedChecks(dir, [
      tr("home", { truth: ["hearth", "reputation", "mail"] }),
    ]);
    expect(check?.observed).toEqual({
      baseline: { hearth: null, mail: null, reputation: null },
      final: {
        hearth,
        mail: [
          { id: 1403, items: 1, money: 0, subject: "Peon" },
          { id: 1404, items: 0, money: 150, subject: "Peon" },
        ],
        reputation: [
          { faction: 21, flags: 64, standing: 2500 },
          { faction: 1156, flags: 16, standing: 0 },
        ],
      },
    });
  });

  const worn = (
    slot: number,
    item: number,
    durability: number,
    max: number,
  ) => ({
    ...held(255, slot, item),
    durability,
    maxDurability: max,
  });
  const wear = {
    inventory: [
      worn(4, 9749, 12, 50),
      worn(3, 53, 0, 0),
      worn(23, 2092, 5, 20),
    ],
  };
  test("durability adds per-item durability to inventory and equipment rows", async () => {
    const dir = await runDir(files(wear));
    const [check, plain] = await observedChecks(dir, [
      tr("repair", { truth: ["inventory", "equipment", "durability"] }),
      tr("plain", { truth: ["equipment"] }),
    ]);
    const final = [worn(4, 9749, 12, 50), worn(3, 53, 0, 0)];
    expect(check?.observed).toMatchObject({
      final: {
        equipment: final,
        inventory: [...final, worn(23, 2092, 5, 20)],
      },
    });
    expect(plain?.observed).toEqual({
      baseline: {
        equipment: [
          { bag: 255, count: 1, item: 2092, name: "Worn Dagger", slot: 15 },
        ],
      },
      final: { equipment: [held(255, 4, 9749), held(255, 3, 53)] },
    });
  });

  test("durability alone lists the rows that can wear", async () => {
    const dir = await runDir(files(wear));
    const [check] = await observedChecks(dir, [
      tr("repair", { truth: ["durability"] }),
    ]);
    expect(check?.observed).toEqual({
      baseline: { durability: [] },
      final: {
        durability: [worn(4, 9749, 12, 50), worn(23, 2092, 5, 20)],
      },
    });
  });

  test("a who check shows that partner's truth or why it is missing", async () => {
    const water = truth().inventory.slice(0, 1);
    const dir = await runDir({
      ...files({}),
      "partner-baseline.json": JSON.stringify(truth({ inventory: [] })),
      "partner-final.json": JSON.stringify(truth({ inventory: water })),
      "partner2-baseline.json": JSON.stringify(truth()),
    });
    const [traded, missing] = await observedChecks(dir, [
      tr("traded", { truth: ["inventory"], who: "partner" }),
      tr("paid", { truth: ["money"], who: "partner2" }),
    ]);
    expect(traded?.observed).toEqual({
      baseline: { inventory: [] },
      final: { inventory: water },
    });
    expect(missing?.met).toBe(false);
    expect(missing?.observed).toEqual({
      baseline: { money: 50_000 },
      final: null,
      reason: "partner2-final.json is missing",
    });
  });

  test("a check that selects no truth field gets the whole summary", async () => {
    const dir = await runDir(files({ money: 50_030 }));
    const [check] = await observedChecks(dir, [tr("state")]);
    expect(check?.observed).toEqual({
      baseline: truthSummary(truth()),
      final: truthSummary(truth({ money: 50_030 })),
    });
  });
});

describe("observeTruth with server-removed conjured items", () => {
  type TestRow = Pick<TruthItem, "bag" | "count" | "item" | "name" | "slot">;
  type InventorySide = { inventory: TruthItem[] };
  const isInventorySide = (side: unknown): side is InventorySide =>
    typeof side === "object" &&
    side !== null &&
    "inventory" in side &&
    Array.isArray(side.inventory);
  const row = (
    item: number,
    name: string,
    slot: number,
    count = 20,
  ): TestRow => ({ bag: 255, count, item, name, slot });
  const dagger = row(2092, "Worn Dagger", 15, 1);
  const muffin = row(5349, "Conjured Muffin", 28);
  const bread = row(1113, "Conjured Bread", 29);
  const of = (...inventory: TestRow[]) => truth({ inventory });
  const evidence = { truth: ["inventory" as const] };
  const flags = { 1113: 2_097_154, 2092: 0, 5349: 2_097_154 };
  const inventoryOf = (side: unknown): number[] => {
    if (!isInventorySide(side))
      throw new Error("observed side has no inventory");
    return side.inventory.map((entry) => entry.item);
  };

  test("drops baseline rows whose template carries the conjured flag and the final inventory lacks", () => {
    const seen = observeTruth(
      { baseline: of(dagger, muffin, bread), final: of(dagger) },
      evidence,
      flags,
    ) as { baseline: unknown; final: unknown };
    expect(inventoryOf(seen.baseline)).toEqual([2092]);
    expect(inventoryOf(seen.final)).toEqual([2092]);
  });

  test("keeps conjured rows the final inventory still holds", () => {
    const seen = observeTruth(
      { baseline: of(dagger, muffin), final: of(dagger, muffin) },
      evidence,
      flags,
    ) as { baseline: unknown };
    expect(inventoryOf(seen.baseline)).toEqual([2092, 5349]);
  });

  test("still reports a vanished item whose template is not conjured", () => {
    const seen = observeTruth(
      { baseline: of(dagger, muffin), final: of(muffin) },
      evidence,
      flags,
    ) as { baseline: unknown };
    expect(inventoryOf(seen.baseline)).toEqual([2092, 5349]);
  });

  test("keeps a vanished row whose template flags are unknown", () => {
    const seen = observeTruth(
      { baseline: of(dagger, muffin), final: of(dagger) },
      evidence,
      {},
    ) as { baseline: unknown };
    expect(inventoryOf(seen.baseline)).toEqual([2092, 5349]);
  });

  test("keeps the whole baseline when the final truth is missing", () => {
    const seen = observeTruth(
      { baseline: of(dagger, muffin, bread), final: null },
      evidence,
      flags,
    ) as { baseline: unknown };
    expect(inventoryOf(seen.baseline)).toEqual([2092, 5349, 1113]);
  });

  test("leaves item deltas free of the removed conjured items", () => {
    const seen = observeTruth(
      { baseline: of(dagger, muffin, bread), final: of(dagger) },
      { items: [1113] },
      flags,
    ) as { items: Record<string, { delta: number }> };
    expect(Object.keys(seen.items)).toEqual(["1113"]);
    expect(seen.items["1113"]?.delta).toBe(0);
  });
});
