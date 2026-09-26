import { describe, expect, test } from "bun:test";
import {
  ARENA_TRAINER_LIST,
  BOUGHT_FORTITUDE,
  BUY_FORTITUDE,
  FORTITUDE_NO_MONEY,
  LIST_ARENA,
  MATRON_ARENA,
} from "#test-support/trainer-fixtures";
import { PacketReader } from "./packet";
import {
  buildTrainerBuySpell,
  buildTrainerList,
  parseTrainerBuyFailed,
  parseTrainerBuySucceeded,
  parseTrainerList,
  trainerFailureName,
} from "./trainer";

describe("trainer packets captured from Matron Arena", () => {
  test("requests match the client bytes", () => {
    expect(buildTrainerList(MATRON_ARENA)).toEqual(LIST_ARENA);
    expect(buildTrainerBuySpell(MATRON_ARENA, 1243)).toEqual(BUY_FORTITUDE);
  });

  test("the list reads every 38-byte spell record and the greeting", () => {
    const r = new PacketReader(ARENA_TRAINER_LIST);
    const list = parseTrainerList(r);
    expect(r.remaining).toBe(0);
    expect(list.guid).toBe(MATRON_ARENA);
    expect(list.trainerType).toBe(0);
    expect(list.greeting).toBe("Hello, priest!  Ready for some training?");
    expect(list.spells.map((s) => [s.spellId, s.usable, s.cost])).toEqual([
      [17, 1, 95],
      [589, 1, 95],
      [591, 1, 95],
      [1243, 0, 9],
      [2052, 1, 95],
    ]);
    expect(list.spells[2]).toMatchObject({
      requiredLevel: 6,
      requiredSpells: [585, 0, 0],
    });
  });

  test("success and failure name the spell and the reason", () => {
    expect(
      parseTrainerBuySucceeded(new PacketReader(BOUGHT_FORTITUDE)),
    ).toEqual({ guid: MATRON_ARENA, spellId: 1243 });
    const failed = parseTrainerBuyFailed(new PacketReader(FORTITUDE_NO_MONEY));
    expect(failed).toEqual({ guid: MATRON_ARENA, spellId: 1243, reason: 1 });
    expect(trainerFailureName(failed.reason)).toBe("not_enough_money");
    expect(trainerFailureName(2)).toBe("not_enough_skill");
    expect(trainerFailureName(9)).toBe("trainer_failure_9");
  });
});
