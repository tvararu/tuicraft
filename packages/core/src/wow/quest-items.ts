import type { InventoryState } from "#wow/inventory";
import type { ItemPushResult } from "#wow/protocol/loot";
import type { QuestQuery } from "#wow/quest-queries";
import type { QuestLog } from "#wow/quest-slots";

export type QuestItemObjective = {
  questId: number;
  itemId: number;
  required: number;
  carried: number | undefined;
};

export type QuestItemPush = ItemPushResult & { at: number };

export type QuestCollect = {
  kind: "collect";
  questId: number;
  itemId: number;
  required: number;
  carried: number;
  pushed: number;
  totalCount: number;
  bag: number;
  slot: number;
};

export function carriedCount(
  inventory: InventoryState,
  itemId: number,
): number | undefined {
  let carried = 0;
  for (const slot of inventory.slots) {
    if (slot.status === "unknown") return undefined;
    if (slot.status === "empty") continue;
    if (slot.item.entry === undefined) return undefined;
    if (slot.item.entry !== itemId) continue;
    if (slot.item.count === undefined) return undefined;
    carried += slot.item.count;
  }
  return inventory.slots.length === 0 ? undefined : carried;
}

export function itemObjectives(
  log: QuestLog,
  queries: ReadonlyMap<number, QuestQuery>,
  inventory: InventoryState,
): QuestItemObjective[] {
  const objectives: QuestItemObjective[] = [];
  for (const { questId } of log.slots) {
    const query = questId === undefined ? undefined : queries.get(questId);
    if (questId === undefined || query?.status !== "known") continue;
    for (const { itemId, count } of query.data.requiredItems)
      if (itemId > 0 && count > 0)
        objectives.push({
          questId,
          itemId,
          required: count,
          carried: carriedCount(inventory, itemId),
        });
  }
  return objectives;
}

export function settleItemPushes(
  waiting: QuestItemPush[],
  objectives: QuestItemObjective[],
): { settled: QuestCollect[]; waiting: QuestItemPush[] } {
  const settled: QuestCollect[] = [];
  let index = 0;
  for (const push of waiting) {
    const matching = objectives.filter((o) => o.itemId === push.itemId);
    const carried = matching[0]?.carried;
    if (matching.length > 0) {
      if (carried === undefined || carried < push.totalCount) break;
      for (const objective of matching)
        settled.push({
          kind: "collect",
          questId: objective.questId,
          itemId: push.itemId,
          required: objective.required,
          carried,
          pushed: push.count,
          totalCount: push.totalCount,
          bag: push.bagSlot,
          slot: push.slot,
        });
    }
    index++;
  }
  return { settled, waiting: waiting.slice(index) };
}
