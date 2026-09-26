import { describe, expect, test } from "bun:test";
import type { Entity, UnitEntity } from "wow/entity-store";
import { ObjectType, UNIT_FIELDS } from "wow/protocol/entity-fields";
import type { QuestQueryResponse } from "wow/protocol/quest-query";
import {
  OBJECTIVE_REACH,
  pickObjectiveTarget,
  type QuestObjective,
  questObjective,
} from "wow/quest-objective";
import type { QuestLog, QuestLogSlot } from "wow/quest-slots";

const WYRM = 15_274;
const TENDER = 15_294;

function query(
  targets: [npcOrGoId: number, count: number][],
  items: [itemId: number, count: number][] = [],
): QuestQueryResponse {
  return {
    questId: 8325,
    requiredItems: items.map(([itemId, count]) => ({ count, itemId })),
    targets: targets.map(([npcOrGoId, count]) => ({
      count,
      encodedNpcOrGoId: npcOrGoId,
      itemDropId: 0,
      npcOrGoId,
      unknownSourceCount: 0,
    })),
  } as QuestQueryResponse;
}

function log(flags: number, counters: number[], questId = 8325): QuestLog {
  const slot: QuestLogSlot = {
    counters: [counters[0], counters[1], counters[2], counters[3]],
    expiresAtSeconds: 0,
    flags,
    questId,
    slot: 3,
  };
  return { complete: true, slots: [slot] };
}

function unit(
  guid: bigint,
  entry: number,
  x: number,
  options: { health?: number; dynamicFlags?: number } = {},
): Entity {
  const entity: UnitEntity = {
    class_: 0,
    displayId: 0,
    entry,
    factionTemplate: 7,
    gender: 0,
    guid,
    health: options.health ?? 50,
    level: 1,
    maxHealth: 50,
    maxPower: [],
    name: undefined,
    npcFlags: 0,
    objectType: ObjectType.UNIT,
    position: { mapId: 530, orientation: 0, x, y: 0, z: 0 },
    power: [],
    race: 0,
    rawFields: new Map([
      [UNIT_FIELDS.DYNAMIC_FLAGS.offset, options.dynamicFlags ?? 0],
    ]),
    scale: 1,
    target: 0n,
    unitFlags: 0,
  };
  return entity;
}

function kills(): QuestObjective {
  const objective = questObjective(query([[WYRM, 8]]), []);
  if ("ok" in objective) throw new Error(objective.cause);
  return objective;
}

const origin = { x: 0, y: 0, z: 0 };

describe("quest objective derivation", () => {
  test("creature targets keep their log counter index and count", () => {
    const objective = questObjective(
      query([
        [0, 0],
        [WYRM, 8],
      ]),
      [],
    );
    expect(objective).toEqual({
      items: [],
      kills: [{ entry: WYRM, index: 1, required: 8 }],
      questId: 8325,
      sources: [],
    });
  });

  test("objectives the loop cannot pursue are named, not guessed", () => {
    expect(questObjective(query([[-181_000, 4]]), [])).toMatchObject({
      cause: "objective_gameobject_unsupported",
    });
    expect(questObjective(query([], [[20_797, 8]]), [])).toMatchObject({
      cause: "objective_item_sources_unknown",
      detail: { items: [20_797] },
    });
    expect(questObjective(query([]), [])).toMatchObject({
      cause: "objective_unsupported",
    });
  });

  test("item objectives use supervisor-named creature sources", () => {
    const objective = questObjective(query([], [[20_797, 8]]), [TENDER]);
    expect(objective).toMatchObject({
      items: [{ itemId: 20_797, required: 8 }],
      sources: [TENDER],
    });
  });
});

describe("objective target selection", () => {
  const pick = (
    entities: Entity[],
    questLog = log(0, [0]),
    tried = new Set<bigint>(),
  ) =>
    pickObjectiveTarget({
      entities,
      log: questLog,
      objective: kills(),
      self: origin,
      tried,
    });

  test("picks the nearest live, untried, untapped objective creature", () => {
    const entities = [
      unit(1n, WYRM, 30),
      unit(2n, WYRM, 5, { health: 0 }),
      unit(3n, TENDER, 2),
      unit(4n, WYRM, 8, { dynamicFlags: 0x4 }),
      unit(5n, WYRM, 12, { dynamicFlags: 0x4 | 0x8 }),
      unit(6n, WYRM, 10),
    ];
    expect(pick(entities)).toMatchObject({ guid: 6n, kind: "target" });
    expect(pick(entities, log(0, [0]), new Set([6n]))).toMatchObject({
      guid: 5n,
    });
  });

  test("a complete log slot ends the objective with server counters", () => {
    expect(pick([unit(1n, WYRM, 5)], log(1, [8]))).toEqual({
      kind: "complete",
      progress: {
        complete: true,
        items: [],
        kills: [{ current: 8, entry: WYRM, index: 0, required: 8 }],
        questId: 8325,
        slot: 3,
      },
    });
  });

  test("a filled kill counter stops targeting that creature", () => {
    expect(pick([unit(1n, WYRM, 5)], log(0, [8]))).toMatchObject({
      cause: "objective_targets_absent",
      detail: { entries: [] },
    });
  });

  test("absent quest, failed quest, missing and distant targets are named stops", () => {
    expect(pick([], log(0, [0], 1))).toMatchObject({
      cause: "quest_not_in_log",
    });
    expect(pick([], log(2, [0]))).toMatchObject({ cause: "quest_failed" });
    expect(pick([])).toMatchObject({ cause: "objective_targets_absent" });
    expect(pick([unit(1n, WYRM, OBJECTIVE_REACH + 1)])).toMatchObject({
      cause: "objective_targets_out_of_reach",
      detail: { distance: OBJECTIVE_REACH + 1, nearest: "0x1" },
    });
  });
});
