import type {
  InventoryItem,
  InventorySlot,
  InventoryState,
} from "wow/inventory";
import type { LootItem } from "wow/protocol/loot";
import type { RewardsLoot, RewardsOpenLoot, RewardsState } from "wow/rewards";

export type ItemLabel = { name: string | null; quality: number | null };
export type ItemLabeler = (entry: number | undefined) => ItemLabel;

type Occupied = Extract<InventorySlot, { status: "occupied" }>;
export type NamedInventoryItem = InventoryItem & ItemLabel;
export type NamedInventorySlot =
  | Exclude<InventorySlot, Occupied>
  | (Omit<Occupied, "item"> & { item: NamedInventoryItem });
export type NamedInventoryState = Omit<InventoryState, "slots"> & {
  slots: NamedInventorySlot[];
};
export type NamedLootItem = LootItem & ItemLabel;
export type NamedRewardsLoot =
  | Exclude<RewardsLoot, RewardsOpenLoot>
  | (Omit<RewardsOpenLoot, "items"> & { items: NamedLootItem[] });
export type NamedRewardsState = Omit<RewardsState, "loot" | "inventory"> & {
  loot: NamedRewardsLoot;
  inventory: NamedInventoryState;
};

export function labelInventory(
  state: InventoryState,
  label: ItemLabeler,
): NamedInventoryState {
  return {
    ...state,
    slots: state.slots.map((slot) =>
      slot.status === "occupied"
        ? { ...slot, item: { ...slot.item, ...label(slot.item.entry) } }
        : slot,
    ),
  };
}

function labelLoot(loot: RewardsLoot, label: ItemLabeler): NamedRewardsLoot {
  if (loot.phase === "closed" || loot.phase === "opening") return loot;
  return {
    ...loot,
    items: loot.items.map((item) => ({ ...item, ...label(item.itemId) })),
  };
}

export function labelRewards(
  state: RewardsState,
  label: ItemLabeler,
): NamedRewardsState {
  return {
    ...state,
    loot: labelLoot(state.loot, label),
    inventory: labelInventory(state.inventory, label),
  };
}
