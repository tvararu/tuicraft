import { PacketReader, PacketWriter } from "wow/protocol/packet";

export const SpellTargetFlag = {
  SELF: 0x0,
  UNIT: 0x2,
  UNIT_RAID: 0x4,
  UNIT_PARTY: 0x8,
  ITEM: 0x10,
  SOURCE_LOCATION: 0x20,
  DEST_LOCATION: 0x40,
  CORPSE_ENEMY: 0x200,
  GAMEOBJECT: 0x800,
  TRADE_ITEM: 0x1000,
  STRING: 0x2000,
  CORPSE_ALLY: 0x8000,
  UNIT_MINIPET: 0x10000,
} as const;

const OBJECT_TARGET_FLAGS =
  SpellTargetFlag.UNIT |
  SpellTargetFlag.UNIT_MINIPET |
  SpellTargetFlag.GAMEOBJECT |
  SpellTargetFlag.CORPSE_ENEMY |
  SpellTargetFlag.CORPSE_ALLY;

const ITEM_TARGET_FLAGS = SpellTargetFlag.ITEM | SpellTargetFlag.TRADE_ITEM;

export type SpellTarget =
  { kind: "self" } | { kind: "unit"; guidLow: number; guidHigh: number };

export function buildCastSpell(
  castCount: number,
  spellId: number,
  target: SpellTarget,
): Uint8Array {
  const w = new PacketWriter();
  w.uint8(castCount);
  w.uint32LE(spellId);
  w.uint8(0);
  if (target.kind === "self") {
    w.uint32LE(SpellTargetFlag.SELF);
  } else {
    w.uint32LE(SpellTargetFlag.UNIT);
    w.packedGuid(target.guidLow, target.guidHigh);
  }
  return w.finish();
}

export function buildCancelCast(
  castCount: number,
  spellId: number,
): Uint8Array {
  const w = new PacketWriter();
  w.uint8(castCount);
  w.uint32LE(spellId);
  return w.finish();
}

export function skipSpellCastTargets(r: PacketReader): bigint {
  const flags = r.uint32LE();
  let target = 0n;
  if (flags & OBJECT_TARGET_FLAGS) {
    const { low, high } = r.packedGuid();
    target = (BigInt(high >>> 0) << 32n) | BigInt(low >>> 0);
  }
  if (flags & ITEM_TARGET_FLAGS) r.packedGuid();
  if (flags & SpellTargetFlag.SOURCE_LOCATION) {
    r.packedGuid();
    r.skip(12);
  }
  if (flags & SpellTargetFlag.DEST_LOCATION) {
    r.packedGuid();
    r.skip(12);
  }
  if (flags & SpellTargetFlag.STRING) r.cString();
  return target;
}

export type SpellStart = {
  caster: bigint;
  castCount: number;
  spellId: number;
  castTimeMs: number;
  target: bigint;
};

const CAST_FLAG_POWER_LEFT_SELF = 0x800;
const CAST_FLAG_AMMO = 0x20;

export function parseSpellStart(r: PacketReader): SpellStart {
  readPackedBigint(r);
  const caster = readPackedBigint(r);
  const castCount = r.uint8();
  const spellId = r.uint32LE();
  const flags = r.uint32LE();
  const castTimeMs = r.uint32LE();
  const target = skipSpellCastTargets(r);
  if (flags & CAST_FLAG_POWER_LEFT_SELF) r.skip(4);
  if (flags & CAST_FLAG_AMMO) r.skip(8);
  return { caster, castCount, spellId, castTimeMs, target };
}

export type SpellGo = {
  caster: bigint;
  castCount: number;
  spellId: number;
  hits: bigint[];
  misses: Array<{ target: bigint; reason: number }>;
  target: bigint;
  powerLeft?: number;
};

const GO_FLAG_AMMO = 0x20;
const GO_FLAG_DEST_LOCATION = 0x40;
const GO_FLAG_POWER_UPDATE = 0x800;
const GO_FLAG_ADJUST_MISSILE = 0x20000;
const GO_FLAG_VISUAL_CHAIN = 0x80000;
const GO_FLAG_RUNE_UPDATE = 0x200000;

export function parseSpellGo(r: PacketReader): SpellGo {
  readPackedBigint(r);
  const caster = readPackedBigint(r);
  const castCount = r.uint8();
  const spellId = r.uint32LE();
  const flags = r.uint32LE();
  r.skip(4);
  const hitCount = r.uint8();
  const hits: bigint[] = [];
  for (let i = 0; i < hitCount; i++) hits.push(r.uint64LE());
  const missCount = r.uint8();
  const misses: Array<{ target: bigint; reason: number }> = [];
  for (let i = 0; i < missCount; i++) {
    const target = r.uint64LE();
    const reason = r.uint8();
    if (reason === 11) r.skip(1);
    misses.push({ target, reason });
  }
  const target = skipSpellCastTargets(r);
  let powerLeft: number | undefined;
  if (flags & GO_FLAG_POWER_UPDATE) powerLeft = r.uint32LE();
  if (flags & GO_FLAG_RUNE_UPDATE) r.skip(8);
  if (flags & GO_FLAG_ADJUST_MISSILE) r.skip(8);
  if (flags & GO_FLAG_AMMO) r.skip(8);
  if (flags & GO_FLAG_VISUAL_CHAIN) r.skip(8);
  if (flags & GO_FLAG_DEST_LOCATION) r.skip(1);
  return { caster, castCount, spellId, hits, misses, target, powerLeft };
}

export const SPELL_CAST_RESULT: Record<number, string> = {
  0x00: "SUCCESS",
  0x01: "AFFECTING_COMBAT",
  0x02: "ALREADY_AT_FULL_HEALTH",
  0x03: "ALREADY_AT_FULL_MANA",
  0x0b: "BAD_IMPLICIT_TARGETS",
  0x0c: "BAD_TARGETS",
  0x17: "CASTER_DEAD",
  0x1b: "DONT_REPORT",
  0x20: "ERROR",
  0x28: "INTERRUPTED",
  0x29: "INTERRUPTED_COMBAT",
  0x2d: "ITEM_NOT_READY",
  0x2f: "LINE_OF_SIGHT",
  0x33: "MOVING",
  0x3f: "NOT_KNOWN",
  0x43: "NOT_READY",
  0x45: "NOT_STANDING",
  0x49: "NOT_WHILE_GHOST",
  0x55: "NO_POWER",
  0x61: "OUT_OF_RANGE",
  0x68: "SILENCED",
  0x69: "SPELL_IN_PROGRESS",
  0x6c: "STUNNED",
  0x6d: "TARGETS_DEAD",
  0x73: "TARGET_FRIENDLY",
  0x80: "TOO_CLOSE",
  0x84: "TRY_AGAIN",
  0x86: "UNIT_NOT_INFRONT",
  0xac: "CUSTOM_ERROR",
};

export type CastFailed = {
  castCount: number;
  spellId: number;
  result: number;
  resultName: string;
};

export function parseCastFailed(r: PacketReader): CastFailed {
  const castCount = r.uint8();
  const spellId = r.uint32LE();
  const result = r.uint8();
  return {
    castCount,
    spellId,
    result,
    resultName: SPELL_CAST_RESULT[result] ?? `0x${result.toString(16)}`,
  };
}

export type SpellFailure = {
  caster: bigint;
  castCount: number;
  spellId: number;
  result: number;
};

export function parseSpellFailure(r: PacketReader): SpellFailure {
  const caster = readPackedBigint(r);
  const castCount = r.uint8();
  const spellId = r.uint32LE();
  const result = r.uint8();
  return { caster, castCount, spellId, result };
}

export type InitialSpells = {
  spells: number[];
  cooldowns: Array<{
    spellId: number;
    category: number;
    cooldownMs: number;
    categoryCooldownMs: number;
  }>;
};

export function parseInitialSpells(r: PacketReader): InitialSpells {
  r.uint8();
  const spellCount = r.uint16LE();
  const spells: number[] = [];
  for (let i = 0; i < spellCount; i++) {
    spells.push(r.uint32LE());
    r.skip(2);
  }
  const cooldownCount = r.uint16LE();
  const cooldowns: InitialSpells["cooldowns"] = [];
  for (let i = 0; i < cooldownCount; i++) {
    const spellId = r.uint32LE();
    r.skip(2);
    const category = r.uint16LE();
    const cooldownMs = r.uint32LE();
    const categoryCooldownMs = r.uint32LE();
    cooldowns.push({ spellId, category, cooldownMs, categoryCooldownMs });
  }
  return { spells, cooldowns };
}

export type SpellCooldown = {
  unit: bigint;
  flags: number;
  entries: Array<{ spellId: number; cooldownMs: number }>;
};

export function parseSpellCooldown(r: PacketReader): SpellCooldown {
  const unit = r.uint64LE();
  const flags = r.uint8();
  const entries: SpellCooldown["entries"] = [];
  while (r.remaining >= 8) {
    entries.push({ spellId: r.uint32LE(), cooldownMs: r.uint32LE() });
  }
  return { unit, flags, entries };
}

export function parseCooldownEvent(r: PacketReader): { spellId: number } {
  return { spellId: r.uint32LE() };
}

export type AuraEntry = {
  slot: number;
  spellId: number;
  flags: number;
  stackCount: number;
  caster?: bigint;
  durationMs?: number;
  timeLeftMs?: number;
};

const AURA_FLAG_NOT_CASTER = 0x08;
const AURA_FLAG_DURATION = 0x20;

function parseAuraEntry(r: PacketReader): AuraEntry {
  const slot = r.uint8();
  const spellId = r.uint32LE();
  if (spellId === 0) {
    return { slot, spellId: 0, flags: 0, stackCount: 0 };
  }
  const flags = r.uint8();
  r.uint8();
  const stackCount = r.uint8();
  let caster: bigint | undefined;
  if (flags & AURA_FLAG_NOT_CASTER) caster = readPackedBigint(r);
  let durationMs: number | undefined;
  let timeLeftMs: number | undefined;
  if (flags & AURA_FLAG_DURATION) {
    durationMs = r.uint32LE();
    timeLeftMs = r.uint32LE();
  }
  return { slot, spellId, flags, stackCount, caster, durationMs, timeLeftMs };
}

export type AuraUpdate = { unit: bigint; auras: AuraEntry[] };

export function parseAuraUpdate(r: PacketReader, all: boolean): AuraUpdate {
  const unit = readPackedBigint(r);
  const auras: AuraEntry[] = [];
  if (all) {
    while (r.remaining > 0) auras.push(parseAuraEntry(r));
  } else {
    auras.push(parseAuraEntry(r));
  }
  return { unit, auras };
}

export type SpellDamage = {
  target: bigint;
  caster: bigint;
  spellId: number;
  damage: number;
  overkill: number;
  schoolMask: number;
  absorbed: number;
  resisted: number;
  periodic: boolean;
  crit: boolean;
};

const SPELL_HIT_CRIT = 0x2;

export function parseSpellNonMeleeDamage(r: PacketReader): SpellDamage {
  const target = readPackedBigint(r);
  const caster = readPackedBigint(r);
  const spellId = r.uint32LE();
  const damage = r.uint32LE();
  const overkill = r.uint32LE();
  const schoolMask = r.uint8();
  const absorbed = r.uint32LE();
  const resisted = r.uint32LE();
  const periodic = r.uint8() === 1;
  r.skip(1);
  r.skip(4);
  const hitInfo = r.uint32LE();
  return {
    target,
    caster,
    spellId,
    damage,
    overkill,
    schoolMask,
    absorbed,
    resisted,
    periodic,
    crit: (hitInfo & SPELL_HIT_CRIT) !== 0,
  };
}

export type SpellHeal = {
  target: bigint;
  caster: bigint;
  spellId: number;
  amount: number;
  overheal: number;
  crit: boolean;
};

export function parseSpellHealLog(r: PacketReader): SpellHeal {
  const target = readPackedBigint(r);
  const caster = readPackedBigint(r);
  const spellId = r.uint32LE();
  const amount = r.uint32LE();
  const overheal = r.uint32LE();
  r.skip(4);
  const crit = r.uint8() === 1;
  return { target, caster, spellId, amount, overheal, crit };
}

export function readPackedBigint(r: PacketReader): bigint {
  const { low, high } = r.packedGuid();
  return (BigInt(high >>> 0) << 32n) | BigInt(low >>> 0);
}
