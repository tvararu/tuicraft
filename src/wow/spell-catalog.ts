import {
  f32,
  i32,
  joinRow,
  localeString,
  openDbc,
  u32,
  type DbcFile,
} from "wow/dbc";

export type SpellPower = {
  type: number;
  costRaw: number;
  costPerLevel: number;
  costPerSecond: number;
  costPerSecondPerLevel: number;
  costPercentageOfBaseMana: number;
};

export type SpellCastTime = {
  id: number;
  castTimeMs: number;
  castTimePerLevel: number;
  minCastTimeMs: number;
};

export type SpellRange = {
  id: number;
  minHostile: number;
  minFriendly: number;
  maxHostile: number;
  maxFriendly: number;
  flags: number;
};

export type SpellDuration = {
  id: number;
  durationMs: number;
  duration1: number;
  duration2: number;
};

export type SpellRadius = {
  id: number;
  min: number;
  perLevel: number;
  max: number;
};

export type SpellEffect = {
  effect: number;
  dieSides: number;
  realPointsPerLevel: number;
  basePoints: number;
  mechanic: number;
  implicitTargetA: number;
  implicitTargetB: number;
  applyAura: number;
  amplitude: number;
  radius: SpellRadius | undefined;
};

export type SpellReagent = { itemId: number; count: number };

export type SpellAttributes = {
  raw: number;
  ex: number;
  ex2: number;
  ex3: number;
  ex4: number;
  ex5: number;
  ex6: number;
  ex7: number;
};

export type SpellTargets = {
  targets: number;
  creatureType: number;
  stances: number;
  stancesNot: number;
  facingCasterFlags: number;
  requiresSpellFocus: number;
};

export type SpellEquippedItem = {
  itemClass: number;
  subClassMask: number;
  inventoryTypeMask: number;
};

export type SpellCooldown = {
  recoveryTimeMs: number;
  category: number;
  categoryRecoveryTimeMs: number;
  startRecoveryCategory: number;
  startRecoveryTimeMs: number;
};

export type SpellAuraRequirements = {
  casterAuraState: number;
  targetAuraState: number;
  casterAuraStateNot: number;
  targetAuraStateNot: number;
  casterAuraSpell: number;
  targetAuraSpell: number;
  excludeCasterAuraSpell: number;
  excludeTargetAuraSpell: number;
};

export type SpellDefinition = {
  id: number;
  name: string;
  rank: string;
  spellLevel: number;
  baseLevel: number;
  maxLevel: number;
  power: SpellPower;
  castTime: SpellCastTime | undefined;
  range: SpellRange | undefined;
  duration: SpellDuration | undefined;
  cooldown: SpellCooldown;
  schoolMask: number;
  attributes: SpellAttributes;
  targets: SpellTargets;
  interruptFlags: number;
  equippedItem: SpellEquippedItem;
  reagents: SpellReagent[];
  effects: SpellEffect[];
  auraRequirements: SpellAuraRequirements;
};

type CatalogFiles = {
  spell: DbcFile;
  range: DbcFile;
  cast: DbcFile;
  duration: DbcFile;
  radius: DbcFile;
};

const SPELL_FIELDS = 234;
const SPELL_RECORD_SIZE = 936;

const LAYOUTS = [
  { file: "Spell.dbc", fields: SPELL_FIELDS, recordSize: SPELL_RECORD_SIZE },
  { file: "SpellRange.dbc", fields: 40, recordSize: 160 },
  { file: "SpellCastTimes.dbc", fields: 4, recordSize: 16 },
  { file: "SpellDuration.dbc", fields: 4, recordSize: 16 },
  { file: "SpellRadius.dbc", fields: 4, recordSize: 16 },
] as const;

export class SpellCatalog {
  private readonly files: CatalogFiles;
  private readonly cache = new Map<number, SpellDefinition>();

  constructor(files: CatalogFiles) {
    this.files = files;
  }

  get(spellId: number): SpellDefinition | undefined {
    const cached = this.cache.get(spellId);
    if (cached) return cached;
    const row = this.files.spell.byId.get(spellId);
    if (row === undefined) return undefined;
    const def = decodeSpell(this.files, row);
    this.cache.set(spellId, def);
    return def;
  }
}

export async function loadSpellCatalog(
  directory: string,
): Promise<SpellCatalog> {
  const loaded = await Promise.all(
    LAYOUTS.map((spec) => openDbc(directory, spec)),
  );
  return new SpellCatalog({
    spell: loaded[0]!,
    range: loaded[1]!,
    cast: loaded[2]!,
    duration: loaded[3]!,
    radius: loaded[4]!,
  });
}

function decodeCast(file: DbcFile, id: number): SpellCastTime | undefined {
  const row = joinRow(file, id);
  if (row === undefined) return undefined;
  return {
    id,
    castTimeMs: i32(file, row, 1),
    castTimePerLevel: i32(file, row, 2),
    minCastTimeMs: i32(file, row, 3),
  };
}

function decodeRange(file: DbcFile, id: number): SpellRange | undefined {
  const row = joinRow(file, id);
  if (row === undefined) return undefined;
  return {
    id,
    minHostile: f32(file, row, 1),
    minFriendly: f32(file, row, 2),
    maxHostile: f32(file, row, 3),
    maxFriendly: f32(file, row, 4),
    flags: u32(file, row, 5),
  };
}

function decodeDuration(file: DbcFile, id: number): SpellDuration | undefined {
  const row = joinRow(file, id);
  if (row === undefined) return undefined;
  return {
    id,
    durationMs: i32(file, row, 1),
    duration1: i32(file, row, 2),
    duration2: i32(file, row, 3),
  };
}

function decodeRadius(file: DbcFile, id: number): SpellRadius | undefined {
  const row = joinRow(file, id);
  if (row === undefined) return undefined;
  return {
    id,
    min: f32(file, row, 1),
    perLevel: f32(file, row, 2),
    max: f32(file, row, 3),
  };
}

function decodeReagents(spell: DbcFile, row: number): SpellReagent[] {
  const reagents: SpellReagent[] = [];
  for (let i = 0; i < 8; i++) {
    const itemId = i32(spell, row, 52 + i);
    const count = u32(spell, row, 60 + i);
    if (itemId === 0) continue;
    reagents.push({ itemId, count });
  }
  return reagents;
}

function decodeEffects(files: CatalogFiles, row: number): SpellEffect[] {
  const effects: SpellEffect[] = [];
  for (let i = 0; i < 3; i++) {
    const effect = u32(files.spell, row, 71 + i);
    if (effect === 0) continue;
    effects.push({
      effect,
      dieSides: i32(files.spell, row, 74 + i),
      realPointsPerLevel: f32(files.spell, row, 77 + i),
      basePoints: i32(files.spell, row, 80 + i),
      mechanic: u32(files.spell, row, 83 + i),
      implicitTargetA: u32(files.spell, row, 86 + i),
      implicitTargetB: u32(files.spell, row, 89 + i),
      applyAura: u32(files.spell, row, 95 + i),
      amplitude: u32(files.spell, row, 98 + i),
      radius: decodeRadius(files.radius, u32(files.spell, row, 92 + i)),
    });
  }
  return effects;
}

function decodePower(spell: DbcFile, row: number): SpellPower {
  return {
    type: u32(spell, row, 41),
    costRaw: u32(spell, row, 42),
    costPerLevel: u32(spell, row, 43),
    costPerSecond: u32(spell, row, 44),
    costPerSecondPerLevel: u32(spell, row, 45),
    costPercentageOfBaseMana: u32(spell, row, 204),
  };
}

function decodeCooldown(spell: DbcFile, row: number): SpellCooldown {
  return {
    recoveryTimeMs: u32(spell, row, 29),
    category: u32(spell, row, 1),
    categoryRecoveryTimeMs: u32(spell, row, 30),
    startRecoveryCategory: u32(spell, row, 205),
    startRecoveryTimeMs: u32(spell, row, 206),
  };
}

function decodeAttributes(spell: DbcFile, row: number): SpellAttributes {
  return {
    raw: u32(spell, row, 4),
    ex: u32(spell, row, 5),
    ex2: u32(spell, row, 6),
    ex3: u32(spell, row, 7),
    ex4: u32(spell, row, 8),
    ex5: u32(spell, row, 9),
    ex6: u32(spell, row, 10),
    ex7: u32(spell, row, 11),
  };
}

function decodeTargets(spell: DbcFile, row: number): SpellTargets {
  return {
    targets: u32(spell, row, 16),
    creatureType: u32(spell, row, 17),
    stances: u32(spell, row, 12),
    stancesNot: u32(spell, row, 14),
    facingCasterFlags: u32(spell, row, 19),
    requiresSpellFocus: u32(spell, row, 18),
  };
}

function decodeEquipped(spell: DbcFile, row: number): SpellEquippedItem {
  return {
    itemClass: i32(spell, row, 68),
    subClassMask: i32(spell, row, 69),
    inventoryTypeMask: i32(spell, row, 70),
  };
}

function decodeAuraRequirements(
  spell: DbcFile,
  row: number,
): SpellAuraRequirements {
  return {
    casterAuraState: u32(spell, row, 20),
    targetAuraState: u32(spell, row, 21),
    casterAuraStateNot: u32(spell, row, 22),
    targetAuraStateNot: u32(spell, row, 23),
    casterAuraSpell: u32(spell, row, 24),
    targetAuraSpell: u32(spell, row, 25),
    excludeCasterAuraSpell: u32(spell, row, 26),
    excludeTargetAuraSpell: u32(spell, row, 27),
  };
}

function decodeSpell(files: CatalogFiles, row: number): SpellDefinition {
  const spell = files.spell;
  return {
    id: u32(spell, row, 0),
    name: localeString(spell, row, 136),
    rank: localeString(spell, row, 153),
    spellLevel: u32(spell, row, 39),
    baseLevel: u32(spell, row, 38),
    maxLevel: u32(spell, row, 37),
    power: decodePower(spell, row),
    castTime: decodeCast(files.cast, u32(spell, row, 28)),
    range: decodeRange(files.range, u32(spell, row, 46)),
    duration: decodeDuration(files.duration, u32(spell, row, 40)),
    cooldown: decodeCooldown(spell, row),
    schoolMask: u32(spell, row, 225),
    attributes: decodeAttributes(spell, row),
    targets: decodeTargets(spell, row),
    interruptFlags: u32(spell, row, 31),
    equippedItem: decodeEquipped(spell, row),
    reagents: decodeReagents(spell, row),
    effects: decodeEffects(files, row),
    auraRequirements: decodeAuraRequirements(spell, row),
  };
}
