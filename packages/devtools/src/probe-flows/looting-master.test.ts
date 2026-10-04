import { describe, expect, test } from "bun:test";
import type { NearbyRow, UnitEntity, WorldHandle } from "@peon/core";
import { fakeAwait, withFakeTimers } from "@peon/core/test-support/fake-time";
import {
  createMockHandle,
  type MockHandle,
} from "@peon/core/test-support/mock-handle";
import { type FlowContext, settleWithin } from "#tools/probe-flows";
import { flow } from "#tools/probe-flows/looting-master";

const ME = 0xdcen;
const FIRST = 0xf1_30_00_3b_06_00_00_01n;
const SECOND = 0xf1_30_00_3b_06_00_00_02n;

function row(guid: bigint, yards: number, health: number): NearbyRow {
  const position = { mapId: 530, orientation: 0, x: 1, y: 2, z: 3 };
  const entity = {
    entry: 15_656,
    guid,
    health,
    maxHealth: 100,
    name: "Angershade",
    objectType: guid === ME ? 4 : 3,
    position,
    rawFields: new Map(),
  } as unknown as UnitEntity;
  return {
    attackable: true,
    distance: yards,
    entity,
    position,
    relation: "hostile",
    roles: [],
    self: guid === ME,
    tappedByOther: false,
  } as unknown as NearbyRow;
}

type Phase = "closed" | "open" | "closing";

function scenario(): FlowContext & { handle: MockHandle; opened: bigint[] } {
  const handle = createMockHandle();
  const health = new Map([
    [FIRST, 100],
    [SECOND, 100],
  ]);
  const opened: bigint[] = [];
  let phase: Phase = "closed";
  let candidates: bigint[] = [];
  handle.queryNearby = () => [
    row(ME, 0, 100),
    ...[...health].map(([guid, hp]) => row(guid, 3, hp)),
  ];
  handle.attack = ((guid: bigint) => {
    health.set(guid, 0);
  }) as WorldHandle["attack"];
  handle.openLoot = ((guid: bigint) => {
    if (phase !== "closed")
      throw new Error("Previous loot window has not closed");
    phase = "open";
    opened.push(guid);
    if (guid === SECOND) candidates = [ME];
  }) as WorldHandle["openLoot"];
  handle.releaseLoot = (() => {
    phase = "closing";
    setTimeout(() => {
      phase = "closed";
    }, 100);
  }) as WorldHandle["releaseLoot"];
  handle.getRewardsState = (() => ({
    loot:
      phase === "open"
        ? {
            guid: opened.at(-1) ?? 0n,
            invalidatedReason: undefined,
            items: [
              {
                count: 1,
                entry: 4604,
                label: null,
                locked: false,
                lootType: 1,
                name: null,
                quality: 0,
                questId: 0,
                questStarter: false,
                randomProperty: 0,
                randomSuffix: 0,
                slot: 0,
                slotType: 0,
              },
            ],
            lootType: 1,
            money: 0,
            openedAt: 0,
            phase,
          }
        : { phase },
  })) as unknown as WorldHandle["getRewardsState"];
  Object.assign(handle, {
    looting: {
      ...handle.looting,
      act: {
        ...handle.looting.act,
        giveMasterLoot: async () => ({ slot: 0, status: "given" }),
      },
      state: () => ({
        masterCandidates: new Map([[SECOND, candidates]]),
        owners: new Map(),
        passOnLoot: false,
      }),
    },
  });
  return { args: { seconds: "5" }, handle, opened, settle: settleWithin(200) };
}

describe("looting-master flow", () => {
  test("closes a window with no candidate list before the next kill", () =>
    withFakeTimers(async () => {
      const ctx = scenario();
      const result = await fakeAwait(flow.run(ctx), 20_000);
      expect(ctx.opened).toEqual([FIRST, SECOND]);
      expect(result).toMatchObject({ attempt: 2, slot: 0 });
    }));
});
