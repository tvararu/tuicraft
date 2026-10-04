import type { Mock } from "bun:test";
import { jest } from "bun:test";
import type { AreaState, NamedRewardsState, PartyMember } from "@peon/core";
import {
  partyMember,
  partyState,
} from "@peon/core/test-support/party-fixtures";
import { groupTool } from "#harness/areas/raid/tool";
import { setSelf, setUnits, unitRow } from "#test-support/ops-fixtures";
import { createTestRuntime } from "#test-support/runtime-fixture";

type RaidState = AreaState<"raid">;
type RaidGroup = NonNullable<RaidState["group"]>;

export const SELF = 0x0764n;
export const TOM = 0x100n;
export const CORPSE = 0x20n;
export const ROLL_GUID = 0x30n;
export const MASTER_LOOT = 2;
export const ROUND_ROBIN = 1;
export const OPEN_MS = 5000;

export const FANG = { itemId: 7073, name: "Broken Fang", slot: 0 };
export const LINEN = { itemId: 2589, name: "Linen Cloth", slot: 1 };
export const LINEN_TWO = { itemId: 2589, name: "Linen Cloth", slot: 2 };

export type Offered = {
  itemId: number;
  name: string | undefined;
  slot: number;
};

export function tom(): PartyMember {
  return partyMember({ guid: TOM, name: "Tom" });
}

export function raidGroup(over: Partial<RaidGroup> = {}): RaidGroup {
  return {
    battleground: false,
    counter: 1,
    difficulty: undefined,
    dungeonFinder: undefined,
    groupGuid: 1n,
    kind: "party",
    leader: SELF,
    loot: { master: SELF, method: MASTER_LOOT, threshold: 2 },
    members: [],
    self: { flags: 0, roles: 0, subgroup: 0 },
    ...over,
  };
}

export function lootState(items: readonly Offered[]): NamedRewardsState {
  return {
    loot: {
      guid: CORPSE,
      invalidatedReason: undefined,
      items: items.map((item) => ({
        count: 1,
        displayId: 0,
        itemId: item.itemId,
        name: item.name,
        quality: 1,
        randomPropertyId: 0,
        randomSuffix: 0,
        slot: item.slot,
        slotType: 0,
      })),
      lootType: 1,
      money: 0,
      openedAt: 0,
      phase: "open",
    },
  } as unknown as NamedRewardsState;
}

export type GiveRoll = {
  allowed: ("pass" | "need" | "greed")[];
  choice: "pass" | "need" | "greed" | undefined;
  corpseGuid: bigint | undefined;
  count: number;
  countdownMs: number;
  expiresAt: number;
  guid: bigint;
  itemId: number;
  mapId: number;
  randomPropertyId: number;
  randomSuffix: number;
  remainingMs: number;
  slot: number;
  startedAt: number;
  votes: never[];
};

export function giveRoll(over: Partial<GiveRoll> = {}): GiveRoll {
  return {
    allowed: ["pass", "need", "greed"],
    choice: undefined,
    corpseGuid: undefined,
    count: 1,
    countdownMs: 50_000,
    expiresAt: 0,
    guid: ROLL_GUID,
    itemId: LINEN.itemId,
    mapId: 0,
    randomPropertyId: 0,
    randomSuffix: 0,
    remainingMs: 50_000,
    slot: 1,
    startedAt: 0,
    votes: [],
    ...over,
  };
}

export type Setup = {
  candidates?: readonly bigint[];
  closedLoot?: boolean;
  corpseDistance?: number;
  group?: Partial<RaidGroup>;
  inGroup?: boolean;
  items?: readonly Offered[];
  opens?: boolean;
  rolls?: readonly GiveRoll[];
};

export async function world(setup: Setup = {}) {
  const t = await createTestRuntime();
  const control = t.handle.getControlState();
  (t.handle.getControlState as Mock<() => typeof control>).mockReturnValue({
    ...control,
    selfGuid: SELF,
  });
  const inGroup = setup.inGroup ?? true;
  const party = inGroup
    ? partyState({ inGroup: true, leader: "Tom", members: [tom()] })
    : partyState();
  (t.handle.getPartyState as Mock<() => typeof party>).mockReturnValue(party);
  const group: RaidState = {
    group: inGroup ? raidGroup(setup.group) : undefined,
    marks: Array.from({ length: 8 }, () => 0n),
    stats: new Map(),
  };
  jest.spyOn(t.handle.raid, "state").mockReturnValue(group);
  setSelf(t.handle);
  setUnits(t.handle, [
    unitRow({
      distance: setup.corpseDistance ?? 2,
      guid: CORPSE,
      hp: 0,
      level: 7,
      lootable: true,
      name: "Springpaw Lynx",
      x: setup.corpseDistance ?? 2,
      y: 0,
    }),
  ]);
  const items = setup.items ?? [FANG, LINEN];
  const open = lootState(items);
  const base = t.handle.getRewardsState();
  const rolls: typeof base.rolls = {
    last: undefined,
    pending: [...(setup.rolls ?? [])],
  };
  const rewards = { ...base, rolls };
  let startLoot = rewards;
  if (setup.closedLoot)
    startLoot = { ...rewards, loot: { phase: "closed" as const } };
  else if (setup.rolls) startLoot = { ...rewards, ...open };
  (t.handle.getRewardsState as Mock<() => typeof base>).mockImplementation(
    () => startLoot,
  );
  const names: Record<number, string> = {
    [FANG.itemId]: FANG.name,
    [LINEN.itemId]: LINEN.name,
  };
  (
    t.handle.itemLabel as Mock<
      (entry: number) => { name: string | null; quality: number | null }
    >
  ).mockImplementation((entry) => ({
    name: names[entry] ?? null,
    quality: 1,
  }));
  jest.spyOn(t.handle, "openLoot").mockImplementation(() => {
    if (setup.opens === false) return;
    queueMicrotask(() => {
      (t.handle.getRewardsState as Mock<() => typeof base>).mockImplementation(
        () => ({ ...base, ...open, rolls }),
      );
      t.handle.triggerRewardsEvent({
        at: 0,
        state: { ...base, ...open, rolls },
        type: "loot_opened",
      });
    });
  });
  const release = jest.spyOn(t.handle, "releaseLoot").mockReturnValue();
  jest.spyOn(t.handle.looting, "state").mockReturnValue({
    masterCandidates: new Map([[CORPSE, setup.candidates ?? [SELF, TOM]]]),
    owners: new Map(),
    passOnLoot: false,
  });
  const give = jest
    .spyOn(t.handle.looting.act, "giveMasterLoot")
    .mockImplementation(async (_guid, slot) => ({ slot, status: "given" }));
  const pass = jest
    .spyOn(t.handle.looting.act, "setPassOnLoot")
    .mockReturnValue();
  const rollLoot = jest.spyOn(t.handle, "rollLoot").mockReturnValue();
  return {
    ...t,
    give,
    pass,
    release,
    rollLoot,
    tool: groupTool.definition(t.rt),
  };
}
