import {
  type DbcFile,
  DbcTable,
  f32,
  i32,
  joinRow,
  localeString,
  openDbc,
  u32,
} from "#wow/dbc";

export type SpellPower = {
  type: number;
  costRaw: number;
  costPerLevel: number;
  costPerSecond: number;
  costPerSecondPerLevel: number;
  costPercentageOfBaseMana: number;
};

export type SpellCastTime = { id: number; castTimeMs: number };

export type SpellRange = {
  id: number;
  minHostile: number;
  maxHostile: number;
  flags: number;
};

export type SpellDuration = { id: number; durationMs: number };

export type SpellRadius = {
  id: number;
  min: number;
  perLevel: number;
  max: number;
};

export type SpellEffect = {
  effect: number;
  realPointsPerLevel: number;
  basePoints: number;
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
};

export type SpellTargeting = {
  targets: number;
  creatureType: number;
  stances: number;
  requiresSpellFocus: number;
};

export type SpellEquippedItem = { itemClass: number };

export type SpellCooldown = {
  recoveryTimeMs: number;
  category: number;
  categoryRecoveryTimeMs: number;
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
  maxLevel: number;
  power: SpellPower;
  castTime: SpellCastTime | undefined;
  range: SpellRange | undefined;
  duration: SpellDuration | undefined;
  cooldown: SpellCooldown;
  attributes: SpellAttributes;
  targets: SpellTargeting;
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

const LAYOUT = {
  spell: {
    file: "Spell.dbc",
    fields: SPELL_FIELDS,
    recordSize: SPELL_RECORD_SIZE,
  },
  range: { file: "SpellRange.dbc", fields: 40, recordSize: 160 },
  cast: { file: "SpellCastTimes.dbc", fields: 4, recordSize: 16 },
  duration: { file: "SpellDuration.dbc", fields: 4, recordSize: 16 },
  radius: { file: "SpellRadius.dbc", fields: 4, recordSize: 16 },
} as const;

export class SpellCatalog {
  private readonly table: DbcTable<SpellDefinition>;

  constructor(files: CatalogFiles) {
    this.table = new DbcTable(files.spell, (_, row) => decodeSpell(files, row));
  }

  get(spellId: number): SpellDefinition | undefined {
    return this.table.get(spellId);
  }
}

export async function loadSpellCatalog(
  directory: string,
): Promise<SpellCatalog> {
  const [spell, range, cast, duration, radius] = await Promise.all([
    openDbc(directory, LAYOUT.spell),
    openDbc(directory, LAYOUT.range),
    openDbc(directory, LAYOUT.cast),
    openDbc(directory, LAYOUT.duration),
    openDbc(directory, LAYOUT.radius),
  ]);
  return new SpellCatalog({ spell, range, cast, duration, radius });
}

function decodeCast(file: DbcFile, id: number): SpellCastTime | undefined {
  const row = joinRow(file, id);
  if (row === undefined) return undefined;
  return {
    id,
    castTimeMs: i32(file, row, 1),
  };
}

function decodeRange(file: DbcFile, id: number): SpellRange | undefined {
  const row = joinRow(file, id);
  if (row === undefined) return undefined;
  return {
    id,
    minHostile: f32(file, row, 1),
    maxHostile: f32(file, row, 3),
    flags: u32(file, row, 5),
  };
}

function decodeDuration(file: DbcFile, id: number): SpellDuration | undefined {
  const row = joinRow(file, id);
  if (row === undefined) return undefined;
  return {
    id,
    durationMs: i32(file, row, 1),
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
      realPointsPerLevel: f32(files.spell, row, 77 + i),
      basePoints: i32(files.spell, row, 80 + i),
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
    startRecoveryTimeMs: u32(spell, row, 206),
  };
}

function decodeAttributes(spell: DbcFile, row: number): SpellAttributes {
  return {
    raw: u32(spell, row, 4),
    ex: u32(spell, row, 5),
    ex2: u32(spell, row, 6),
  };
}

function decodeTargets(spell: DbcFile, row: number): SpellTargeting {
  return {
    targets: u32(spell, row, 16),
    creatureType: u32(spell, row, 17),
    stances: u32(spell, row, 12),
    requiresSpellFocus: u32(spell, row, 18),
  };
}

function decodeEquipped(spell: DbcFile, row: number): SpellEquippedItem {
  return {
    itemClass: i32(spell, row, 68),
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
    maxLevel: u32(spell, row, 37),
    power: decodePower(spell, row),
    castTime: decodeCast(files.cast, u32(spell, row, 28)),
    range: decodeRange(files.range, u32(spell, row, 46)),
    duration: decodeDuration(files.duration, u32(spell, row, 40)),
    cooldown: decodeCooldown(spell, row),
    attributes: decodeAttributes(spell, row),
    targets: decodeTargets(spell, row),
    interruptFlags: u32(spell, row, 31),
    equippedItem: decodeEquipped(spell, row),
    reagents: decodeReagents(spell, row),
    effects: decodeEffects(files, row),
    auraRequirements: decodeAuraRequirements(spell, row),
  };
}
