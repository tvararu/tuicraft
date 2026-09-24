import type { PacketReader } from "wow/protocol/packet";

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
  r: PacketReader,
): InventoryChangeFailure {
  const result = r.uint8();
  if (result === InventoryResult.OK) return { kind: "ok", result };
  const item1 = r.uint64LE();
  const item2 = r.uint64LE();
  const bagType = r.uint8();
  const detail = inventoryFailureDetail(r, result);
  return { kind: "error", result, item1, item2, bagType, detail };
}

function inventoryFailureDetail(
  r: PacketReader,
  result: number,
): InventoryFailureDetail {
  switch (result) {
    case InventoryResult.CANT_EQUIP_LEVEL:
    case InventoryResult.PURCHASE_LEVEL_TOO_LOW:
      return { kind: "level", requiredLevel: r.uint32LE() };
    case InventoryResult.BIND_CONFIRM:
      return {
        kind: "binding",
        itemGuid: r.uint64LE(),
        slot: r.uint32LE(),
        containerGuid: r.uint64LE(),
      };
    case InventoryResult.MAX_LIMIT_COUNT:
    case InventoryResult.MAX_LIMIT_SOCKETED:
    case InventoryResult.MAX_LIMIT_EQUIPPED:
      return { kind: "limit", category: r.uint32LE() };
    default:
      return { kind: "none" };
  }
}
