import type { Mock } from "bun:test";
import { describe, expect, jest, test } from "bun:test";
import type { AreaState, NamedRewardsState, PartyMember } from "@peon/core";
import { elapse, withFakeTimers } from "@peon/core/test-support/fake-time";
import {
  partyMember,
  partyState,
} from "@peon/core/test-support/party-fixtures";
import { groupTool } from "#harness/areas/raid/tool";
import { setSelf, setUnits, unitRow } from "#test-support/ops-fixtures";
import { createTestRuntime } from "#test-support/runtime-fixture";
import { runTool } from "#test-support/tool-harness";

type RaidState = AreaState<"raid">;
type RaidGroup = NonNullable<RaidState["group"]>;

const SELF = 0x0764n;
const TOM = 0x100n;
const CORPSE = 0x20n;
const ROLL_GUID = 0x30n;
const MASTER_LOOT = 2;
const ROUND_ROBIN = 1;
const OPEN_MS = 5000;

const FANG = { itemId: 7073, name: "Broken Fang", slot: 0 };
const LINEN = { itemId: 2589, name: "Linen Cloth", slot: 1 };
const LINEN_TWO = { itemId: 2589, name: "Linen Cloth", slot: 2 };

type Offered = { itemId: number; name: string | undefined; slot: number };

function tom(): PartyMember {
  return partyMember({ guid: TOM, name: "Tom" });
}

function raidGroup(over: Partial<RaidGroup> = {}): RaidGroup {
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

function lootState(items: readonly Offered[]): NamedRewardsState {
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

type Roll = {
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
function roll(over: Partial<Roll> = {}): Roll {
  return {
    allowed: ["pass", "need", "greed"],
    choice: undefined,
    corpseGuid: CORPSE,
    count: 1,
    countdownMs: 60_000,
    expiresAt: 60_000,
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

type Setup = {
  candidates?: readonly bigint[];
  closedLoot?: boolean;
  corpseDistance?: number;
  group?: Partial<RaidGroup>;
  inGroup?: boolean;
  items?: readonly Offered[];
  opens?: boolean;
  rolls?: readonly Roll[];
};

async function world(setup: Setup = {}) {
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

describe("group tool give", () => {
  test("refuses out of a group, without master loot and as a non-master", async () => {
    const none = await world({ inGroup: false });
    expect(
      (await runTool(none.tool, { do: "give", what: "Linen" })).text,
    ).toContain("REFUSED not_in_group");
    const robin = await world({
      group: { loot: { master: 0n, method: ROUND_ROBIN, threshold: 2 } },
    });
    expect(
      (await runTool(robin.tool, { do: "give", what: "Linen" })).text,
    ).toContain("REFUSED no_master_loot");
    const other = await world({
      group: { loot: { master: TOM, method: MASTER_LOOT, threshold: 2 } },
    });
    expect(
      (await runTool(other.tool, { do: "give", what: "Linen" })).text,
    ).toContain("REFUSED not_master");
    for (const t of [none, robin, other]) {
      expect(t.give).not.toHaveBeenCalled();
      expect(t.handle.openLoot).not.toHaveBeenCalled();
    }
  });

  test("refuses without an item name or with a stranger", async () => {
    const t = await world();
    expect((await runTool(t.tool, { do: "give" })).text).toContain(
      "REFUSED needs_item",
    );
    expect(
      (await runTool(t.tool, { do: "give", to: "Zed", what: "Linen" })).text,
    ).toContain("REFUSED not_a_member");
    expect(t.give).not.toHaveBeenCalled();
  });

  test("opens the corpse, gives the named item to a member and releases", async () => {
    const t = await world();
    const out = await runTool(t.tool, {
      do: "give",
      target: "Springpaw Lynx",
      to: "Tom",
      what: "linen",
    });
    expect(out.text).toContain("DONE");
    expect(out.text).toContain("Linen Cloth");
    expect(out.text).toContain("Tom");
    expect(t.handle.openLoot).toHaveBeenCalledWith(CORPSE);
    expect(t.give).toHaveBeenCalledWith(CORPSE, 1, "Tom");
    expect(t.release).toHaveBeenCalledTimes(1);
  });

  test("gives to yourself when no member is named, on the nearest corpse", async () => {
    const t = await world();
    const out = await runTool(t.tool, { do: "give", what: "Broken Fang" });
    expect(out.text).toContain("DONE");
    expect(t.give).toHaveBeenCalledWith(CORPSE, 0, "@self");
  });

  test("gives to yourself when the caller names its own character", async () => {
    const t = await world();
    const out = await runTool(t.tool, {
      do: "give",
      to: "Testchar",
      what: "Broken Fang",
    });
    expect(out.text).toContain("DONE");
    expect(t.give).toHaveBeenCalledWith(CORPSE, 0, "@self");
  });

  test("takes the lowest slot among items with the same label", async () => {
    const t = await world({ items: [FANG, LINEN_TWO, LINEN] });
    await runTool(t.tool, { do: "give", to: "Tom", what: "Linen Cloth" });
    expect(t.give).toHaveBeenCalledWith(CORPSE, 1, "Tom");
  });

  test("matches an unnamed cached item by numeric id", async () => {
    const unnamed = { itemId: 27_668, name: undefined, slot: 0 };
    const t = await world({ items: [unnamed] });
    const out = await runTool(t.tool, { do: "give", to: "Tom", what: "27668" });
    expect(out.text).toContain("DONE");
    expect(t.give).toHaveBeenCalledWith(CORPSE, 0, "Tom");
  });

  test("matches an unnamed cached item by 'item <id>' label", async () => {
    const unnamed = { itemId: 27_668, name: undefined, slot: 0 };
    const t = await world({ items: [unnamed] });
    const out = await runTool(t.tool, {
      do: "give",
      to: "Tom",
      what: "item 27668",
    });
    expect(out.text).toContain("DONE");
    expect(t.give).toHaveBeenCalledWith(CORPSE, 0, "Tom");
  });

  test("matches a named item by its numeric id", async () => {
    const t = await world();
    const out = await runTool(t.tool, {
      do: "give",
      to: "Tom",
      what: String(LINEN.itemId),
    });
    expect(out.text).toContain("DONE");
    expect(t.give).toHaveBeenCalledWith(CORPSE, 1, "Tom");
  });

  test("does not match an id fragment of another item", async () => {
    const unnamed = { itemId: 27_668, name: undefined, slot: 0 };
    const t = await world({ items: [unnamed] });
    const out = await runTool(t.tool, {
      do: "give",
      to: "Tom",
      what: "7668",
    });
    expect(out.text).toContain("REFUSED not_offered");
    expect(t.give).not.toHaveBeenCalled();
  });

  test("refuses an item the corpse does not hold and releases the window", async () => {
    const t = await world();
    const out = await runTool(t.tool, {
      do: "give",
      to: "Tom",
      what: "Thunderfury",
    });
    expect(out.text).toContain("REFUSED not_offered");
    expect(out.text).toContain("Broken Fang");
    expect(t.give).not.toHaveBeenCalled();
    expect(t.release).toHaveBeenCalledTimes(1);
  });

  test("names an unnamed item the same way in every refusal", async () => {
    const unnamed = { itemId: 20_772, name: undefined, slot: 0 };
    const t = await world({ items: [unnamed] });
    const first = await runTool(t.tool, {
      do: "give",
      to: "Tom",
      what: "item",
    });
    expect(first.text).toContain("REFUSED not_offered");
    expect(first.text).toContain("item 20772");
    const second = await runTool(t.tool, {
      do: "give",
      to: "Tom",
      what: "item 20772",
    });
    expect(second.text).toContain("DONE");
    expect(t.give).toHaveBeenCalledWith(CORPSE, 0, "Tom");
  });

  test("refuses a member the server does not list as a candidate", async () => {
    const t = await world({ candidates: [SELF] });
    const out = await runTool(t.tool, { do: "give", to: "Tom", what: "Linen" });
    expect(out.text).toContain("REFUSED not_candidate");
    expect(t.give).not.toHaveBeenCalled();
    expect(t.release).toHaveBeenCalledTimes(1);
  });

  test("reports the loot error and still releases", async () => {
    const t = await world();
    t.give.mockRejectedValue(new Error("LOOT_ERROR_INV_FULL"));
    const out = await runTool(t.tool, { do: "give", to: "Tom", what: "Linen" });
    expect(out.text).toContain("FAILED");
    expect(out.text).toContain("LOOT_ERROR_INV_FULL");
    expect(t.release).toHaveBeenCalledTimes(1);
  });

  test("fails when the loot window never opens", async () => {
    const t = await world({ opens: false });
    const out = await withFakeTimers(async () => {
      const run = runTool(t.tool, { do: "give", to: "Tom", what: "Linen" });
      await elapse(OPEN_MS);
      return await run;
    });
    expect(out.text).toContain("FAILED");
    expect(t.give).not.toHaveBeenCalled();
  });

  test("refuses a corpse out of reach and names the walk", async () => {
    const t = await world({ corpseDistance: 40 });
    const out = await runTool(t.tool, { do: "give", to: "Tom", what: "Linen" });
    expect(out.text).toContain("REFUSED too_far");
    expect(t.handle.openLoot).not.toHaveBeenCalled();
  });
});

describe("group tool pass_loot", () => {
  test("sends the opt-out flag and says it is only requested", async () => {
    const t = await world();
    const on = await runTool(t.tool, { do: "pass_loot", what: "on" });
    expect(t.pass).toHaveBeenLastCalledWith(true);
    expect(on.text).toContain("requested");
    await runTool(t.tool, { do: "pass_loot", what: "off" });
    expect(t.pass).toHaveBeenLastCalledWith(false);
  });

  test("refuses another word and a missing group", async () => {
    const t = await world();
    expect(
      (await runTool(t.tool, { do: "pass_loot", what: "maybe" })).text,
    ).toContain("REFUSED bad_choice");
    const none = await world({ inGroup: false });
    expect(
      (await runTool(none.tool, { do: "pass_loot", what: "on" })).text,
    ).toContain("REFUSED not_in_group");
    expect(t.pass).not.toHaveBeenCalled();
    expect(none.pass).not.toHaveBeenCalled();
  });
});

describe("group tool roll", () => {
  test("answers the open roll", async () => {
    const t = await world({ rolls: [roll()] });
    const out = await runTool(t.tool, { do: "roll", what: "greed" });
    expect(out.text).toContain("DONE");
    expect(out.text).toContain("Linen Cloth");
    expect(t.rollLoot).toHaveBeenCalledWith(ROLL_GUID, 1, "greed");
  });

  test("refuses when no roll is open or the only roll is answered", async () => {
    const none = await world();
    expect(
      (await runTool(none.tool, { do: "roll", what: "need" })).text,
    ).toContain("REFUSED no_roll");
    const done = await world({ rolls: [roll({ choice: "pass" })] });
    expect(
      (await runTool(done.tool, { do: "roll", what: "need" })).text,
    ).toContain("REFUSED no_roll");
    expect(none.rollLoot).not.toHaveBeenCalled();
    expect(done.rollLoot).not.toHaveBeenCalled();
  });

  test("refuses a vote the roll does not allow", async () => {
    const t = await world({ rolls: [roll({ allowed: ["pass", "greed"] })] });
    const out = await runTool(t.tool, { do: "roll", what: "need" });
    expect(out.text).toContain("REFUSED roll_not_allowed");
    expect(out.text).toContain("greed");
    expect(t.rollLoot).not.toHaveBeenCalled();
  });

  test("refuses an unknown vote", async () => {
    const t = await world({ rolls: [roll()] });
    expect(
      (await runTool(t.tool, { do: "roll", what: "maybe" })).text,
    ).toContain("REFUSED bad_choice");
    expect(t.rollLoot).not.toHaveBeenCalled();
  });

  test("with two open rolls it asks which, and an item name picks one", async () => {
    const second = roll({
      guid: 0x31n,
      itemId: FANG.itemId,
      slot: 0,
    });
    const t = await world({ rolls: [roll(), second] });
    const ask = await runTool(t.tool, { do: "roll", what: "pass" });
    expect(ask.text).toContain("REFUSED ambiguous_roll");
    expect(t.rollLoot).not.toHaveBeenCalled();
    const picked = await runTool(t.tool, {
      do: "roll",
      what: "pass",
      with: String(FANG.itemId),
    });
    expect(picked.text).toContain("DONE");
    expect(t.rollLoot).toHaveBeenCalledWith(0x31n, 0, "pass");
  });

  test("matches by name with the loot window closed", async () => {
    const second = roll({
      guid: 0x31n,
      itemId: FANG.itemId,
      slot: 0,
    });
    const t = await world({ closedLoot: true, rolls: [roll(), second] });
    const picked = await runTool(t.tool, {
      do: "roll",
      what: "pass",
      with: "linen cloth",
    });
    expect(picked.text).toContain("DONE");
    expect(t.rollLoot).toHaveBeenCalledWith(ROLL_GUID, 1, "pass");
  });

  test("matches an item id label", async () => {
    const second = roll({
      guid: 0x31n,
      itemId: FANG.itemId,
      slot: 0,
    });
    const t = await world({ closedLoot: true, rolls: [roll(), second] });
    const picked = await runTool(t.tool, {
      do: "roll",
      what: "need",
      with: `item ${LINEN.itemId}`,
    });
    expect(picked.text).toContain("DONE");
    expect(t.rollLoot).toHaveBeenCalledWith(ROLL_GUID, 1, "need");
  });

  test("refuses an unmatched item name without rolling", async () => {
    const t = await world({ closedLoot: true, rolls: [roll()] });
    const out = await runTool(t.tool, {
      do: "roll",
      what: "need",
      with: "Mithril Ore",
    });
    expect(out.text).toContain("REFUSED no_roll");
    expect(t.rollLoot).not.toHaveBeenCalled();
  });

  test("reports a refused send as FAILED", async () => {
    const t = await world({ rolls: [roll()] });
    t.rollLoot.mockImplementation(() => {
      throw new Error("Loot roll was already answered");
    });
    const out = await runTool(t.tool, { do: "roll", what: "need" });
    expect(out.text).toContain("FAILED");
    expect(out.text).toContain("already answered");
  });
});
