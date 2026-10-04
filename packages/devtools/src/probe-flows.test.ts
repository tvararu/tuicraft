import { describe, expect, test } from "bun:test";
import type { Entity, WorldHandle } from "@peon/core";
import {
  fakeAwait,
  fakeMsUntilSettled,
  fakeRejection,
  withFakeTimers,
} from "@peon/core/test-support/fake-time";
import { createMockHandle } from "@peon/core/test-support/mock-handle";
import { type FlowContext, loadFlows, settleWithin } from "#tools/probe-flows";

type Row = ReturnType<WorldHandle["queryNearby"]>[number];
type Spec = {
  guid: bigint;
  entry: number;
  name: string;
  objectType: 3 | 4 | 5;
  distance: number | null;
  roles?: Row["roles"];
  self?: boolean;
};

function row(spec: Spec): Row {
  const { guid, entry, name, objectType, distance, roles = [] } = spec;
  const position = { mapId: 530, orientation: 0, x: 1, y: 2, z: 3 };
  const entity: Entity = {
    entry,
    guid,
    name,
    objectType,
    position,
    rawFields: new Map(),
    scale: 1,
  };
  return {
    attackable: false,
    attackingMe: false,
    bearingRadians: null,
    distance,
    entity,
    horizontalDistance: distance,
    lootable: false,
    originSource: null,
    originUpdatedAt: null,
    position,
    positionKind: null,
    positionObservedAt: null,
    positionSource: null,
    preparedAt: 0,
    relation: "friendly",
    remotePose: undefined,
    roles,
    self: spec.self ?? false,
    tapped: false,
    tappedByOther: false,
    targetOf: undefined,
    turnRadians: null,
  };
}

const ROWS = [
  row({
    distance: 0,
    entry: 0,
    guid: 1n,
    name: "Me",
    objectType: 4,
    self: true,
  }),
  row({
    distance: 4.26,
    entry: 15_278,
    guid: 0xf1_30n,
    name: "Magistrix Erona",
    objectType: 3,
    roles: ["gossip", "questgiver"],
  }),
  row({
    distance: 9.5,
    entry: 16_475,
    guid: 0xf1_31n,
    name: "Marshal Wolf",
    objectType: 3,
    roles: ["gossip"],
  }),
  row({
    distance: 12,
    entry: 181_222,
    guid: 0xf1_32n,
    name: "Chest",
    objectType: 5,
  }),
  row({ distance: 20, entry: 0, guid: 0x77n, name: "Fbuddy", objectType: 4 }),
];

function context(
  args: Record<string, string> = {},
  rows: () => Row[] = () => ROWS,
): FlowContext & { talked: bigint[] } {
  const handle = createMockHandle();
  const talked: bigint[] = [];
  handle.queryNearby = rows;
  handle.talk = (guid) => talked.push(guid);
  return { args, handle, settle: settleWithin(300), talked };
}

function arrivingAfter(calls: number): () => Row[] {
  let seen = 0;
  return () => (++seen > calls ? ROWS : []);
}

const flows = await loadFlows();

function flow(name: string) {
  const found = flows.get(name);
  if (!found) throw new Error(`no flow ${name}`);
  return found;
}

describe("loadFlows", () => {
  test("finds one flow per file in probe-flows", () => {
    expect([...flows.keys()]).toEqual(
      expect.arrayContaining(["login", "nearest", "talk"]),
    );
  });
});

describe("login flow", () => {
  test("reports where the character stands", async () => {
    const ctx = context();
    ctx.handle.getPlaceState = () => ({
      area: "Sunstrider Isle",
      areaId: 3431,
      at: 1,
      mapId: 530,
      zone: "Eversong Woods",
      zoneId: 3430,
    });
    expect(await flow("login").run(ctx)).toEqual({
      area: "Sunstrider Isle",
      mapId: 530,
      pose: null,
      zone: "Eversong Woods",
    });
  });

  test("reports an unknown place once the settle time runs out", () =>
    withFakeTimers(async () => {
      const run = flow("login").run(context());
      const ms = await fakeMsUntilSettled(run, 1000);
      expect(await run).toEqual({
        area: null,
        mapId: null,
        pose: null,
        zone: null,
      });
      expect(ms).toBeGreaterThanOrEqual(300);
      expect(ms).toBeLessThan(400);
    }));
});

describe("nearest flow", () => {
  test("lists the nearest entities of a role, never the character", async () => {
    const result = await flow("nearest").run(context({ kind: "gossip" }));
    expect(result).toEqual({
      kind: "gossip",
      rows: [
        {
          distance: 4.3,
          entry: 15_278,
          guid: "0xf130",
          name: "Magistrix Erona",
          roles: ["gossip", "questgiver"],
          type: "unit",
        },
        {
          distance: 9.5,
          entry: 16_475,
          guid: "0xf131",
          name: "Marshal Wolf",
          roles: ["gossip"],
          type: "unit",
        },
      ],
    });
  });

  test("matches object types", async () => {
    const objects = await flow("nearest").run(context({ kind: "gameobject" }));
    const players = await flow("nearest").run(context({ kind: "player" }));
    expect(objects).toMatchObject({
      rows: [{ entry: 181_222, type: "gameobject" }],
    });
    expect(players).toMatchObject({
      rows: [{ name: "Fbuddy", type: "player" }],
    });
  });

  test("waits for the world to fill in, up to the settle time", () =>
    withFakeTimers(async () => {
      const late = context({ kind: "gameobject" }, arrivingAfter(2));
      const never = context({ kind: "gameobject" }, () => []);
      const found = flow("nearest").run(late);
      expect(await fakeMsUntilSettled(found, 1000)).toBe(200);
      expect(await found).toMatchObject({ rows: [{ entry: 181_222 }] });
      const empty = flow("nearest").run(never);
      const ms = await fakeMsUntilSettled(empty, 1000);
      expect(await empty).toEqual({ kind: "gameobject", rows: [] });
      expect(ms).toBeGreaterThanOrEqual(300);
      expect(ms).toBeLessThan(400);
    }));

  test("refuses an unknown kind", async () => {
    const run = flow("nearest").run(context({ kind: "dragon" }));
    await expect(run).rejects.toThrow("kind=");
  });
});

describe("talk flow", () => {
  test("talks to the nearest entity with the entry", async () => {
    const ctx = context({ entry: "16475" });
    expect(await flow("talk").run(ctx)).toEqual({
      distance: 9.5,
      entry: 16_475,
      guid: "0xf131",
      name: "Marshal Wolf",
      roles: ["gossip"],
      type: "unit",
    });
    expect(ctx.talked).toEqual([0xf1_31n]);
  });

  test("waits for the entity to come into view", () =>
    withFakeTimers(async () => {
      const ctx = context({ entry: "16475" }, arrivingAfter(2));
      expect(await fakeAwait(flow("talk").run(ctx), 1000)).toMatchObject({
        entry: 16_475,
      });
      expect(ctx.talked).toEqual([0xf1_31n]);
    }));

  test("refuses when no such entity is nearby", () =>
    withFakeTimers(async () => {
      const ctx = context({ entry: "1" });
      expect(await fakeRejection(flow("talk").run(ctx), 1000)).toContain(
        "entry 1",
      );
      expect(ctx.talked).toEqual([]);
    }));

  test("refuses a missing or non-numeric entry", async () => {
    const missing = flow("talk").run(context());
    const word = flow("talk").run(context({ entry: "x" }));
    await expect(missing).rejects.toThrow("entry=");
    await expect(word).rejects.toThrow("entry=");
  });
});

describe("item-flags flow", () => {
  test("reports each template's flags, null for unknown entries", async () => {
    const ctx = context({ items: "5349,5349,1113" });
    ctx.handle.getItemTemplate = (async (entry: number) =>
      entry === 5349
        ? { flags: 2_097_154 }
        : undefined) as typeof ctx.handle.getItemTemplate;
    expect(await flow("item-flags").run(ctx)).toEqual({
      flags: { 1113: null, 5349: 2_097_154 },
    });
  });

  test("refuses bad input and too many ids", async () => {
    const missing = flow("item-flags").run(context());
    const word = flow("item-flags").run(context({ items: "x" }));
    const many = flow("item-flags").run(
      context({ items: Array.from({ length: 41 }, () => "1").join(",") }),
    );
    await expect(missing).rejects.toThrow("items=");
    await expect(word).rejects.toThrow("items=");
    await expect(many).rejects.toThrow("at most 40");
  });
});
