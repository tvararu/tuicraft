import { PacketReader, PacketWriter } from "wow/protocol/packet";

const TARGET_UNIT = 0x00000002;
const TARGET_ITEM = 0x00000010;
const TARGET_SOURCE = 0x00000020;
const TARGET_DEST = 0x00000040;
const TARGET_CORPSE_ENEMY = 0x00000200;
const TARGET_GAMEOBJECT = 0x00000800;
const TARGET_TRADE_ITEM = 0x00001000;
const TARGET_STRING = 0x00002000;
const TARGET_CORPSE_ALLY = 0x00008000;
const TARGET_MINIPET = 0x00010000;
const TARGET_OBJECT =
  TARGET_UNIT |
  TARGET_MINIPET |
  TARGET_GAMEOBJECT |
  TARGET_CORPSE_ENEMY |
  TARGET_CORPSE_ALLY;
const TARGET_ITEM_MASK = TARGET_ITEM | TARGET_TRADE_ITEM;

const CAST_POWER_LEFT_SELF = 0x00000800;
const CAST_PROJECTILE = 0x00000020;
const CAST_ADJUST_MISSILE = 0x00020000;
const CAST_VISUAL_CHAIN = 0x00080000;
const CAST_RUNE_LIST = 0x00200000;
const CAST_UNKNOWN_23 = 0x00400000;

const AURA_CASTER = 0x08;
const AURA_DURATION = 0x20;
const SPELL_MISS_REFLECT = 11;
const RUNE_SLOTS = 6;

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

export type SpellUnknownPair = {
  unknown1: number;
  unknown2: number;
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
  unknown23?: SpellUnknownPair;
};

type SpellStartExtras = Pick<SpellStart, "power" | "ammo" | "unknown23">;

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
  visualChain?: SpellUnknownPair;
  destUnknown?: number;
};

type SpellGoExtras = Pick<
  SpellGo,
  "power" | "runes" | "missile" | "ammo" | "visualChain" | "destUnknown"
>;

export type InitialSpell = {
  spellId: number;
  unknown: number;
};

export type InitialCooldown = {
  spellId: number;
  itemId: number;
  category: number;
  cooldown: number;
  categoryCooldown: number;
};

export type InitialSpells = {
  unknown: number;
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

export type AttackStart = {
  attacker: bigint;
  victim: bigint;
};

export type AttackStop = {
  attacker: bigint;
  victim: bigint;
  dead: number;
};

export type AuraUpdate =
  | { unit: bigint; slot: number; removed: true }
  | {
      unit: bigint;
      slot: number;
      removed: false;
      spellId: number;
      flags: number;
      level: number;
      stacks: number;
      caster?: bigint;
      duration?: number;
      timeLeft?: number;
    };

export type XpGain = {
  victim: bigint;
  total: number;
  kind: "kill" | "other";
  original?: number;
  groupRate?: number;
  recruitAFriend: boolean;
};

export type LearnedSpell = {
  spellId: number;
  unknown: number;
};

export type RemovedSpell = {
  spellId: number;
};

export type SupersededSpell = {
  superseded: number;
  learned: number;
};

function readPackedGuid(r: PacketReader): bigint {
  const { low, high } = r.packedGuid();
  return (BigInt(high >>> 0) << 32n) | BigInt(low >>> 0);
}

function remainingUint32s(r: PacketReader): number[] {
  if (r.remaining % 4 !== 0)
    throw new RangeError(
      `trailing ${r.remaining} bytes are not uint32-aligned`,
    );
  const extra: number[] = [];
  while (r.remaining >= 4) extra.push(r.uint32LE());
  return extra;
}

function readLocation(r: PacketReader): SpellLocation {
  return {
    transport: readPackedGuid(r),
    x: r.floatLE(),
    y: r.floatLE(),
    z: r.floatLE(),
  };
}

function parseSpellTargets(r: PacketReader): SpellTargets {
  const flags = r.uint32LE();
  const objectGuid = flags & TARGET_OBJECT ? readPackedGuid(r) : undefined;
  const itemGuid = flags & TARGET_ITEM_MASK ? readPackedGuid(r) : undefined;
  const source = flags & TARGET_SOURCE ? readLocation(r) : undefined;
  const dest = flags & TARGET_DEST ? readLocation(r) : undefined;
  const name = flags & TARGET_STRING ? r.cString() : undefined;
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
  const power = flags & CAST_POWER_LEFT_SELF ? r.uint32LE() : undefined;
  const ammo =
    flags & CAST_PROJECTILE
      ? { displayId: r.uint32LE(), inventoryType: r.uint32LE() }
      : undefined;
  const unknown23 =
    flags & CAST_UNKNOWN_23
      ? { unknown1: r.uint32LE(), unknown2: r.uint32LE() }
      : undefined;
  return { power, ammo, unknown23 };
}

function parseGoExtras(
  r: PacketReader,
  flags: number,
  targetFlags: number,
): SpellGoExtras {
  const power = flags & CAST_POWER_LEFT_SELF ? r.uint32LE() : undefined;
  const runes = flags & CAST_RUNE_LIST ? readRuneState(r) : undefined;
  const missile =
    flags & CAST_ADJUST_MISSILE
      ? { elevation: r.floatLE(), delay: r.uint32LE() }
      : undefined;
  const ammo =
    flags & CAST_PROJECTILE
      ? { displayId: r.uint32LE(), inventoryType: r.uint32LE() }
      : undefined;
  const visualChain =
    flags & CAST_VISUAL_CHAIN
      ? { unknown1: r.uint32LE(), unknown2: r.uint32LE() }
      : undefined;
  const destUnknown = targetFlags & TARGET_DEST ? r.uint8() : undefined;
  return { power, runes, missile, ammo, visualChain, destUnknown };
}

export function buildAttackSwing(guid: bigint): Uint8Array {
  const w = new PacketWriter();
  w.uint64LE(guid);
  return w.finish();
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
  w.uint32LE(TARGET_UNIT);
  w.packedGuid(Number(targetGuid & 0xffffffffn), Number(targetGuid >> 32n));
  return w.finish();
}

export function buildCancelCast(spellId: number): Uint8Array {
  const w = new PacketWriter();
  w.uint8(0);
  w.uint32LE(spellId);
  return w.finish();
}

export function parseInitialSpells(r: PacketReader): InitialSpells {
  const unknown = r.uint8();
  const spellCount = r.uint16LE();
  const spells: InitialSpell[] = [];
  for (let i = 0; i < spellCount; i++) {
    spells.push({ spellId: r.uint32LE(), unknown: r.uint16LE() });
  }
  const cooldownCount = r.uint16LE();
  const cooldowns: InitialCooldown[] = [];
  for (let i = 0; i < cooldownCount; i++) {
    cooldowns.push({
      spellId: r.uint32LE(),
      itemId: r.uint16LE(),
      category: r.uint16LE(),
      cooldown: r.uint32LE(),
      categoryCooldown: r.uint32LE(),
    });
  }
  return { unknown, spells, cooldowns };
}

export function parseSpellStart(r: PacketReader): SpellStart {
  const castItem = readPackedGuid(r);
  const caster = readPackedGuid(r);
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
  const castItem = readPackedGuid(r);
  const caster = readPackedGuid(r);
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
    caster: readPackedGuid(r),
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
  if (r.remaining !== 0)
    throw new RangeError(`truncated cooldown entry, ${r.remaining} leftover`);
  return { guid, flags, cooldowns };
}

export function parseAttackStart(r: PacketReader): AttackStart {
  return { attacker: r.uint64LE(), victim: r.uint64LE() };
}

export function parseAttackStop(r: PacketReader): AttackStop {
  return {
    attacker: readPackedGuid(r),
    victim: readPackedGuid(r),
    dead: r.uint32LE(),
  };
}

export function parseAuraUpdate(
  r: PacketReader,
  unit = readPackedGuid(r),
): AuraUpdate {
  const slot = r.uint8();
  const spellId = r.uint32LE();
  if (spellId === 0) return { unit, slot, removed: true };
  const flags = r.uint8();
  const level = r.uint8();
  const stacks = r.uint8();
  const caster = (flags & AURA_CASTER) === 0 ? readPackedGuid(r) : undefined;
  const duration = flags & AURA_DURATION ? r.uint32LE() : undefined;
  const timeLeft = flags & AURA_DURATION ? r.uint32LE() : undefined;
  return {
    unit,
    slot,
    removed: false,
    spellId,
    flags,
    level,
    stacks,
    caster,
    duration,
    timeLeft,
  };
}

export function parseXpGain(r: PacketReader): XpGain {
  const victim = r.uint64LE();
  const total = r.uint32LE();
  const kind = r.uint8() === 0 ? "kill" : "other";
  const original = kind === "kill" ? r.uint32LE() : undefined;
  const groupRate = kind === "kill" ? r.floatLE() : undefined;
  const recruitAFriend = r.uint8() !== 0;
  return { victim, total, kind, original, groupRate, recruitAFriend };
}

export function parseLearnedSpell(r: PacketReader): LearnedSpell {
  return { spellId: r.uint32LE(), unknown: r.uint16LE() };
}

export function parseRemovedSpell(r: PacketReader): RemovedSpell {
  return { spellId: r.uint32LE() };
}

export function parseSupersededSpell(r: PacketReader): SupersededSpell {
  return { superseded: r.uint32LE(), learned: r.uint32LE() };
}
