import { describe, expect, jest, test } from "bun:test";
import type { SpellDefinition } from "@peon/core";
import type { TravelAfter } from "#harness/contract/details";
import { createRefTable } from "#harness/ops/refs";
import { travelSpec } from "#harness/tools/travel";
import { MOUNT_HINT_YD } from "#harness/tools/travel-mount";
import {
  driveGoto,
  setSelf,
  setUnits,
  toolCtx,
  unitRow,
} from "#test-support/ops-fixtures";
import {
  createTestRuntime,
  type TestRuntime,
} from "#test-support/runtime-fixture";
import {
  definition,
  installSpells,
  type SpellInit,
} from "#test-support/spell-tool-fixtures";

const MOUNTED_AURA = 78;
const FLIGHT_AURA = 207;
const HORSE = definition({ aura: MOUNTED_AURA, id: 458, name: "Brown Horse" });
const FIREBALL = definition({ id: 133, name: "Fireball" });

function flying(init: SpellInit) {
  const base = definition(init);
  const [first] = base.effects;
  if (!first) throw new Error("fixture has no effect");
  return {
    ...base,
    effects: [first, { ...first, applyAura: FLIGHT_AURA, effect: 6 }],
  };
}

const GRYPHON = flying({ aura: MOUNTED_AURA, id: 461, name: "Gryphon" });

type Init = {
  book?: SpellDefinition[];
  learned?: number[];
  mounted?: boolean;
  mapId?: number;
  distance?: number;
};

async function world(init: Init = {}): Promise<TestRuntime> {
  const t = await createTestRuntime({ parts: { refs: createRefTable() } });
  const distance = init.distance ?? MOUNT_HINT_YD + 50;
  installSpells(t.handle, {
    book: init.book ?? [HORSE, FIREBALL],
    ...(init.learned === undefined ? {} : { learned: init.learned }),
  });
  setSelf(t.handle, { x: 0, y: 0 });
  setUnits(t.handle, [
    unitRow({
      distance,
      guid: 0x10n,
      name: "Far Innkeeper",
      relation: "friendly",
      x: distance,
      y: 0,
    }),
  ]);
  if (init.mapId !== undefined) {
    const control = t.handle.getControlState();
    const pose = control.pose;
    if (!pose) throw new Error("no pose");
    const poseAt = { ...pose, mapId: init.mapId };
    t.handle.getControlState = () => ({
      ...control,
      pose: poseAt,
      serverPose: poseAt,
    });
  }
  jest.spyOn(t.handle.selfstate, "state").mockReturnValue({
    ...t.handle.selfstate.state(),
    mounted: init.mounted ?? false,
  });
  driveGoto(t.handle, [{ arrive: { x: distance - 1, y: 0 } }]);
  return t;
}

async function travelText(t: TestRuntime, to: string) {
  const res = await travelSpec.run({ to }, toolCtx<TravelAfter>(t));
  return (res.body ?? []).join("\n");
}

describe("travel mount hint", () => {
  test("a long outdoor unit walk on foot names the mount call", async () => {
    const t = await world();
    expect(await travelText(t, "Far Innkeeper")).toContain(
      'spell(do: "mount", spell: "Brown Horse")',
    );
  });

  test("a long outdoor point walk names the mount call", async () => {
    const t = await world();
    expect(await travelText(t, `${MOUNT_HINT_YD + 50} yd north`)).toContain(
      'spell(do: "mount"',
    );
  });

  test("a short walk, exactly the threshold, gets no hint", async () => {
    const t = await world({ distance: MOUNT_HINT_YD });
    expect(await travelText(t, "Far Innkeeper")).not.toContain("mount");
    const far = await world({ distance: MOUNT_HINT_YD + 1 });
    expect(await travelText(far, "Far Innkeeper")).toContain("mount");
  });

  test("an instance map gets no hint", async () => {
    const t = await world({ mapId: 36 });
    expect(await travelText(t, "Far Innkeeper")).not.toContain("mount");
  });

  test("a mounted character gets no hint", async () => {
    const t = await world({ mounted: true });
    expect(await travelText(t, "Far Innkeeper")).not.toContain("mount");
  });

  test("no mount spell, an unlearned one, or only a flying one gets no hint", async () => {
    for (const init of [
      { book: [FIREBALL] },
      { book: [HORSE, FIREBALL], learned: [133] },
      { book: [GRYPHON, FIREBALL] },
    ]) {
      const t = await world(init);
      expect(await travelText(t, "Far Innkeeper")).not.toContain("mount");
    }
  });
});
