import type { CombatEvent, RewardsEvent, TacticsEvent } from "@tuicraft/core";
import { formatGuid } from "#ui/format";

function spell(event: CombatEvent, spellId: number | undefined): string {
  if (spellId === undefined) return "spell";
  return event.spellName === undefined
    ? `spell ${spellId}`
    : `${event.spellName} (${spellId})`;
}

export function formatCombatEventText(event: CombatEvent): string {
  const { lastOutcome: outcome, lastXp: xp, auras } = event.state;
  switch (event.type) {
    case "xp":
      return xp
        ? `[combat] +${xp.total} XP (${xp.kind === "kill" ? `kill ${formatGuid(xp.victim)}` : "other"})`
        : "[combat] xp";
    case "cast_failed":
    case "cast_interrupted": {
      const verb = event.type === "cast_failed" ? "failed" : "interrupted";
      const reason = outcome?.reason?.replaceAll("_", " ") ?? "unknown reason";
      return `[combat] ${spell(event, outcome?.spellId)} ${verb}: ${reason}`;
    }
    case "aura":
      return `[combat] auras: ${auras.length === 0 ? "none" : auras.map((aura) => aura.spellId).join(", ")}`;
    case "cast_sent":
    case "cast_started":
    case "cast_succeeded":
      return `[combat] ${spell(event, outcome?.spellId)} ${event.type.slice(5)}`;
    default:
      return `[combat] ${event.type}`;
  }
}

export function formatRewardsEventText(event: RewardsEvent): string {
  const { lastMoneyNotice: money, lastItemPush: push, loot } = event.state;
  switch (event.type) {
    case "money_notice":
      if (!money) return "[rewards] money_notice";
      return money.alone
        ? `[rewards] looted ${money.money} copper`
        : `[rewards] share of loot: ${money.money} copper`;
    case "item_push":
      return push
        ? `[rewards] received item ${push.itemId} x${push.count} (now ${push.totalCount})`
        : "[rewards] item_push";
    case "loot_opened": {
      if (loot.phase !== "open" && loot.phase !== "closing")
        return "[rewards] loot_opened";
      const items = loot.items.map(
        (item) => `slot ${item.slot} item ${item.itemId} x${item.count}`,
      );
      return `[rewards] loot opened: ${[`${loot.money} copper`, ...items].join(", ")}`;
    }
    default:
      return `[rewards] ${event.type}`;
  }
}

export function formatTacticsEventText(
  event: TacticsEvent,
): string | undefined {
  switch (event.type) {
    case "activated":
    case "request":
    case "result":
    case "applied":
      return undefined;
    case "started":
      return `[tactics] started ${event.targetGuid}`;
    case "discarded":
      return `[tactics] discarded ${event.actionId ?? "action"}: ${event.reason}`;
    case "outcome":
      return `[tactics] outcome ${event.status}: ${event.reason}`;
    case "transport":
      return `[tactics] transport error: ${event.error}`;
    default:
      return `[tactics] stopped: ${event.reason}`;
  }
}
