import { type PacketReader, PacketWriter } from "#wow/protocol/packet";

const SpellTargetFlag = {
  UNIT: 0x00_00_00_02,
  ITEM: 0x00_00_00_10,
  SOURCE_LOCATION: 0x00_00_00_20,
  DEST_LOCATION: 0x00_00_00_40,
  CORPSE_ENEMY: 0x00_00_02_00,
  GAMEOBJECT: 0x00_00_08_00,
  TRADE_ITEM: 0x00_00_10_00,
  STRING: 0x00_00_20_00,
  CORPSE_ALLY: 0x00_00_80_00,
  MINIPET: 0x00_01_00_00,
} as const;

const SpellCastFlag = {
  PROJECTILE: 0x00_00_00_20,
  POWER_LEFT_SELF: 0x00_00_08_00,
  ADJUST_MISSILE: 0x00_02_00_00,
  VISUAL_CHAIN: 0x00_08_00_00,
  RUNE_LIST: 0x00_20_00_00,
  UNKNOWN_23: 0x00_40_00_00,
} as const;

export const SpellCastResult = {
  INTERRUPTED: 40,
} as const;

const SPELL_MISS_REFLECT = 11;
const RUNE_SLOTS = 6;

const TARGET_OBJECT =
  SpellTargetFlag.UNIT |
  SpellTargetFlag.MINIPET |
  SpellTargetFlag.GAMEOBJECT |
  SpellTargetFlag.CORPSE_ENEMY |
  SpellTargetFlag.CORPSE_ALLY;
const TARGET_ITEM_MASK = SpellTargetFlag.ITEM | SpellTargetFlag.TRADE_ITEM;

export type SpellLocation = {
  transport: bigint;
  x: number;
  y: number;
  z: number;
};

export type SpellTargets = {
  flags: number;
  objectGuid?: bigint;
  itemGuid?: bigint;
  source?: SpellLocation;
  dest?: SpellLocation;
  name?: string;
};

export type SpellAmmo = {
  displayId: number;
  inventoryType: number;
};

export type SpellStart = {
  castItem: bigint;
  caster: bigint;
  castCount: number;
  spellId: number;
  flags: number;
  timer: number;
  targets: SpellTargets;
  power?: number;
  ammo?: SpellAmmo;
};

type SpellStartExtras = Pick<SpellStart, "power" | "ammo">;

export type SpellMiss = {
  guid: bigint;
  reason: number;
  reflect?: number;
};

export type SpellRuneState = {
  initial: number;
  after: number;
  cooldowns: number[];
};

export type SpellMissile = {
  elevation: number;
  delay: number;
};

export type SpellGo = {
  castItem: bigint;
  caster: bigint;
  extraCasts: number;
  spellId: number;
  flags: number;
  timestamp: number;
  hits: bigint[];
  misses: SpellMiss[];
  targets: SpellTargets;
  power?: number;
  runes?: SpellRuneState;
  missile?: SpellMissile;
  ammo?: SpellAmmo;
  destUnknown?: number;
};

type SpellGoExtras = Pick<
  SpellGo,
  "power" | "runes" | "missile" | "ammo" | "destUnknown"
>;

export type InitialSpell = { spellId: number };

export type InitialCooldown = {
  spellId: number;
  itemId: number;
  category: number;
  cooldown: number;
  categoryCooldown: number;
};

export type InitialSpells = {
  spells: InitialSpell[];
  cooldowns: InitialCooldown[];
};

export type CastFailed = {
  castCount: number;
  spellId: number;
  result: number;
  extra: number[];
};

export type SpellFailure = {
  caster: bigint;
  extraCasts: number;
  spellId: number;
  result: number;
};

export type SpellCooldownEntry = {
  spellId: number;
  time: number;
};

export type SpellCooldown = {
  guid: bigint;
  flags: number;
  cooldowns: SpellCooldownEntry[];
};

export type LearnedSpell = { spellId: number };

export type RemovedSpell = {
  spellId: number;
};

export type SupersededSpell = {
  superseded: number;
  learned: number;
};

export type SpellDelayed = { caster: bigint; delayMs: number };

export type CooldownNotice = { spellId: number; guid: bigint };

function remainingUint32s(r: PacketReader): number[] {
  const extra: number[] = [];
  while (r.remaining >= 4) extra.push(r.uint32LE());
  return extra;
}

function readLocation(r: PacketReader): SpellLocation {
  return { transport: r.packedGuidBig(), ...r.vec3() };
}

function parseSpellTargets(r: PacketReader): SpellTargets {
  const flags = r.uint32LE();
  const objectGuid = flags & TARGET_OBJECT ? r.packedGuidBig() : undefined;
  const itemGuid = flags & TARGET_ITEM_MASK ? r.packedGuidBig() : undefined;
  const source =
    flags & SpellTargetFlag.SOURCE_LOCATION ? readLocation(r) : undefined;
  const dest =
    flags & SpellTargetFlag.DEST_LOCATION ? readLocation(r) : undefined;
  const name = flags & SpellTargetFlag.STRING ? r.cString() : undefined;
  return { flags, objectGuid, itemGuid, source, dest, name };
}

function readHits(r: PacketReader): bigint[] {
  const count = r.uint8();
  const hits: bigint[] = [];
  for (let i = 0; i < count; i++) hits.push(r.uint64LE());
  return hits;
}

function readMisses(r: PacketReader): SpellMiss[] {
  const count = r.uint8();
  const misses: SpellMiss[] = [];
  for (let i = 0; i < count; i++) {
    const guid = r.uint64LE();
    const reason = r.uint8();
    const reflect = reason === SPELL_MISS_REFLECT ? r.uint8() : undefined;
    misses.push({ guid, reason, reflect });
  }
  return misses;
}

function readRuneState(r: PacketReader): SpellRuneState {
  const initial = r.uint8();
  const after = r.uint8();
  const cooldowns: number[] = [];
  for (let i = 0; i < RUNE_SLOTS; i++) {
    const bit = 1 << i;
    if (bit & initial && !(bit & after)) cooldowns.push(r.uint8());
  }
  return { initial, after, cooldowns };
}

function parseStartExtras(r: PacketReader, flags: number): SpellStartExtras {
  const power =
    flags & SpellCastFlag.POWER_LEFT_SELF ? r.uint32LE() : undefined;
  const ammo =
    flags & SpellCastFlag.PROJECTILE
      ? { displayId: r.uint32LE(), inventoryType: r.uint32LE() }
      : undefined;
  if (flags & SpellCastFlag.UNKNOWN_23) r.skip(8);
  return { power, ammo };
}

function parseGoExtras(
  r: PacketReader,
  flags: number,
  targetFlags: number,
): SpellGoExtras {
  const power =
    flags & SpellCastFlag.POWER_LEFT_SELF ? r.uint32LE() : undefined;
  const runes = flags & SpellCastFlag.RUNE_LIST ? readRuneState(r) : undefined;
  const missile =
    flags & SpellCastFlag.ADJUST_MISSILE
      ? { elevation: r.floatLE(), delay: r.uint32LE() }
      : undefined;
  const ammo =
    flags & SpellCastFlag.PROJECTILE
      ? { displayId: r.uint32LE(), inventoryType: r.uint32LE() }
      : undefined;
  if (flags & SpellCastFlag.VISUAL_CHAIN) r.skip(8);
  const destUnknown =
    targetFlags & SpellTargetFlag.DEST_LOCATION ? r.uint8() : undefined;
  return { power, runes, missile, ammo, destUnknown };
}

export function buildCastSpell(
  castCount: number,
  spellId: number,
  targetGuid: bigint,
): Uint8Array {
  const w = new PacketWriter();
  w.uint8(castCount);
  w.uint32LE(spellId);
  w.uint8(0);
  if (targetGuid === 0n) {
    w.uint32LE(0);
    return w.finish();
  }
  w.uint32LE(SpellTargetFlag.UNIT);
  w.packedGuidBig(targetGuid);
  return w.finish();
}

export function buildCancelCast(spellId: number): Uint8Array {
  const w = new PacketWriter();
  w.uint8(0);
  w.uint32LE(spellId);
  return w.finish();
}

export function parseInitialSpells(r: PacketReader): InitialSpells {
  r.skip(1);
  const spellCount = r.uint16LE();
  const spells: InitialSpell[] = [];
  for (let i = 0; i < spellCount; i++) {
    spells.push({ spellId: r.uint32LE() });
    r.skip(2);
  }
  const cooldownCount = r.uint16LE();
  const cooldowns: InitialCooldown[] = [];
  for (let i = 0; i < cooldownCount && r.remaining >= 16; i++) {
    cooldowns.push({
      spellId: r.uint32LE(),
      itemId: r.uint16LE(),
      category: r.uint16LE(),
      cooldown: r.uint32LE(),
      categoryCooldown: r.uint32LE(),
    });
  }
  return { spells, cooldowns };
}

export function parseSpellStart(r: PacketReader): SpellStart {
  const castItem = r.packedGuidBig();
  const caster = r.packedGuidBig();
  const castCount = r.uint8();
  const spellId = r.uint32LE();
  const flags = r.uint32LE();
  const timer = r.uint32LE() | 0;
  const targets = parseSpellTargets(r);
  return {
    castItem,
    caster,
    castCount,
    spellId,
    flags,
    timer,
    targets,
    ...parseStartExtras(r, flags),
  };
}

export function parseSpellGo(r: PacketReader): SpellGo {
  const castItem = r.packedGuidBig();
  const caster = r.packedGuidBig();
  const extraCasts = r.uint8();
  const spellId = r.uint32LE();
  const flags = r.uint32LE();
  const timestamp = r.uint32LE();
  const hits = readHits(r);
  const misses = readMisses(r);
  const targets = parseSpellTargets(r);
  return {
    castItem,
    caster,
    extraCasts,
    spellId,
    flags,
    timestamp,
    hits,
    misses,
    targets,
    ...parseGoExtras(r, flags, targets.flags),
  };
}

export function parseCastFailed(r: PacketReader): CastFailed {
  return {
    castCount: r.uint8(),
    spellId: r.uint32LE(),
    result: r.uint8(),
    extra: remainingUint32s(r),
  };
}

export function parseSpellFailure(r: PacketReader): SpellFailure {
  return {
    caster: r.packedGuidBig(),
    extraCasts: r.uint8(),
    spellId: r.uint32LE(),
    result: r.uint8(),
  };
}

export function parseSpellCooldown(r: PacketReader): SpellCooldown {
  const guid = r.uint64LE();
  const flags = r.uint8();
  const cooldowns: SpellCooldownEntry[] = [];
  while (r.remaining >= 8) {
    cooldowns.push({ spellId: r.uint32LE(), time: r.uint32LE() });
  }
  return { guid, flags, cooldowns };
}

export function parseLearnedSpell(r: PacketReader): LearnedSpell {
  return { spellId: r.uint32LE() };
}

export function parseRemovedSpell(r: PacketReader): RemovedSpell {
  return { spellId: r.uint32LE() };
}

export function parseSupersededSpell(r: PacketReader): SupersededSpell {
  return { superseded: r.uint32LE(), learned: r.uint32LE() };
}

export function parseSpellDelayed(r: PacketReader): SpellDelayed {
  return { caster: r.packedGuidBig(), delayMs: r.uint32LE() };
}

export function parseCooldownNotice(r: PacketReader): CooldownNotice {
  return { spellId: r.uint32LE(), guid: r.uint64LE() };
}
