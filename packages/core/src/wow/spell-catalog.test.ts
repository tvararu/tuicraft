import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { packDbc } from "#test-support/dbc";
import { loadSpellCatalog } from "#wow/spell-catalog";

const SPELL_FIELDS = 234;
const RANGE_FIELDS = 40;
const CAST_FIELDS = 4;
const DURATION_FIELDS = 4;
const RADIUS_FIELDS = 4;

const dirs: string[] = [];

async function emptyDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "spell-catalog-"));
  dirs.push(dir);
  return dir;
}

function fbits(value: number): number {
  const view = new DataView(new ArrayBuffer(4));
  view.setFloat32(0, value, true);
  return view.getUint32(0, true);
}

function stringTable(strings: string[]): { block: Uint8Array; at: number[] } {
  const at = [0];
  const body: number[] = [0];
  for (const text of strings) {
    at.push(body.length);
    for (let i = 0; i < text.length; i++) body.push(text.charCodeAt(i) & 0xff);
    body.push(0);
  }
  return { block: Uint8Array.from(body), at };
}

function spellRow(cells: Record<number, number>): number[] {
  const row = new Array<number>(SPELL_FIELDS).fill(0);
  for (const [key, value] of Object.entries(cells)) row[Number(key)] = value;
  return row;
}

type FixtureTables = Partial<
  Record<"spell" | "range" | "cast" | "duration" | "radius", Uint8Array>
>;

async function writeTables(
  dir: string,
  tables: FixtureTables,
): Promise<string> {
  const names = {
    "Spell.dbc": tables.spell,
    "SpellRange.dbc": tables.range,
    "SpellCastTimes.dbc": tables.cast,
    "SpellDuration.dbc": tables.duration,
    "SpellRadius.dbc": tables.radius,
  };
  for (const [name, bytes] of Object.entries(names)) {
    if (bytes) await Bun.write(join(dir, name), bytes);
  }
  return dir;
}

function companionSet() {
  const empty = new Uint8Array([0]);
  return {
    range: packDbc(
      RANGE_FIELDS,
      [[1, fbits(0), fbits(0), fbits(30), fbits(40), 1]],
      empty,
    ),
    cast: packDbc(CAST_FIELDS, [[1, 1500, 0, 1500]], empty),
    duration: packDbc(DURATION_FIELDS, [[1, 4000, 4000, -1]], empty),
    radius: packDbc(
      RADIUS_FIELDS,
      [[8, fbits(5), fbits(0.5), fbits(25)]],
      empty,
    ),
  };
}

afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe("loadSpellCatalog", () => {
  test("fails when Spell.dbc is missing", async () => {
    const dir = await emptyDir();
    const extras = companionSet();
    await writeTables(dir, extras);
    await expect(loadSpellCatalog(dir)).rejects.toThrow(/Spell\.dbc/);
  });

  test("fails on non-WDBC magic", async () => {
    const dir = await emptyDir();
    const extras = companionSet();
    const bad = packDbc(
      SPELL_FIELDS,
      [spellRow({ 0: 1 })],
      new Uint8Array([0]),
    );
    bad[0] = 0x41;
    await writeTables(dir, { ...extras, spell: bad });
    await expect(loadSpellCatalog(dir)).rejects.toThrow(/WDBC/);
  });

  test("fails when the record payload is truncated", async () => {
    const dir = await emptyDir();
    const extras = companionSet();
    const full = packDbc(
      SPELL_FIELDS,
      [spellRow({ 0: 1 })],
      new Uint8Array([0]),
    );
    await writeTables(dir, { ...extras, spell: full.subarray(0, 40) });
    await expect(loadSpellCatalog(dir)).rejects.toThrow(/truncated/);
  });

  test("fails on unsupported Spell field count", async () => {
    const dir = await emptyDir();
    const extras = companionSet();
    const wrong = packDbc(
      10,
      [new Array<number>(10).fill(0)],
      new Uint8Array([0]),
    );
    await writeTables(dir, { ...extras, spell: wrong });
    await expect(loadSpellCatalog(dir)).rejects.toThrow(/234/);
  });

  test("fails on unsupported SpellRange layout", async () => {
    const dir = await emptyDir();
    const extras = companionSet();
    extras.range = packDbc(4, [[1, 0, 0, 0]], new Uint8Array([0]));
    await writeTables(dir, {
      ...extras,
      spell: packDbc(SPELL_FIELDS, [spellRow({ 0: 1 })], new Uint8Array([0])),
    });
    await expect(loadSpellCatalog(dir)).rejects.toThrow(/SpellRange/);
  });

  test("fails when a companion table is missing", async () => {
    const dir = await emptyDir();
    const extras = companionSet();
    await writeTables(dir, {
      spell: packDbc(SPELL_FIELDS, [spellRow({ 0: 1 })], new Uint8Array([0])),
      range: extras.range,
      cast: extras.cast,
      duration: extras.duration,
    });
    await expect(loadSpellCatalog(dir)).rejects.toThrow(/SpellRadius\.dbc/);
  });
});

describe("SpellCatalog.get", () => {
  test("returns undefined for an id absent from Spell.dbc", async () => {
    const dir = await emptyDir();
    const extras = companionSet();
    const names = stringTable(["Nope"]);
    const spell = packDbc(
      SPELL_FIELDS,
      [spellRow({ 0: 99, 136: names.at[1] ?? 0 })],
      names.block,
    );
    await writeTables(dir, { ...extras, spell });
    const catalog = await loadSpellCatalog(dir);
    expect(catalog.get(133)).toBeUndefined();
    expect(catalog.get(99)?.name).toBe("Nope");
  });

  test("joins signed, float, and locale fields without converting costs", async () => {
    const dir = await emptyDir();
    const names = stringTable(["Fireball", "Rank 1"]);
    const extras = companionSet();
    extras.range = packDbc(
      RANGE_FIELDS,
      [[4, fbits(0), fbits(0), fbits(35.5), fbits(40), 0]],
      new Uint8Array([0]),
    );
    extras.cast = packDbc(
      CAST_FIELDS,
      [[3, 1500, -50, 500]],
      new Uint8Array([0]),
    );
    const spell = packDbc(
      SPELL_FIELDS,
      [
        spellRow({
          0: 133,
          1: 11,
          4: 0x1_00_00,
          16: 0x20,
          17: 8,
          28: 3,
          29: 8000,
          30: 1500,
          38: 1,
          39: 1,
          40: 1,
          41: 0,
          42: 0,
          43: 2,
          46: 4,
          52: 17_056,
          60: 1,
          68: -1,
          71: 2,
          74: 1,
          77: fbits(0.25),
          80: -1,
          86: 6,
          92: 8,
          95: 0,
          98: 1000,
          136: names.at[1] ?? 0,
          153: names.at[2] ?? 0,
          204: 8,
          205: 133,
          206: 1500,
          225: 4,
        }),
      ],
      names.block,
    );
    await writeTables(dir, { ...extras, spell });
    const catalog = await loadSpellCatalog(dir);
    const def = catalog.get(133);
    expect(def).toBeDefined();
    if (!def) return;
    expect(def.name).toBe("Fireball");
    expect(def.rank).toBe("Rank 1");
    expect(def.power.type).toBe(0);
    expect(def.power.costRaw).toBe(0);
    expect(def.power.costPerLevel).toBe(2);
    expect(def.power.costPercentageOfBaseMana).toBe(8);
    expect(def.castTime?.castTimeMs).toBe(1500);
    expect(def.range?.maxHostile).toBeCloseTo(35.5);
    expect(def.duration?.durationMs).toBe(4000);
    expect(def.cooldown.recoveryTimeMs).toBe(8000);
    expect(def.cooldown.categoryRecoveryTimeMs).toBe(1500);
    expect(def.cooldown.startRecoveryTimeMs).toBe(1500);
    expect(def.attributes.raw).toBe(0x1_00_00);
    expect(def.targets.targets).toBe(0x20);
    expect(def.targets.creatureType).toBe(8);
    expect(def.equippedItem.itemClass).toBe(-1);
    expect(def.reagents).toEqual([{ itemId: 17_056, count: 1 }]);
    expect(def.effects).toHaveLength(1);
    expect(def.effects[0]?.effect).toBe(2);
    expect(def.effects[0]?.basePoints).toBe(-1);
    expect(def.effects[0]?.realPointsPerLevel).toBeCloseTo(0.25);
    expect(def.effects[0]?.amplitude).toBe(1000);
    expect(def.effects[0]?.radius?.min).toBeCloseTo(5);
    expect(def.effects[0]?.radius?.perLevel).toBeCloseTo(0.5);
    expect(def.effects[0]?.radius?.max).toBeCloseTo(25);
  });

  test("keeps rage cost tenths and does not invent learned-only filtering", async () => {
    const dir = await emptyDir();
    const names = stringTable(["Heroic Strike"]);
    const extras = companionSet();
    extras.range = packDbc(
      RANGE_FIELDS,
      [[2, fbits(0), fbits(0), fbits(5), fbits(5), 1]],
      new Uint8Array([0]),
    );
    extras.cast = packDbc(CAST_FIELDS, [[1, 0, 0, 0]], new Uint8Array([0]));
    const spell = packDbc(
      SPELL_FIELDS,
      [
        spellRow({
          0: 78,
          28: 1,
          39: 1,
          41: 1,
          42: 150,
          46: 2,
          136: names.at[1] ?? 0,
        }),
        spellRow({ 0: 9999, 39: 80, 136: 0 }),
      ],
      names.block,
    );
    await writeTables(dir, { ...extras, spell });
    const catalog = await loadSpellCatalog(dir);
    expect(catalog.get(78)?.power.costRaw).toBe(150);
    expect(catalog.get(78)?.power.type).toBe(1);
  });

  test("treats duration index 0 as no duration row", async () => {
    const dir = await emptyDir();
    const extras = companionSet();
    const spell = packDbc(
      SPELL_FIELDS,
      [spellRow({ 0: 585, 40: 0 })],
      new Uint8Array([0]),
    );
    await writeTables(dir, { ...extras, spell });
    expect((await loadSpellCatalog(dir)).get(585)?.duration).toBeUndefined();
  });

  test("exposes aura-state and aura-spell requirements and exclusions", async () => {
    const dir = await emptyDir();
    const extras = companionSet();
    const spell = packDbc(
      SPELL_FIELDS,
      [
        spellRow({
          0: 24_275,
          20: 2,
          21: 16,
          22: 4,
          23: 8,
          24: 11_129,
          25: 0,
          26: 0,
          27: 17,
        }),
      ],
      new Uint8Array([0]),
    );
    await writeTables(dir, { ...extras, spell });
    const aura = (await loadSpellCatalog(dir)).get(24_275)?.auraRequirements;
    expect(aura).toEqual({
      casterAuraState: 2,
      targetAuraState: 16,
      casterAuraStateNot: 4,
      targetAuraStateNot: 8,
      casterAuraSpell: 11_129,
      targetAuraSpell: 0,
      excludeCasterAuraSpell: 0,
      excludeTargetAuraSpell: 17,
    });
  });
});
