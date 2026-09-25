import { describe, expect, test } from "bun:test";
import { bytes } from "test/hex";
import { PacketReader } from "wow/protocol/packet";
import {
  buildQuestgiverAcceptQuest,
  buildQuestgiverChooseReward,
  buildQuestgiverCompleteQuest,
  buildQuestgiverQueryQuest,
  buildQuestgiverRequestReward,
  parseQuestgiverOfferReward,
  parseQuestgiverQuestComplete,
  parseQuestgiverQuestDetails,
  parseQuestgiverQuestList,
  parseQuestgiverRequestItems,
  parseQuestgiverStatus,
} from "wow/protocol/questgiver";

const guid = 0x0102030405060708n;
const factions = [
  { factionId: 72, valueId: -1, override: -250 },
  { factionId: 76, valueId: 2, override: 600 },
  { factionId: 0, valueId: 0, override: 0 },
  { factionId: 0, valueId: 0, override: 0 },
  { factionId: 0, valueId: 0, override: 0 },
];
const reputationBytes = `
  48000000 4c000000 00000000 00000000 00000000
  ffffffff 02000000 00000000 00000000 00000000
  06ffffff 58020000 00000000 00000000 00000000
`;
const rewardBytes = `
  01000000 d1070000 02000000 b90b0000
  01000000 e9030000 03000000 a10f0000
  38ffffff 2c010000 0c000000 0000c03f
`;
const spellBytes = "64000000 9bffffff 06000000 01000000 14000000 0a000000";
const rewards = {
  choices: [{ itemId: 2001, count: 2, displayId: 3001 }],
  items: [{ itemId: 1001, count: 3, displayId: 4001 }],
  money: -200,
  experience: 300,
  honor: 12,
  honorMultiplier: 1.5,
  spellId: 100,
  spellCastId: -101,
  titleId: 6,
  talents: 1,
  arenaPoints: 20,
  reputationMask: 10,
  factions,
};
const details = bytes(`
  0807060504030201 1817161514131211 2a000000 5400 4400 4f00
  02 00020080 03000000 7f
  ${rewardBytes} ${spellBytes} ${reputationBytes}
  01000000 07000000 e8030000
`);
const offer = bytes(`
  0807060504030201 2a000000 5400 5200 02 00020080 03000000
  01000000 e8030000 07000000
  ${rewardBytes} 08000000 ${spellBytes} ${reputationBytes}
`);
const request = bytes(`
  0807060504030201 2a000000 5400 4900
  09000000 07000000 02000000 00020080 03000000 c8000000
  01000000 e9030000 03000000 a10f0000
  03000000 04000000 08000000 10000000
`);

describe("questgiver requests", () => {
  test("encode guid, quest and trailing fields", () => {
    expect(buildQuestgiverQueryQuest(guid, 42, 127)).toEqual(
      bytes("0807060504030201 2a000000 7f"),
    );
    expect(buildQuestgiverAcceptQuest(guid, 42, 0x12_34_56_78)).toEqual(
      bytes("0807060504030201 2a000000 78563412"),
    );
    expect(buildQuestgiverCompleteQuest(guid, 42)).toEqual(
      bytes("0807060504030201 2a000000"),
    );
    expect(buildQuestgiverRequestReward(guid, 42)).toEqual(
      bytes("0807060504030201 2a000000"),
    );
    expect(buildQuestgiverChooseReward(guid, 42, 5)).toEqual(
      bytes("0807060504030201 2a000000 05000000"),
    );
  });
});

describe("quest menus and rewards", () => {
  test("reads one-byte status and one-byte quest-list count", () => {
    expect(
      parseQuestgiverStatus(new PacketReader(bytes("0807060504030201 0a"))),
    ).toEqual({ guid, status: 10 });
    expect(
      parseQuestgiverQuestList(
        new PacketReader(
          bytes(`
      0807060504030201 486900 e8030000 07000000 01
      2a000000 08000000 ffffffff 00020080 02 517565737400
    `),
        ),
      ),
    ).toEqual({
      guid,
      title: "Hi",
      emoteDelay: 1000,
      emote: 7,
      quests: [
        {
          questId: 42,
          icon: 8,
          level: -1,
          flags: 0x80_00_02_00,
          repeatable: 2,
          title: "Quest",
        },
      ],
    });
  });

  test("retains divider, unknown byte, signed rewards, and emote-first detail order", () => {
    expect(parseQuestgiverQuestDetails(new PacketReader(details))).toEqual({
      guid,
      dividerGuid: 0x1112131415161718n,
      questId: 42,
      title: "T",
      details: "D",
      objectives: "O",
      activateAccept: 2,
      flags: 0x80_00_02_00,
      suggestedPlayers: 3,
      unknown: 127,
      rewards,
      emotes: [{ emote: 7, delay: 1000 }],
    });
  });

  test("reads offer's one-byte enable-next, delay-first emotes, and extra unknown field", () => {
    expect(parseQuestgiverOfferReward(new PacketReader(offer))).toEqual({
      guid,
      questId: 42,
      title: "T",
      rewardText: "R",
      enableNext: 2,
      flags: 0x80_00_02_00,
      suggestedPlayers: 3,
      emotes: [{ emote: 7, delay: 1000 }],
      rewards,
      unknownAfterHonorMultiplier: 8,
    });
  });

  test("retains required money/items and all four completion flags", () => {
    expect(parseQuestgiverRequestItems(new PacketReader(request))).toEqual({
      guid,
      questId: 42,
      title: "T",
      requestText: "I",
      unknown: 9,
      emote: 7,
      closeOnCancel: 2,
      flags: 0x80_00_02_00,
      suggestedPlayers: 3,
      requiredMoney: 200,
      items: [{ itemId: 1001, count: 3, displayId: 4001 }],
      completionFlags: [3, 4, 8, 16],
    });
  });

  test("hidden reward counts do not suppress the remaining spell and faction fields", () => {
    const data = bytes(`
      0807060504030201 0000000000000000 2a000000 00 00 00
      00 00020000 00000000 00
      00000000 00000000 00000000 00000000
      0c000000 0000c03f ${spellBytes} ${reputationBytes} 00000000
    `);
    const result = parseQuestgiverQuestDetails(new PacketReader(data));
    expect(result.flags).toBe(0x2_00);
    expect(result.rewards).toEqual({
      ...rewards,
      choices: [],
      items: [],
      money: 0,
      experience: 0,
    });
    expect(result.emotes).toEqual([]);
  });

  test("incomplete objective-only requests retain non-completable flags with no items", () => {
    const data = bytes(`
      0807060504030201 2a000000 5400 5200
      00000000 07000000 00000000 00000000 00000000 00000000
      00000000 00000000 04000000 08000000 10000000
    `);
    const result = parseQuestgiverRequestItems(new PacketReader(data));
    expect(result.requiredMoney).toBe(0);
    expect(result.items).toEqual([]);
    expect(result.completionFlags).toEqual([0, 4, 8, 16]);
  });

  test("reads actual six-word completion without speculative reward item tails", () => {
    const data = bytes("2a000000 2c010000 38ffffff 0c000000 01000000 14000000");
    expect(parseQuestgiverQuestComplete(new PacketReader(data))).toEqual({
      questId: 42,
      experience: 300,
      money: -200,
      honor: 12,
      talents: 1,
      arenaPoints: 20,
    });
  });
});
