import { describe, expect, test } from "bun:test";
import type { ControlPose } from "#wow/control";
import type { Entity, Position } from "#wow/entity-store";
import { type NearbySources, queryNearby } from "#wow/nearby";
import { ObjectType } from "#wow/protocol/entity-fields";
import type { RemotePose } from "#wow/remote-motion";

const SELF = 1n;
const NOW = 5000;

function entity(guid: bigint, position?: Position): Entity {
  return {
    entry: 0,
    guid,
    name: undefined,
    objectType: ObjectType.UNIT,
    position,
    rawFields: new Map(),
    scale: 1,
  } as Entity;
}

function at(x: number, y: number, z = 0, mapId = 0): Position {
  return { mapId, orientation: 0, x, y, z };
}

function pose(x: number, y: number, orientation = 0): ControlPose {
  return {
    mapId: 0,
    orientation,
    source: "predicted",
    updatedAt: 42,
    x,
    y,
    z: 0,
  };
}

function sources(
  selfPose: ControlPose | undefined,
  entities: Entity[],
  remotePoses: RemotePose[] = [],
): NearbySources {
  return {
    control: { pose: selfPose, selfGuid: SELF },
    entities,
    now: NOW,
    observedPosition: () => undefined,
    remotePoses,
  };
}

describe("queryNearby", () => {
  test("measures 3d distance, bearing and signed turn from the pose", () => {
    const [row] = queryNearby(
      sources(pose(0, 0, Math.PI / 2), [entity(2n, at(3, 0, 4))]),
    );
    expect(row?.horizontalDistance).toBe(3);
    expect(row?.distance).toBe(5);
    expect(row?.bearingRadians).toBe(0);
    expect(row?.turnRadians).toBeCloseTo(-Math.PI / 2);
    expect(row?.originSource).toBe("predicted");
    expect(row?.originUpdatedAt).toBe(42);
  });

  test("normalises bearing to [0, 2π)", () => {
    const [row] = queryNearby(sources(pose(0, 0), [entity(2n, at(0, -5))]));
    expect(row?.bearingRadians).toBeCloseTo((3 * Math.PI) / 2);
    expect(row?.turnRadians).toBeCloseTo(-Math.PI / 2);
  });

  test("self row is first at distance 0 and carries the pose", () => {
    const rows = queryNearby(
      sources(pose(10, 10), [entity(2n, at(11, 10)), entity(SELF, at(0, 0))]),
    );
    expect(rows.map((r) => r.self)).toEqual([true, false]);
    expect(rows[0]?.distance).toBe(0);
    expect(rows[0]?.horizontalDistance).toBe(0);
    expect(rows[0]?.bearingRadians).toBeNull();
    expect(rows[0]?.position).toMatchObject({ x: 10, y: 10 });
  });

  test("falls back to the self entity position when there is no pose", () => {
    const [, other] = queryNearby(
      sources(undefined, [entity(SELF, at(0, 0)), entity(2n, at(4, 0))]),
    );
    expect(other?.distance).toBe(4);
    expect(other?.originSource).toBe("self_entity");
    expect(other?.originUpdatedAt).toBeNull();
  });

  test("leaves entities on another map or without position unmeasured", () => {
    const rows = queryNearby(
      sources(pose(0, 0), [entity(2n, at(1, 0, 0, 1)), entity(3n)]),
      { all: true },
    );
    for (const row of rows) {
      expect(row.distance).toBeNull();
      expect(row.horizontalDistance).toBeNull();
      expect(row.turnRadians).toBeNull();
    }
  });

  test("sorts by distance, then guid, with unmeasured rows last", () => {
    const rows = queryNearby(
      sources(pose(0, 0), [
        entity(9n),
        entity(5n, at(2, 0)),
        entity(4n, at(2, 0)),
        entity(3n, at(1, 0)),
        entity(8n, at(1, 0, 0, 1)),
      ]),
      { all: true },
    );
    expect(rows.map((r) => r.entity.guid)).toEqual([3n, 4n, 5n, 8n, 9n]);
  });

  test("default range drops rows beyond 100 yd, off-map or without position", () => {
    const entities = [
      entity(2n, at(100, 0)),
      entity(3n, at(100.01, 0)),
      entity(4n, at(1, 0, 0, 1)),
      entity(5n),
    ];
    const near = queryNearby(sources(pose(0, 0), entities));
    expect(near.map((r) => r.entity.guid)).toEqual([2n]);
    const all = queryNearby(sources(pose(0, 0), entities), { all: true });
    expect(all).toHaveLength(4);
  });

  test("without any origin nothing is filtered", () => {
    const rows = queryNearby(sources(undefined, [entity(2n, at(1000, 0))]));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.originSource).toBeNull();
  });

  test("attaches the remote pose by guid and stamps every row with now", () => {
    const remote: RemotePose = {
      guid: 2n,
      position: at(3, 0),
      receivedAt: 4000,
      source: "observer",
    };
    const rows = queryNearby(
      sources(
        pose(0, 0),
        [entity(2n, at(3, 0)), entity(3n, at(4, 0))],
        [remote],
      ),
    );
    expect(rows.map((r) => r.remotePose)).toEqual([remote, undefined]);
    expect(rows.map((r) => r.preparedAt)).toEqual([NOW, NOW]);
  });
});
