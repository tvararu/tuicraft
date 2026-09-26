import { describe, expect, test } from "bun:test";
import { bytes } from "#test-support/hex";
import {
  DESTROY_TWO_OF_STACK,
  DESTROY_WHOLE_STACK,
  INVENTORY_FULL_ON_REWARD,
} from "#test-support/inventory-fixtures";
import {
  buildDestroyItem,
  inventoryResultName,
  parseInventoryChangeFailure,
} from "#wow/protocol/inventory";
import { PacketReader } from "#wow/protocol/packet";

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

describe("CMSG_DESTROYITEM", () => {
  test("matches wow_messages and the captured client packets", () => {
    expect(buildDestroyItem(255, 36, 0)).toEqual(DESTROY_WHOLE_STACK);
    expect(buildDestroyItem(255, 29, 2)).toEqual(DESTROY_TWO_OF_STACK);
    expect(buildDestroyItem(19, 3, 5)).toEqual(bytes("13 03 05 000000"));
  });

  test("reads the captured full-bags answer to a quest reward", () => {
    const failure = parseInventoryChangeFailure(
      new PacketReader(INVENTORY_FULL_ON_REWARD),
    );
    expect(failure).toMatchObject({ kind: "error", result: 50 });
    expect(inventoryResultName(failure.result)).toBe("inventory_full");
  });
});

describe("inventoryResultName", () => {
  test("names AzerothCore results and keeps unknown codes readable", () => {
    expect(inventoryResultName(50)).toBe("inventory_full");
    expect(inventoryResultName(24)).toBe("cant_drop_soulbound");
    expect(inventoryResultName(23)).toBe("item_not_found");
    expect(inventoryResultName(250)).toBe("inventory_result_250");
  });
});
