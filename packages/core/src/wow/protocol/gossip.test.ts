import { describe, expect, test } from "bun:test";
import { bytes } from "#test-support/hex";
import {
  buildGossipHello,
  buildGossipSelectOption,
  parseGossipMessage,
} from "#wow/protocol/gossip";
import { PacketReader } from "#wow/protocol/packet";

const guid = 0x0102030405060708n;
const menu = bytes(`
  0807060504030201 11000000 22000000 01000000
  99000000 03 02 f4010000 48656c6c6f20c3a900 5061793f00
  01000000 2a000000 08000000 ffffffff 00020080 02 517565737400
`);

describe("buildGossipHello", () => {
  test("writes the npc guid", () => {
    expect(buildGossipHello(guid)).toEqual(bytes("0807060504030201"));
  });
});

describe("buildGossipSelectOption", () => {
  const select = { guid, menuId: 17, optionIndex: 153 };

  test("distinguishes an absent code from an empty one", () => {
    expect(buildGossipSelectOption(select)).toEqual(
      bytes("0807060504030201 11000000 99000000"),
    );
    expect(buildGossipSelectOption({ ...select, code: "" })).toEqual(
      bytes("0807060504030201 11000000 99000000 00"),
    );
    expect(buildGossipSelectOption({ ...select, code: "é" })).toEqual(
      bytes("0807060504030201 11000000 99000000 c3a900"),
    );
  });
});

describe("parseGossipMessage", () => {
  test("retains menu identity, raw flags, signed levels, and UTF-8 labels", () => {
    const r = new PacketReader(menu);
    expect(parseGossipMessage(r)).toEqual({
      guid,
      menuId: 17,
      titleTextId: 34,
      options: [
        {
          optionIndex: 153,
          icon: 3,
          coded: 2,
          money: 500,
          text: "Hello é",
          boxText: "Pay?",
        },
      ],
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
    expect(r.remaining).toBe(0);
    expect(
      parseGossipMessage(
        new PacketReader(
          bytes("0807060504030201 11000000 22000000 00000000 00000000"),
        ),
      ),
    ).toEqual({ guid, menuId: 17, titleTextId: 34, options: [], quests: [] });
  });
});
