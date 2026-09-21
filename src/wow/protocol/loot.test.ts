import { describe, expect, test } from "bun:test";
import { PacketReader } from "wow/protocol/packet";
import {
  buildAutostoreLootItem,
  buildLoot,
  buildLootRelease,
  parseItemPushResult,
  parseInventoryChangeFailure,
  parseLootMoneyNotify,
  parseLootReleaseResponse,
  parseLootRemoved,
  parseLootResponse,
} from "wow/protocol/loot";

const guid = 0x0102030405060708n;
const guidBytes = [8, 7, 6, 5, 4, 3, 2, 1];

function bytes(hex: string): Uint8Array {
  return Buffer.from(hex.replace(/\s/g, ""), "hex");
}

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

  test("invalid GUIDs and slots cannot wrap to another request", () => {
    for (const value of [-1n, 1n << 64n]) {
      expect(() => buildLoot(value)).toThrow(RangeError);
      expect(() => buildLootRelease(value)).toThrow(RangeError);
    }
    for (const slot of [-1, 256, 1.5]) {
      expect(() => buildAutostoreLootItem(slot)).toThrow(RangeError);
    }
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

  test("truncated loot entries and truncated fixed packets reject", () => {
    const cases = [
      { data: loot, parse: parseLootResponse },
      { data: failure, parse: parseLootResponse },
      { data: push, parse: parseItemPushResult },
      {
        data: bytes("08 07 06 05 04 03 02 01 01"),
        parse: parseLootReleaseResponse,
      },
      { data: bytes("01 00 00 00 01"), parse: parseLootMoneyNotify },
      { data: bytes("02"), parse: parseLootRemoved },
    ];
    for (const { data, parse } of cases) {
      for (let length = 0; length < data.length; length++) {
        expect(() => parse(new PacketReader(data.subarray(0, length)))).toThrow(
          RangeError,
        );
      }
    }
  });

  test("an item count cannot hide extra or missing entry bytes", () => {
    const missing = loot.slice();
    missing[13] = 3;
    const extra = loot.slice();
    extra[13] = 1;
    expect(() => parseLootResponse(new PacketReader(missing))).toThrow(
      RangeError,
    );
    expect(() => parseLootResponse(new PacketReader(extra))).toThrow(
      RangeError,
    );
  });
});

describe("inventory change failure layouts", () => {
  test("distinguishes explicit OK from inventory-full and preserves unknown errors", () => {
    expect(parseInventoryChangeFailure(new PacketReader(bytes("00")))).toEqual({
      kind: "ok",
      result: 0,
    });
    expect(
      parseInventoryChangeFailure(
        new PacketReader(bytes("32 0807060504030201 1817161514131211 07")),
      ),
    ).toEqual({
      kind: "error",
      result: 50,
      item1: guid,
      item2: 0x1112131415161718n,
      bagType: 7,
      detail: { kind: "none" },
    });
    expect(
      parseInventoryChangeFailure(
        new PacketReader(bytes("ff 0000000000000000 0000000000000000 00")),
      ),
    ).toEqual({
      kind: "error",
      result: 255,
      item1: 0n,
      item2: 0n,
      bagType: 0,
      detail: { kind: "none" },
    });
  });

  test("retains required-level, binding-confirmation and item-category tails", () => {
    expect(
      parseInventoryChangeFailure(
        new PacketReader(
          bytes("57 0000000000000000 0000000000000000 00 50000000"),
        ),
      ),
    ).toMatchObject({
      result: 87,
      detail: { kind: "level", requiredLevel: 80 },
    });
    expect(
      parseInventoryChangeFailure(
        new PacketReader(
          bytes(
            "51 0000000000000000 0000000000000000 00 0807060504030201 18000000 1817161514131211",
          ),
        ),
      ),
    ).toMatchObject({
      result: 81,
      detail: {
        kind: "binding",
        itemGuid: guid,
        slot: 24,
        containerGuid: 0x1112131415161718n,
      },
    });
    expect(
      parseInventoryChangeFailure(
        new PacketReader(
          bytes("59 0000000000000000 0000000000000000 00 7b000000"),
        ),
      ),
    ).toMatchObject({ result: 89, detail: { kind: "limit", category: 123 } });
  });

  test("requires all bytes of each source-specific tail and rejects trailing payload", () => {
    const fixtures = [
      bytes("32 0000000000000000 0000000000000000 00"),
      bytes("01 0000000000000000 0000000000000000 00 50000000"),
      bytes(
        "51 0000000000000000 0000000000000000 00 0807060504030201 18000000 1817161514131211",
      ),
      bytes("54 0000000000000000 0000000000000000 00 7b000000"),
    ];
    for (const data of fixtures) {
      for (let length = 0; length < data.length; length++) {
        expect(() =>
          parseInventoryChangeFailure(
            new PacketReader(data.subarray(0, length)),
          ),
        ).toThrow(RangeError);
      }
      expect(() =>
        parseInventoryChangeFailure(
          new PacketReader(Buffer.concat([data, bytes("00")])),
        ),
      ).toThrow(RangeError);
    }
    expect(() =>
      parseInventoryChangeFailure(new PacketReader(bytes("00 00"))),
    ).toThrow(RangeError);
  });
});
