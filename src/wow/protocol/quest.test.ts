import { describe, expect, test } from "bun:test";
import { PacketReader } from "wow/protocol/packet";
import {
  buildQuestgiverStatusQuery,
  buildQuestgiverHello,
  buildQuestgiverQueryQuest,
  buildQuestQuery,
  buildQuestgiverAcceptQuest,
  buildQuestgiverCompleteQuest,
  buildQuestgiverRequestReward,
  buildQuestgiverChooseReward,
  buildQuestLogRemoveQuest,
  parseQuestgiverStatus,
  parseQuestgiverQuestList,
  parseQuestgiverQuestDetails,
  parseQuestQueryResponse,
  parseQuestgiverRequestItems,
  parseQuestgiverOfferReward,
  parseQuestgiverQuestComplete,
  parseQuestUpdateAddKill,
  parseQuestUpdateAddItem,
  parseQuestUpdateComplete,
  parseQuestInvalid,
  parseQuestFailed,
  parseQuestUpdateFailed,
  parseQuestUpdateFailedTimer,
} from "wow/protocol/quest";

function bytes(hex: string): Uint8Array {
  return Buffer.from(hex.replace(/\s/g, ""), "hex");
}

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
const spellBytes = `64000000 9bffffff 06000000 01000000 14000000 0a000000`;
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
const query = bytes(`
  2a000000 02000000 ffffffff 0a000000 afffffff 01000000 03000000
  48000000 5cfeffff 4c000000 28230000 2b000000 07000000
  38ffffff 2c010000 64000000 9bffffff 0c000000 0000c03f
  c8000000 00020080 06000000 02000000 01000000 14000000 0a000000
  e9030000 02000000 00000000 00000000 eb030000 01000000 00000000 00000000
  d1070000 01000000 d2070000 02000000 00000000 00000000
  00000000 00000000 00000000 00000000 d6070000 06000000
  ${reputationBytes}
  12020000 0000c03f 000010c0 07000000
  5469746c6500 48756e7400 44657461696c7300 4172656100 446f6e6500
  7b000000 03000000 f4010000 02000000
  41010080 01000000 f5010000 03000000
  00000000 00000000 00000000 00000000
  00000000 00000000 00000000 00000000
  64000000 02000000 c8000000 03000000
  00000000 00000000 00000000 00000000 00000000 00000000 00000000 00000000
  576f6c6600 436865737400 00 00
`);

describe("quest requests", () => {
  test("encodes required widths including unequal unknown trailers", () => {
    expect(buildQuestgiverStatusQuery(guid)).toEqual(bytes("0807060504030201"));
    expect(buildQuestgiverHello(guid)).toEqual(bytes("0807060504030201"));
    expect(buildQuestgiverQueryQuest(guid, 42, 127)).toEqual(
      bytes("0807060504030201 2a000000 7f"),
    );
    expect(buildQuestQuery(42)).toEqual(bytes("2a000000"));
    expect(buildQuestgiverAcceptQuest(guid, 42, 0x12345678)).toEqual(
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
    expect(buildQuestLogRemoveQuest(24)).toEqual(bytes("18"));
  });

  test("rejects scalars that the writer would truncate or wrap", () => {
    expect(() => buildQuestgiverHello(-1n)).toThrow(RangeError);
    expect(() => buildQuestgiverStatusQuery(0x10000000000000000n)).toThrow(
      RangeError,
    );
    expect(() => buildQuestQuery(-1)).toThrow(RangeError);
    expect(() => buildQuestQuery(1.5)).toThrow(RangeError);
    expect(() => buildQuestgiverQueryQuest(guid, 42, 256)).toThrow(RangeError);
    expect(() => buildQuestgiverAcceptQuest(guid, 42, 0x100000000)).toThrow(
      RangeError,
    );
    expect(() => buildQuestgiverChooseReward(guid, 42, -1)).toThrow(RangeError);
    expect(() => buildQuestLogRemoveQuest(256)).toThrow(RangeError);
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
          flags: 0x80000200,
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
      flags: 0x80000200,
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
      flags: 0x80000200,
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
      flags: 0x80000200,
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
    expect(result.flags).toBe(0x200);
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

  test("requires mandatory tails, terminated strings, and bounded record counts", () => {
    const fixtures = [
      { data: details, parse: parseQuestgiverQuestDetails },
      { data: offer, parse: parseQuestgiverOfferReward },
      { data: request, parse: parseQuestgiverRequestItems },
      { data: query, parse: parseQuestQueryResponse },
    ];
    for (const { data, parse } of fixtures) {
      for (let length = 0; length < data.length; length++) {
        expect(() => parse(new PacketReader(data.subarray(0, length)))).toThrow(
          RangeError,
        );
      }
      expect(() =>
        parse(new PacketReader(Buffer.concat([data, bytes("00")]))),
      ).toThrow(RangeError);
    }
    expect(() =>
      parseQuestgiverQuestList(
        new PacketReader(bytes("0807060504030201 00 00000000 00000000 ff")),
      ),
    ).toThrow(RangeError);
    expect(() =>
      parseQuestgiverQuestDetails(
        new PacketReader(
          bytes(
            "0807060504030201 0000000000000000 2a000000 00 00 00 00 00000000 00000000 00 ffffffff",
          ),
        ),
      ),
    ).toThrow(RangeError);
    expect(() =>
      parseQuestgiverQuestList(
        new PacketReader(
          bytes(
            "0807060504030201 00 00000000 00000000 01 2a000000 08000000 ffffffff 00000000 00 78",
          ),
        ),
      ),
    ).toThrow(RangeError);
  });
});

describe("quest query objectives", () => {
  test("preserves full rewards and objectives, XP index, negative sorts, and sign-magnitude gameobjects", () => {
    expect(parseQuestQueryResponse(new PacketReader(query))).toEqual({
      questId: 42,
      method: 2,
      level: -1,
      minLevel: 10,
      zoneOrSort: -81,
      type: 1,
      suggestedPlayers: 3,
      reputationObjectives: [
        { factionId: 72, value: -420 },
        { factionId: 76, value: 9000 },
      ],
      nextQuestId: 43,
      xpId: 7,
      money: -200,
      maxLevelMoney: 300,
      spellId: 100,
      spellCastId: -101,
      honor: 12,
      honorMultiplier: 1.5,
      sourceItemId: 200,
      flags: 0x80000200,
      titleId: 6,
      playersSlain: 2,
      talents: 1,
      arenaPoints: 20,
      reputationMask: 10,
      items: [
        { itemId: 1001, count: 2 },
        { itemId: 0, count: 0 },
        { itemId: 1003, count: 1 },
        { itemId: 0, count: 0 },
      ],
      choices: [
        { itemId: 2001, count: 1 },
        { itemId: 2002, count: 2 },
        { itemId: 0, count: 0 },
        { itemId: 0, count: 0 },
        { itemId: 0, count: 0 },
        { itemId: 2006, count: 6 },
      ],
      factions,
      poi: { mapId: 530, x: 1.5, y: -2.25, option: 7 },
      title: "Title",
      objectives: "Hunt",
      details: "Details",
      areaDescription: "Area",
      completedText: "Done",
      targets: [
        {
          encodedNpcOrGoId: 123,
          npcOrGoId: 123,
          count: 3,
          itemDropId: 500,
          unknownSourceCount: 2,
        },
        {
          encodedNpcOrGoId: 0x80000141,
          npcOrGoId: -321,
          count: 1,
          itemDropId: 501,
          unknownSourceCount: 3,
        },
        {
          encodedNpcOrGoId: 0,
          npcOrGoId: 0,
          count: 0,
          itemDropId: 0,
          unknownSourceCount: 0,
        },
        {
          encodedNpcOrGoId: 0,
          npcOrGoId: 0,
          count: 0,
          itemDropId: 0,
          unknownSourceCount: 0,
        },
      ],
      requiredItems: [
        { itemId: 100, count: 2 },
        { itemId: 200, count: 3 },
        { itemId: 0, count: 0 },
        { itemId: 0, count: 0 },
        { itemId: 0, count: 0 },
        { itemId: 0, count: 0 },
      ],
      objectiveTexts: ["Wolf", "Chest", "", ""],
    });
  });

  test("does not turn a truncated or high-bit-only query into missing quest success", () => {
    expect(() =>
      parseQuestQueryResponse(new PacketReader(bytes("2a000000"))),
    ).toThrow(RangeError);
    expect(() =>
      parseQuestQueryResponse(new PacketReader(bytes("2a000080"))),
    ).toThrow(RangeError);
  });
});

describe("quest objective and failure notifications", () => {
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
    expect(() =>
      parseQuestgiverQuestComplete(new PacketReader(data.subarray(0, 23))),
    ).toThrow(RangeError);
    expect(() =>
      parseQuestgiverQuestComplete(
        new PacketReader(Buffer.concat([data, bytes("00000000")])),
      ),
    ).toThrow(RangeError);
  });

  test("retains uint32 counters and decodes gameobject credit without two's-complement corruption", () => {
    expect(
      parseQuestUpdateAddKill(
        new PacketReader(
          bytes("2a000000 41010080 00000100 01000100 0807060504030201"),
        ),
      ),
    ).toEqual({
      questId: 42,
      encodedNpcOrGoId: 0x80000141,
      npcOrGoId: -321,
      currentCount: 65536,
      requiredCount: 65537,
      guid,
    });
  });

  test("distinguishes actual empty item invalidation from explicit item counts", () => {
    expect(parseQuestUpdateAddItem(new PacketReader(bytes("")))).toEqual({
      kind: "notification",
    });
    expect(
      parseQuestUpdateAddItem(new PacketReader(bytes("e9030000 03000000"))),
    ).toEqual({ kind: "item", itemId: 1001, count: 3 });
    for (let length = 1; length < 8; length++) {
      expect(() =>
        parseQuestUpdateAddItem(new PacketReader(new Uint8Array(length))),
      ).toThrow(RangeError);
    }
    expect(() =>
      parseQuestUpdateAddItem(new PacketReader(bytes("e9030000 03000000 00"))),
    ).toThrow(RangeError);
  });

  test("keeps failure reason distinct from quest identity and preserves unknown reasons", () => {
    expect(parseQuestInvalid(new PacketReader(bytes("01000080")))).toEqual({
      reason: 0x80000001,
    });
    expect(
      parseQuestFailed(new PacketReader(bytes("2a000000 32000000"))),
    ).toEqual({ questId: 42, reason: 50 });
    expect(
      parseQuestUpdateComplete(new PacketReader(bytes("2a000000"))),
    ).toEqual({ questId: 42 });
    expect(parseQuestUpdateFailed(new PacketReader(bytes("2a000000")))).toEqual(
      { questId: 42 },
    );
    expect(
      parseQuestUpdateFailedTimer(new PacketReader(bytes("2a000000"))),
    ).toEqual({ questId: 42 });
    for (const parse of [
      parseQuestInvalid,
      parseQuestUpdateComplete,
      parseQuestUpdateFailed,
      parseQuestUpdateFailedTimer,
    ]) {
      expect(() => parse(new PacketReader(bytes("2a0000")))).toThrow(
        RangeError,
      );
      expect(() => parse(new PacketReader(bytes("2a000000 00")))).toThrow(
        RangeError,
      );
    }
  });
});
