import { type PacketReader, PacketWriter } from "wow/protocol/packet";

export type VendorGood = {
  slot: number;
  itemId: number;
  displayId: number;
  stock: number | null;
  price: number;
  maxDurability: number;
  buyCount: number;
  extendedCost: number;
};

export type VendorInventory = {
  guid: bigint;
  items: VendorGood[];
  emptyReason: number | undefined;
};

export type SellItemFailure = {
  vendorGuid: bigint;
  itemGuid: bigint;
  param: number | undefined;
  result: number;
};

export type BuyItemResult = {
  vendorGuid: bigint;
  slot: number;
  stock: number | null;
  count: number;
};

export type BuyItemFailure = {
  vendorGuid: bigint;
  itemId: number;
  param: number | undefined;
  result: number;
};

const SELL_RESULTS: Record<number, string> = {
  1: "cant_find_item",
  2: "cant_sell_item",
  3: "cant_find_vendor",
  4: "you_dont_own_that_item",
  5: "sell_failed",
  6: "only_empty_bag",
  7: "cant_sell_to_this_merchant",
  8: "must_repair_item",
  9: "internal_bag_error",
};

const BUY_RESULTS: Record<number, string> = {
  0: "cant_find_item",
  1: "item_already_sold",
  2: "not_enough_money",
  4: "seller_dont_like_you",
  5: "distance_too_far",
  7: "item_sold_out",
  8: "cant_carry_more",
  11: "rank_require",
  12: "reputation_require",
};

export function sellResultName(result: number): string {
  return SELL_RESULTS[result] ?? `sell_result_${result}`;
}

export function buyResultName(result: number): string {
  return BUY_RESULTS[result] ?? `buy_result_${result}`;
}

function stockOf(raw: number): number | null {
  return raw === 0xff_ff_ff_ff ? null : raw;
}

export function buildListInventory(vendorGuid: bigint): Uint8Array {
  const w = new PacketWriter();
  w.uint64LE(vendorGuid);
  return w.finish();
}

export function buildSellItem(
  vendorGuid: bigint,
  itemGuid: bigint,
  count: number,
): Uint8Array {
  const w = new PacketWriter();
  w.uint64LE(vendorGuid);
  w.uint64LE(itemGuid);
  w.uint32LE(count);
  return w.finish();
}

export function buildBuyItem(
  vendorGuid: bigint,
  itemId: number,
  slot: number,
  count: number,
): Uint8Array {
  const w = new PacketWriter();
  w.uint64LE(vendorGuid);
  w.uint32LE(itemId);
  w.uint32LE(slot);
  w.uint32LE(count);
  w.uint8(0);
  return w.finish();
}

export function buildRepairAll(vendorGuid: bigint): Uint8Array {
  const w = new PacketWriter();
  w.uint64LE(vendorGuid);
  w.uint64LE(0n);
  w.uint8(0);
  return w.finish();
}

function readGood(r: PacketReader): VendorGood {
  return {
    slot: r.uint32LE(),
    itemId: r.uint32LE(),
    displayId: r.uint32LE(),
    stock: stockOf(r.uint32LE()),
    price: r.uint32LE(),
    maxDurability: r.uint32LE(),
    buyCount: r.uint32LE(),
    extendedCost: r.uint32LE(),
  };
}

export function parseListInventory(r: PacketReader): VendorInventory {
  const guid = r.uint64LE();
  const count = r.uint8();
  if (count === 0)
    return { guid, items: [], emptyReason: r.remaining > 0 ? r.uint8() : 0 };
  const items: VendorGood[] = [];
  for (let i = 0; i < count; i++) items.push(readGood(r));
  return { guid, items, emptyReason: undefined };
}

function optionalParam(r: PacketReader): number | undefined {
  return r.remaining > 1 ? r.uint32LE() : undefined;
}

export function parseSellItemFailure(r: PacketReader): SellItemFailure {
  const vendorGuid = r.uint64LE();
  const itemGuid = r.uint64LE();
  const param = optionalParam(r);
  return { vendorGuid, itemGuid, param, result: r.uint8() };
}

export function parseBuyItem(r: PacketReader): BuyItemResult {
  return {
    vendorGuid: r.uint64LE(),
    slot: r.uint32LE(),
    stock: stockOf(r.uint32LE()),
    count: r.uint32LE(),
  };
}

export function parseBuyFailed(r: PacketReader): BuyItemFailure {
  const vendorGuid = r.uint64LE();
  const itemId = r.uint32LE();
  const param = optionalParam(r);
  return { vendorGuid, itemId, param, result: r.uint8() };
}
