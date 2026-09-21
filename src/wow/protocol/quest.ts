import { PacketReader, PacketWriter } from "wow/protocol/packet";

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

export type QuestObjectiveTarget = {
  encodedNpcOrGoId: number;
  npcOrGoId: number;
  count: number;
  itemDropId: number;
  unknownSourceCount: number;
};

export type QuestReputationObjective = { factionId: number; value: number };
export type QuestPointOfInterest = {
  mapId: number;
  x: number;
  y: number;
  option: number;
};

export type QuestQueryResponse = {
  questId: number;
  method: number;
  level: number;
  minLevel: number;
  zoneOrSort: number;
  type: number;
  suggestedPlayers: number;
  reputationObjectives: [QuestReputationObjective, QuestReputationObjective];
  nextQuestId: number;
  xpId: number;
  money: number;
  maxLevelMoney: number;
  spellId: number;
  spellCastId: number;
  honor: number;
  honorMultiplier: number;
  sourceItemId: number;
  flags: number;
  titleId: number;
  playersSlain: number;
  talents: number;
  arenaPoints: number;
  reputationMask: number;
  items: QuestItem[];
  choices: QuestItem[];
  factions: QuestFactionReward[];
  poi: QuestPointOfInterest;
  title: string;
  objectives: string;
  details: string;
  areaDescription: string;
  completedText: string;
  targets: QuestObjectiveTarget[];
  requiredItems: QuestItem[];
  objectiveTexts: [string, string, string, string];
};

export type QuestgiverQuestComplete = {
  questId: number;
  experience: number;
  money: number;
  honor: number;
  talents: number;
  arenaPoints: number;
};

export type QuestUpdateAddKill = {
  questId: number;
  encodedNpcOrGoId: number;
  npcOrGoId: number;
  currentCount: number;
  requiredCount: number;
  guid: bigint;
};

export type QuestUpdateAddItem =
  | { kind: "notification" }
  | { kind: "item"; itemId: number; count: number };

export type QuestUpdateComplete = { questId: number };
export type QuestInvalid = { reason: number };
export type QuestFailed = { questId: number; reason: number };
export type QuestUpdateFailed = { questId: number };
export type QuestUpdateFailedTimer = { questId: number };

const decoder = new TextDecoder("utf-8", { ignoreBOM: true });

function string(reader: PacketReader): string {
  const bytes: number[] = [];
  for (let byte = reader.uint8(); byte !== 0; byte = reader.uint8())
    bytes.push(byte);
  return decoder.decode(Uint8Array.from(bytes));
}

function end(reader: PacketReader): void {
  if (reader.remaining !== 0)
    throw new RangeError("Unexpected trailing quest payload");
}

function checkCount(reader: PacketReader, count: number, width: number): void {
  if (count > Math.floor(reader.remaining / width))
    throw new RangeError("Quest record count exceeds remaining payload");
}

function checkUnsigned(value: number, maximum: number): void {
  if (!Number.isInteger(value) || value < 0 || value > maximum)
    throw new RangeError("Quest request integer outside unsigned range");
}

function guidRequest(guid: bigint, size: number): PacketWriter {
  if (guid < 0n || guid > 0xffffffffffffffffn)
    throw new RangeError("GUID outside uint64 range");
  const writer = new PacketWriter(size);
  writer.uint64LE(guid);
  return writer;
}

function questRequest(
  guid: bigint,
  questId: number,
  size: number,
): PacketWriter {
  checkUnsigned(questId, 0xffffffff);
  const writer = guidRequest(guid, size);
  writer.uint32LE(questId);
  return writer;
}

export function buildQuestgiverStatusQuery(guid: bigint): Uint8Array {
  return guidRequest(guid, 8).finish();
}

export function buildQuestgiverHello(guid: bigint): Uint8Array {
  return guidRequest(guid, 8).finish();
}

export function buildQuestgiverQueryQuest(
  guid: bigint,
  questId: number,
  unknown: number,
): Uint8Array {
  checkUnsigned(unknown, 0xff);
  const writer = questRequest(guid, questId, 13);
  writer.uint8(unknown);
  return writer.finish();
}

export function buildQuestQuery(questId: number): Uint8Array {
  checkUnsigned(questId, 0xffffffff);
  const writer = new PacketWriter(4);
  writer.uint32LE(questId);
  return writer.finish();
}

export function buildQuestgiverAcceptQuest(
  guid: bigint,
  questId: number,
  unknown: number,
): Uint8Array {
  checkUnsigned(unknown, 0xffffffff);
  const writer = questRequest(guid, questId, 16);
  writer.uint32LE(unknown);
  return writer.finish();
}

export function buildQuestgiverCompleteQuest(
  guid: bigint,
  questId: number,
): Uint8Array {
  return questRequest(guid, questId, 12).finish();
}

export function buildQuestgiverRequestReward(
  guid: bigint,
  questId: number,
): Uint8Array {
  return questRequest(guid, questId, 12).finish();
}

export function buildQuestgiverChooseReward(
  guid: bigint,
  questId: number,
  rewardIndex: number,
): Uint8Array {
  checkUnsigned(rewardIndex, 0xffffffff);
  const writer = questRequest(guid, questId, 16);
  writer.uint32LE(rewardIndex);
  return writer.finish();
}

export function buildQuestLogRemoveQuest(slot: number): Uint8Array {
  checkUnsigned(slot, 0xff);
  const writer = new PacketWriter(1);
  writer.uint8(slot);
  return writer.finish();
}

export function parseQuestMenuEntry(reader: PacketReader): QuestMenuEntry {
  return {
    questId: reader.uint32LE(),
    icon: reader.uint32LE(),
    level: reader.uint32LE() | 0,
    flags: reader.uint32LE(),
    repeatable: reader.uint8(),
    title: string(reader),
  };
}

export function parseQuestgiverStatus(reader: PacketReader): QuestgiverStatus {
  const result = { guid: reader.uint64LE(), status: reader.uint8() };
  end(reader);
  return result;
}

export function parseQuestgiverQuestList(
  reader: PacketReader,
): QuestgiverQuestList {
  const guid = reader.uint64LE();
  const title = string(reader);
  const emoteDelay = reader.uint32LE();
  const emote = reader.uint32LE();
  const count = reader.uint8();
  checkCount(reader, count, 18);
  const quests: QuestMenuEntry[] = [];
  for (let i = 0; i < count; i++) quests.push(parseQuestMenuEntry(reader));
  end(reader);
  return { guid, title, emoteDelay, emote, quests };
}

function displayItems(reader: PacketReader): QuestDisplayItem[] {
  const count = reader.uint32LE();
  checkCount(reader, count, 12);
  const items: QuestDisplayItem[] = [];
  for (let i = 0; i < count; i++) {
    items.push({
      itemId: reader.uint32LE(),
      count: reader.uint32LE(),
      displayId: reader.uint32LE(),
    });
  }
  return items;
}

function items(reader: PacketReader, count: number): QuestItem[] {
  checkCount(reader, count, 8);
  const result: QuestItem[] = [];
  for (let i = 0; i < count; i++)
    result.push({ itemId: reader.uint32LE(), count: reader.uint32LE() });
  return result;
}

function factions(reader: PacketReader): QuestFactionReward[] {
  checkCount(reader, 5, 12);
  const result: QuestFactionReward[] = [];
  for (let i = 0; i < 5; i++)
    result.push({ factionId: reader.uint32LE(), valueId: 0, override: 0 });
  for (const faction of result) faction.valueId = reader.uint32LE() | 0;
  for (const faction of result) faction.override = reader.uint32LE() | 0;
  return result;
}

function rewardPrefix(reader: PacketReader): QuestRewardPrefix {
  return {
    choices: displayItems(reader),
    items: displayItems(reader),
    money: reader.uint32LE() | 0,
    experience: reader.uint32LE(),
    honor: reader.uint32LE(),
    honorMultiplier: reader.floatLE(),
  };
}

function rewardSuffix(reader: PacketReader): QuestRewardSuffix {
  return {
    spellId: reader.uint32LE(),
    spellCastId: reader.uint32LE() | 0,
    titleId: reader.uint32LE(),
    talents: reader.uint32LE(),
    arenaPoints: reader.uint32LE(),
    reputationMask: reader.uint32LE(),
    factions: factions(reader),
  };
}

function emotes(
  reader: PacketReader,
  order: "emote-first" | "delay-first",
): QuestEmote[] {
  const count = reader.uint32LE();
  checkCount(reader, count, 8);
  const result: QuestEmote[] = [];
  for (let i = 0; i < count; i++) {
    const first = reader.uint32LE();
    const second = reader.uint32LE();
    result.push(
      order === "emote-first"
        ? { emote: first, delay: second }
        : { emote: second, delay: first },
    );
  }
  return result;
}

export function parseQuestgiverQuestDetails(
  reader: PacketReader,
): QuestgiverQuestDetails {
  const result = {
    guid: reader.uint64LE(),
    dividerGuid: reader.uint64LE(),
    questId: reader.uint32LE(),
    title: string(reader),
    details: string(reader),
    objectives: string(reader),
    activateAccept: reader.uint8(),
    flags: reader.uint32LE(),
    suggestedPlayers: reader.uint32LE(),
    unknown: reader.uint8(),
    rewards: { ...rewardPrefix(reader), ...rewardSuffix(reader) },
    emotes: emotes(reader, "emote-first"),
  };
  end(reader);
  return result;
}

export function parseQuestgiverOfferReward(
  reader: PacketReader,
): QuestgiverOfferReward {
  const guid = reader.uint64LE();
  const questId = reader.uint32LE();
  const title = string(reader);
  const rewardText = string(reader);
  const enableNext = reader.uint8();
  const flags = reader.uint32LE();
  const suggestedPlayers = reader.uint32LE();
  const offerEmotes = emotes(reader, "delay-first");
  const prefix = rewardPrefix(reader);
  const unknownAfterHonorMultiplier = reader.uint32LE();
  const rewards = { ...prefix, ...rewardSuffix(reader) };
  end(reader);
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
  reader: PacketReader,
): QuestgiverRequestItems {
  const result: QuestgiverRequestItems = {
    guid: reader.uint64LE(),
    questId: reader.uint32LE(),
    title: string(reader),
    requestText: string(reader),
    unknown: reader.uint32LE(),
    emote: reader.uint32LE(),
    closeOnCancel: reader.uint32LE(),
    flags: reader.uint32LE(),
    suggestedPlayers: reader.uint32LE(),
    requiredMoney: reader.uint32LE(),
    items: displayItems(reader),
    completionFlags: [
      reader.uint32LE(),
      reader.uint32LE(),
      reader.uint32LE(),
      reader.uint32LE(),
    ],
  };
  end(reader);
  return result;
}

function npcOrGoId(encoded: number): number {
  return encoded & 0x80000000 ? -(encoded & 0x7fffffff) : encoded;
}

function targets(reader: PacketReader): QuestObjectiveTarget[] {
  checkCount(reader, 4, 16);
  const result: QuestObjectiveTarget[] = [];
  for (let i = 0; i < 4; i++) {
    const encodedNpcOrGoId = reader.uint32LE();
    result.push({
      encodedNpcOrGoId,
      npcOrGoId: npcOrGoId(encodedNpcOrGoId),
      count: reader.uint32LE(),
      itemDropId: reader.uint32LE(),
      unknownSourceCount: reader.uint32LE(),
    });
  }
  return result;
}

export function parseQuestQueryResponse(
  reader: PacketReader,
): QuestQueryResponse {
  const result: QuestQueryResponse = {
    questId: reader.uint32LE(),
    method: reader.uint32LE(),
    level: reader.uint32LE() | 0,
    minLevel: reader.uint32LE(),
    zoneOrSort: reader.uint32LE() | 0,
    type: reader.uint32LE(),
    suggestedPlayers: reader.uint32LE(),
    reputationObjectives: [
      { factionId: reader.uint32LE(), value: reader.uint32LE() | 0 },
      { factionId: reader.uint32LE(), value: reader.uint32LE() | 0 },
    ],
    nextQuestId: reader.uint32LE(),
    xpId: reader.uint32LE(),
    money: reader.uint32LE() | 0,
    maxLevelMoney: reader.uint32LE(),
    spellId: reader.uint32LE(),
    spellCastId: reader.uint32LE() | 0,
    honor: reader.uint32LE(),
    honorMultiplier: reader.floatLE(),
    sourceItemId: reader.uint32LE(),
    flags: reader.uint32LE(),
    titleId: reader.uint32LE(),
    playersSlain: reader.uint32LE(),
    talents: reader.uint32LE(),
    arenaPoints: reader.uint32LE(),
    reputationMask: reader.uint32LE(),
    items: items(reader, 4),
    choices: items(reader, 6),
    factions: factions(reader),
    poi: {
      mapId: reader.uint32LE(),
      x: reader.floatLE(),
      y: reader.floatLE(),
      option: reader.uint32LE(),
    },
    title: string(reader),
    objectives: string(reader),
    details: string(reader),
    areaDescription: string(reader),
    completedText: string(reader),
    targets: targets(reader),
    requiredItems: items(reader, 6),
    objectiveTexts: [
      string(reader),
      string(reader),
      string(reader),
      string(reader),
    ],
  };
  end(reader);
  return result;
}

export function parseQuestgiverQuestComplete(
  reader: PacketReader,
): QuestgiverQuestComplete {
  const result = {
    questId: reader.uint32LE(),
    experience: reader.uint32LE(),
    money: reader.uint32LE() | 0,
    honor: reader.uint32LE(),
    talents: reader.uint32LE(),
    arenaPoints: reader.uint32LE(),
  };
  end(reader);
  return result;
}

export function parseQuestUpdateAddKill(
  reader: PacketReader,
): QuestUpdateAddKill {
  const questId = reader.uint32LE();
  const encodedNpcOrGoId = reader.uint32LE();
  const result = {
    questId,
    encodedNpcOrGoId,
    npcOrGoId: npcOrGoId(encodedNpcOrGoId),
    currentCount: reader.uint32LE(),
    requiredCount: reader.uint32LE(),
    guid: reader.uint64LE(),
  };
  end(reader);
  return result;
}

export function parseQuestUpdateAddItem(
  reader: PacketReader,
): QuestUpdateAddItem {
  if (reader.remaining === 0) return { kind: "notification" };
  const itemId = reader.uint32LE();
  const count = reader.uint32LE();
  end(reader);
  return { kind: "item", itemId, count };
}

export function parseQuestUpdateComplete(
  reader: PacketReader,
): QuestUpdateComplete {
  const questId = reader.uint32LE();
  end(reader);
  return { questId };
}

export function parseQuestInvalid(reader: PacketReader): QuestInvalid {
  const reason = reader.uint32LE();
  end(reader);
  return { reason };
}

export function parseQuestFailed(reader: PacketReader): QuestFailed {
  const result = { questId: reader.uint32LE(), reason: reader.uint32LE() };
  end(reader);
  return result;
}

export function parseQuestUpdateFailed(
  reader: PacketReader,
): QuestUpdateFailed {
  const questId = reader.uint32LE();
  end(reader);
  return { questId };
}

export function parseQuestUpdateFailedTimer(
  reader: PacketReader,
): QuestUpdateFailedTimer {
  const questId = reader.uint32LE();
  end(reader);
  return { questId };
}
