import { PacketReader, PacketWriter } from "wow/protocol/packet";

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

export function buildLoot(guid: bigint): Uint8Array {
  checkGuid(guid);
  const writer = new PacketWriter(8);
  writer.uint64LE(guid);
  return writer.finish();
}

export function buildAutostoreLootItem(slot: number): Uint8Array {
  if (!Number.isInteger(slot) || slot < 0 || slot > 255)
    throw new RangeError("Loot slot outside uint8 range");
  const writer = new PacketWriter(1);
  writer.uint8(slot);
  return writer.finish();
}

export function buildLootRelease(guid: bigint): Uint8Array {
  checkGuid(guid);
  const writer = new PacketWriter(8);
  writer.uint64LE(guid);
  return writer.finish();
}

export function parseLootResponse(reader: PacketReader): LootResponse {
  const guid = reader.uint64LE();
  const lootType = reader.uint8();
  if (lootType === 0) {
    const error = reader.uint8();
    end(reader);
    return { kind: "error", guid, lootType, error };
  }
  const money = reader.uint32LE();
  const count = reader.uint8();
  if (reader.remaining !== count * 22)
    throw new RangeError("Loot item count does not match payload size");
  const items: LootItem[] = [];
  for (let i = 0; i < count; i++) items.push(readItem(reader));
  return { kind: "loot", guid, lootType, money, items };
}

export function parseLootRemoved(reader: PacketReader): LootRemoved {
  const slot = reader.uint8();
  end(reader);
  return { slot };
}

export function parseLootReleaseResponse(
  reader: PacketReader,
): LootReleaseResponse {
  const guid = reader.uint64LE();
  const status = reader.uint8();
  end(reader);
  return { guid, status };
}

export function parseLootMoneyNotify(reader: PacketReader): LootMoneyNotify {
  const money = reader.uint32LE();
  const alone = reader.uint8() !== 0;
  end(reader);
  return { money, alone };
}

export function parseItemPushResult(reader: PacketReader): ItemPushResult {
  const guid = reader.uint64LE();
  const received = reader.uint32LE();
  const created = reader.uint32LE();
  const showInChat = reader.uint32LE();
  const bagSlot = reader.uint8();
  const slot = reader.uint32LE();
  const itemId = reader.uint32LE();
  const randomSuffix = reader.uint32LE();
  const randomPropertyId = reader.uint32LE() | 0;
  const count = reader.uint32LE();
  const totalCount = reader.uint32LE();
  end(reader);
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

function readItem(reader: PacketReader): LootItem {
  const slot = reader.uint8();
  const itemId = reader.uint32LE();
  const count = reader.uint32LE();
  const displayId = reader.uint32LE();
  const randomSuffix = reader.uint32LE();
  const randomPropertyId = reader.uint32LE() | 0;
  const slotType = reader.uint8();
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

function checkGuid(guid: bigint): void {
  if (guid < 0n || guid > 0xffffffffffffffffn)
    throw new RangeError("GUID outside uint64 range");
}

function end(reader: PacketReader): void {
  if (reader.remaining !== 0)
    throw new RangeError("Unexpected trailing loot payload");
}

export const InventoryResult = {
  OK: 0,
  CANT_EQUIP_LEVEL: 1,
  BAG_FULL: 4,
  INVENTORY_FULL: 50,
  BAG_FULL3: 53,
  BIND_CONFIRM: 81,
  MAX_LIMIT_COUNT: 84,
  MAX_LIMIT_SOCKETED: 85,
  PURCHASE_LEVEL_TOO_LOW: 87,
  MAX_LIMIT_EQUIPPED: 89,
} as const;

export type InventoryFailureDetail =
  | { kind: "none" }
  | { kind: "level"; requiredLevel: number }
  | { kind: "binding"; itemGuid: bigint; slot: number; containerGuid: bigint }
  | { kind: "limit"; category: number };

export type InventoryChangeFailure =
  | { kind: "ok"; result: 0 }
  | {
      kind: "error";
      result: number;
      item1: bigint;
      item2: bigint;
      bagType: number;
      detail: InventoryFailureDetail;
    };

export function parseInventoryChangeFailure(
  reader: PacketReader,
): InventoryChangeFailure {
  const result = reader.uint8();
  let packet: InventoryChangeFailure;
  if (result === InventoryResult.OK) packet = { kind: "ok", result };
  else {
    const item1 = reader.uint64LE();
    const item2 = reader.uint64LE();
    const bagType = reader.uint8();
    packet = {
      kind: "error",
      result,
      item1,
      item2,
      bagType,
      detail: inventoryFailureDetail(reader, result),
    };
  }
  if (reader.remaining !== 0)
    throw new RangeError("Unexpected trailing inventory error payload");
  return packet;
}

function inventoryFailureDetail(
  reader: PacketReader,
  result: number,
): InventoryFailureDetail {
  switch (result) {
    case InventoryResult.CANT_EQUIP_LEVEL:
    case InventoryResult.PURCHASE_LEVEL_TOO_LOW:
      return { kind: "level", requiredLevel: reader.uint32LE() };
    case InventoryResult.BIND_CONFIRM:
      return {
        kind: "binding",
        itemGuid: reader.uint64LE(),
        slot: reader.uint32LE(),
        containerGuid: reader.uint64LE(),
      };
    case InventoryResult.MAX_LIMIT_COUNT:
    case InventoryResult.MAX_LIMIT_SOCKETED:
    case InventoryResult.MAX_LIMIT_EQUIPPED:
      return { kind: "limit", category: reader.uint32LE() };
    default:
      return { kind: "none" };
  }
}
