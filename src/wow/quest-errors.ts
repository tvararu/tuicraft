import {
  type InventoryChangeFailure,
  inventoryResultName,
} from "wow/protocol/inventory";
import type { QuestIntent, QuestWindow } from "wow/quests-requests";

export type QuestError = {
  kind:
    | "stale_dialog"
    | "invalid"
    | "log_full"
    | "quest_failed"
    | "failed"
    | "timer_failed"
    | "unsupported_window"
    | "inventory";
  at: number;
  questId?: number;
  reason?: number;
  reasonName?: string;
  window?: QuestWindow;
  guid?: bigint;
  name?: string;
};

export function inventoryQuestError(
  pending: QuestIntent | undefined,
  packet: InventoryChangeFailure,
): Omit<QuestError, "at"> | undefined {
  if (packet.kind !== "error") return;
  if (pending?.action !== "chooseReward" && pending?.action !== "accept")
    return;
  return {
    kind: "inventory",
    questId: pending.questId,
    reason: packet.result,
    name: inventoryResultName(packet.result),
  };
}
