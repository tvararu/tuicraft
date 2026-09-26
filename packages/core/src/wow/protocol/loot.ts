import { type PacketReader, PacketWriter } from "#wow/protocol/packet";

export type LootItem = {
  slot: number;
  itemId: number;
  count: number;
  displayId: number;
  randomSuffix: number;
  randomPropertyId: number;
  slotType: number;
};

export type LootResponse =
  | { kind: "error"; guid: bigint; lootType: 0; error: number }
  | {
      kind: "loot";
      guid: bigint;
      lootType: number;
      money: number;
      items: LootItem[];
    };

export type LootRemoved = { slot: number };
export type LootReleaseResponse = { guid: bigint; status: number };
export type LootMoneyNotify = { money: number; alone: boolean };
export type ItemPushResult = {
  guid: bigint;
  received: number;
  created: number;
  showInChat: number;
  bagSlot: number;
  slot: number;
  itemId: number;
  randomSuffix: number;
  randomPropertyId: number;
  count: number;
  totalCount: number;
};

function guidRequest(guid: bigint): Uint8Array {
  const w = new PacketWriter();
  w.uint64LE(guid);
  return w.finish();
}

export function buildLoot(guid: bigint): Uint8Array {
  return guidRequest(guid);
}

export function buildAutostoreLootItem(slot: number): Uint8Array {
  const w = new PacketWriter();
  w.uint8(slot);
  return w.finish();
}

export function buildLootRelease(guid: bigint): Uint8Array {
  return guidRequest(guid);
}

export function parseLootResponse(r: PacketReader): LootResponse {
  const guid = r.uint64LE();
  const lootType = r.uint8();
  if (lootType === 0) {
    return { kind: "error", guid, lootType, error: r.uint8() };
  }
  const money = r.uint32LE();
  const count = r.uint8();
  const items: LootItem[] = [];
  for (let i = 0; i < count; i++) items.push(readItem(r));
  return { kind: "loot", guid, lootType, money, items };
}

export function parseLootRemoved(r: PacketReader): LootRemoved {
  return { slot: r.uint8() };
}

export function parseLootReleaseResponse(r: PacketReader): LootReleaseResponse {
  return { guid: r.uint64LE(), status: r.uint8() };
}

export function parseLootMoneyNotify(r: PacketReader): LootMoneyNotify {
  return { money: r.uint32LE(), alone: r.uint8() !== 0 };
}

export function parseItemPushResult(r: PacketReader): ItemPushResult {
  const guid = r.uint64LE();
  const received = r.uint32LE();
  const created = r.uint32LE();
  const showInChat = r.uint32LE();
  const bagSlot = r.uint8();
  const slot = r.uint32LE();
  const itemId = r.uint32LE();
  const randomSuffix = r.uint32LE();
  const randomPropertyId = r.uint32LE() | 0;
  const count = r.uint32LE();
  const totalCount = r.uint32LE();
  return {
    guid,
    received,
    created,
    showInChat,
    bagSlot,
    slot,
    itemId,
    randomSuffix,
    randomPropertyId,
    count,
    totalCount,
  };
}

function readItem(r: PacketReader): LootItem {
  const slot = r.uint8();
  const itemId = r.uint32LE();
  const count = r.uint32LE();
  const displayId = r.uint32LE();
  const randomSuffix = r.uint32LE();
  const randomPropertyId = r.uint32LE() | 0;
  const slotType = r.uint8();
  return {
    slot,
    itemId,
    count,
    displayId,
    randomSuffix,
    randomPropertyId,
    slotType,
  };
}

export const ROLL_VOTES = ["pass", "need", "greed", "disenchant"] as const;
export type RollVote = (typeof ROLL_VOTES)[number];

export type LootStartRoll = {
  guid: bigint;
  mapId: number;
  slot: number;
  itemId: number;
  randomSuffix: number;
  randomPropertyId: number;
  count: number;
  countdownMs: number;
  voteMask: number;
};
export type LootRollNotice = {
  guid: bigint;
  slot: number;
  player: bigint;
  itemId: number;
  randomSuffix: number;
  randomPropertyId: number;
  rollNumber: number;
  vote: number;
  autoPass: boolean;
};
export type LootRollWon = {
  guid: bigint;
  slot: number;
  itemId: number;
  randomSuffix: number;
  randomPropertyId: number;
  winner: bigint;
  rollNumber: number;
  vote: number;
};
export type LootAllPassed = {
  guid: bigint;
  slot: number;
  itemId: number;
  randomPropertyId: number;
  randomSuffix: number;
};

export function buildLootRoll(
  guid: bigint,
  slot: number,
  vote: RollVote,
): Uint8Array {
  const w = new PacketWriter();
  w.uint64LE(guid);
  w.uint32LE(slot);
  w.uint8(ROLL_VOTES.indexOf(vote));
  return w.finish();
}

export function parseLootStartRoll(r: PacketReader): LootStartRoll {
  return {
    guid: r.uint64LE(),
    mapId: r.uint32LE(),
    slot: r.uint32LE(),
    itemId: r.uint32LE(),
    randomSuffix: r.uint32LE(),
    randomPropertyId: r.uint32LE() | 0,
    count: r.uint32LE(),
    countdownMs: r.uint32LE(),
    voteMask: r.uint8(),
  };
}

export function parseLootRoll(r: PacketReader): LootRollNotice {
  return {
    guid: r.uint64LE(),
    slot: r.uint32LE(),
    player: r.uint64LE(),
    itemId: r.uint32LE(),
    randomSuffix: r.uint32LE(),
    randomPropertyId: r.uint32LE() | 0,
    rollNumber: r.uint8(),
    vote: r.uint8(),
    autoPass: r.uint8() !== 0,
  };
}

export function parseLootRollWon(r: PacketReader): LootRollWon {
  return {
    guid: r.uint64LE(),
    slot: r.uint32LE(),
    itemId: r.uint32LE(),
    randomSuffix: r.uint32LE(),
    randomPropertyId: r.uint32LE() | 0,
    winner: r.uint64LE(),
    rollNumber: r.uint8(),
    vote: r.uint8(),
  };
}

export function parseLootAllPassed(r: PacketReader): LootAllPassed {
  return {
    guid: r.uint64LE(),
    slot: r.uint32LE(),
    itemId: r.uint32LE(),
    randomPropertyId: r.uint32LE() | 0,
    randomSuffix: r.uint32LE(),
  };
}
