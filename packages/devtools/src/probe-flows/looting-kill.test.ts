import { describe, expect, test } from "bun:test";
import type { AreaState, UnitEntity, WorldHandle } from "@peon/core";
import {
  elapse,
  fakeAwait,
  fakeMsUntilSettled,
  fakeRejection,
  withFakeTimers,
} from "@peon/core/test-support/fake-time";
import {
  createMockHandle,
  type MockHandle,
} from "@peon/core/test-support/mock-handle";
import { type FlowContext, settleWithin } from "#tools/probe-flows";
import { flow } from "#tools/probe-flows/looting-kill";

type Row = ReturnType<WorldHandle["queryNearby"]>[number];

const ME = 0xdcen;
const CUB = 0xf1_30_00_3b_06_00_00_01n;
const GUARD = 0xf1_30_00_3b_09_00_00_04n;
const TAKEN = 0xf1_30_00_3b_0a_00_00_05n;
const FAR = 0xf1_30_00_3b_08_00_00_03n;

function row(spec: {
  guid: bigint;
  distance: number;
  health?: number;
  self?: boolean;
  attackable?: boolean;
  tappedByOther?: boolean;
}): Row {
  const position = { mapId: 530, orientation: 0, x: 1, y: 2, z: 3 };
  const entity: UnitEntity = {
    class_: 1,
    displayId: 1,
    entry: 15_656,
    factionTemplate: 21,
    gender: 0,
    guid: spec.guid,
    health: spec.health ?? 100,
    level: 9,
    maxHealth: 100,
    maxPower: [],
    name: "Angershade",
    npcFlags: 0,
    objectType: spec.self ? 4 : 3,
    position,
    power: [],
    race: 0,
    rawFields: new Map(),
    scale: 1,
    target: 0n,
    unitFlags: 0,
  };
  return {
    attackable: spec.attackable ?? true,
    attackingMe: false,
    bearingRadians: null,
    distance: spec.distance,
    entity,
    horizontalDistance: spec.distance,
    lootable: false,
    originSource: null,
    originUpdatedAt: null,
    position,
    positionKind: null,
    positionObservedAt: null,
    positionSource: null,
    preparedAt: 0,
    relation: "hostile",
    remotePose: undefined,
    roles: [],
    self: spec.self ?? false,
    tapped: false,
    tappedByOther: spec.tappedByOther ?? false,
    targetOf: undefined,
    turnRadians: null,
  };
}

function withOwners(
  handle: MockHandle,
  owners: () => AreaState<"looting">["owners"],
): void {
  Object.assign(handle, {
    looting: {
      ...handle.looting,
      state: () => ({
        masterCandidates: new Map(),
        owners: owners(),
        passOnLoot: false,
      }),
    },
  });
}

function context(
  args: Record<string, string>,
  rows: () => Row[],
): FlowContext & { handle: MockHandle } {
  const handle = createMockHandle();
  handle.queryNearby = rows;
  return { args, handle, settle: settleWithin(200) };
}

describe("looting-kill flow", () => {
  test("attacks the nearest hostile creature and prints its loot owner once it dies", () =>
    withFakeTimers(async () => {
      let health = 100;
      const rows = () => [
        row({ distance: 0, guid: ME, self: true }),
        row({ attackable: false, distance: 2, guid: GUARD }),
        row({ distance: 3, guid: TAKEN, tappedByOther: true }),
        row({ distance: 3, guid: CUB, health }),
        row({ distance: 40, guid: FAR }),
      ];
      const ctx = context({ seconds: "5" }, rows);
      withOwners(ctx.handle, () =>
        health === 0
          ? new Map([[CUB, { looter: 0n, master: 0n, mine: "unknown" }]])
          : new Map(),
      );
      const running = flow.run(ctx);
      await elapse(50);
      health = 0;
      expect(await fakeAwait(running, 1000)).toEqual({
        looting: {
          owners: [
            {
              creature: "0xf130003b06000001",
              looter: "0x0",
              master: "0x0",
              mine: "unknown",
            },
          ],
          passOnLoot: false,
        },
        owner: "unknown",
        stop: "target_dead",
        target: expect.objectContaining({ guid: "0xf130003b06000001" }),
      });
      expect(ctx.handle.loadCatalogs).toHaveBeenCalled();
      expect(ctx.handle.attack).toHaveBeenCalledWith(CUB);
    }));

  test("walks into melee range of a far creature", () =>
    withFakeTimers(async () => {
      let distance = 30;
      let health = 100;
      const rows = () => [
        row({ distance: 0, guid: ME, self: true }),
        row({ distance, guid: FAR, health }),
      ];
      const ctx = context({ seconds: "5" }, rows);
      const steps: number[] = [];
      ctx.handle.walkTowardPoint = async (_point, yards) => {
        steps.push(yards);
        distance -= yards;
        return {
          pose: {
            mapId: 530,
            orientation: 0,
            source: "server" as const,
            updatedAt: 0,
            x: 0,
            y: 0,
            z: 0,
          },
          status: "completed" as const,
          traveled: yards,
        };
      };
      const running = flow.run(ctx);
      await elapse(700);
      health = 0;
      expect(await fakeAwait(running, 5000)).toMatchObject({
        stop: "target_dead",
      });
      expect(steps).toEqual([20, 7]);
    }));

  test("stops when the character dies or the time runs out", () =>
    withFakeTimers(async () => {
      let mine = 100;
      const rows = () => [
        row({ distance: 0, guid: ME, health: mine, self: true }),
        row({ distance: 3, guid: CUB }),
      ];
      const dying = flow.run(context({ seconds: "5" }, rows));
      await elapse(50);
      mine = 0;
      expect(await fakeAwait(dying, 1000)).toMatchObject({
        owner: null,
        stop: "self_dead",
      });
      mine = 100;
      const late = flow.run(context({ seconds: "0.3" }, rows));
      const ms = await fakeMsUntilSettled(late, 2000);
      expect(await late).toMatchObject({ stop: "timeout" });
      expect(ms).toBeGreaterThanOrEqual(300);
      expect(ms).toBeLessThan(600);
    }));

  test("fails with no hostile creature in reach or bad seconds", () =>
    withFakeTimers(async () => {
      const lonely = context({}, () => [
        row({ distance: 0, guid: ME, self: true }),
        row({ distance: 36, guid: FAR }),
      ]);
      expect(await fakeRejection(flow.run(lonely), 1000)).toContain(
        "no hostile creature within 35",
      );
      expect(
        await fakeRejection(
          flow.run(context({ seconds: "0" }, () => [])),
          1000,
        ),
      ).toContain("seconds > 0");
    }));
});
