import { describe, expect, test } from "bun:test";
import {
  buildGossipHello,
  buildGossipSelectOption,
  parseGossipMessage,
} from "wow/protocol/gossip";
import { PacketReader } from "wow/protocol/packet";

function bytes(hex: string): Uint8Array {
  return Buffer.from(hex.replace(/\s/g, ""), "hex");
}

const guid = 0x0102030405060708n;
const menu = bytes(`
  0807060504030201 11000000 22000000 01000000
  99000000 03 02 f4010000 48656c6c6f20c3a900 5061793f00
  01000000 2a000000 08000000 ffffffff 00020080 02 517565737400
`);

describe("gossip wire", () => {
  test("selects offered option IDs and distinguishes absent from empty code", () => {
    expect(buildGossipHello(guid)).toEqual(bytes("0807060504030201"));
    expect(buildGossipSelectOption(guid, 17, 153)).toEqual(
      bytes("0807060504030201 11000000 99000000"),
    );
    expect(buildGossipSelectOption(guid, 17, 153, "")).toEqual(
      bytes("0807060504030201 11000000 99000000 00"),
    );
    expect(buildGossipSelectOption(guid, 17, 153, "é")).toEqual(
      bytes("0807060504030201 11000000 99000000 c3a900"),
    );
    expect(() => buildGossipSelectOption(guid, 17, 153, "x\0y")).toThrow(
      RangeError,
    );
    expect(() => buildGossipHello(-1n)).toThrow(RangeError);
    expect(() => buildGossipHello(0x10000000000000000n)).toThrow(RangeError);
    expect(() => buildGossipSelectOption(guid, -1, 153)).toThrow(RangeError);
    expect(() => buildGossipSelectOption(guid, 17, 0x100000000)).toThrow(
      RangeError,
    );
  });

  test("retains menu identity, raw flags, signed levels, and UTF-8 labels", () => {
    expect(parseGossipMessage(new PacketReader(menu))).toEqual({
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
          flags: 0x80000200,
          repeatable: 2,
          title: "Quest",
        },
      ],
    });
    expect(
      parseGossipMessage(
        new PacketReader(
          bytes("0807060504030201 11000000 22000000 00000000 00000000"),
        ),
      ),
    ).toEqual({ guid, menuId: 17, titleTextId: 34, options: [], quests: [] });
  });

  test("rejects truncated strings and records, trailing bytes, and unbounded counts", () => {
    for (let length = 0; length < menu.length; length++) {
      expect(() =>
        parseGossipMessage(new PacketReader(menu.subarray(0, length))),
      ).toThrow(RangeError);
    }
    expect(() =>
      parseGossipMessage(
        new PacketReader(bytes("0807060504030201 11000000 22000000 ffffffff")),
      ),
    ).toThrow(RangeError);
    expect(() =>
      parseGossipMessage(
        new PacketReader(
          bytes("0807060504030201 11000000 22000000 00000000 ffffffff"),
        ),
      ),
    ).toThrow(RangeError);
    expect(() =>
      parseGossipMessage(new PacketReader(Buffer.concat([menu, bytes("00")]))),
    ).toThrow(RangeError);
  });
});
