import { type PacketReader, PacketWriter } from "#wow/protocol/packet";

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

export type QuestInvalid = { reason: number; reasonName: string };

export type QuestFailed = { questId: number; reason: number };

export type QuestUpdateFailed = { questId: number };

export type QuestUpdateFailedTimer = { questId: number };

export function buildQuestLogRemoveQuest(slot: number): Uint8Array {
  const w = new PacketWriter();
  w.uint8(slot);
  return w.finish();
}

export function npcOrGoId(encoded: number): number {
  return encoded & 0x80_00_00_00 ? -(encoded & 0x7f_ff_ff_ff) : encoded;
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

const INVALID_REASON_NAMES: Record<number, string> = {
  0: "requirements_not_met",
  1: "level_too_low",
  6: "wrong_race",
  7: "already_completed",
  12: "only_one_timed_quest",
  13: "already_on_quest",
  16: "expansion_required",
  18: "already_on_quest",
  21: "missing_required_items",
  23: "not_enough_money",
  26: "daily_quest_limit_reached",
  27: "tired_time_reached",
  29: "daily_quest_completed_today",
};

export function parseQuestInvalid(r: PacketReader): QuestInvalid {
  const reason = r.uint32LE();
  return {
    reason,
    reasonName: INVALID_REASON_NAMES[reason] ?? `invalid_reason_${reason}`,
  };
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
