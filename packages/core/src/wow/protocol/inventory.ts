import { type PacketReader, PacketWriter } from "#wow/protocol/packet";

export const InventoryResult = {
  OK: 0,
  CANT_EQUIP_LEVEL: 1,
  BAG_FULL: 4,
  INVENTORY_FULL: 50,
  BAG_FULL3: 53,
  BIND_CONFIRM: 81,
  MAX_LIMIT_COUNT: 84,
  MAX_LIMIT_SOCKETED: 85,
  PURCHASE_LEVEL_TOO_LOW: 87,
  MAX_LIMIT_EQUIPPED: 89,
} as const;

export type InventoryFailureDetail =
  | { kind: "none" }
  | { kind: "level"; requiredLevel: number }
  | { kind: "binding"; itemGuid: bigint; slot: number; containerGuid: bigint }
  | { kind: "limit"; category: number };

export type InventoryChangeFailure =
  | { kind: "ok"; result: 0 }
  | {
      kind: "error";
      result: number;
      item1: bigint;
      item2: bigint;
      bagType: number;
      detail: InventoryFailureDetail;
    };

export function parseInventoryChangeFailure(
  r: PacketReader,
): InventoryChangeFailure {
  const result = r.uint8();
  if (result === InventoryResult.OK) return { kind: "ok", result };
  const item1 = r.uint64LE();
  const item2 = r.uint64LE();
  const bagType = r.uint8();
  const detail = inventoryFailureDetail(r, result);
  return { kind: "error", result, item1, item2, bagType, detail };
}

function inventoryFailureDetail(
  r: PacketReader,
  result: number,
): InventoryFailureDetail {
  switch (result) {
    case InventoryResult.CANT_EQUIP_LEVEL:
    case InventoryResult.PURCHASE_LEVEL_TOO_LOW:
      return { kind: "level", requiredLevel: r.uint32LE() };
    case InventoryResult.BIND_CONFIRM:
      return {
        kind: "binding",
        itemGuid: r.uint64LE(),
        slot: r.uint32LE(),
        containerGuid: r.uint64LE(),
      };
    case InventoryResult.MAX_LIMIT_COUNT:
    case InventoryResult.MAX_LIMIT_SOCKETED:
    case InventoryResult.MAX_LIMIT_EQUIPPED:
      return { kind: "limit", category: r.uint32LE() };
    default:
      return { kind: "none" };
  }
}

const RESULT_NAMES: Record<number, string> = {
  0: "ok",
  1: "cant_equip_level_i",
  2: "cant_equip_skill",
  3: "item_doesnt_go_to_slot",
  4: "bag_full",
  5: "nonempty_bag_over_other_bag",
  6: "cant_trade_equip_bags",
  7: "only_ammo_can_go_here",
  8: "no_required_proficiency",
  9: "no_equipment_slot_available",
  10: "you_can_never_use_that_item",
  11: "you_can_never_use_that_item2",
  12: "no_equipment_slot_available2",
  13: "cant_equip_with_twohanded",
  14: "cant_dual_wield",
  15: "item_doesnt_go_into_bag",
  16: "item_doesnt_go_into_bag2",
  17: "cant_carry_more_of_this",
  18: "no_equipment_slot_available3",
  19: "item_cant_stack",
  20: "item_cant_be_equipped",
  21: "items_cant_be_swapped",
  22: "slot_is_empty",
  23: "item_not_found",
  24: "cant_drop_soulbound",
  25: "out_of_range",
  26: "tried_to_split_more_than_count",
  27: "couldnt_split_items",
  28: "missing_reagent",
  29: "not_enough_money",
  30: "not_a_bag",
  31: "can_only_do_with_empty_bags",
  32: "dont_own_that_item",
  33: "can_equip_only1_quiver",
  34: "must_purchase_that_bag_slot",
  35: "too_far_away_from_bank",
  36: "item_locked",
  37: "you_are_stunned",
  38: "you_are_dead",
  39: "cant_do_right_now",
  40: "int_bag_error",
  41: "can_equip_only1_bolt",
  42: "can_equip_only1_ammopouch",
  43: "stackable_cant_be_wrapped",
  44: "equipped_cant_be_wrapped",
  45: "wrapped_cant_be_wrapped",
  46: "bound_cant_be_wrapped",
  47: "unique_cant_be_wrapped",
  48: "bags_cant_be_wrapped",
  49: "already_looted",
  50: "inventory_full",
  51: "bank_full",
  52: "item_is_currently_sold_out",
  53: "bag_full3",
  54: "item_not_found2",
  55: "item_cant_stack2",
  56: "bag_full4",
  57: "item_sold_out",
  58: "object_is_busy",
  59: "none",
  60: "not_in_combat",
  61: "not_while_disarmed",
  62: "bag_full6",
  63: "cant_equip_rank",
  64: "cant_equip_reputation",
  65: "too_many_special_bags",
  66: "loot_cant_loot_that_now",
  67: "item_unique_equipable",
  68: "vendor_missing_turnins",
  69: "not_enough_honor_points",
  70: "not_enough_arena_points",
  71: "item_max_count_socketed",
  72: "mail_bound_item",
  73: "no_split_while_prospecting",
  75: "item_max_count_equipped_socketed",
  76: "item_unique_equippable_socketed",
  77: "too_much_gold",
  78: "not_during_arena_match",
  79: "cannot_trade_that",
  80: "personal_arena_rating_too_low",
  81: "event_autoequip_bind_confirm",
  82: "artefacts_only_for_own_characters",
  84: "item_max_limit_category_count_exceeded",
  85: "item_max_limit_category_socketed_exceeded",
  86: "scaling_stat_item_level_exceeded",
  87: "purchase_level_too_low",
  88: "cant_equip_need_talent",
  89: "item_max_limit_category_equipped_exceeded",
};

export function inventoryResultName(result: number): string {
  return RESULT_NAMES[result] ?? `inventory_result_${result}`;
}

export function buildDestroyItem(
  bag: number,
  slot: number,
  count: number,
): Uint8Array {
  const w = new PacketWriter();
  w.uint8(bag);
  w.uint8(slot);
  w.uint8(count);
  w.uint8(0);
  w.uint8(0);
  w.uint8(0);
  return w.finish();
}
