import { describe, expect, test } from "bun:test";
import type { EngageAfter } from "#harness/contract/details";
import { grayLevel } from "#harness/loops/combat-actions-credit";
import { createSightings } from "#harness/ops/sightings";
import { unitViews } from "#harness/ops/views";
import {
  checkHelper,
  chooseTarget,
  guardPull,
  LEVEL_CAP_ABOVE,
  parseQuest,
} from "#harness/tools/engage-choose";
import {
  attackBy,
  driveGoto,
  setSelf,
  setUnits,
  toolCtx,
  unitRow,
} from "#test-support/ops-fixtures";
import {
  createTestRuntime,
  type MockHandle,
} from "#test-support/runtime-fixture";

const STALKER = 0x20n;
const LYNX = 0x21n;

function stalker(distance = 22) {
  return unitRow({
    distance,
    entry: 15_366,
    guid: STALKER,
    level: 7,
    name: "Springpaw Stalker",
    x: distance,
    y: 0,
  });
}

const lynx = unitRow({
  distance: 30,
  guid: LYNX,
  level: 5,
  name: "Springpaw Lynx",
  x: 30,
  y: 0,
});

function questLog(handle: MockHandle, questId: number): void {
  const state = handle.getQuestState();
  const counters: [number, number, number, number] = [0, 0, 0, 0];
  handle.getQuestState = () => ({
    ...state,
    log: {
      complete: true,
      slots: [{ counters, expiresAtSeconds: 0, flags: 0, questId, slot: 0 }],
    },
  });
}

const REMEMBERED = 0x23n;

function remember(t: Awaited<ReturnType<typeof createTestRuntime>>) {
  t.rt.sightings = createSightings(t.rt.clock);
  setUnits(t.handle, [
    unitRow({
      distance: 8,
      entry: 15_366,
      guid: REMEMBERED,
      level: 7,
      name: "Springpaw Stalker",
      x: 8,
      y: 0,
      z: 3,
    }),
  ]);
  unitViews(toolCtx<EngageAfter>(t));
}

async function field(level: number) {
  const t = await createTestRuntime();
  setSelf(t.handle, { level });
  setUnits(t.handle, [stalker(), lynx]);
  return t;
}

describe("chooseTarget", () => {
  test("unnamed: the nearest hostile at most 3 levels above you", async () => {
    const t = await field(5);
    const choice = await chooseTarget(toolCtx<EngageAfter>(t), {});
    expect(choice).toMatchObject({
      guid: STALKER,
      mode: "single",
      named: false,
      wanted: 1,
    });
  });

  test("unnamed: a unit another player tapped is never chosen", async () => {
    const t = await field(5);
    setUnits(t.handle, [
      unitRow({
        distance: 10,
        entry: 15_366,
        guid: STALKER,
        level: 7,
        name: "Springpaw Stalker",
        tappedByOther: true,
        x: 10,
        y: 0,
      }),
      lynx,
    ]);
    const choice = await chooseTarget(toolCtx<EngageAfter>(t), {});
    expect(choice).toMatchObject({ guid: LYNX, named: false });
  });

  test("unnamed: only stronger units refuses too_strong with conditional text", async () => {
    const t = await createTestRuntime();
    setSelf(t.handle, { level: 1 });
    setUnits(t.handle, [stalker()]);
    const refused = chooseTarget(toolCtx<EngageAfter>(t), {});
    await expect(refused).rejects.toMatchObject({
      next: undefined,
      reason: "too_strong",
    });
    await expect(refused).rejects.toHaveProperty(
      "detail",
      expect.stringMatching(
        /^Springpaw Stalker u\d+ is L7, 6 levels above you\. If the human asked for this fight: engage\(target: "u\d+"\)\.$/,
      ),
    );
  });

  test("unnamed: a gray unit is passed for one that gives XP", async () => {
    const t = await createTestRuntime();
    setSelf(t.handle, { level: 20 });
    setUnits(t.handle, [
      unitRow({
        distance: 10,
        guid: 0x30n,
        level: 9,
        name: "Mistbat",
        x: 10,
        y: 0,
      }),
      unitRow({
        distance: 25,
        guid: 0x31n,
        level: 15,
        name: "Wraith",
        x: 25,
        y: 0,
      }),
    ]);
    const choice = await chooseTarget(toolCtx<EngageAfter>(t), {});
    expect(choice).toMatchObject({ guid: 0x31n, named: false });
  });

  test("unnamed: only gray units in view refuses not_seen and names them", async () => {
    const t = await createTestRuntime();
    setSelf(t.handle, { level: 20 });
    setUnits(t.handle, [
      unitRow({
        distance: 10,
        guid: 0x30n,
        level: 9,
        name: "Mistbat",
        x: 10,
        y: 0,
      }),
    ]);
    driveGoto(t.handle, [{ arrive: { x: 0, y: 0 } }]);
    const refused = chooseTarget(toolCtx<EngageAfter>(t), {});
    await expect(refused).rejects.toMatchObject({ reason: "not_seen" });
    const detail = await refused.catch(
      (error: { detail: string }) => error.detail,
    );
    expect(detail).toContain("Mistbat");
    expect(detail).toContain("no XP");
    expect(detail).toContain(`${grayLevel(20) + 1}-${20 + LEVEL_CAP_ABOVE}`);
    await expect(refused).rejects.toHaveProperty(
      "next",
      'travel(to: "explore")',
    );
  });

  test("unnamed: a gray attacker is still fought", async () => {
    const t = await createTestRuntime();
    setSelf(t.handle, { level: 20 });
    setUnits(t.handle, [
      unitRow({
        distance: 5,
        guid: 0x30n,
        level: 9,
        name: "Mistbat",
        x: 5,
        y: 0,
      }),
    ]);
    attackBy(t.handle, 0x30n);
    const choice = await chooseTarget(toolCtx<EngageAfter>(t), {});
    expect(choice.guid).toBe(0x30n);
  });

  test("a named target skips the level cap", async () => {
    const t = await field(1);
    const choice = await chooseTarget(toolCtx<EngageAfter>(t), {
      target: "Springpaw Stalker",
    });
    expect(choice).toMatchObject({ guid: STALKER, named: true });
  });

  test("named: a unit another player tapped refuses tapped_by_other", async () => {
    const t = await field(10);
    setUnits(t.handle, [
      unitRow({
        distance: 10,
        entry: 15_366,
        guid: STALKER,
        level: 7,
        name: "Springpaw Stalker",
        tappedByOther: true,
        x: 10,
        y: 0,
      }),
      lynx,
    ]);
    const refused = chooseTarget(toolCtx<EngageAfter>(t), {
      target: "Springpaw Stalker",
    });
    await expect(refused).rejects.toMatchObject({
      next: `engage(target: "${t.rt.refs.refOf(LYNX)}")`,
      reason: "tapped_by_other",
    });
    await expect(refused).rejects.toHaveProperty(
      "detail",
      expect.stringMatching(
        /^Springpaw Stalker u\d+ is tapped by another player; killing it gives you no loot, experience or quest credit\.$/,
      ),
    );
  });

  test("named: a tapped unit with no other hostile in view points at engage()", async () => {
    const t = await field(10);
    setUnits(t.handle, [
      unitRow({
        distance: 10,
        entry: 15_366,
        guid: STALKER,
        level: 7,
        name: "Springpaw Stalker",
        tappedByOther: true,
        x: 10,
        y: 0,
      }),
    ]);
    await expect(
      chooseTarget(toolCtx<EngageAfter>(t), { target: "Springpaw Stalker" }),
    ).rejects.toMatchObject({ next: "engage()", reason: "tapped_by_other" });
  });

  test("named: a tapped unit points at an untapped one of the same name", async () => {
    const t = await field(10);
    setUnits(t.handle, [
      unitRow({
        distance: 10,
        entry: 15_366,
        guid: STALKER,
        level: 7,
        name: "Springpaw Stalker",
        tappedByOther: true,
        x: 10,
        y: 0,
      }),
      unitRow({
        distance: 40,
        entry: 15_366,
        guid: 0x22n,
        level: 7,
        name: "Springpaw Stalker",
        x: 40,
        y: 0,
      }),
    ]);
    await expect(
      chooseTarget(toolCtx<EngageAfter>(t), { target: "Springpaw Stalker" }),
    ).rejects.toMatchObject({
      next: expect.stringMatching(/^engage\(target: "u\d+"\)$/),
      reason: "tapped_by_other",
    });
  });

  test("a named target not seen yet explores until it comes into view", async () => {
    const t = await createTestRuntime();
    setSelf(t.handle, { level: 10 });
    setUnits(t.handle, []);
    const goTo = driveGoto(t.handle, [
      {
        arrive: { x: 20, y: 0 },
        onArrive: () => setUnits(t.handle, [stalker()]),
      },
    ]);
    const choice = await chooseTarget(toolCtx<EngageAfter>(t), {
      target: "Springpaw Stalker",
    });
    expect(choice.guid).toBe(STALKER);
    expect(goTo).toHaveBeenCalledTimes(1);
  });

  test("named: a unit in view wins over a nearer remembered one", async () => {
    const t = await createTestRuntime();
    setSelf(t.handle, { level: 10 });
    remember(t);
    setUnits(t.handle, [stalker(30)]);
    const goTo = driveGoto(t.handle, [{ arrive: { x: 0, y: 0 } }]);
    const choice = await chooseTarget(toolCtx<EngageAfter>(t), {
      target: "Springpaw Stalker",
    });
    expect(choice.guid).toBe(STALKER);
    expect(choice.unit?.inView).toBe(true);
    expect(goTo).not.toHaveBeenCalled();
  });

  test("named: only a remembered unit walks to where it was seen first", async () => {
    const t = await createTestRuntime();
    setSelf(t.handle, { level: 10, x: -40 });
    remember(t);
    setUnits(t.handle, []);
    const goTo = driveGoto(t.handle, [
      {
        arrive: { x: 5, y: 0, z: 3 },
        onArrive: () => setUnits(t.handle, [stalker(12)]),
      },
    ]);
    const choice = await chooseTarget(toolCtx<EngageAfter>(t), {
      target: "Springpaw Stalker",
    });
    expect(goTo).toHaveBeenNthCalledWith(1, {
      kind: "point",
      x: 8,
      y: 0,
      z: 3,
    });
    expect(choice.guid).toBe(STALKER);
  });

  test("named: a remembered unit still out of view refuses with an explore step", async () => {
    const t = await createTestRuntime();
    setSelf(t.handle, { level: 10, x: -40 });
    remember(t);
    setUnits(t.handle, []);
    driveGoto(t.handle, [{ refuse: "stop: ground corridor changes surface" }]);
    const refused = chooseTarget(toolCtx<EngageAfter>(t), {
      target: "Springpaw Stalker",
    });
    await expect(refused).rejects.toMatchObject({
      next: 'travel(to: "explore north")',
      reason: "not_in_view",
    });
    await expect(refused).rejects.toHaveProperty(
      "detail",
      expect.stringMatching(
        /^Springpaw Stalker u\d+ is not in view; it was last seen 48 yd north of you\.$/,
      ),
    );
  });

  test("a unit id seen only earlier is treated like a remembered name", async () => {
    const t = await createTestRuntime();
    setSelf(t.handle, { level: 10, x: -40 });
    remember(t);
    const ref = t.rt.refs.refOf(REMEMBERED);
    setUnits(t.handle, [stalker(30)]);
    driveGoto(t.handle, [{ refuse: "stop: ground corridor changes surface" }]);
    await expect(
      chooseTarget(toolCtx<EngageAfter>(t), { target: ref }),
    ).rejects.toMatchObject({ reason: "not_in_view" });
  });

  test("count above 1 is a cycle over that kind of creature", async () => {
    const t = await field(10);
    const choice = await chooseTarget(toolCtx<EngageAfter>(t), {
      count: 3,
      target: "Springpaw Stalker",
    });
    expect(choice).toMatchObject({ mode: "cycle", wanted: 3 });
  });

  test("quest by id: the named creature is the one item source", async () => {
    const t = await field(10);
    questLog(t.handle, 8325);
    const bare = await chooseTarget(toolCtx<EngageAfter>(t), { quest: "8325" });
    expect(bare).toMatchObject({
      mode: "quest",
      questId: 8325,
      sources: [],
      unit: undefined,
    });
    const named = await chooseTarget(toolCtx<EngageAfter>(t), {
      quest: "#8325",
      target: "Springpaw Stalker",
    });
    expect(named).toMatchObject({
      mode: "quest",
      questId: 8325,
      sources: [15_366],
    });
  });

  test("an unknown quest refuses with the quest log", async () => {
    const t = await field(10);
    questLog(t.handle, 8325);
    expect(() => parseQuest(toolCtx<EngageAfter>(t), "9999")).toThrow(
      expect.objectContaining({
        body: ["#8325 (title not loaded)"],
        reason: "unknown_quest",
      }),
    );
  });
});

describe("guardPull", () => {
  test("under 50% HP refuses with rest, then the same call", async () => {
    const t = await field(10);
    setSelf(t.handle, { hp: 80, level: 10, maxHp: 200 });
    expect(() =>
      guardPull(toolCtx<EngageAfter>(t), { target: "Springpaw Stalker" }),
    ).toThrow(
      expect.objectContaining({
        next: 'rest(), then engage(target: "Springpaw Stalker")',
        reason: "low_health",
      }),
    );
  });

  test("a rage class is never refused for low power", async () => {
    const t = await field(10);
    setSelf(t.handle, { level: 10, maxPower: 100, power: 0, powerType: 1 });
    expect(() => guardPull(toolCtx<EngageAfter>(t), {})).not.toThrow();
  });

  test("another attacker must be fought first", async () => {
    const t = await field(10);
    attackBy(t.handle, LYNX);
    expect(() =>
      guardPull(toolCtx<EngageAfter>(t), { target: "Springpaw Stalker" }),
    ).toThrow(
      expect.objectContaining({
        next: expect.stringMatching(/^engage\(target: "u\d+"\)$/),
        reason: "other_attacker",
      }),
    );
  });

  test("defending against the attacker skips the HP guard", async () => {
    const t = await field(10);
    setSelf(t.handle, { hp: 60, level: 10, maxHp: 200 });
    attackBy(t.handle, STALKER);
    expect(() => guardPull(toolCtx<EngageAfter>(t), {})).not.toThrow();
  });
});

describe("checkHelper", () => {
  test("no Jev key refuses no_combat_helper", async () => {
    const t = await field(10);
    t.handle.capabilities = () => ({
      factions: true,
      jev: false,
      navigation: true,
      spells: true,
    });
    expect(() => checkHelper(toolCtx<EngageAfter>(t))).toThrow(
      expect.objectContaining({ reason: "no_combat_helper" }),
    );
  });

  test("capabilities not built yet lets the fight try", async () => {
    const t = await field(10);
    t.handle.capabilities = () => {
      throw new Error("not_implemented");
    };
    expect(() => checkHelper(toolCtx<EngageAfter>(t))).not.toThrow();
  });
});
