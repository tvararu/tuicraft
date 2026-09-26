import { formatGuid } from "ui/format";
import { observedKillXp } from "ui/format-combat";
import { formatResurrectionOffer } from "ui/format-recovery";
import type {
  CycleLootRecord,
  CycleState,
  CycleTargetRecord,
  DefenseState,
  DestroyRequest,
  DestroyState,
  ExperienceState,
  NamedInventoryState,
  NamedRewardsState,
  RecoveryState,
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
  const detail = state.stopDetail?.["reason"];
  const why = typeof detail === "string" ? ` (${detail})` : "";
  if (state.stopCause) lines.push(`Stop reason: ${state.stopCause}${why}`);
  return lines;
}

export function formatDefenseState(state: DefenseState): string[] {
  const lines = [
    `Defense: ${state.armed ? `armed (${state.mode})` : "off"}`,
    `Engagements: ${state.engagements}`,
  ];
  if (state.armed) lines.push(`Instruction: ${state.instruction}`);
  if (state.active)
    lines.push(`Defending against: ${formatGuid(state.active.attacker)}`);
  if (state.lastStop)
    lines.push(
      `Last stop: ${formatGuid(state.lastStop.attacker)} (${state.lastStop.reason})`,
    );
  if (!state.armed && state.disarmReason)
    lines.push(`Disarmed by: ${state.disarmReason}`);
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
  if (state.spiritHealerConfirm)
    lines.push(
      `Spirit healer confirm: ${formatGuid(state.spiritHealerConfirm.guid)}`,
    );
  lines.push(...formatResurrectionOffer(state, now));
  return lines;
}

export function formatInventoryState(state: NamedInventoryState): string[] {
  const lines = [
    `Inventory: ${state.status} (carried)`,
    `Coinage: ${show(state.coinage)}`,
    `Free slots: ${show(state.freeSlots)}`,
  ];
  for (const slot of state.slots) {
    if (slot.status !== "occupied") continue;
    const { entry, name, count } = slot.item;
    const label = name === null ? "" : ` ${name}`;
    lines.push(
      `Item ${show(entry)}${label} x${show(count)} at bag ${slot.bag} slot ${slot.slot}`,
    );
  }
  const unknown = state.slots.filter((slot) => slot.status === "unknown");
  lines.push(`Unknown slots: ${unknown.length}`);
  if (state.issues.length > 0)
    lines.push(`Inventory issues: ${state.issues.length}`);
  return lines;
}

function describeDestroy(request: DestroyRequest): string {
  return `destroy item ${show(request.itemId)} x${request.count} at bag ${request.bag} slot ${request.slot}`;
}

export function formatDestroyState(state: DestroyState): string[] {
  const lines: string[] = [];
  if (state.pending)
    lines.push(`Request: ${describeDestroy(state.pending)} unanswered`);
  const outcome = state.lastOutcome;
  if (outcome) {
    const reason = outcome.reason ? ` ${outcome.reason}` : "";
    lines.push(
      `Last: ${describeDestroy(outcome.request)}: ${outcome.status}${reason} (stack ${outcome.request.stackBefore} -> ${outcome.stackAfter})`,
    );
  }
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

function formatLootErrors(state: NamedRewardsState): string[] {
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

export function formatRewardsState(state: NamedRewardsState): string[] {
  const { loot, pending } = state;
  const lines = [`Loot: ${loot.phase}`];
  if (loot.phase === "open" || loot.phase === "closing") {
    lines.push(`Offer: ${loot.money} copper`);
    for (const { slot, itemId, name, count, slotType } of loot.items) {
      const label = name === null ? "" : ` ${name}`;
      lines.push(
        `Slot ${slot}: item ${itemId}${label} x${count} (${pickup(slotType)})`,
      );
    }
  }
  if (pending) lines.push(`Request: ${pending.action} ${pending.status}`);
  lines.push(`Carried coinage: ${show(state.inventory.coinage)}`);
  return [...lines, ...formatRolls(state), ...formatLootErrors(state)];
}

function formatRolls({ rolls }: NamedRewardsState): string[] {
  const lines = rolls.pending.map((roll) => {
    const answer = roll.choice ? `answered ${roll.choice}` : "unanswered";
    const corpse = roll.corpseGuid
      ? ` corpse ${formatGuid(roll.corpseGuid)}`
      : "";
    return `Roll ${formatGuid(roll.guid)} slot ${roll.slot}: item ${roll.itemId} x${roll.count}${corpse}, ${Math.ceil(roll.remainingMs / 1000)} s left, allowed ${roll.allowed.join("/")}, ${answer}`;
  });
  const { last } = rolls;
  if (last?.outcome === "won")
    lines.push(
      `Last roll: item ${last.itemId} won by ${last.mine ? "you" : formatGuid(last.winner ?? 0n)} (${last.winnerChoice} ${last.rolled})`,
    );
  if (last?.outcome === "all_passed")
    lines.push(`Last roll: item ${last.itemId} passed by everyone`);
  return lines;
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
