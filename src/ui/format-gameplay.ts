import { formatGuid } from "ui/format";
import { observedKillXp } from "ui/format-combat";
import { formatResurrectionOffer } from "ui/format-recovery";
import type {
  CycleLootRecord,
  CycleState,
  CycleTargetRecord,
  ExperienceState,
  InventoryState,
  RecoveryState,
  RewardsState,
} from "wow";

function show(value: string | number | undefined): string {
  return value === undefined ? "unknown" : String(value);
}

function formatCycleTarget(target: CycleTargetRecord): string {
  const reason = target.outcome?.reason ?? target.cause;
  const xp =
    reason === "server_kill_credit"
      ? observedKillXp(target.outcome?.observation, target.guid)
      : undefined;
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
    `Instruction: ${state.instruction}`,
    `Starts: ${state.startsUsed}/${state.maxStarts}`,
    `Resumes: ${state.resumes}`,
    ...state.queue.map(formatCycleTarget),
  ];
  const { objective } = state;
  if (objective) {
    const done = objective.complete ? "complete" : "incomplete";
    lines.push(`Objective: quest ${objective.questId} ${done}`);
    for (const kill of objective.kills)
      lines.push(`Kill ${kill.entry}: ${show(kill.current)}/${kill.required}`);
    for (const item of objective.items)
      lines.push(`Item ${item.itemId}: ${item.required} required`);
  }
  if (state.lastLoot) lines.push(...formatCycleLoot(state.lastLoot));
  if (state.lastRecovery)
    lines.push(`Last recovery: ${state.lastRecovery.outcome}`);
  if (state.stopCause) lines.push(`Stop reason: ${state.stopCause}`);
  return lines;
}

export function formatRecoveryState(
  state: RecoveryState,
  now = Date.now(),
): string[] {
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
  lines.push(...formatResurrectionOffer(state, now));
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
  if (state.issues.length > 0)
    lines.push(`Inventory issues: ${state.issues.length}`);
  return lines;
}

function pickup(slotType: number): string {
  return slotType === 0 || slotType === 4
    ? "pickup allowed"
    : "no direct pickup";
}

const OPEN_FAILURES: Record<string, string> = {
  loot_source_unavailable: "the corpse despawned or left view",
  release_only: "the server answered with a release only",
  self_unavailable: "you died or left the world",
};

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
  const failure = state.lastOpenFailure;
  if (failure)
    lines.push(
      `Last open failed: ${OPEN_FAILURES[failure.reason] ?? failure.reason} (0x${failure.guid.toString(16)})`,
    );
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

export function formatExperienceState(state: ExperienceState): string[] {
  const lines = [
    `Level: ${show(state.level)}`,
    `XP: ${show(state.xp)} / ${show(state.nextLevelXp)}`,
  ];
  const { lastXp, lastLevelUp } = state;
  if (lastXp) {
    const source =
      lastXp.kind === "kill" ? `kill ${formatGuid(lastXp.victim)}` : "other";
    lines.push(`Last XP gain: ${lastXp.total} (${source})`);
  }
  if (lastLevelUp) lines.push(`Last level up: ${lastLevelUp.level}`);
  return lines;
}
