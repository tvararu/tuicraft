import { describe, expect, test } from "bun:test";
import { formatPartyState } from "ui/format-party";
import { PartyStore } from "wow/party-store";
import type { GroupList } from "wow/protocol/group";

function list(names: string[], loot?: GroupList["loot"]): GroupList {
  return {
    leaderGuidHigh: 0,
    leaderGuidLow: 1,
    loot,
    members: names.map((name, i) => ({
      guidHigh: 0,
      guidLow: 0xa_40 + i,
      name,
      online: true,
    })),
  };
}

const ROUND_ROBIN = {
  looterGuidHigh: 0,
  looterGuidLow: 0,
  method: 1,
  threshold: 2,
};

describe("party store", () => {
  test("reports joining, member changes and leaving", () => {
    const party = new PartyStore();
    expect(party.applyList(list(["Bob"], ROUND_ROBIN), "Xia")).toEqual({
      added: [],
      formed: true,
      removed: [],
    });
    expect(party.applyList(list(["Bob", "Cid"], ROUND_ROBIN), "Xia")).toEqual({
      added: ["Cid"],
      formed: false,
      removed: [],
    });
    expect(party.applyList(list([]), "")).toEqual({
      added: [],
      formed: false,
      removed: ["Bob", "Cid"],
    });
    expect(party.snapshot()).toEqual({
      inGroup: false,
      leader: null,
      loot: null,
      members: [],
    });
  });

  test("names the loot rule and keeps member stats until they leave", () => {
    const party = new PartyStore();
    party.applyList(list(["Bob"], ROUND_ROBIN), "Xia");
    party.applyStats(0xa40n, { hp: 152, level: 10, maxHp: 217 }, 1000);
    party.applyStats(0xa40n, { hp: 79 }, 2000);
    party.applyList(list(["Bob"], ROUND_ROBIN), "Xia");
    party.applyLeader("Bob");
    const state = party.snapshot();
    expect(state).toMatchObject({
      inGroup: true,
      leader: "Bob",
      loot: {
        masterLooter: null,
        method: "round_robin",
        threshold: "uncommon",
      },
      members: [
        { health: 79, level: 10, maxHealth: 217, name: "Bob", statsAt: 2000 },
      ],
    });
    expect(formatPartyState(state, 5000)).toEqual([
      "Group: 2 members",
      "Leader: Bob",
      "Loot: round_robin, threshold uncommon",
      "Member Bob (0xa40): online, health 79/217, level 10, 3s ago",
    ]);
    party.applyList(list([]), "");
    party.applyList(list(["Bob"]), "Xia");
    expect(formatPartyState(party.snapshot(), 5000)).toEqual([
      "Group: 2 members",
      "Leader: Xia",
      "Loot: unknown",
      "Member Bob (0xa40): online, health unknown, level unknown",
    ]);
  });

  test("prefers the observed unit while the member is in view", () => {
    const party = new PartyStore();
    party.applyList(list(["Bob"]), "Xia");
    party.applyStats(0xa40n, { hp: 200, level: 10, maxHp: 217 }, 1000);
    const unit = { health: 126, level: 10, maxHealth: 217 };
    const state = party.snapshot(
      (guid) => (guid === 0xa40n ? unit : undefined),
      4000,
    );
    expect(state.members[0]).toMatchObject({
      health: 126,
      source: "unit",
      statsAt: 4000,
    });
    expect(formatPartyState(state, 4000)).toContain(
      "Member Bob (0xa40): online, health 126/217, level 10, in view",
    );
    expect(party.snapshot().members[0]).toMatchObject({
      health: 200,
      source: "party_stats",
    });
  });

  test("marks offline members and prints no group when alone", () => {
    const party = new PartyStore();
    expect(formatPartyState(party.snapshot())).toEqual(["Group: none"]);
    party.applyList(list(["Bob"]), "Xia");
    party.applyStats(0xa40n, { online: false }, 1000);
    expect(party.snapshot().members[0]?.online).toBe(false);
    party.clear();
    expect(party.snapshot().inGroup).toBe(false);
  });
});
