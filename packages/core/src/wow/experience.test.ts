import { describe, expect, test } from "bun:test";
import { must } from "#test-support/must";
import { captured8325, hexBytes } from "#test-support/quest-8325-packets";
import { EntityStore } from "#wow/entity-store";
import { readExperience } from "#wow/experience";
import { parseXpGain } from "#wow/protocol/combat";
import { ObjectType, PLAYER_FIELDS } from "#wow/protocol/entity-fields";
import { parseLevelUpInfo } from "#wow/protocol/experience";
import { PacketReader } from "#wow/protocol/packet";

const self = 0x9f_bn;

describe("experience notices captured from the live server", () => {
  test("level-up info carries the new level and stat deltas", () => {
    const info = parseLevelUpInfo(
      new PacketReader(hexBytes(captured8325.levelUp)),
    );
    expect(info).toEqual({
      healthDelta: 6,
      level: 2,
      powerDeltas: [55, 0, 0, 0, 0, 0, 0],
      statDeltas: [0, 0, 0, 1, 1],
    });
  });

  test("kill and quest XP notices are distinguished", () => {
    const kill = parseXpGain(new PacketReader(hexBytes(captured8325.killXp)));
    const quest = parseXpGain(new PacketReader(hexBytes(captured8325.questXp)));
    expect(kill).toMatchObject({ kind: "kill", total: 50 });
    expect(quest).toMatchObject({ kind: "other", total: 100, victim: 0n });
  });

  test("experience reads self XP fields and never another player's", () => {
    const entities = new EntityStore();
    entities.create(self, ObjectType.PLAYER, { createComplete: true });
    entities.create(2n, ObjectType.PLAYER, { createComplete: true });
    for (const guid of [self, 2n]) {
      const fields = must(entities.get(guid)).rawFields;
      fields.set(PLAYER_FIELDS.XP.offset, 180);
      fields.set(PLAYER_FIELDS.NEXT_LEVEL_XP.offset, 400);
    }
    const combat = { lastLevelUp: undefined, lastXp: undefined };
    const lookup = (guid: bigint) => entities.get(guid);
    expect(readExperience(self, lookup, combat)).toMatchObject({
      nextLevelXp: 400,
      xp: 180,
    });
    expect(readExperience(self, () => entities.get(2n), combat)).toMatchObject({
      nextLevelXp: undefined,
      xp: undefined,
    });
  });
});
