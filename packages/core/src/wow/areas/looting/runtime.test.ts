import { describe, expect, test } from "bun:test";
import { areaRig } from "#test-support/area-rig";
import {
  lootingLootErrorBody,
  lootingLootListBody,
  lootingLootMasterListBody,
  lootingLootOpenBody,
  lootingLootRemovedBody,
} from "#test-support/areas/looting";
import { elapse, withFakeTimers } from "#test-support/fake-time";
import { partyMember, partyState } from "#test-support/party-fixtures";
import { GameOpcode } from "#wow/protocol/opcodes";

const ME = 0xdcen;
const CREATURE = 0xf1_30_00_3d_28_01_28_c6n;
const OTHER = 0xf1_30_00_3d_2a_01_2a_can;

const PARTNER = 0x0_0000_0de6n;

function member(name: string, guid: bigint) {
  return partyMember({ guid, name });
}

function inParty() {
  const rig = areaRig("looting", {
    selfGuid: ME,
    legacy: {
      party: () =>
        partyState({ inGroup: true, members: [member("Partner", PARTNER)] }),
      friends: () => [],
      ignored: () => [],
      guild: () => undefined,
      channels: () => [],
    },
  });
  return {
    act: rig.handle.act,
    dispose: rig.dispose,
    rig,
    sent: rig.sent,
  };
}

function killed() {
  const rig = areaRig("looting", { selfGuid: ME });
  for (const creature of [CREATURE, OTHER])
    rig.inject(GameOpcode.SMSG_LOOT_LIST, lootingLootListBody({ creature }));
  const owners = () => [...rig.handle.state().owners.keys()];
  return { owners, rig };
}

describe("looting runtime", () => {
  test("a creature that leaves view loses its owner", () => {
    const { owners, rig } = killed();
    try {
      rig.events.entity.emit({ guid: CREATURE, type: "disappear" });
      expect(owners()).toEqual([OTHER]);
    } finally {
      rig.dispose();
    }
  });

  test("an unheld disappear changes nothing", () => {
    const { owners, rig } = killed();
    try {
      rig.events.entity.emit({
        guid: 0xf1_30_00_00_00_00_00_01n,
        type: "disappear",
      });
      expect(owners()).toEqual([CREATURE, OTHER]);
    } finally {
      rig.dispose();
    }
  });

  test("setPassOnLoot sends one CMSG_OPT_OUT_OF_LOOT and records the request", () => {
    const rig = areaRig("looting", { selfGuid: ME });
    try {
      expect(rig.handle.state().passOnLoot).toBe(false);
      rig.handle.act.setPassOnLoot(true);
      expect(rig.sent).toEqual([
        {
          opcode: GameOpcode.CMSG_OPT_OUT_OF_LOOT,
          body: new Uint8Array([1, 0, 0, 0]),
        },
      ]);
      expect(rig.handle.state().passOnLoot).toBe(true);
      rig.handle.act.setPassOnLoot(false);
      expect(rig.sent[1]?.body).toEqual(new Uint8Array([0, 0, 0, 0]));
      expect(rig.handle.state().passOnLoot).toBe(false);
    } finally {
      rig.dispose();
    }
  });

  test("a new session starts with the pass flag off (Player.cpp:215)", () => {
    const first = areaRig("looting", { selfGuid: ME });
    first.handle.act.setPassOnLoot(true);
    first.dispose();
    const next = areaRig("looting", { selfGuid: ME });
    try {
      expect(next.handle.state().passOnLoot).toBe(false);
      expect(next.sent).toEqual([]);
    } finally {
      next.dispose();
    }
  });

  test("setLootMethod sends the method, the party member's guid and the threshold (GroupHandler.cpp:518-521)", () => {
    const party = inParty();
    try {
      party.act.setLootMethod({
        method: "master_loot",
        threshold: "rare",
        master: "Partner",
      });
      expect(party.sent).toEqual([
        {
          opcode: GameOpcode.CMSG_LOOT_METHOD,
          body: new Uint8Array([
            2, 0, 0, 0, 0xe6, 0x0d, 0, 0, 0, 0, 0, 0, 3, 0, 0, 0,
          ]),
        },
      ]);
    } finally {
      party.dispose();
    }
  });

  test("setLootMethod with no master sends guid 0", () => {
    const rig = areaRig("looting", { selfGuid: ME });
    try {
      rig.handle.act.setLootMethod({
        method: "group_loot",
        threshold: "uncommon",
        master: "",
      });
      expect(rig.sent).toEqual([
        {
          opcode: GameOpcode.CMSG_LOOT_METHOD,
          body: new Uint8Array([
            3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0,
          ]),
        },
      ]);
    } finally {
      rig.dispose();
    }
  });

  test("setLootMethod throws for a master outside the party and sends nothing", () => {
    const rig = areaRig("looting", { selfGuid: ME });
    try {
      expect(() =>
        rig.handle.act.setLootMethod({
          method: "master_loot",
          threshold: "uncommon",
          master: "Stranger",
        }),
      ).toThrow("not in your party");
      expect(rig.sent).toEqual([]);
    } finally {
      rig.dispose();
    }
  });

  test("setLootMethod refuses a threshold below uncommon before any send (GroupHandler.cpp:535-536)", () => {
    const party = inParty();
    try {
      for (const threshold of ["poor", "normal"])
        expect(() =>
          party.act.setLootMethod({
            method: "group_loot",
            threshold: threshold as never,
            master: "Partner",
          }),
        ).toThrow(`unknown loot threshold: ${threshold}`);
      expect(() =>
        party.act.setLootMethod({
          method: "personal" as never,
          threshold: "uncommon",
          master: "",
        }),
      ).toThrow("unknown loot method: personal");
      expect(party.sent).toEqual([]);
    } finally {
      party.dispose();
    }
  });
  test("setLootMethod accepts the @self token for the character's own guid (SR2-group-13)", () => {
    const rig = areaRig("looting", { selfGuid: ME });
    try {
      rig.handle.act.setLootMethod({
        method: "master_loot",
        threshold: "uncommon",
        master: "@self",
      });
      expect(rig.sent).toEqual([
        {
          opcode: GameOpcode.CMSG_LOOT_METHOD,
          body: new Uint8Array([
            2, 0, 0, 0, 0xce, 0x0d, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0,
          ]),
        },
      ]);
    } finally {
      rig.dispose();
    }
  });

  test("giveMasterLoot resolves its own name through @self and sends one CMSG_LOOT_MASTER_GIVE (LootHandler.cpp:484-559)", async () => {
    const party = inParty();
    try {
      party.rig.inject(
        GameOpcode.SMSG_LOOT_MASTER_LIST,
        lootingLootMasterListBody([ME, PARTNER]),
      );
      party.rig.inject(
        GameOpcode.SMSG_LOOT_RESPONSE,
        lootingLootOpenBody(CREATURE, []),
      );
      const done = party.act.giveMasterLoot(CREATURE, 0, "@self");
      expect(party.sent).toEqual([
        {
          opcode: GameOpcode.CMSG_LOOT_MASTER_GIVE,
          body: new Uint8Array([
            0xc6, 0x28, 0x01, 0x28, 0x3d, 0x00, 0x30, 0xf1, 0, 0xce, 0x0d, 0, 0,
            0, 0, 0, 0,
          ]),
        },
      ]);
      party.rig.inject(GameOpcode.SMSG_LOOT_REMOVED, lootingLootRemovedBody(0));
      const result = await done;
      expect(result).toEqual({ status: "given", slot: 0 });
      party.dispose();
    } catch (error) {
      party.dispose();
      throw error;
    }
  });

  test("giveMasterLoot resolves a partner name, and a removal for another slot does not settle it", async () => {
    const party = inParty();
    try {
      party.rig.inject(
        GameOpcode.SMSG_LOOT_MASTER_LIST,
        lootingLootMasterListBody([PARTNER]),
      );
      party.rig.inject(
        GameOpcode.SMSG_LOOT_RESPONSE,
        lootingLootOpenBody(CREATURE, []),
      );
      let done = false;
      const pending = party.act
        .giveMasterLoot(CREATURE, 1, "Partner")
        .then(() => {
          done = true;
        });
      party.rig.inject(GameOpcode.SMSG_LOOT_REMOVED, lootingLootRemovedBody(2));
      expect(done).toBe(false);
      party.rig.inject(GameOpcode.SMSG_LOOT_REMOVED, lootingLootRemovedBody(1));
      await pending;
      expect(done).toBe(true);
      party.dispose();
    } catch (error) {
      party.dispose();
      throw error;
    }
  });

  test("giveMasterLoot throws for a target outside the candidates and sends nothing", () => {
    const party = inParty();
    try {
      party.rig.inject(
        GameOpcode.SMSG_LOOT_MASTER_LIST,
        lootingLootMasterListBody([PARTNER]),
      );
      expect(() => party.act.giveMasterLoot(CREATURE, 0, "Stranger")).toThrow(
        "not a candidate",
      );
      expect(party.sent).toEqual([]);
    } finally {
      party.dispose();
    }
  });

  test("giveMasterLoot rejects with the server loot error (Player.cpp:8398-8405)", async () => {
    const party = inParty();
    try {
      party.rig.inject(
        GameOpcode.SMSG_LOOT_MASTER_LIST,
        lootingLootMasterListBody([PARTNER]),
      );
      party.rig.inject(
        GameOpcode.SMSG_LOOT_RESPONSE,
        lootingLootOpenBody(CREATURE, []),
      );
      const done = party.act.giveMasterLoot(CREATURE, 0, "Partner");
      void done.catch(() => undefined);
      party.rig.inject(
        GameOpcode.SMSG_LOOT_RESPONSE,
        lootingLootErrorBody(CREATURE, 12),
      );
      await expect(done).rejects.toThrow("that player's inventory is full");
      party.dispose();
    } catch (error) {
      party.dispose();
      throw error;
    }
  });

  test("giveMasterLoot times out after 5 s with no answer (fake time)", async () => {
    await withFakeTimers(async () => {
      const party = inParty();
      try {
        party.rig.inject(
          GameOpcode.SMSG_LOOT_MASTER_LIST,
          lootingLootMasterListBody([PARTNER]),
        );
        party.rig.inject(
          GameOpcode.SMSG_LOOT_RESPONSE,
          lootingLootOpenBody(CREATURE, []),
        );
        const pending = party.act.giveMasterLoot(CREATURE, 0, "Partner");
        const assertion = pending.then(
          () => {
            throw new Error("give settled without an answer");
          },
          (error: unknown) => {
            expect(String(error)).toContain(
              "timed out waiting for slot 0 after 5000ms",
            );
          },
        );
        await elapse(5100);
        await assertion;
        expect(party.sent).toEqual([
          {
            opcode: GameOpcode.CMSG_LOOT_MASTER_GIVE,
            body: new Uint8Array([
              0xc6, 0x28, 0x01, 0x28, 0x3d, 0x00, 0x30, 0xf1, 0, 0xe6, 0x0d, 0,
              0, 0, 0, 0, 0,
            ]),
          },
        ]);
        party.dispose();
      } catch (error) {
        party.dispose();
        throw error;
      }
    });
  });
});
