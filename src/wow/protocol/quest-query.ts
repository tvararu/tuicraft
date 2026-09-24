import { PacketReader, PacketWriter } from "wow/protocol/packet";
import {
  factions,
  items,
  type QuestFactionReward,
  type QuestItem,
} from "wow/protocol/questgiver";
import { npcOrGoId } from "wow/protocol/quest-log";

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

export function buildQuestQuery(questId: number): Uint8Array {
  const w = new PacketWriter();
  w.uint32LE(questId);
  return w.finish();
}

function targets(r: PacketReader): QuestObjectiveTarget[] {
  const result: QuestObjectiveTarget[] = [];
  for (let i = 0; i < 4; i++) {
    const encodedNpcOrGoId = r.uint32LE();
    result.push({
      encodedNpcOrGoId,
      npcOrGoId: npcOrGoId(encodedNpcOrGoId),
      count: r.uint32LE(),
      itemDropId: r.uint32LE(),
      unknownSourceCount: r.uint32LE(),
    });
  }
  return result;
}

function readHead(r: PacketReader) {
  const questId = r.uint32LE();
  const method = r.uint32LE();
  const level = r.uint32LE() | 0;
  const minLevel = r.uint32LE();
  const zoneOrSort = r.uint32LE() | 0;
  const type = r.uint32LE();
  const suggestedPlayers = r.uint32LE();
  const reputationObjectives: QuestQueryResponse["reputationObjectives"] = [
    readReputation(r),
    readReputation(r),
  ];
  const nextQuestId = r.uint32LE();
  const xpId = r.uint32LE();
  return {
    questId,
    method,
    level,
    minLevel,
    zoneOrSort,
    type,
    suggestedPlayers,
    reputationObjectives,
    nextQuestId,
    xpId,
  };
}

function readReputation(r: PacketReader): QuestReputationObjective {
  return { factionId: r.uint32LE(), value: r.uint32LE() | 0 };
}

function readRewards(r: PacketReader) {
  return {
    money: r.uint32LE() | 0,
    maxLevelMoney: r.uint32LE(),
    spellId: r.uint32LE(),
    spellCastId: r.uint32LE() | 0,
    honor: r.uint32LE(),
    honorMultiplier: r.floatLE(),
    sourceItemId: r.uint32LE(),
    flags: r.uint32LE(),
    titleId: r.uint32LE(),
    playersSlain: r.uint32LE(),
    talents: r.uint32LE(),
    arenaPoints: r.uint32LE(),
    reputationMask: r.uint32LE(),
    items: items(r, 4),
    choices: items(r, 6),
    factions: factions(r),
  };
}

function readPoi(r: PacketReader): QuestPointOfInterest {
  return {
    mapId: r.uint32LE(),
    x: r.floatLE(),
    y: r.floatLE(),
    option: r.uint32LE(),
  };
}

function readTexts(r: PacketReader) {
  return {
    title: r.cString(),
    objectives: r.cString(),
    details: r.cString(),
    areaDescription: r.cString(),
    completedText: r.cString(),
  };
}

export function parseQuestQueryResponse(r: PacketReader): QuestQueryResponse {
  const head = readHead(r);
  const rewards = readRewards(r);
  const poi = readPoi(r);
  const texts = readTexts(r);
  const objectiveTargets = targets(r);
  const requiredItems = items(r, 6);
  const objectiveTexts: QuestQueryResponse["objectiveTexts"] = [
    r.cString(),
    r.cString(),
    r.cString(),
    r.cString(),
  ];
  return {
    ...head,
    ...rewards,
    poi,
    ...texts,
    targets: objectiveTargets,
    requiredItems,
    objectiveTexts,
  };
}
