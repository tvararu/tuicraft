import { PacketReader, PacketWriter } from "wow/protocol/packet";

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

export function buildQuestLogRemoveQuest(slot: number): Uint8Array {
  const w = new PacketWriter();
  w.uint8(slot);
  return w.finish();
}

export function npcOrGoId(encoded: number): number {
  return encoded & 0x80000000 ? -(encoded & 0x7fffffff) : encoded;
}

export function parseQuestUpdateAddKill(r: PacketReader): QuestUpdateAddKill {
  const questId = r.uint32LE();
  const encodedNpcOrGoId = r.uint32LE();
  return {
    questId,
    encodedNpcOrGoId,
    npcOrGoId: npcOrGoId(encodedNpcOrGoId),
    currentCount: r.uint32LE(),
    requiredCount: r.uint32LE(),
    guid: r.uint64LE(),
  };
}

export function parseQuestUpdateAddItem(r: PacketReader): QuestUpdateAddItem {
  if (r.remaining === 0) return { kind: "notification" };
  const itemId = r.uint32LE();
  const count = r.uint32LE();
  return { kind: "item", itemId, count };
}

export function parseQuestUpdateComplete(r: PacketReader): QuestUpdateComplete {
  return { questId: r.uint32LE() };
}

export function parseQuestInvalid(r: PacketReader): QuestInvalid {
  return { reason: r.uint32LE() };
}

export function parseQuestFailed(r: PacketReader): QuestFailed {
  return { questId: r.uint32LE(), reason: r.uint32LE() };
}

export function parseQuestUpdateFailed(r: PacketReader): QuestUpdateFailed {
  return { questId: r.uint32LE() };
}

export function parseQuestUpdateFailedTimer(
  r: PacketReader,
): QuestUpdateFailedTimer {
  return { questId: r.uint32LE() };
}
