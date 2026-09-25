import { describe, expect, test } from "bun:test";
import { bytes } from "test/hex";
import { PacketReader } from "wow/protocol/packet";
import {
  buildQuestQuery,
  parseQuestQueryResponse,
} from "wow/protocol/quest-query";

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

describe("buildQuestQuery", () => {
  test("writes the quest id", () => {
    expect(buildQuestQuery(42)).toEqual(bytes("2a000000"));
  });
});

describe("parseQuestQueryResponse", () => {
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
      flags: 0x80_00_02_00,
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
          encodedNpcOrGoId: 0x80_00_01_41,
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
});
