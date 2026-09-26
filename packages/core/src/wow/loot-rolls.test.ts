import { describe, expect, test } from "bun:test";
import { bytes } from "#test-support/hex";
import { LootRolls, ROLL_GRACE_MS } from "#wow/loot-rolls";
import {
  parseLootAllPassed,
  parseLootRoll,
  parseLootRollWon,
  parseLootStartRoll,
} from "#wow/protocol/loot";
import { GameOpcode } from "#wow/protocol/opcodes";
import { PacketReader } from "#wow/protocol/packet";

const self = 0xa_5bn;
const mate = 0xa_5cn;
const rollGuid = 0x40_00_00_00_00_0f_3d_77n;
const corpse = 0xf1_30_00_3d_2a_07_91_20n;

const start = `
  773d0f0000000040 12020000 03000000 260a0000
  00000000 00000000 01000000 60ea0000 07
`;
const needSelected = `
  0000000000000000 03000000 5b0a000000000000 260a0000
  00000000 00000000 00 00 00
`;
const mateRolled = `
  0000000000000000 03000000 5c0a000000000000 260a0000
  00000000 00000000 80 00 00
`;
const selfRolled = `
  0000000000000000 03000000 5b0a000000000000 260a0000
  00000000 00000000 0b 01 00
`;
const won = `
  0000000000000000 03000000 260a0000 00000000 00000000
  5b0a000000000000 0b 01
`;
const allPassed = `
  773d0f0000000040 03000000 260a0000 00000000 00000000
`;

function fixture(loot?: bigint) {
  let now = 1000;
  const sent: { opcode: number; body: Uint8Array | undefined }[] = [];
  const events: string[] = [];
  const rolls = new LootRolls({
    changed: (type) => events.push(type),
    lootGuid: () => loot,
    now: () => now,
    selfGuid: () => self,
    send: (opcode, body) => {
      sent.push({ body, opcode });
    },
  });
  const read = (hex: string) => new PacketReader(bytes(hex));
  rolls.receiveStart(parseLootStartRoll(read(start)));
  return {
    advance: (ms: number) => {
      now += ms;
    },
    events,
    read,
    rolls,
    sent,
  };
}

describe("group loot rolls", () => {
  test("a started roll is pending with its item, countdown and allowed votes", () => {
    const f = fixture(corpse);
    f.advance(1500);
    expect(f.rolls.snapshot().pending).toEqual([
      expect.objectContaining({
        allowed: ["pass", "need", "greed"],
        choice: undefined,
        corpseGuid: corpse,
        count: 1,
        countdownMs: 60_000,
        guid: rollGuid,
        itemId: 2598,
        mapId: 530,
        randomPropertyId: 0,
        remainingMs: 58_500,
        slot: 3,
      }),
    ]);
    expect(f.events).toEqual(["loot_roll_started"]);
  });

  test("answering sends the roll id, slot and vote once", () => {
    const f = fixture();
    f.rolls.roll(rollGuid, 3, "need");
    expect(f.sent).toEqual([
      {
        body: bytes("773d0f0000000040 03000000 01"),
        opcode: GameOpcode.CMSG_LOOT_ROLL,
      },
    ]);
    expect(f.rolls.snapshot().pending[0]?.choice).toBe("need");
    expect(() => f.rolls.roll(rollGuid, 3, "greed")).toThrow(
      "Loot roll was already answered",
    );
    expect(f.sent).toHaveLength(1);
  });

  test("refuses rolls that are not pending or not allowed", () => {
    const f = fixture();
    expect(() => f.rolls.roll(rollGuid, 0, "pass")).toThrow(
      "No pending loot roll",
    );
    expect(() => f.rolls.roll(corpse, 3, "pass")).toThrow(
      "No pending loot roll",
    );
    expect(() => f.rolls.roll(rollGuid, 3, "disenchant")).toThrow(
      "Roll type is not allowed: disenchant",
    );
    f.advance(60_000 + ROLL_GRACE_MS);
    expect(() => f.rolls.roll(rollGuid, 3, "pass")).toThrow(
      "No pending loot roll",
    );
    expect(f.sent).toEqual([]);
  });

  test("the corpse from a later loot offer identifies the roll", () => {
    const f = fixture();
    f.rolls.observeOffer(corpse, [
      {
        count: 1,
        displayId: 0,
        itemId: 2598,
        randomPropertyId: 0,
        randomSuffix: 0,
        slot: 3,
        slotType: 1,
      },
    ]);
    f.rolls.roll(corpse, 3, "pass");
    expect(f.sent[0]?.body).toEqual(bytes("773d0f0000000040 03000000 00"));
  });

  test("votes without a roll id match by slot and item, and the win resolves it", () => {
    const f = fixture();
    f.rolls.receiveRoll(parseLootRoll(f.read(needSelected)));
    f.rolls.receiveRoll(parseLootRoll(f.read(mateRolled)));
    f.rolls.receiveRoll(parseLootRoll(f.read(selfRolled)));
    const [roll] = f.rolls.snapshot().pending;
    expect(roll?.choice).toBe("need");
    expect(roll?.votes.map((v) => [v.player, v.choice, v.rolled])).toEqual([
      [self, "need", undefined],
      [mate, "pass", undefined],
      [self, "need", 11],
    ]);
    f.rolls.receiveWon(parseLootRollWon(f.read(won)));
    expect(f.rolls.snapshot()).toEqual({
      last: expect.objectContaining({
        guid: rollGuid,
        itemId: 2598,
        mine: true,
        myChoice: "need",
        outcome: "won",
        rolled: 11,
        winner: self,
        winnerChoice: "need",
      }),
      pending: [],
    });
    expect(f.events.at(-1)).toBe("loot_roll_won");
  });

  test("everyone passing resolves the roll with no winner", () => {
    const f = fixture();
    f.rolls.receiveAllPassed(parseLootAllPassed(f.read(allPassed)));
    expect(f.rolls.snapshot()).toEqual({
      last: expect.objectContaining({
        mine: false,
        outcome: "all_passed",
        winner: undefined,
      }),
      pending: [],
    });
  });
});
