import { formatGuid } from "ui/format";
import {
  type QuestDialog,
  type QuestDisplayItem,
  type QuestEvent,
  type QuestIntent,
  type QuestLogSlot,
  type QuestRewards,
  type QuestState,
  questSlotStatus,
} from "wow";

const INVALID_REASONS: Record<number, string> = {
  0: "requirements not met",
  1: "level too low",
  6: "wrong race",
  7: "already completed",
  12: "only one timed quest at a time",
  13: "already on that quest",
  16: "expansion required",
  18: "already on that quest",
  21: "missing required items",
  23: "not enough money",
  26: "daily quest limit reached",
  27: "tired time reached",
  29: "daily quest already completed today",
};

const NEXT_STEP: Record<QuestDialog["kind"], string> = {
  details: "accept-quest",
  gossip: "select-quest <id> or select-option <id>",
  list: "select-quest <id>",
  offer: "choose-reward <index> (0 without choices)",
  requestItems: "request-reward",
};

function nextStep(state: QuestState, dialog: QuestDialog): string {
  if (dialog.kind !== "details") return `tuicraft ${NEXT_STEP[dialog.kind]}`;
  const { questId, activateAccept } = dialog.data;
  if (state.log.slots.some((slot) => slot.questId === questId))
    return "already in the quest log; tuicraft cancel-interaction closes the dialog";
  if (!activateAccept) return "accept not offered; tuicraft cancel-interaction";
  return `tuicraft ${NEXT_STEP.details}`;
}

function titleOf(state: QuestState, questId: number): string | undefined {
  for (const query of state.queries)
    if (query.questId === questId && query.status === "known")
      return query.data.title;
  const data = state.dialog?.data;
  if (data && "questId" in data && data.questId === questId) return data.title;
  const offered =
    state.dialog?.kind === "gossip" || state.dialog?.kind === "list"
      ? state.dialog.data.quests
      : [];
  return offered.find((quest) => quest.questId === questId)?.title;
}

function named(state: QuestState, questId: number): string {
  const title = titleOf(state, questId);
  return title ? `${questId} ${title}` : `${questId}`;
}

function items(list: QuestDisplayItem[]): string {
  return list.map((item) => `item ${item.itemId} x${item.count}`).join(", ");
}

function rewards(r: QuestRewards): string[] {
  const lines = r.choices.map(
    (item, index) =>
      `Reward choice ${index}: item ${item.itemId} x${item.count}`,
  );
  const fixed = [
    r.experience > 0 ? `${r.experience} XP` : "",
    r.money > 0 ? `${r.money} copper` : "",
    items(r.items),
  ].filter(Boolean);
  if (fixed.length > 0) lines.push(`Rewards: ${fixed.join(", ")}`);
  return lines;
}

function dialogLines(state: QuestState, dialog: QuestDialog): string[] {
  const giver = `from ${formatGuid(dialog.data.guid)}`;
  const lines: string[] = [];
  switch (dialog.kind) {
    case "gossip":
      lines.push(`Dialog: gossip ${giver}`);
      for (const option of dialog.data.options)
        lines.push(`Option ${option.optionIndex}: ${option.text}`);
      break;
    case "list":
      lines.push(`Dialog: list ${giver}, ${dialog.data.title}`);
      break;
    case "details":
      lines.push(
        `Dialog: details ${giver}, quest ${named(state, dialog.data.questId)}`,
      );
      lines.push(...rewards(dialog.data.rewards));
      break;
    case "requestItems": {
      const { data } = dialog;
      lines.push(
        `Dialog: requestItems ${giver}, quest ${named(state, data.questId)}`,
      );
      if (data.items.length > 0)
        lines.push(`Required items: ${items(data.items)}`);
      if (data.requiredMoney > 0)
        lines.push(`Required money: ${data.requiredMoney} copper`);
      break;
    }
    default:
      lines.push(
        `Dialog: offer ${giver}, quest ${named(state, dialog.data.questId)}`,
      );
      lines.push(...rewards(dialog.data.rewards));
  }
  if (dialog.kind === "gossip" || dialog.kind === "list")
    for (const quest of dialog.data.quests)
      lines.push(
        `Quest ${quest.questId} (level ${quest.level}): ${quest.title}`,
      );
  lines.push(`Next: ${nextStep(state, dialog)}`);
  return lines;
}

function counts(state: QuestState, slot: QuestLogSlot): string {
  const questId = slot.questId ?? 0;
  const query = state.queries.find(
    (entry) => entry.questId === questId && entry.status === "known",
  );
  const targets = query?.status === "known" ? query.data.targets : [];
  const parts = slot.counters.flatMap((count, i) => {
    const required = targets[i]?.count ?? 0;
    if (required > 0) return [`${count ?? "?"}/${required}`];
    return count ? [`${count}`] : [];
  });
  for (const item of state.items)
    if (item.questId === questId)
      parts.push(`item ${item.itemId} ${item.carried ?? "?"}/${item.required}`);
  return parts.length > 0 ? `, ${parts.join(" ")}` : "";
}

function slotLine(state: QuestState, slot: QuestLogSlot): string {
  const status = questSlotStatus(slot);
  const questId = slot.questId ?? 0;
  return `Slot ${slot.slot}: quest ${named(state, questId)}, ${status}${counts(state, slot)}`;
}

function intentText(state: QuestState, intent: QuestIntent): string {
  const quest =
    intent.questId === undefined ? "" : ` ${named(state, intent.questId)}`;
  return `${intent.action}${quest}`;
}

function errorText(state: QuestState): string | undefined {
  const error = state.lastError;
  if (!error) return undefined;
  const reason =
    error.reason === undefined
      ? ""
      : `: ${INVALID_REASONS[error.reason] ?? `reason ${error.reason}`}`;
  const quest =
    error.questId === undefined ? "" : ` ${named(state, error.questId)}`;
  return `${error.kind}${quest}${reason}`;
}

function rewardText(state: QuestState): string | undefined {
  const reward = state.lastReward;
  if (!reward) return undefined;
  const parts = [
    reward.experience > 0 ? `+${reward.experience} XP` : "",
    reward.money > 0 ? `+${reward.money} copper` : "",
  ].filter(Boolean);
  return `${named(state, reward.questId)}${parts.length > 0 ? ` ${parts.join(" ")}` : ""}`;
}

export function formatQuestState(state: QuestState): string[] {
  const lines = state.dialog
    ? dialogLines(state, state.dialog)
    : ["Dialog: none"];
  if (state.pending)
    lines.push(`Request: ${state.pending.action} ${state.pending.status}`);
  for (const intent of state.unresolved)
    lines.push(`Unresolved: ${intentText(state, intent)}`);
  if (state.log.complete) {
    const held = state.log.slots.filter((slot) => (slot.questId ?? 0) !== 0);
    lines.push(`Quest log: ${held.length} quests`);
    for (const slot of held) lines.push(slotLine(state, slot));
  } else lines.push("Quest log: unknown");
  const error = errorText(state);
  if (error) lines.push(`Last error: ${error}`);
  const reward = rewardText(state);
  if (reward) lines.push(`Last reward: ${reward}`);
  return lines;
}

function progressText(event: QuestEvent): string {
  const { state, questId } = event;
  const progress = state.lastProgress;
  if (event.source === "packet" && progress?.kind === "kill") {
    const { data } = progress;
    return `[quest] progress ${named(state, data.questId)}: creature ${data.npcOrGoId} ${data.currentCount}/${data.requiredCount}`;
  }
  if (event.source === "inventory" && progress?.kind === "collect")
    return `[quest] progress ${named(state, progress.questId)}: item ${progress.itemId} ${progress.carried}/${progress.required}`;
  if (event.source === "packet" && progress?.kind === "item")
    return progress.data.kind === "item"
      ? `[quest] progress: item ${progress.data.itemId} x${progress.data.count}`
      : "[quest] progress: item";
  if (questId === undefined) return "[quest] progress";
  const slot = state.log.slots.find((entry) => entry.questId === questId);
  return `[quest] progress ${named(state, questId)}${slot ? counts(state, slot).replace(",", ":") : ""}`;
}

export function formatQuestEventText(event: QuestEvent): string {
  const { state, questId, type } = event;
  switch (type) {
    case "progress":
      return progressText(event);
    case "rewarded":
      return `[quest] rewarded ${rewardText(state) ?? questId ?? ""}`.trimEnd();
    case "error":
      return `[quest] error ${errorText(state) ?? ""}`.trimEnd();
    case "dialog":
      return state.dialog
        ? `[quest] dialog ${state.dialog.kind}${questId === undefined ? "" : ` ${named(state, questId)}`}, next: ${nextStep(state, state.dialog).replace("tuicraft ", "")}`
        : "[quest] dialog";
    case "intent": {
      const action = state.lastIntent?.action;
      const quest = questId === undefined ? "" : ` ${named(state, questId)}`;
      return `[quest] intent${action ? ` ${action}` : ""}${quest}`;
    }
    default: {
      const detail = event.detail === undefined ? "" : ` ${event.detail}`;
      return questId === undefined
        ? `[quest] ${type}${detail}`
        : `[quest] ${type} ${named(state, questId)}${detail}`;
    }
  }
}
