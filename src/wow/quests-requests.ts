import { type Entity, fieldOf } from "wow/entity-store";
import { UNIT_FIELDS } from "wow/protocol/entity-fields";
import { buildGossipHello, buildGossipSelectOption } from "wow/protocol/gossip";
import { GameOpcode } from "wow/protocol/opcodes";
import { buildQuestLogRemoveQuest } from "wow/protocol/quest-log";
import {
  buildQuestgiverAcceptQuest,
  buildQuestgiverChooseReward,
  buildQuestgiverCompleteQuest,
  buildQuestgiverQueryQuest,
  buildQuestgiverRequestReward,
} from "wow/protocol/questgiver";
import type { QuestLog } from "wow/quest-slots";
import type { QuestAction, QuestDialog, QuestIntent } from "wow/quests";

export type QuestRequest = {
  opcode: number;
  body: Uint8Array;
  intent: Omit<QuestIntent, "at">;
};

export function positiveId(id: number): void {
  if (!Number.isInteger(id) || id <= 0 || id > 0xff_ff_ff_ff)
    throw new Error("invalid_quest_id");
}

export function talkRequest(guid: bigint): QuestRequest {
  if (guid <= 0n || guid > 0xffffffffffffffffn) throw new Error("invalid_guid");
  return {
    opcode: GameOpcode.CMSG_GOSSIP_HELLO,
    body: buildGossipHello(guid),
    intent: { action: "talk", guid },
  };
}

export function selectOptionRequest(
  dialog: QuestDialog | undefined,
  optionId: number,
  code: string | undefined,
): QuestRequest {
  if (dialog?.kind !== "gossip") throw new Error("gossip_not_open");
  const option = dialog.data.options.find(
    (entry) => entry.optionIndex === optionId,
  );
  if (!option) throw new Error("option_not_offered");
  if (option.coded && code === undefined)
    throw new Error("gossip_code_required");
  if (!option.coded && code !== undefined)
    throw new Error("gossip_code_not_offered");
  const { guid, menuId } = dialog.data;
  const body = buildGossipSelectOption({
    guid,
    menuId,
    optionIndex: optionId,
    code,
  });
  return {
    opcode: GameOpcode.CMSG_GOSSIP_SELECT_OPTION,
    body,
    intent: { action: "selectOption", guid, optionId },
  };
}

export function selectQuestRequest(
  dialog: QuestDialog | undefined,
  questId: number,
): QuestRequest | "turnIn" {
  positiveId(questId);
  if (dialog?.kind !== "gossip" && dialog?.kind !== "list")
    throw new Error("quest_not_offered");
  const entry = dialog.data.quests.find((quest) => quest.questId === questId);
  if (!entry) throw new Error("quest_not_offered");
  if (entry.icon === 4) return "turnIn";
  const guid = dialog.data.guid;
  return {
    opcode: GameOpcode.CMSG_QUESTGIVER_QUERY_QUEST,
    body: buildQuestgiverQueryQuest(guid, questId, 0),
    intent: { action: "selectQuest", guid, questId },
  };
}

export function acceptRequest(
  dialog: QuestDialog | undefined,
  log: QuestLog,
): QuestRequest {
  if (dialog?.kind !== "details") throw new Error("quest_details_not_open");
  if (!dialog.data.activateAccept) throw new Error("quest_accept_not_offered");
  const { guid, questId } = dialog.data;
  if (log.slots.some((slot) => slot.questId === questId))
    throw new Error("quest_already_in_log");
  return {
    opcode: GameOpcode.CMSG_QUESTGIVER_ACCEPT_QUEST,
    body: buildQuestgiverAcceptQuest(guid, questId, 0),
    intent: { action: "accept", guid, questId },
  };
}

function offeredGiver(
  dialog: QuestDialog | undefined,
  questId: number,
): bigint {
  if (!dialog) throw new Error("quest_not_offered");
  if (dialog.kind === "gossip" || dialog.kind === "list") {
    if (dialog.data.quests.some((entry) => entry.questId === questId))
      return dialog.data.guid;
  } else if (dialog.data.questId === questId) return dialog.data.guid;
  throw new Error("quest_not_offered");
}

export function completeRequest(
  dialog: QuestDialog | undefined,
  questId: number,
): QuestRequest {
  positiveId(questId);
  const guid = offeredGiver(dialog, questId);
  return {
    opcode: GameOpcode.CMSG_QUESTGIVER_COMPLETE_QUEST,
    body: buildQuestgiverCompleteQuest(guid, questId),
    intent: { action: "complete", guid, questId },
  };
}

export function requestRewardRequest(
  dialog: QuestDialog | undefined,
): QuestRequest {
  if (dialog?.kind !== "requestItems")
    throw new Error("quest_request_items_not_open");
  if ((dialog.data.completionFlags[0] & 3) !== 3)
    throw new Error("quest_requirements_unmet");
  const { guid, questId } = dialog.data;
  return {
    opcode: GameOpcode.CMSG_QUESTGIVER_REQUEST_REWARD,
    body: buildQuestgiverRequestReward(guid, questId),
    intent: { action: "requestReward", guid, questId },
  };
}

export function chooseRewardRequest(
  dialog: QuestDialog | undefined,
  index: number,
): QuestRequest {
  if (dialog?.kind !== "offer") throw new Error("reward_offer_not_open");
  const count = dialog.data.rewards.choices.length;
  if (
    !Number.isInteger(index) ||
    index < 0 ||
    index >= Math.max(1, count) ||
    index >= 6
  )
    throw new Error("reward_not_offered");
  const { guid, questId } = dialog.data;
  return {
    opcode: GameOpcode.CMSG_QUESTGIVER_CHOOSE_REWARD,
    body: buildQuestgiverChooseReward(guid, questId, index),
    intent: { action: "chooseReward", guid, questId, rewardIndex: index },
  };
}

export function abandonRequest(
  slot: number,
  readLog: () => QuestLog,
): QuestRequest {
  if (!Number.isInteger(slot) || slot < 0 || slot >= 25)
    throw new Error("invalid_quest_slot");
  const entry = readLog().slots[slot];
  if (entry?.questId === undefined) throw new Error("quest_slot_unknown");
  if (entry.questId === 0) throw new Error("quest_slot_empty");
  return {
    opcode: GameOpcode.CMSG_QUESTLOG_REMOVE_QUEST,
    body: buildQuestLogRemoveQuest(slot),
    intent: { action: "abandon", slot, questId: entry.questId },
  };
}

export function expectedDialog(
  pendingAction: QuestAction | undefined,
  dialog: QuestDialog,
): boolean {
  switch (pendingAction) {
    case "accept":
    case "abandon":
    case "cancel":
      return false;
    case "selectQuest":
      return (
        dialog.kind === "details" ||
        dialog.kind === "requestItems" ||
        dialog.kind === "offer"
      );
    case "complete":
      return dialog.kind === "requestItems" || dialog.kind === "offer";
    case "requestReward":
    case "chooseReward":
      return dialog.kind === "offer";
    default:
      return true;
  }
}

export function questIdsVisible(entity: Entity): boolean {
  const offsets = [UNIT_FIELDS.CHARMEDBY.offset, UNIT_FIELDS.SUMMONEDBY.offset];
  return offsets.every(
    (offset) =>
      fieldOf(entity, offset) === 0 && fieldOf(entity, offset + 1) === 0,
  );
}
