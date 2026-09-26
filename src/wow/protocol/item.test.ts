import { describe, expect, test } from "bun:test";
import {
  LESSER_HEALING_POTION_RESPONSE,
  UNKNOWN_ITEM_999999_RESPONSE,
} from "test/item-query-fixtures";
import {
  buildItemQuery,
  buildUseItem,
  parseItemQueryResponse,
} from "wow/protocol/item";
import { PacketReader, PacketWriter } from "wow/protocol/packet";

const NONE = 0xff_ff_ff_ff;

function words(w: PacketWriter, values: number[]): void {
  for (const value of values) w.uint32LE(value);
}

describe("CMSG_USE_ITEM", () => {
  test("writes the 3.3.5 layout AzerothCore reads, with self as target", () => {
    const body = buildUseItem({
      bag: 255,
      slot: 29,
      castCount: 3,
      spellId: 5005,
      itemGuid: 0x4000_0000_000f_17a9n,
    });
    expect([...body]).toEqual([
      0xff, 0x1d, 0x03, 0x8d, 0x13, 0x00, 0x00, 0xa9, 0x17, 0x0f, 0x00, 0x00,
      0x00, 0x00, 0x40, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    ]);
  });
});

describe("item template query", () => {
  test("asks for one entry", () => {
    expect([...buildItemQuery(2687)]).toEqual([0x7f, 0x0a, 0x00, 0x00]);
  });

  test("reads the on-use spells past a variable stat list", () => {
    const w = new PacketWriter();
    words(w, [2687, 0, 5, NONE]);
    for (const name of ["Dry Pork Ribs", "", "", ""]) w.cString(name);
    words(
      w,
      Array.from({ length: 21 }, (_, i) => 1000 + i),
    );
    words(w, [2, 3, 5, 7, 2, 0, 0]);
    for (let i = 0; i < 2; i++) {
      w.floatLE(1.5);
      w.floatLE(2.5);
      w.uint32LE(0);
    }
    words(w, new Array(9).fill(9));
    w.floatLE(0);
    words(w, [5005, 0, NONE, NONE, 11, 1000]);
    for (let slot = 1; slot < 5; slot++) words(w, [0, 0, 0, NONE, 0, NONE]);
    w.uint32LE(0);
    w.cString("");
    expect(parseItemQueryResponse(new PacketReader(w.finish()))).toEqual({
      entry: 2687,
      template: {
        entry: 2687,
        itemClass: 0,
        name: "Dry Pork Ribs",
        quality: 1001,
        spells: [
          {
            category: 11,
            categoryCooldownMs: 1000,
            charges: -1,
            cooldownMs: -1,
            id: 5005,
            trigger: 0,
          },
        ],
        stackSize: 1019,
        subclass: 5,
      },
    });
  });

  test("reads name, quality and the on-use spell from a captured response", () => {
    expect(
      parseItemQueryResponse(new PacketReader(LESSER_HEALING_POTION_RESPONSE)),
    ).toEqual({
      entry: 858,
      template: {
        entry: 858,
        itemClass: 0,
        name: "Lesser Healing Potion",
        quality: 1,
        spells: [
          {
            category: 4,
            categoryCooldownMs: 60_000,
            charges: -1,
            cooldownMs: 0,
            id: 440,
            trigger: 0,
          },
        ],
        stackSize: 20,
        subclass: 1,
      },
    });
    expect(
      parseItemQueryResponse(new PacketReader(UNKNOWN_ITEM_999999_RESPONSE)),
    ).toEqual({ entry: 999_999, template: undefined });
  });

  test("reports an unknown entry from the high bit", () => {
    const w = new PacketWriter();
    w.uint32LE(0x80_00_00_00 | 2687);
    expect(parseItemQueryResponse(new PacketReader(w.finish()))).toEqual({
      entry: 2687,
      template: undefined,
    });
  });
});
