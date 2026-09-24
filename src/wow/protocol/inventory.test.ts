import { describe, expect, test } from "bun:test";
import { PacketReader } from "wow/protocol/packet";
import { bytes } from "test/hex";
import { parseInventoryChangeFailure } from "wow/protocol/inventory";

const guid = 0x0102030405060708n;

describe("parseInventoryChangeFailure", () => {
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
});
