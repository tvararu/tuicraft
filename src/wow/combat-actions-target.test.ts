import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { packDbc } from "test/dbc";
import type { CombatState } from "wow/combat";
import { targetReason, targetRelation } from "wow/combat-actions-target";
import { EntityStore } from "wow/entity-store";
import {
  type FactionTemplateCatalog,
  loadFactionTemplates,
} from "wow/faction-template";
import { ObjectType, UnitFlag } from "wow/protocol/entity-fields";

const SELF = 1n;
const PLAYER_MASK = 1;
const TEMPLATES = { self: 1, hostile: 2, neutral: 3, friendly: 4 } as const;

function template(
  id: number,
  faction: number,
  masks: { our?: number; friendly?: number; hostile?: number },
): number[] {
  const row = new Array<number>(14).fill(0);
  row[0] = id;
  row[1] = faction;
  row[3] = masks.our ?? 0;
  row[4] = masks.friendly ?? 0;
  row[5] = masks.hostile ?? 0;
  return row;
}

let dir = "";
let catalog: FactionTemplateCatalog;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "combat-target-"));
  await Bun.write(
    join(dir, "FactionTemplate.dbc"),
    packDbc(14, [
      template(TEMPLATES.self, 10, { our: PLAYER_MASK }),
      template(TEMPLATES.hostile, 20, { hostile: PLAYER_MASK }),
      template(TEMPLATES.neutral, 30, {}),
      template(TEMPLATES.friendly, 40, { friendly: PLAYER_MASK }),
    ]),
  );
  catalog = await loadFactionTemplates(dir);
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

const state = {
  self: { guid: SELF, health: 100 },
  target: { health: 100 },
} as unknown as CombatState;

function world(
  factionTemplate: number,
  options: {
    objectType?: ObjectType;
    attacking?: boolean;
    factions?: FactionTemplateCatalog;
  } = {},
) {
  const store = new EntityStore();
  store.create(SELF, ObjectType.PLAYER, {
    health: 100,
    maxHealth: 100,
    factionTemplate: TEMPLATES.self,
  });
  store.create(2n, options.objectType ?? ObjectType.UNIT, {
    health: 100,
    maxHealth: 100,
    factionTemplate,
    target: options.attacking ? SELF : 0n,
    unitFlags: options.attacking ? UnitFlag.IN_COMBAT : 0,
  });
  return {
    combat: { isAttackingSelf: () => false },
    entity: (guid: bigint) => store.get(guid),
    factions: () => ("factions" in options ? options.factions : catalog),
  };
}

describe("targetReason", () => {
  test("engages hostile and neutral creatures", () => {
    expect(targetReason(world(TEMPLATES.hostile), 2n, state)).toBeUndefined();
    expect(targetReason(world(TEMPLATES.neutral), 2n, state)).toBeUndefined();
  });

  test("refuses friendly creatures and players with distinct reasons", () => {
    expect(targetReason(world(TEMPLATES.friendly), 2n, state)).toBe(
      "target_friendly",
    );
    expect(
      targetReason(
        world(TEMPLATES.hostile, { objectType: ObjectType.PLAYER }),
        2n,
        state,
      ),
    ).toBe("target_not_pve_creature");
  });

  test("refuses an unknown relation unless the creature attacks the character", () => {
    expect(targetReason(world(99), 2n, state)).toBe(
      "unverified_hostile_relation",
    );
    expect(
      targetReason(
        world(TEMPLATES.neutral, { factions: undefined }),
        2n,
        state,
      ),
    ).toBe("unverified_hostile_relation");
    expect(
      targetReason(world(99, { attacking: true }), 2n, state),
    ).toBeUndefined();
    expect(
      targetReason(world(TEMPLATES.friendly, { attacking: true }), 2n, state),
    ).toBeUndefined();
  });
});

describe("targetRelation", () => {
  test("names the relation that decided the fight", () => {
    expect(targetRelation(world(TEMPLATES.hostile), 2n, SELF)).toBe("hostile");
    expect(targetRelation(world(TEMPLATES.neutral), 2n, SELF)).toBe("neutral");
    expect(targetRelation(world(TEMPLATES.friendly), 2n, SELF)).toBe(
      "friendly",
    );
    expect(targetRelation(world(99), 2n, SELF)).toBe("unknown");
    expect(targetRelation(world(TEMPLATES.neutral), 3n, SELF)).toBe("unknown");
  });
});
