import type { InventoryState } from "#wow/inventory";
import type { LootItem } from "#wow/protocol/loot";

export const BAG_RESERVE = 1;

export function slotsNeeded(
  inventory: InventoryState,
  item: Pick<LootItem, "itemId" | "count">,
  stackSize: number | undefined,
): number {
  if (stackSize === undefined) return 1;
  let room = 0;
  for (const slot of inventory.slots) {
    if (slot.region !== "backpack" && slot.region !== "bag_item") continue;
    if (slot.status !== "occupied" || slot.item.entry !== item.itemId) continue;
    if (slot.item.count !== undefined)
      room += Math.max(0, stackSize - slot.item.count);
  }
  return Math.ceil(Math.max(0, item.count - room) / stackSize);
}

export function keepsReserve(room: {
  needed: number;
  freeAtOpen: number | undefined;
  usedSinceOpen: number;
  free: number | undefined;
}): boolean {
  if (room.needed === 0) return true;
  if (room.freeAtOpen === undefined || room.free === undefined) return false;
  const spare = Math.min(room.free, room.freeAtOpen - room.usedSinceOpen);
  return spare - room.needed >= BAG_RESERVE;
}
