import { describe, expect, test } from "bun:test";
import type { TravelAfter } from "#harness/contract/details";
import type { ToolResult } from "#harness/contract/result";
import { travelSpec } from "#harness/tools/travel";
import {
  attackBy,
  contentOf,
  driveGoto,
  limitProblem,
  MAP_ID,
  setSelf,
  setUnits,
  toolCtx,
  unitRow,
} from "#test-support/ops-fixtures";
import { createTestRuntime } from "#test-support/runtime-fixture";

const MARNIEL = unitRow({
  distance: 36,
  guid: 0x10n,
  name: "Marniel Amberlight",
  relation: "friendly",
  roles: ["vendor"],
  x: 36,
  y: 0,
});
const STALKER = unitRow({
  distance: 22,
  guid: 0x20n,
  level: 7,
  name: "Springpaw Stalker",
  x: 40,
  y: 0,
});

function fit(res: ToolResult<TravelAfter>): string {
  const text = contentOf(res);
  return limitProblem(text) ?? text;
}

async function world() {
  const t = await createTestRuntime();
  setSelf(t.handle, { x: 0, y: 0 });
  setUnits(t.handle, [MARNIEL]);
  return t;
}

describe("travel explore", () => {
  test("explore north reports what came into view", async () => {
    const t = await world();
    driveGoto(t.handle, [
      {
        arrive: { x: 20, y: 0 },
        onArrive: () => setUnits(t.handle, [MARNIEL, STALKER]),
      },
    ]);
    const res = await travelSpec.run(
      { to: "explore north" },
      toolCtx<TravelAfter>(t),
    );
    expect(res.status).toBe("DONE");
    expect(fit(res)).toMatch(
      /^DONE explored 20 yd north\. New in view: 1 hostile \(u\d+ Springpaw Stalker L7 22 yd/,
    );
  });

  test("explore walks past critters and gray mobs to a hostile worth fighting", async () => {
    const t = await world();
    const larva = unitRow({
      distance: 20,
      guid: 0x30n,
      level: 1,
      name: "Larva",
      relation: "neutral",
      x: 20,
      y: 20,
    });
    const gray = unitRow({
      distance: 22,
      guid: 0x31n,
      level: 4,
      name: "Old Wolf",
      x: 40,
      y: 10,
    });
    const boar = unitRow({
      distance: 30,
      guid: 0x32n,
      level: 15,
      name: "Bristleback",
      x: 110,
      y: 0,
    });
    driveGoto(t.handle, [
      {
        arrive: { x: 20, y: 0 },
        onArrive: () => setUnits(t.handle, [MARNIEL, larva, gray]),
      },
      { arrive: { x: 40, y: 0 } },
      { arrive: { x: 60, y: 0 } },
      {
        arrive: { x: 80, y: 0 },
        onArrive: () => setUnits(t.handle, [MARNIEL, larva, gray, boar]),
      },
      { arrive: { x: 100, y: 0 } },
    ]);
    const res = await travelSpec.run(
      { to: "explore north" },
      toolCtx<TravelAfter>(t),
    );
    const [larvaRef, grayRef, boarRef] = [0x30n, 0x31n, 0x32n].map((guid) =>
      t.rt.refs.refOf(guid),
    );
    expect(res.after.traveledYd).toBe(80);
    expect(fit(res)).toBe(
      `DONE explored 80 yd north. New in view: 1 hostile (${boarRef} Bristleback L15 30 yd N). Passed: 2 gray or critter units (${larvaRef} Larva L1, ${grayRef} Old Wolf L4).`,
    );
  });

  test("explore for a questgiver walks past hostiles", async () => {
    const t = await world();
    const boar = unitRow({
      distance: 30,
      guid: 0x32n,
      level: 12,
      name: "Bristleback",
      x: 30,
      y: 0,
    });
    const giver = unitRow({
      distance: 25,
      guid: 0x33n,
      name: "Marshal McBride",
      relation: "friendly",
      roles: ["questgiver"],
      x: 65,
      y: 0,
    });
    driveGoto(t.handle, [
      {
        arrive: { x: 20, y: 0 },
        onArrive: () => setUnits(t.handle, [MARNIEL, boar]),
      },
      {
        arrive: { x: 40, y: 0 },
        onArrive: () => setUnits(t.handle, [MARNIEL, boar, giver]),
      },
    ]);
    const res = await travelSpec.run(
      { for: "questgiver", to: "explore north" },
      toolCtx<TravelAfter>(t),
    );
    expect(res.after.traveledYd).toBe(40);
    expect(res.detail).toStartWith("explored 40 yd north.");
  });

  test("explore for a name stops only on that unit", async () => {
    const t = await world();
    const boar = unitRow({
      distance: 30,
      guid: 0x32n,
      level: 12,
      name: "Bristleback",
      x: 30,
      y: 0,
    });
    driveGoto(t.handle, [
      {
        arrive: { x: 20, y: 0 },
        onArrive: () => setUnits(t.handle, [MARNIEL, boar]),
      },
      { arrive: { x: 40, y: 0 } },
      { arrive: { x: 60, y: 0 } },
      { arrive: { x: 80, y: 0 } },
      { arrive: { x: 100, y: 0 } },
    ]);
    const res = await travelSpec.run(
      { for: "Kobold Vermin", to: "explore north" },
      toolCtx<TravelAfter>(t),
    );
    expect(res.after.traveledYd).toBe(100);
  });

  test("explore into explored ground names a bearing still unexplored", async () => {
    const t = await createTestRuntime();
    setSelf(t.handle, { x: 10, y: 10 });
    for (const cell of ["1:0", "1:-1", "1:1", "0:-1", "0:1"])
      t.rt.travel.visitedCells.add(`${MAP_ID}:${cell}`);
    driveGoto(t.handle, [{}]);
    const res = await travelSpec.run(
      { to: "explore north" },
      toolCtx<TravelAfter>(t),
    );
    expect(res).toMatchObject({
      next: 'travel(to: "explore southeast")',
      status: "DONE",
    });
    expect(res.detail).toStartWith(
      "explored 0 yd north; the ground ahead was explored already.",
    );
  });

  test("three blocked explore legs end PARTLY obstructed", async () => {
    const t = await world();
    driveGoto(t.handle, [
      { refuse: "unreachable: no path to the destination" },
      { refuse: "stop: ground corridor collision" },
    ]);
    const res = await travelSpec.run(
      { to: "explore north" },
      toolCtx<TravelAfter>(t),
    );
    expect(res).toMatchObject({
      next: 'travel(to: "explore east")',
      reason: "obstructed",
      status: "PARTLY",
    });
    expect(res.after.legs).toHaveLength(3);
    expect(fit(res)).toStartWith(
      "PARTLY obstructed: explored 0 yd north; 3 legs were blocked. Nothing new in view.",
    );
  });

  test("a ledge on three bearings names an untried bearing", async () => {
    const t = await world();
    driveGoto(t.handle, [
      { refuse: "unreachable: pathfind_find_path failed (UNKNOWN_HEIGHT)" },
    ]);
    const res = await travelSpec.run(
      { to: "explore north" },
      toolCtx<TravelAfter>(t),
    );
    expect(res).toMatchObject({
      next: 'travel(to: "explore east")',
      reason: "obstructed",
      status: "PARTLY",
    });
  });

  test("with every bearing blocked from here it asks the human", async () => {
    const t = await world();
    t.rt.travel.blockedBearings.set(
      `${MAP_ID}:0:0`,
      new Set(["NE", "E", "SE", "S", "SW", "W", "NW"]),
    );
    driveGoto(t.handle, [
      { refuse: "unreachable: no path to the destination" },
      { refuse: "stop: ground corridor collision" },
    ]);
    const res = await travelSpec.run(
      { to: "explore north" },
      toolCtx<TravelAfter>(t),
    );
    expect(res).toMatchObject({
      detail:
        "explored 0 yd north; 1 leg was blocked, each by the same fault where you stand (no_path_to). Moving off this spot also failed. Nothing new in view.",
      next: 'ask the human: "I am stuck. Can you move me?"',
      reason: "obstructed",
      status: "PARTLY",
    });
  });

  test("a second explore bearing blocked from the same cell asks the human", async () => {
    const t = await world();
    const blocked = [
      { refuse: "unreachable: no path to the destination" },
      { refuse: "stop: ground corridor collision" },
    ];
    driveGoto(t.handle, blocked);
    const first = await travelSpec.run(
      { to: "explore north" },
      toolCtx<TravelAfter>(t),
    );
    expect(first.next).toBe('travel(to: "explore east")');
    driveGoto(t.handle, blocked);
    const second = await travelSpec.run(
      { to: "explore south" },
      toolCtx<TravelAfter>(t),
    );
    expect(second).toMatchObject({
      next: 'ask the human: "Explore is blocked in more than one direction from here. Can you move me or name a way out?"',
      reason: "obstructed",
    });
    expect(t.rt.travel.obstructedExplores.get(`${MAP_ID}:0:0`)).toEqual(
      new Set(["N", "S"]),
    );
  });

  test("a unit that left view says so and looks for it", async () => {
    const t = await world();
    setUnits(t.handle, [MARNIEL, STALKER]);
    driveGoto(t.handle, [{ refuse: "stop: target_not_observed" }]);
    const res = await travelSpec.run(
      { to: "Springpaw Stalker" },
      toolCtx<TravelAfter>(t),
    );
    expect(res).toMatchObject({
      detail:
        "Springpaw Stalker is no longer in view; it may be dead or despawned.",
      next: 'look(name: "Springpaw Stalker", within: 100)',
      reason: "target_not_observed",
      status: "FAILED",
    });
  });

  test("an attacker on you refuses travel before any run", async () => {
    const t = await world();
    setUnits(t.handle, [MARNIEL, STALKER]);
    attackBy(t.handle, 0x20n);
    const ref = t.rt.refs.refOf(0x20n);
    await expect(
      travelSpec.run({ to: "explore north" }, toolCtx<TravelAfter>(t)),
    ).rejects.toMatchObject({
      detail: `Springpaw Stalker ${ref} is attacking you.`,
      next: `engage(target: "${ref}")`,
      reason: "attacked",
    });
    expect(t.rt.runs.list()).toHaveLength(0);
  });

  test("a new attacker stops an explore within the leg", async () => {
    const t = await world();
    setUnits(t.handle, [MARNIEL, STALKER]);
    const goTo = driveGoto(t.handle, [{ hold: true }]);
    const pending = travelSpec.run(
      { to: "explore north" },
      toolCtx<TravelAfter>(t),
    );
    await Bun.sleep(0);
    attackBy(t.handle, 0x20n);
    const res = await pending;
    expect(goTo).toHaveBeenCalledTimes(1);
    expect(res).toMatchObject({
      next: `engage(target: "${t.rt.refs.refOf(0x20n)}")`,
      reason: "interrupted",
      status: "FAILED",
    });
  });

  test("a gray-only explore result keeps walking the same way toward XP levels", async () => {
    const t = await world();
    driveGoto(t.handle, [
      { arrive: { x: 20, y: 0 } },
      { arrive: { x: 40, y: 0 } },
      { arrive: { x: 60, y: 0 } },
      { arrive: { x: 80, y: 0 } },
      { arrive: { x: 100, y: 0 } },
    ]);
    const res = await travelSpec.run(
      { to: "explore north" },
      toolCtx<TravelAfter>(t),
    );
    expect(res.next).toBe('travel(to: "explore north")');
    expect(res.detail).toContain("give no XP");
    expect(res.detail).toContain("L");
  });
});
