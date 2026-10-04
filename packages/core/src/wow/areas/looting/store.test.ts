import { describe, expect, test } from "bun:test";
import { areaRig } from "#test-support/area-rig";
import {
  lootingLootErrorBody,
  lootingLootListBody,
  lootingLootMasterListBody,
  lootingLootOpenBody,
  lootingLootReleaseBody,
  lootingLootRemovedBody,
} from "#test-support/areas/looting";
import type { LootingEvent } from "#wow/areas/looting/store";
import { GameOpcode } from "#wow/protocol/opcodes";

const ME = 0xdcen;
const PARTNER = 0xdcfn;
const CREATURE = 0xf1_30_00_3d_28_01_28_c6n;
const OTHER = 0xf1_30_00_3d_2a_01_2a_can;

function setup() {
  const rig = areaRig("looting", { selfGuid: ME });
  const seen: LootingEvent[] = [];
  rig.handle.onEvent((event) => seen.push(event));
  const list = (init: { creature: bigint; master?: bigint; looter?: bigint }) =>
    rig.inject(GameOpcode.SMSG_LOOT_LIST, lootingLootListBody(init));
  const owner = (creature: bigint) => rig.handle.state().owners.get(creature);
  return { list, owner, rig, seen };
}

describe("LootingStore", () => {
  test("starts with no owners, no master candidates and no pass", () => {
    const { rig } = setup();
    try {
      expect(rig.handle.state()).toEqual({
        owners: new Map(),
        masterCandidates: new Map(),
        passOnLoot: false,
      });
    } finally {
      rig.dispose();
    }
  });

  test("the solo form gives mine unknown and one loot_owner event", () => {
    const { list, owner, rig, seen } = setup();
    try {
      list({ creature: CREATURE });
      expect(owner(CREATURE)).toEqual({
        master: 0n,
        looter: 0n,
        mine: "unknown",
      });
      expect(seen).toEqual([
        {
          type: "loot_owner",
          creature: CREATURE,
          master: 0n,
          looter: 0n,
          mine: "unknown",
        },
      ]);
    } finally {
      rig.dispose();
    }
  });

  test("the group form gives mine yes for self as looter or master, no for another", () => {
    const { list, owner, rig } = setup();
    try {
      list({ creature: CREATURE, looter: ME });
      expect(owner(CREATURE)?.mine).toBe("yes");
      list({ creature: CREATURE, looter: PARTNER });
      expect(owner(CREATURE)?.mine).toBe("no");
      list({ creature: CREATURE, looter: PARTNER, master: ME });
      expect(owner(CREATURE)?.mine).toBe("yes");
      list({ creature: OTHER, master: PARTNER });
      expect(owner(OTHER)).toEqual({
        master: PARTNER,
        looter: 0n,
        mine: "no",
      });
    } finally {
      rig.dispose();
    }
  });

  test("keeps the 64 newest creatures and drops the oldest", () => {
    const { list, owner, rig } = setup();
    try {
      for (let i = 0n; i < 65n; i++) list({ creature: CREATURE + i });
      expect(rig.handle.state().owners.size).toBe(64);
      expect(owner(CREATURE)).toBeUndefined();
      expect(owner(CREATURE + 1n)).toBeDefined();
      expect(owner(CREATURE + 64n)).toBeDefined();
    } finally {
      rig.dispose();
    }
  });

  test("a repeat for a held creature refreshes it as the newest", () => {
    const { list, owner, rig } = setup();
    try {
      for (let i = 0n; i < 64n; i++) list({ creature: CREATURE + i });
      list({ creature: CREATURE, looter: ME });
      list({ creature: CREATURE + 64n });
      expect(owner(CREATURE)?.mine).toBe("yes");
      expect(owner(CREATURE + 1n)).toBeUndefined();
    } finally {
      rig.dispose();
    }
  });

  test("forget drops one entry in silence", () => {
    const { list, rig, seen } = setup();
    try {
      list({ creature: CREATURE });
      list({ creature: OTHER });
      seen.length = 0;
      rig.stores.areas.looting.forget(CREATURE);
      expect([...rig.handle.state().owners.keys()]).toEqual([OTHER]);
      expect(seen).toEqual([]);
    } finally {
      rig.dispose();
    }
  });

  test("the snapshot is a copy", () => {
    const { list, owner, rig } = setup();
    try {
      list({ creature: CREATURE });
      const state = rig.handle.state();
      (state.owners as Map<bigint, unknown>).delete(CREATURE);
      expect(owner(CREATURE)).toBeDefined();
    } finally {
      rig.dispose();
    }
  });

  test("a master list binds to the opened corpse and emits master_loot_candidates", () => {
    const { rig, seen } = setup();
    try {
      rig.inject(
        GameOpcode.SMSG_LOOT_MASTER_LIST,
        lootingLootMasterListBody([ME, PARTNER]),
      );
      rig.inject(
        GameOpcode.SMSG_LOOT_RESPONSE,
        lootingLootOpenBody(CREATURE, []),
      );
      expect(rig.handle.state().masterCandidates.get(CREATURE)).toEqual([
        ME,
        PARTNER,
      ]);
      expect(seen).toEqual([
        {
          type: "master_loot_candidates",
          candidates: [ME, PARTNER],
        },
      ]);
    } finally {
      rig.dispose();
    }
  });

  test("a release keeps the bound candidates for the re-open", () => {
    const { rig, seen } = setup();
    try {
      rig.inject(
        GameOpcode.SMSG_LOOT_MASTER_LIST,
        lootingLootMasterListBody([PARTNER]),
      );
      rig.inject(
        GameOpcode.SMSG_LOOT_RESPONSE,
        lootingLootOpenBody(CREATURE, []),
      );
      seen.length = 0;
      expect(rig.handle.state().masterCandidates.get(CREATURE)).toEqual([
        PARTNER,
      ]);
      rig.inject(
        GameOpcode.SMSG_LOOT_RELEASE_RESPONSE,
        lootingLootReleaseBody(CREATURE, 1),
      );
      expect(rig.handle.state().masterCandidates.get(CREATURE)).toEqual([
        PARTNER,
      ]);
      expect(seen).toEqual([]);
    } finally {
      rig.dispose();
    }
  });
  test("a re-open without a new list keeps the bound candidates", () => {
    const { rig } = setup();
    try {
      rig.inject(
        GameOpcode.SMSG_LOOT_MASTER_LIST,
        lootingLootMasterListBody([ME, PARTNER]),
      );
      rig.inject(
        GameOpcode.SMSG_LOOT_RESPONSE,
        lootingLootOpenBody(CREATURE, []),
      );
      rig.inject(
        GameOpcode.SMSG_LOOT_RELEASE_RESPONSE,
        lootingLootReleaseBody(CREATURE, 1),
      );
      rig.inject(
        GameOpcode.SMSG_LOOT_RESPONSE,
        lootingLootOpenBody(CREATURE, []),
      );
      expect(rig.handle.state().masterCandidates.get(CREATURE)).toEqual([
        ME,
        PARTNER,
      ]);
    } finally {
      rig.dispose();
    }
  });
  test("another member opening a different corpse keeps the first corpse's list", () => {
    const { rig } = setup();
    try {
      rig.stores.rewards.requestOpen(CREATURE);
      rig.inject(
        GameOpcode.SMSG_LOOT_MASTER_LIST,
        lootingLootMasterListBody([ME, PARTNER]),
      );
      rig.inject(
        GameOpcode.SMSG_LOOT_RESPONSE,
        lootingLootOpenBody(CREATURE, []),
      );
      rig.stores.rewards.requestClose(
        rig.stores.rewards.snapshot().loot as never,
      );
      rig.inject(
        GameOpcode.SMSG_LOOT_MASTER_LIST,
        lootingLootMasterListBody([PARTNER]),
      );
      expect(rig.handle.state().masterCandidates.get(CREATURE)).toEqual([
        ME,
        PARTNER,
      ]);
      expect(rig.handle.state().masterCandidates.get(OTHER)).toBeUndefined();
      rig.stores.rewards.requestOpen(CREATURE);
      rig.inject(
        GameOpcode.SMSG_LOOT_MASTER_LIST,
        lootingLootMasterListBody([ME, PARTNER]),
      );
      rig.inject(
        GameOpcode.SMSG_LOOT_RESPONSE,
        lootingLootOpenBody(CREATURE, []),
      );
      expect(rig.handle.state().masterCandidates.get(CREATURE)).toEqual([
        ME,
        PARTNER,
      ]);
    } finally {
      rig.dispose();
    }
  });

  test("leaving view keeps the bound list for the return and the re-open", () => {
    const { rig } = setup();
    try {
      rig.stores.rewards.requestOpen(CREATURE);
      rig.inject(
        GameOpcode.SMSG_LOOT_MASTER_LIST,
        lootingLootMasterListBody([ME, PARTNER]),
      );
      rig.inject(
        GameOpcode.SMSG_LOOT_RESPONSE,
        lootingLootOpenBody(CREATURE, []),
      );
      rig.events.entity.emit({ guid: CREATURE, type: "disappear" });
      rig.stores.rewards.requestOpen(CREATURE);
      rig.inject(
        GameOpcode.SMSG_LOOT_RESPONSE,
        lootingLootOpenBody(CREATURE, []),
      );
      expect(rig.handle.state().masterCandidates.get(CREATURE)).toEqual([
        ME,
        PARTNER,
      ]);
    } finally {
      rig.dispose();
    }
  });
  test("duplicate items with the same label settle only their own give", () => {
    const { rig } = setup();
    try {
      rig.inject(GameOpcode.SMSG_LOOT_REMOVED, lootingLootRemovedBody(0));
      rig.inject(
        GameOpcode.SMSG_LOOT_RESPONSE,
        lootingLootErrorBody(CREATURE, 12),
      );
      rig.inject(
        GameOpcode.SMSG_LOOT_RELEASE_RESPONSE,
        lootingLootReleaseBody(CREATURE, 1),
      );
    } finally {
      rig.dispose();
    }
  });
});
