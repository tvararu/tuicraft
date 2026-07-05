import { PacketReader, PacketWriter } from "wow/protocol/packet";
import { readPackedBigint } from "wow/protocol/spells";

export function buildGuidBody(guidLow: number, guidHigh: number): Uint8Array {
  const w = new PacketWriter();
  w.uint32LE(guidLow);
  w.uint32LE(guidHigh);
  return w.finish();
}

export function buildBigintGuidBody(guid: bigint): Uint8Array {
  const w = new PacketWriter();
  w.uint64LE(guid);
  return w.finish();
}

export function buildRepopRequest(): Uint8Array {
  const w = new PacketWriter();
  w.uint8(0);
  return w.finish();
}

export function buildAutostoreLootItem(slot: number): Uint8Array {
  const w = new PacketWriter();
  w.uint8(slot);
  return w.finish();
}

export function buildStandStateChange(state: number): Uint8Array {
  const w = new PacketWriter();
  w.uint32LE(state);
  return w.finish();
}

export function buildItemQuery(entry: number): Uint8Array {
  const w = new PacketWriter();
  w.uint32LE(entry);
  return w.finish();
}

export type AttackStop = { attacker: bigint; victim: bigint; dead: boolean };

export function parseAttackStop(r: PacketReader): AttackStop {
  const attacker = readPackedBigint(r);
  const victim = readPackedBigint(r);
  const dead = r.remaining >= 4 ? r.uint32LE() !== 0 : false;
  return { attacker, victim, dead };
}

export function parseAttackStart(r: PacketReader): {
  attacker: bigint;
  victim: bigint;
} {
  return { attacker: r.uint64LE(), victim: r.uint64LE() };
}

export type MeleeDamage = {
  attacker: bigint;
  victim: bigint;
  damage: number;
  overkill: number;
  absorbed: number;
  resisted: number;
  blocked: number;
  miss: boolean;
  crit: boolean;
  victimState: number;
};

const HIT_INFO_UNK1 = 0x1;
const HIT_INFO_MISS = 0x10;
const HIT_INFO_ALL_ABSORB = 0x60;
const HIT_INFO_ALL_RESIST = 0x180;
const HIT_INFO_CRIT = 0x200;
const HIT_INFO_BLOCK = 0x2000;
const HIT_INFO_UNK19 = 0x80000;

export function parseAttackerStateUpdate(r: PacketReader): MeleeDamage {
  const hitInfo = r.uint32LE();
  const attacker = readPackedBigint(r);
  const victim = readPackedBigint(r);
  const damage = r.uint32LE();
  const overkill = r.uint32LE();
  const damageCount = r.uint8();
  for (let i = 0; i < damageCount; i++) r.skip(12);
  let absorbed = 0;
  let resisted = 0;
  if (hitInfo & HIT_INFO_ALL_ABSORB) absorbed = r.uint32LE();
  if (hitInfo & HIT_INFO_ALL_RESIST) resisted = r.uint32LE();
  const victimState = r.uint8();
  r.skip(8);
  let blocked = 0;
  if (hitInfo & HIT_INFO_BLOCK) blocked = r.uint32LE();
  if (hitInfo & HIT_INFO_UNK19) r.skip(4);
  if (hitInfo & HIT_INFO_UNK1) r.skip(48);
  return {
    attacker,
    victim,
    damage,
    overkill,
    absorbed,
    resisted,
    blocked,
    miss: (hitInfo & HIT_INFO_MISS) !== 0,
    crit: (hitInfo & HIT_INFO_CRIT) !== 0,
    victimState,
  };
}

export type LootItem = {
  slot: number;
  itemId: number;
  count: number;
  slotType: number;
};

export type LootResponse = {
  lootee: bigint;
  lootType: number;
  lootError?: number;
  gold: number;
  items: LootItem[];
};

export function parseLootResponse(r: PacketReader): LootResponse {
  const lootee = r.uint64LE();
  const lootType = r.uint8();
  if (lootType === 0) {
    const lootError = r.uint8();
    return { lootee, lootType, lootError, gold: 0, items: [] };
  }
  const gold = r.uint32LE();
  const itemCount = r.uint8();
  const items: LootItem[] = [];
  for (let i = 0; i < itemCount; i++) {
    const slot = r.uint8();
    const itemId = r.uint32LE();
    const count = r.uint32LE();
    r.skip(12);
    const slotType = r.uint8();
    items.push({ slot, itemId, count, slotType });
  }
  return { lootee, lootType, gold, items };
}

export type ItemPush = {
  player: bigint;
  looted: boolean;
  created: boolean;
  itemId: number;
  count: number;
  totalCount: number;
};

export function parseItemPushResult(r: PacketReader): ItemPush {
  const player = r.uint64LE();
  const looted = r.uint32LE() === 0;
  const created = r.uint32LE() === 1;
  r.skip(4);
  r.skip(1);
  r.skip(4);
  const itemId = r.uint32LE();
  r.skip(8);
  const count = r.uint32LE();
  const totalCount = r.uint32LE();
  return { player, looted, created, itemId, count, totalCount };
}

export function parseLootMoneyNotify(r: PacketReader): {
  copper: number;
  alone: boolean;
} {
  const copper = r.uint32LE();
  const alone = r.remaining > 0 ? r.uint8() === 1 : true;
  return { copper, alone };
}

export type XpGain = {
  victim: bigint;
  totalXp: number;
  kill: boolean;
  rawXp?: number;
};

export function parseXpGain(r: PacketReader): XpGain {
  const victim = r.uint64LE();
  const totalXp = r.uint32LE();
  const expType = r.uint8();
  const kill = expType === 0;
  let rawXp: number | undefined;
  if (kill) {
    rawXp = r.uint32LE();
    r.skip(4);
  }
  return { victim, totalXp, kill, rawXp };
}

export function parseLevelUp(r: PacketReader): {
  level: number;
  healthGained: number;
  manaGained: number;
} {
  const level = r.uint32LE();
  const healthGained = r.uint32LE();
  const manaGained = r.uint32LE();
  return { level, healthGained, manaGained };
}

export function parseHealthUpdate(r: PacketReader): {
  unit: bigint;
  health: number;
} {
  return { unit: readPackedBigint(r), health: r.uint32LE() };
}

export function parsePowerUpdate(r: PacketReader): {
  unit: bigint;
  powerType: number;
  amount: number;
} {
  return {
    unit: readPackedBigint(r),
    powerType: r.uint8(),
    amount: r.uint32LE(),
  };
}

export function parseCorpseQueryResponse(r: PacketReader): {
  found: boolean;
  mapId?: number;
  x?: number;
  y?: number;
  z?: number;
} {
  const found = r.uint8() === 1;
  if (!found || r.remaining < 20) return { found };
  const mapId = r.uint32LE();
  const x = r.floatLE();
  const y = r.floatLE();
  const z = r.floatLE();
  return { found, mapId, x, y, z };
}

export function parseDeathReleaseLoc(r: PacketReader): {
  mapId: number;
  x: number;
  y: number;
  z: number;
} {
  return {
    mapId: r.uint32LE(),
    x: r.floatLE(),
    y: r.floatLE(),
    z: r.floatLE(),
  };
}

export function parseResurrectRequest(r: PacketReader): {
  resurrector: bigint;
  name: string;
} {
  const resurrector = r.uint64LE();
  const nameLen = r.uint32LE();
  const bytes = r.bytes(Math.max(0, nameLen - 1));
  if (r.remaining > 0) r.skip(1);
  return { resurrector, name: new TextDecoder().decode(bytes) };
}

export function buildResurrectResponse(
  resurrector: bigint,
  accept: boolean,
): Uint8Array {
  const w = new PacketWriter();
  w.uint64LE(resurrector);
  w.uint8(accept ? 1 : 0);
  return w.finish();
}

export type ItemInfo = { entry: number; name: string; quality: number };

export function parseItemQueryResponse(r: PacketReader): ItemInfo | undefined {
  const entry = r.uint32LE();
  if ((entry & 0x80000000) !== 0 || r.remaining === 0) return undefined;
  r.skip(8);
  r.skip(4);
  const name = r.cString();
  r.cString();
  r.cString();
  r.cString();
  r.skip(4);
  const quality = r.uint32LE();
  return { entry, name, quality };
}
