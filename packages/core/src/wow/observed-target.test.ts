import { describe, expect, test } from "bun:test";
import { CombatRuntime } from "#wow/combat";
import { EntityStore } from "#wow/entity-store";
import { observedTargetPosition } from "#wow/observed-target";
import { ObjectType } from "#wow/protocol/entity-fields";

const GUID = 2n;
const SPAWN = { mapId: 530, x: 0, y: 0, z: 3, orientation: 1 };

function setup() {
  let now = 1000;
  const entities = new EntityStore();
  entities.create(GUID, ObjectType.UNIT, { position: SPAWN });
  const combat = new CombatRuntime({
    send: () => {},
    now: () => now,
    selfGuid: () => 1n,
    selectedGuid: () => undefined,
    getEntity: (guid) => entities.get(guid),
    selfPose: () => undefined,
  });
  combat.observePosition(GUID, SPAWN);
  const target = () =>
    observedTargetPosition(entities.get(GUID), combat.unit(GUID), 530);
  return {
    combat,
    entities,
    target,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe("observedTargetPosition", () => {
  test("an idle creature stays a target long after its last observation", () => {
    const f = setup();
    f.advance(60_000);
    expect(f.target()).toEqual({ x: 0, y: 0, z: 3 });
  });

  test("a creature that finished a spline is targeted at its endpoint", () => {
    const f = setup();
    f.combat.applyMonsterMove(
      {
        kind: "move",
        guid: GUID,
        extra: 0,
        start: { x: 0, y: 0, z: 3 },
        splineId: 1,
        facing: { kind: "none" },
        flags: 0,
        duration: 1000,
        points: [
          { x: 0, y: 0, z: 3 },
          { x: 10, y: 0, z: 3 },
        ],
        interpolation: "linear",
        cyclic: false,
      },
      530,
    );
    f.advance(30_000);
    expect(f.target()).toMatchObject({ x: 10, y: 0 });
  });

  test("a creature removed from the entity store is not a target", () => {
    const f = setup();
    f.entities.destroy(GUID);
    f.combat.forget(GUID);
    expect(f.target).toThrow("target_not_observed");
  });

  test("a creature on another map is not a target", () => {
    const f = setup();
    expect(() =>
      observedTargetPosition(f.entities.get(GUID), f.combat.unit(GUID), 0),
    ).toThrow("target_map_changed");
  });
});
