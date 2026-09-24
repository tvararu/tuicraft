import { describe, expect, test } from "bun:test";
import { PacketReader } from "wow/protocol/packet";
import { bytes } from "test/hex";
import {
  buildAutostoreLootItem,
  buildLoot,
  buildLootRelease,
  parseItemPushResult,
  parseLootMoneyNotify,
  parseLootReleaseResponse,
  parseLootRemoved,
  parseLootResponse,
} from "wow/protocol/loot";

const guid = 0x0102030405060708n;
const guidBytes = [8, 7, 6, 5, 4, 3, 2, 1];

const loot = bytes(`
  08 07 06 05 04 03 02 01 01 04 03 02 01 02
  02 78 56 34 12 03 00 00 00 44 33 22 11 d4 c3 b2 a1 ef ff ff ff 04
  07 ef cd ab 90 08 00 00 00 88 77 66 55 00 00 00 00 00 00 00 00 01
`);
const failure = bytes("08 07 06 05 04 03 02 01 00 04");
const push = bytes(`
  08 07 06 05 04 03 02 01
  00 00 00 00 01 00 00 00 01 00 00 00 ff
  ff ff ff ff 78 56 34 12 dd cc bb aa ef ff ff ff 03 00 00 00 09 00 00 00
`);

describe("loot requests", () => {
  test("loot and release use the full unpacked target GUID", () => {
    expect([...buildLoot(guid)]).toEqual(guidBytes);
    expect([...buildLootRelease(guid)]).toEqual(guidBytes);
    expect([...buildAutostoreLootItem(255)]).toEqual([255]);
  });
});

describe("loot responses", () => {
  test("success preserves each slot, money, random suffix and signed property", () => {
    const reader = new PacketReader(loot);
    expect(parseLootResponse(reader)).toEqual({
      kind: "loot",
      guid,
      lootType: 1,
      money: 0x01020304,
      items: [
        {
          slot: 2,
          itemId: 0x12345678,
          count: 3,
          displayId: 0x11223344,
          randomSuffix: 0xa1b2c3d4,
          randomPropertyId: -17,
          slotType: 4,
        },
        {
          slot: 7,
          itemId: 0x90abcdef,
          count: 8,
          displayId: 0x55667788,
          randomSuffix: 0,
          randomPropertyId: 0,
          slotType: 1,
        },
      ],
    });
    expect(reader.remaining).toBe(0);
  });

  test("server rejection is complete without fabricated money or item fields", () => {
    expect(parseLootResponse(new PacketReader(failure))).toEqual({
      kind: "error",
      guid,
      lootType: 0,
      error: 4,
    });
  });

  test("an empty successful loot window is distinct from rejection", () => {
    const payload = bytes("08 07 06 05 04 03 02 01 01 00 00 00 00 00");
    expect(parseLootResponse(new PacketReader(payload))).toEqual({
      kind: "loot",
      guid,
      lootType: 1,
      money: 0,
      items: [],
    });
  });

  test("item pushes distinguish stacked additions and total inventory count", () => {
    expect(parseItemPushResult(new PacketReader(push))).toEqual({
      guid,
      received: 0,
      created: 1,
      showInChat: 1,
      bagSlot: 255,
      slot: 0xffffffff,
      itemId: 0x12345678,
      randomSuffix: 0xaabbccdd,
      randomPropertyId: -17,
      count: 3,
      totalCount: 9,
    });
  });

  test("money notifications distinguish a shared award from solo loot", () => {
    expect(
      parseLootMoneyNotify(new PacketReader(bytes("78 56 34 12 00"))),
    ).toEqual({ money: 0x12345678, alone: false });
    expect(
      parseLootMoneyNotify(new PacketReader(bytes("01 00 00 00 01"))),
    ).toEqual({ money: 1, alone: true });
  });

  test("release and removal preserve the server status and slot", () => {
    expect(
      parseLootReleaseResponse(
        new PacketReader(bytes("08 07 06 05 04 03 02 01 01")),
      ),
    ).toEqual({ guid, status: 1 });
    expect(parseLootRemoved(new PacketReader(bytes("fe")))).toEqual({
      slot: 254,
    });
  });
});
