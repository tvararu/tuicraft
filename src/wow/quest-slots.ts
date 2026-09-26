import { type Entity, type EntityLookup, fieldOf } from "wow/entity-store";
import { ObjectType, PLAYER_FIELDS } from "wow/protocol/entity-fields";

export type QuestLogSlot = {
  slot: number;
  questId: number | undefined;
  flags: number | undefined;
  counters: [
    number | undefined,
    number | undefined,
    number | undefined,
    number | undefined,
  ];
  expiresAtSeconds: number | undefined;
};

export type QuestLog = { complete: boolean; slots: QuestLogSlot[] };

export type QuestLogChange = {
  type: "accepted" | "completed" | "failed" | "progress" | "removed";
  questId: number;
};

const COMPLETE = 1;
const FAILED = 2;

export function questSlotStatus(
  slot: QuestLogSlot,
): "complete" | "failed" | "in progress" {
  const flags = slot.flags ?? 0;
  if (flags & FAILED) return "failed";
  if (flags & COMPLETE) return "complete";
  return "in progress";
}

function logSlot(
  entity: Entity | undefined,
  slot: number,
  idsVisible: boolean,
): QuestLogSlot {
  const offset = PLAYER_FIELDS.QUEST_LOG.offset + slot * 5;
  const low = fieldOf(entity, offset + 2);
  const high = fieldOf(entity, offset + 3);
  return {
    slot,
    questId: entity?.rawFields.get(offset) ?? (idsVisible ? 0 : undefined),
    flags: fieldOf(entity, offset + 1),
    counters: [
      low === undefined ? undefined : low & 0xff_ff,
      low === undefined ? undefined : low >>> 16,
      high === undefined ? undefined : high & 0xff_ff,
      high === undefined ? undefined : high >>> 16,
    ],
    expiresAtSeconds: fieldOf(entity, offset + 4),
  };
}

export function readQuestLog(
  selfGuid: bigint,
  getEntity: EntityLookup,
  questIdsVisibleAtCreate = false,
): QuestLog {
  const candidate = selfGuid === 0n ? undefined : getEntity(selfGuid);
  const entity =
    candidate?.guid === selfGuid && candidate.objectType === ObjectType.PLAYER
      ? candidate
      : undefined;
  const idsVisible = entity?.createComplete === true && questIdsVisibleAtCreate;
  const slots = Array.from({ length: 25 }, (_, slot) =>
    logSlot(entity, slot, idsVisible),
  );
  const complete = slots.every(
    (slot) =>
      slot.questId !== undefined &&
      slot.flags !== undefined &&
      slot.expiresAtSeconds !== undefined &&
      slot.counters.every((count) => count !== undefined),
  );
  return { complete, slots };
}

export function sameSlot(a: QuestLogSlot, b: QuestLogSlot): boolean {
  return (
    a.questId === b.questId &&
    a.flags === b.flags &&
    a.expiresAtSeconds === b.expiresAtSeconds &&
    a.counters.every((count, i) => count === b.counters[i])
  );
}

export function questLogChanges(
  previous: QuestLog,
  next: QuestLog,
): QuestLogChange[] {
  const before = byQuest(previous);
  const after = byQuest(next);
  const changes: QuestLogChange[] = [];
  for (const [questId, slot] of after) {
    const old = before.get(questId);
    if (old) changes.push(...slotChanges(old, slot, questId));
    else if (known(previous)) changes.push(...added(slot, questId));
  }
  if (!known(next)) return changes;
  for (const questId of before.keys())
    if (!after.has(questId)) changes.push({ type: "removed", questId });
  return changes;
}

function byQuest(log: QuestLog): Map<number, QuestLogSlot> {
  return new Map(
    log.slots.flatMap((slot) => (slot.questId ? [[slot.questId, slot]] : [])),
  );
}

function known(log: QuestLog): boolean {
  return log.slots.every((slot) => slot.questId !== undefined);
}

function added(slot: QuestLogSlot, questId: number): QuestLogChange[] {
  const changes: QuestLogChange[] = [{ type: "accepted", questId }];
  const flags = slot.flags ?? 0;
  if (flags & COMPLETE) changes.push({ type: "completed", questId });
  if (flags & FAILED) changes.push({ type: "failed", questId });
  return changes;
}

function slotChanges(
  previous: QuestLogSlot,
  next: QuestLogSlot,
  questId: number,
): QuestLogChange[] {
  const changes: QuestLogChange[] = [];
  const flags = next.flags;
  if (flags !== undefined && previous.flags !== undefined) {
    if (flags & COMPLETE && !(previous.flags & COMPLETE))
      changes.push({ type: "completed", questId });
    if (flags & FAILED && !(previous.flags & FAILED))
      changes.push({ type: "failed", questId });
  }
  if (!sameSlot(previous, next)) changes.push({ type: "progress", questId });
  return changes;
}
