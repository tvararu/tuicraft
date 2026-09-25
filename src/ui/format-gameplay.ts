import { formatGuid } from "ui/format";
import type {
  CycleLootRecord,
  CycleState,
  CycleTargetRecord,
} from "wow/encounter-cycle";
import type { InventoryState } from "wow/inventory";
import type { RecoveryState } from "wow/recovery";
import type { RewardsState } from "wow/rewards";

function show(value: string | number | undefined): string {
  return value === undefined ? "unknown" : String(value);
}

function killXp(target: CycleTargetRecord): number | undefined {
  const xp = target.outcome?.observation?.["lastXp"];
  if (typeof xp !== "object" || xp === null) return undefined;
  if (!("kind" in xp && "victim" in xp && "total" in xp)) return undefined;
  if (xp.kind !== "kill" || xp.victim !== formatGuid(target.guid))
    return undefined;
  return typeof xp.total === "number" ? xp.total : undefined;
}

function formatCycleTarget(target: CycleTargetRecord): string {
  const reason = target.outcome?.reason ?? target.cause;
  const xp = reason === "server_kill_credit" ? killXp(target) : undefined;
  const credit = xp === undefined ? "" : `, ${xp} XP`;
  const loot = target.loot === "none" ? ", no loot" : "";
  return `Target ${formatGuid(target.guid)}: ${target.status} (${show(reason)})${credit}${loot}`;
}

function formatCycleLoot(loot: CycleLootRecord): string[] {
  const { coinageBefore: before, coinageAfter: after } = loot;
  const coinage =
    before !== undefined && after !== undefined
      ? `${before} -> ${after}`
      : "unknown";
  return [
    `Money: ${loot.moneyTaken} copper requested`,
    `Coinage change: ${coinage}`,
    `Item slots requested: ${loot.slotsTaken.join(", ") || "none"}`,
  ];
}

export function formatCycleState(state: CycleState): string[] {
  const lines = [
    `Cycle: ${state.phase}`,
    `Starts: ${state.startsUsed}/${state.maxStarts}`,
    ...state.queue.map(formatCycleTarget),
  ];
  if (state.lastLoot) lines.push(...formatCycleLoot(state.lastLoot));
  if (state.stopCause) lines.push(`Stop reason: ${state.stopCause}`);
  return lines;
}

export function formatRecoveryState(state: RecoveryState): string[] {
  const { corpse, reclaim, request } = state;
  const reason = reclaim.reason ? ` (${reclaim.reason})` : "";
  const lines = [
    `Life: ${state.life}`,
    `Health: ${show(state.health)}`,
    `Corpse: ${corpse.status}`,
    `Reclaim: ${reclaim.readiness}${reason}`,
    `Reclaim request allowed: ${reclaim.canRequest ? "yes" : "no"}`,
  ];
  if (corpse.status === "found")
    lines.push(`Corpse maps: ${corpse.mapId} / ${corpse.corpseMapId}`);
  if (reclaim.distance !== undefined)
    lines.push(`Corpse distance: ${reclaim.distance.toFixed(2)} yards`);
  if (reclaim.remainingMs !== undefined)
    lines.push(`Reclaim delay: ${reclaim.remainingMs} ms`);
  if (request) lines.push(`Request: ${request.action} ${request.status}`);
  return lines;
}

export function formatInventoryState(state: InventoryState): string[] {
  const lines = [
    `Inventory: ${state.status} (carried)`,
    `Coinage: ${show(state.coinage)}`,
    `Free slots: ${show(state.freeSlots)}`,
  ];
  for (const slot of state.slots) {
    if (slot.status !== "occupied") continue;
    const { entry, count } = slot.item;
    lines.push(
      `Item ${show(entry)} x${show(count)} at bag ${slot.bag} slot ${slot.slot}`,
    );
  }
  const unknown = state.slots.filter((slot) => slot.status === "unknown");
  lines.push(`Unknown slots: ${unknown.length}`);
  if (state.issues.length)
    lines.push(`Inventory issues: ${state.issues.length}`);
  return lines;
}

function pickup(slotType: number): string {
  return slotType === 0 || slotType === 4
    ? "pickup allowed"
    : "no direct pickup";
}

function formatLootErrors(state: RewardsState): string[] {
  const lines: string[] = [];
  const inventory = state.lastInventoryError;
  if (inventory) {
    let reason = `code ${inventory.packet.result}`;
    if (inventory.inventoryFull) reason = "inventory full";
    else if (inventory.bagFull) reason = "bag full";
    lines.push(`Last inventory error: ${reason}`);
  }
  if (state.lastLootError)
    lines.push(`Last loot error code: ${state.lastLootError.error}`);
  return lines;
}

export function formatRewardsState(state: RewardsState): string[] {
  const { loot, pending } = state;
  const lines = [`Loot: ${loot.phase}`];
  if (loot.phase === "open" || loot.phase === "closing") {
    lines.push(`Offer: ${loot.money} copper`);
    for (const item of loot.items)
      lines.push(
        `Slot ${item.slot}: item ${item.itemId} x${item.count} (${pickup(item.slotType)})`,
      );
  }
  if (pending) lines.push(`Request: ${pending.action} ${pending.status}`);
  lines.push(`Carried coinage: ${show(state.inventory.coinage)}`);
  return [...lines, ...formatLootErrors(state)];
}
