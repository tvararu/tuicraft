import { type PacketReader, PacketWriter } from "wow/protocol/packet";

export type QuestMenuEntry = {
  questId: number;
  icon: number;
  level: number;
  flags: number;
  repeatable: number;
  title: string;
};

export type QuestgiverStatus = { guid: bigint; status: number };

export type QuestgiverQuestList = {
  guid: bigint;
  title: string;
  emoteDelay: number;
  emote: number;
  quests: QuestMenuEntry[];
};

export type QuestItem = { itemId: number; count: number };

export type QuestDisplayItem = QuestItem & { displayId: number };

export type QuestEmote = { emote: number; delay: number };

export type QuestFactionReward = {
  factionId: number;
  valueId: number;
  override: number;
};

type QuestRewardPrefix = {
  choices: QuestDisplayItem[];
  items: QuestDisplayItem[];
  money: number;
  experience: number;
  honor: number;
  honorMultiplier: number;
};

type QuestRewardSuffix = {
  spellId: number;
  spellCastId: number;
  titleId: number;
  talents: number;
  arenaPoints: number;
  reputationMask: number;
  factions: QuestFactionReward[];
};

export type QuestRewards = QuestRewardPrefix & QuestRewardSuffix;

export type QuestgiverQuestDetails = {
  guid: bigint;
  dividerGuid: bigint;
  questId: number;
  title: string;
  details: string;
  objectives: string;
  activateAccept: number;
  flags: number;
  autoAccept: boolean;
  suggestedPlayers: number;
  unknown: number;
  rewards: QuestRewards;
  emotes: QuestEmote[];
};

export type QuestgiverOfferReward = {
  guid: bigint;
  questId: number;
  title: string;
  rewardText: string;
  enableNext: number;
  flags: number;
  suggestedPlayers: number;
  emotes: QuestEmote[];
  rewards: QuestRewards;
  unknownAfterHonorMultiplier: number;
};

export type QuestgiverRequestItems = {
  guid: bigint;
  questId: number;
  title: string;
  requestText: string;
  unknown: number;
  emote: number;
  closeOnCancel: number;
  flags: number;
  suggestedPlayers: number;
  requiredMoney: number;
  items: QuestDisplayItem[];
  completionFlags: [number, number, number, number];
};

export type QuestgiverQuestComplete = {
  questId: number;
  experience: number;
  money: number;
  honor: number;
  talents: number;
  arenaPoints: number;
};

function guidRequest(guid: bigint): PacketWriter {
  const w = new PacketWriter();
  w.uint64LE(guid);
  return w;
}

function questRequest(guid: bigint, questId: number): PacketWriter {
  const w = guidRequest(guid);
  w.uint32LE(questId);
  return w;
}

export function buildQuestgiverQueryQuest(
  guid: bigint,
  questId: number,
  unknown: number,
): Uint8Array {
  const w = questRequest(guid, questId);
  w.uint8(unknown);
  return w.finish();
}

export function buildQuestgiverAcceptQuest(
  guid: bigint,
  questId: number,
  unknown: number,
): Uint8Array {
  const w = questRequest(guid, questId);
  w.uint32LE(unknown);
  return w.finish();
}

export function buildQuestgiverCompleteQuest(
  guid: bigint,
  questId: number,
): Uint8Array {
  return questRequest(guid, questId).finish();
}

export function buildQuestgiverRequestReward(
  guid: bigint,
  questId: number,
): Uint8Array {
  return questRequest(guid, questId).finish();
}

export function buildQuestgiverChooseReward(
  guid: bigint,
  questId: number,
  rewardIndex: number,
): Uint8Array {
  const w = questRequest(guid, questId);
  w.uint32LE(rewardIndex);
  return w.finish();
}

export function parseQuestMenuEntry(r: PacketReader): QuestMenuEntry {
  return {
    questId: r.uint32LE(),
    icon: r.uint32LE(),
    level: r.uint32LE() | 0,
    flags: r.uint32LE(),
    repeatable: r.uint8(),
    title: r.cString(),
  };
}

export function parseQuestgiverStatus(r: PacketReader): QuestgiverStatus {
  return { guid: r.uint64LE(), status: r.uint8() };
}

export function parseQuestgiverQuestList(r: PacketReader): QuestgiverQuestList {
  const guid = r.uint64LE();
  const title = r.cString();
  const emoteDelay = r.uint32LE();
  const emote = r.uint32LE();
  const count = r.uint8();
  const quests: QuestMenuEntry[] = [];
  for (let i = 0; i < count; i++) quests.push(parseQuestMenuEntry(r));
  return { guid, title, emoteDelay, emote, quests };
}

function displayItems(r: PacketReader): QuestDisplayItem[] {
  const count = r.uint32LE();
  const displayed: QuestDisplayItem[] = [];
  for (let i = 0; i < count; i++) {
    displayed.push({
      itemId: r.uint32LE(),
      count: r.uint32LE(),
      displayId: r.uint32LE(),
    });
  }
  return displayed;
}

export function items(r: PacketReader, count: number): QuestItem[] {
  const result: QuestItem[] = [];
  for (let i = 0; i < count; i++)
    result.push({ itemId: r.uint32LE(), count: r.uint32LE() });
  return result;
}

export function factions(r: PacketReader): QuestFactionReward[] {
  const result: QuestFactionReward[] = [];
  for (let i = 0; i < 5; i++)
    result.push({ factionId: r.uint32LE(), valueId: 0, override: 0 });
  for (const faction of result) faction.valueId = r.uint32LE() | 0;
  for (const faction of result) faction.override = r.uint32LE() | 0;
  return result;
}

function rewardPrefix(r: PacketReader): QuestRewardPrefix {
  return {
    choices: displayItems(r),
    items: displayItems(r),
    money: r.uint32LE() | 0,
    experience: r.uint32LE(),
    honor: r.uint32LE(),
    honorMultiplier: r.floatLE(),
  };
}

function rewardSuffix(r: PacketReader): QuestRewardSuffix {
  return {
    spellId: r.uint32LE(),
    spellCastId: r.uint32LE() | 0,
    titleId: r.uint32LE(),
    talents: r.uint32LE(),
    arenaPoints: r.uint32LE(),
    reputationMask: r.uint32LE(),
    factions: factions(r),
  };
}

function emotes(
  r: PacketReader,
  order: "emote-first" | "delay-first",
): QuestEmote[] {
  const count = r.uint32LE();
  const result: QuestEmote[] = [];
  for (let i = 0; i < count; i++) {
    const first = r.uint32LE();
    const second = r.uint32LE();
    result.push(
      order === "emote-first"
        ? { emote: first, delay: second }
        : { emote: second, delay: first },
    );
  }
  return result;
}

const QUEST_FLAGS_AUTO_ACCEPT = 0x8_00_00;

export function parseQuestgiverQuestDetails(
  r: PacketReader,
): QuestgiverQuestDetails {
  const guid = r.uint64LE();
  const dividerGuid = r.uint64LE();
  const questId = r.uint32LE();
  const title = r.cString();
  const details = r.cString();
  const objectives = r.cString();
  const activateAccept = r.uint8();
  const flags = r.uint32LE();
  return {
    guid,
    dividerGuid,
    questId,
    title,
    details,
    objectives,
    activateAccept,
    flags,
    autoAccept: (flags & QUEST_FLAGS_AUTO_ACCEPT) !== 0,
    suggestedPlayers: r.uint32LE(),
    unknown: r.uint8(),
    rewards: { ...rewardPrefix(r), ...rewardSuffix(r) },
    emotes: emotes(r, "emote-first"),
  };
}

export function parseQuestgiverOfferReward(
  r: PacketReader,
): QuestgiverOfferReward {
  const guid = r.uint64LE();
  const questId = r.uint32LE();
  const title = r.cString();
  const rewardText = r.cString();
  const enableNext = r.uint8();
  const flags = r.uint32LE();
  const suggestedPlayers = r.uint32LE();
  const offerEmotes = emotes(r, "delay-first");
  const prefix = rewardPrefix(r);
  const unknownAfterHonorMultiplier = r.uint32LE();
  const rewards = { ...prefix, ...rewardSuffix(r) };
  return {
    guid,
    questId,
    title,
    rewardText,
    enableNext,
    flags,
    suggestedPlayers,
    emotes: offerEmotes,
    rewards,
    unknownAfterHonorMultiplier,
  };
}

export function parseQuestgiverRequestItems(
  r: PacketReader,
): QuestgiverRequestItems {
  return {
    guid: r.uint64LE(),
    questId: r.uint32LE(),
    title: r.cString(),
    requestText: r.cString(),
    unknown: r.uint32LE(),
    emote: r.uint32LE(),
    closeOnCancel: r.uint32LE(),
    flags: r.uint32LE(),
    suggestedPlayers: r.uint32LE(),
    requiredMoney: r.uint32LE(),
    items: displayItems(r),
    completionFlags: [r.uint32LE(), r.uint32LE(), r.uint32LE(), r.uint32LE()],
  };
}

export function parseQuestgiverQuestComplete(
  r: PacketReader,
): QuestgiverQuestComplete {
  return {
    questId: r.uint32LE(),
    experience: r.uint32LE(),
    money: r.uint32LE() | 0,
    honor: r.uint32LE(),
    talents: r.uint32LE(),
    arenaPoints: r.uint32LE(),
  };
}
