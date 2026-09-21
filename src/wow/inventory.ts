import type { Entity } from "wow/entity-store";
import { readSelfField, type EntityLookup } from "wow/player-state";
import {
  CONTAINER_FIELDS,
  ITEM_FIELDS,
  OBJECT_FIELDS,
  ObjectType,
  PLAYER_FIELDS,
} from "wow/protocol/entity-fields";

export type InventoryItem = {
  guid: bigint;
  entry: number | undefined;
  owner: bigint | undefined;
  contained: bigint | undefined;
  count: number | undefined;
  flags: number | undefined;
  randomPropertyId: number | undefined;
  durability: number | undefined;
  maxDurability: number | undefined;
};

export type InventoryRegion =
  | "equipment"
  | "bag"
  | "backpack"
  | "keyring"
  | "currency"
  | "bag_item";
export type InventoryAddress = {
  bag: number;
  slot: number;
  region: InventoryRegion;
};
export type InventorySlot = InventoryAddress &
  (
    | { status: "unknown" }
    | { status: "empty" }
    | { status: "occupied"; guid: bigint; item: InventoryItem }
  );
export type InventoryBag = {
  slot: number;
  guid: bigint | undefined;
  status: "unknown" | "empty" | "known";
  size: number | undefined;
};
export type InventoryIssue = {
  code:
    | "owner_mismatch"
    | "contained_mismatch"
    | "duplicate_guid"
    | "invalid_item_type"
    | "invalid_bag_type"
    | "invalid_bag_size";
  bag: number;
  slot: number;
  guid: bigint;
};
export type InventoryState = {
  selfGuid: bigint;
  scope: "carried";
  status: "unknown" | "partial" | "complete";
  coinage: number | undefined;
  slots: InventorySlot[];
  bags: InventoryBag[];
  freeSlots: number | undefined;
  issues: InventoryIssue[];
};

type ReadContext = {
  selfGuid: bigint;
  getEntity: EntityLookup;
  issues: InventoryIssue[];
  seen: Set<bigint>;
};

const ROOTS = [
  {
    first: 0,
    count: 19,
    offset: PLAYER_FIELDS.INV_SLOT_HEAD.offset,
    region: "equipment",
  },
  {
    first: 19,
    count: 4,
    offset: PLAYER_FIELDS.INV_SLOT_HEAD.offset + 38,
    region: "bag",
  },
  {
    first: 23,
    count: 16,
    offset: PLAYER_FIELDS.PACK_SLOT_1.offset,
    region: "backpack",
  },
  {
    first: 86,
    count: 32,
    offset: PLAYER_FIELDS.KEYRING_SLOT_1.offset,
    region: "keyring",
  },
  {
    first: 118,
    count: 32,
    offset: PLAYER_FIELDS.CURRENCYTOKEN_SLOT_1.offset,
    region: "currency",
  },
] as const;

function word(entity: Entity | undefined, offset: number): number | undefined {
  if (!entity) return undefined;
  const value = entity.rawFields.get(offset);
  if (value !== undefined) return value >>> 0;
  return entity.createComplete ? 0 : undefined;
}

function guid(
  low: number | undefined,
  high: number | undefined,
): bigint | undefined {
  if (low === undefined || high === undefined) return undefined;
  return BigInt(low) | (BigInt(high) << 32n);
}

function itemGuid(entity: Entity, offset: number): bigint | undefined {
  return guid(word(entity, offset), word(entity, offset + 1));
}

function issue(
  context: ReadContext,
  address: InventoryAddress,
  guid: bigint,
  code: InventoryIssue["code"],
): void {
  context.issues.push({ code, bag: address.bag, slot: address.slot, guid });
}

function readItem(
  context: ReadContext,
  address: InventoryAddress,
  itemId: bigint,
  parent: bigint,
): InventoryItem {
  let entity = context.getEntity(itemId);
  if (
    entity &&
    (entity.guid !== itemId ||
      (entity.objectType !== ObjectType.ITEM &&
        entity.objectType !== ObjectType.CONTAINER))
  ) {
    issue(context, address, itemId, "invalid_item_type");
    entity = undefined;
  }
  const owner = entity ? itemGuid(entity, ITEM_FIELDS.OWNER.offset) : undefined;
  const contained = entity
    ? itemGuid(entity, ITEM_FIELDS.CONTAINED.offset)
    : undefined;
  if (owner !== undefined && owner !== context.selfGuid)
    issue(context, address, itemId, "owner_mismatch");
  if (contained !== undefined && contained !== parent)
    issue(context, address, itemId, "contained_mismatch");
  const owned = owner === context.selfGuid && contained === parent;
  const property = word(entity, ITEM_FIELDS.RANDOM_PROPERTIES_ID.offset);
  return {
    guid: itemId,
    owner,
    contained,
    entry: word(entity, OBJECT_FIELDS.ENTRY.offset),
    count: owned ? word(entity, ITEM_FIELDS.STACK_COUNT.offset) : undefined,
    flags: word(entity, ITEM_FIELDS.FLAGS.offset),
    randomPropertyId: property === undefined ? undefined : property | 0,
    durability: owned ? word(entity, ITEM_FIELDS.DURABILITY.offset) : undefined,
    maxDurability: owned
      ? word(entity, ITEM_FIELDS.MAXDURABILITY.offset)
      : undefined,
  };
}

function slot(
  context: ReadContext,
  address: InventoryAddress,
  itemGuid: bigint | undefined,
  parent: bigint,
): InventorySlot {
  if (itemGuid === undefined) return { ...address, status: "unknown" };
  if (itemGuid === 0n) return { ...address, status: "empty" };
  if (context.seen.has(itemGuid))
    issue(context, address, itemGuid, "duplicate_guid");
  context.seen.add(itemGuid);
  return {
    ...address,
    status: "occupied",
    guid: itemGuid,
    item: readItem(context, address, itemGuid, parent),
  };
}

function roots(context: ReadContext, self: Entity): InventorySlot[] {
  const result: InventorySlot[] = [];
  for (const range of ROOTS) {
    for (let i = 0; i < range.count; i++) {
      const offset = range.offset + i * 2;
      const itemGuid = guid(
        readSelfField(context.selfGuid, self, offset),
        readSelfField(context.selfGuid, self, offset + 1),
      );
      result.push(
        slot(
          context,
          { bag: 255, slot: range.first + i, region: range.region },
          itemGuid,
          context.selfGuid,
        ),
      );
    }
  }
  return result;
}

function bag(
  context: ReadContext,
  root: InventorySlot,
  slots: InventorySlot[],
): InventoryBag {
  if (root.status === "empty")
    return { slot: root.slot, guid: 0n, status: "empty", size: 0 };
  const result: InventoryBag = {
    slot: root.slot,
    guid: root.status === "occupied" ? root.guid : undefined,
    status: "unknown",
    size: undefined,
  };
  if (root.status !== "occupied") return result;
  if (
    context.issues.some(
      (issue) => issue.code === "duplicate_guid" && issue.guid === root.guid,
    )
  )
    return result;
  const entity = context.getEntity(root.guid);
  if (
    !entity ||
    root.item.owner !== context.selfGuid ||
    root.item.contained !== context.selfGuid
  )
    return result;
  if (entity.guid !== root.guid || entity.objectType !== ObjectType.CONTAINER) {
    issue(context, root, root.guid, "invalid_bag_type");
    return result;
  }
  const size = word(entity, CONTAINER_FIELDS.NUM_SLOTS.offset);
  if (size === undefined) return result;
  if (size > CONTAINER_FIELDS.SLOT_1.size / 2) {
    issue(context, root, root.guid, "invalid_bag_size");
    return result;
  }
  result.status = "known";
  result.size = size;
  for (let i = 0; i < size; i++) {
    const child = itemGuid(entity, CONTAINER_FIELDS.SLOT_1.offset + i * 2);
    slots.push(
      slot(
        context,
        { bag: root.slot, slot: i, region: "bag_item" },
        child,
        root.guid,
      ),
    );
  }
  return result;
}

function complete(slot: InventorySlot): boolean {
  if (slot.status === "unknown") return false;
  if (slot.status === "empty") return true;
  const item = slot.item;
  return (
    item.entry !== undefined &&
    item.owner !== undefined &&
    item.contained !== undefined &&
    item.count !== undefined &&
    item.flags !== undefined &&
    item.randomPropertyId !== undefined &&
    item.durability !== undefined &&
    item.maxDurability !== undefined
  );
}

function freeSlots(
  slots: InventorySlot[],
  bags: InventoryBag[],
  issues: InventoryIssue[],
): number | undefined {
  if (issues.some((issue) => issue.code === "duplicate_guid")) return undefined;
  if (bags.some((bag) => bag.size === undefined)) return undefined;
  let count = 0;
  for (const slot of slots) {
    if (slot.region !== "backpack" && slot.region !== "bag_item") continue;
    if (slot.status === "unknown") return undefined;
    if (slot.status === "empty") count++;
  }
  return count;
}

export function readInventory(
  selfGuid: bigint,
  getEntity: EntityLookup,
): InventoryState {
  const self = getEntity(selfGuid);
  if (
    !selfGuid ||
    self?.guid !== selfGuid ||
    self.objectType !== ObjectType.PLAYER
  )
    return {
      selfGuid,
      scope: "carried",
      status: "unknown",
      coinage: undefined,
      slots: [],
      bags: [],
      freeSlots: undefined,
      issues: [],
    };
  const context: ReadContext = {
    selfGuid,
    getEntity,
    issues: [],
    seen: new Set(),
  };
  const slots = roots(context, self);
  const bags: InventoryBag[] = [];
  for (const root of slots.filter((slot) => slot.region === "bag"))
    bags.push(bag(context, root, slots));
  const coinage = readSelfField(selfGuid, self, PLAYER_FIELDS.COINAGE.offset);
  const known =
    coinage !== undefined &&
    context.issues.length === 0 &&
    slots.every(complete) &&
    bags.every((bag) => bag.size !== undefined);
  return {
    selfGuid,
    scope: "carried",
    status: known ? "complete" : "partial",
    coinage,
    slots,
    bags,
    freeSlots: freeSlots(slots, bags, context.issues),
    issues: context.issues,
  };
}
