import { type CycleStop, cycleStop } from "#wow/cycle-stop";
import { type Entity, fieldOf, isUnit } from "#wow/entity-store";
import { distance } from "#wow/geometry";
import { ObjectType, UNIT_FIELDS } from "#wow/protocol/entity-fields";
import type { Vec3 } from "#wow/protocol/packet";
import type { QuestQueryResponse } from "#wow/protocol/quest-query";
import type { QuestLog } from "#wow/quest-slots";

export const OBJECTIVE_REACH = 50;

const LOG_COMPLETE = 1;
const LOG_FAILED = 2;
const DYNFLAG_TAPPED = 0x4;
const DYNFLAG_TAPPED_BY_PLAYER = 0x8;

export type ObjectiveKill = { entry: number; index: number; required: number };
export type ObjectiveItem = { itemId: number; required: number };

export type QuestObjective = {
  questId: number;
  kills: ObjectiveKill[];
  items: ObjectiveItem[];
  sources: number[];
};

export type ObjectiveProgress = {
  questId: number;
  slot: number;
  complete: boolean;
  kills: (ObjectiveKill & { current: number | undefined })[];
  items: ObjectiveItem[];
};

export type ObjectivePick =
  | { kind: "complete"; progress: ObjectiveProgress }
  | { kind: "target"; guid: bigint; entry: number; distance: number }
  | CycleStop;

export function questObjective(
  query: QuestQueryResponse,
  sources: readonly number[],
): QuestObjective | CycleStop {
  const kills: ObjectiveKill[] = [];
  for (const [index, target] of query.targets.entries()) {
    if (target.npcOrGoId < 0 && target.count > 0)
      return cycleStop("objective_gameobject_unsupported", {
        gameObject: -target.npcOrGoId,
      });
    if (target.npcOrGoId > 0 && target.count > 0)
      kills.push({ entry: target.npcOrGoId, index, required: target.count });
  }
  const items = query.requiredItems
    .filter((item) => item.itemId > 0 && item.count > 0)
    .map((item) => ({ itemId: item.itemId, required: item.count }));
  if (items.length > 0 && sources.length === 0)
    return cycleStop("objective_item_sources_unknown", {
      items: items.map((item) => item.itemId),
    });
  if (kills.length === 0 && items.length === 0)
    return cycleStop("objective_unsupported", { questId: query.questId });
  return { questId: query.questId, kills, items, sources: [...sources] };
}

export function objectiveProgress(
  objective: QuestObjective,
  log: QuestLog,
): ObjectiveProgress | CycleStop {
  const slot = log.slots.find((entry) => entry.questId === objective.questId);
  if (slot === undefined)
    return cycleStop("quest_not_in_log", { questId: objective.questId });
  if (slot.flags === undefined)
    return cycleStop("quest_log_unobserved", { questId: objective.questId });
  if (slot.flags & LOG_FAILED)
    return cycleStop("quest_failed", { questId: objective.questId });
  return {
    questId: objective.questId,
    slot: slot.slot,
    complete: (slot.flags & LOG_COMPLETE) !== 0,
    kills: objective.kills.map((kill) => ({
      ...kill,
      current: slot.counters[kill.index],
    })),
    items: objective.items,
  };
}

function wantedEntries(progress: ObjectiveProgress, sources: number[]) {
  const entries = new Set(sources);
  for (const kill of progress.kills)
    if (kill.current === undefined || kill.current < kill.required)
      entries.add(kill.entry);
  return entries;
}

function tappedByOther(entity: Entity): boolean {
  const flags = fieldOf(entity, UNIT_FIELDS.DYNAMIC_FLAGS.offset) ?? 0;
  return (flags & DYNFLAG_TAPPED) !== 0 && !(flags & DYNFLAG_TAPPED_BY_PLAYER);
}

export function pickObjectiveTarget(args: {
  objective: QuestObjective;
  log: QuestLog;
  entities: readonly Entity[];
  self: Vec3 | undefined;
  tried: ReadonlySet<bigint>;
}): ObjectivePick {
  const progress = objectiveProgress(args.objective, args.log);
  if ("ok" in progress) return progress;
  if (progress.complete) return { kind: "complete", progress };
  if (args.self === undefined) return cycleStop("self_pose_unobserved");
  const self = args.self;
  const entries = wantedEntries(progress, args.objective.sources);
  const candidates = args.entities
    .filter(
      (entity) =>
        isUnit(entity) &&
        entity.objectType === ObjectType.UNIT &&
        entries.has(entity.entry) &&
        entity.health > 0 &&
        entity.position !== undefined &&
        !args.tried.has(entity.guid) &&
        !tappedByOther(entity),
    )
    .map((entity) => ({
      guid: entity.guid,
      entry: entity.entry,
      distance: distance(self, entity.position ?? self),
    }))
    .sort((a, b) => a.distance - b.distance);
  const nearest = candidates[0];
  if (nearest === undefined)
    return cycleStop("objective_targets_absent", { entries: [...entries] });
  if (nearest.distance > OBJECTIVE_REACH)
    return cycleStop("objective_targets_out_of_reach", {
      nearest: `0x${nearest.guid.toString(16)}`,
      distance: Math.round(nearest.distance),
      reach: OBJECTIVE_REACH,
    });
  return { kind: "target", ...nearest };
}
