import { Emitter, type Unsubscribe } from "lib/emitter";
import { type EntityEvent, type EntityLookup, isUnit } from "wow/entity-store";
import {
  type InventorySlot,
  type InventoryState,
  readInventory,
} from "wow/inventory";
import { readLife } from "wow/player-state";
import {
  type InventoryChangeFailure,
  InventoryResult,
} from "wow/protocol/inventory";
import { GameOpcode } from "wow/protocol/opcodes";
import {
  type BuyItemFailure,
  type BuyItemResult,
  buildBuyItem,
  buildListInventory,
  buildRepairAll,
  buildSellItem,
  buyResultName,
  type SellItemFailure,
  sellResultName,
  type VendorGood,
  type VendorInventory,
} from "wow/protocol/vendor";

export type VendorDeps = {
  send: (opcode: number, body?: Uint8Array) => void;
  now: () => number;
  selfGuid: () => bigint;
  getEntity: EntityLookup;
};

export const VENDOR_ANSWER_MS = 5000;
const NPC_FLAG_VENDOR = 0x80;
const NPC_FLAG_REPAIR = 0x10_00;

export type VendorWindow = {
  guid: bigint;
  items: VendorGood[];
  emptyReason: number | undefined;
  openedAt: number;
  invalidatedReason: string | undefined;
};

type RequestBase = {
  guid: bigint;
  requestedAt: number;
  coinageBefore: number | undefined;
};
export type RepairTarget = {
  bag: number;
  slot: number;
  guid: bigint;
  durability: number;
  maxDurability: number;
};
export type VendorRequest = RequestBase &
  (
    | { action: "list" }
    | {
        action: "sell";
        itemGuid: bigint;
        bag: number;
        slot: number;
        itemId: number | undefined;
        count: number;
        stackBefore: number;
      }
    | {
        action: "buy";
        slot: number;
        itemId: number;
        count: number;
        price: number;
        answer: BuyItemResult | undefined;
      }
    | { action: "repair"; damaged: RepairTarget[] }
  );

export type VendorOutcome = {
  action: VendorRequest["action"];
  status: "confirmed" | "refused" | "partial" | "unanswered";
  reason: string | undefined;
  request: VendorRequest;
  coinageAfter: number | undefined;
  moneyDelta: number | undefined;
  observedAt: number;
};

export type VendorState = {
  window: VendorWindow | undefined;
  pending: VendorRequest | undefined;
  lastOutcome: VendorOutcome | undefined;
  coinage: number | undefined;
  disposed: boolean;
};

type Settled = "listed" | "sold" | "bought" | "repaired";
export type VendorEvent = {
  type:
    | `${VendorRequest["action"]}_requested`
    | Settled
    | "refused"
    | "partial"
    | "unanswered"
    | "invalidated";
  at: number;
  state: VendorState;
};

type Occupied = Extract<InventorySlot, { status: "occupied" }>;

function occupied(inventory: InventoryState, bag: number, slot: number) {
  return inventory.slots.find(
    (candidate): candidate is Occupied =>
      candidate.status === "occupied" &&
      candidate.bag === bag &&
      candidate.slot === slot,
  );
}

function damagedItems(inventory: InventoryState): RepairTarget[] {
  return inventory.slots.flatMap((slot) => {
    if (slot.status !== "occupied") return [];
    const { durability, maxDurability } = slot.item;
    if (!maxDurability || durability === undefined) return [];
    if (durability >= maxDurability) return [];
    const { bag, guid } = slot;
    return [{ bag, slot: slot.slot, guid, durability, maxDurability }];
  });
}

function inventoryReason(result: number): string {
  if (result === InventoryResult.INVENTORY_FULL) return "inventory_full";
  if (
    result === InventoryResult.BAG_FULL ||
    result === InventoryResult.BAG_FULL3
  )
    return "bag_full";
  return `inventory_result_${result}`;
}

function stillDamaged(
  inventory: InventoryState,
  damaged: RepairTarget[],
): RepairTarget[] {
  return damaged.filter((target) => {
    const held = occupied(inventory, target.bag, target.slot);
    if (held?.guid !== target.guid) return false;
    const { durability, maxDurability } = held.item;
    return durability === undefined || durability < (maxDurability ?? 0);
  });
}

function stackLeft(
  inventory: InventoryState,
  bag: number,
  slot: number,
  itemGuid: bigint,
): number {
  const held = occupied(inventory, bag, slot);
  return held?.guid === itemGuid ? (held.item.count ?? 1) : 0;
}

function settledBy(
  pending: VendorRequest,
  inventory: InventoryState,
): Settled | undefined {
  const { coinage } = inventory;
  const before = pending.coinageBefore;
  const delta =
    coinage === undefined || before === undefined ? 0 : coinage - before;
  switch (pending.action) {
    case "sell": {
      const { bag, slot, itemGuid, stackBefore, count } = pending;
      const left = stackLeft(inventory, bag, slot, itemGuid);
      return left === stackBefore - count && delta > 0 ? "sold" : undefined;
    }
    case "buy":
      return pending.answer && (pending.price === 0 || delta < 0)
        ? "bought"
        : undefined;
    case "repair": {
      const fixed = stillDamaged(inventory, pending.damaged).length === 0;
      return fixed && delta < 0 ? "repaired" : undefined;
    }
    default:
      return;
  }
}

export class VendorRuntime {
  private readonly events = new Emitter<[VendorEvent]>();
  private readonly deps: VendorDeps;
  private disposed = false;
  private window: VendorWindow | undefined;
  private pending: VendorRequest | undefined;
  private lastOutcome: VendorOutcome | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(deps: VendorDeps) {
    this.deps = deps;
  }

  onEvent(listener: (event: VendorEvent) => void): Unsubscribe {
    if (this.disposed) return () => undefined;
    return this.events.subscribe(listener);
  }

  snapshot(): VendorState {
    return {
      window: this.window
        ? { ...this.window, items: this.window.items.map((i) => ({ ...i })) }
        : undefined,
      pending: this.pending ? { ...this.pending } : undefined,
      lastOutcome: this.lastOutcome ? { ...this.lastOutcome } : undefined,
      coinage: this.inventory().coinage,
      disposed: this.disposed,
    };
  }

  list(guid: bigint): VendorState {
    this.ready();
    const vendor = this.deps.getEntity(guid);
    if (!(isUnit(vendor) && vendor.npcFlags & NPC_FLAG_VENDOR))
      throw new Error("Creature is not an observed vendor");
    this.deps.send(GameOpcode.CMSG_LIST_INVENTORY, buildListInventory(guid));
    return this.request({ action: "list", ...this.base(guid) });
  }

  sell(bag: number, slot: number, count?: number): VendorState {
    const window = this.openWindow();
    const inventory = this.inventory();
    const held = occupied(inventory, bag, slot);
    if (!held || (held.region !== "backpack" && held.region !== "bag_item"))
      throw new Error(`No carried bag item at bag ${bag} slot ${slot}`);
    const stackBefore = held.item.count ?? 1;
    const sold = count ?? stackBefore;
    if (sold > stackBefore) throw new Error("Sell count exceeds the stack");
    this.deps.send(
      GameOpcode.CMSG_SELL_ITEM,
      buildSellItem(window.guid, held.guid, sold),
    );
    return this.request({
      action: "sell",
      ...this.base(window.guid),
      itemGuid: held.guid,
      bag,
      slot,
      itemId: held.item.entry,
      count: sold,
      stackBefore,
    });
  }

  buy(slot: number, count = 1): VendorState {
    const window = this.openWindow();
    const good = window.items.find((offered) => offered.slot === slot);
    if (!good) throw new Error("Vendor slot was not offered");
    this.deps.send(
      GameOpcode.CMSG_BUY_ITEM,
      buildBuyItem(window.guid, good.itemId, slot, count),
    );
    return this.request({
      action: "buy",
      ...this.base(window.guid),
      slot,
      itemId: good.itemId,
      count,
      price: good.price * count,
      answer: undefined,
    });
  }

  repair(): VendorState {
    const window = this.openWindow();
    const vendor = this.deps.getEntity(window.guid);
    if (!(isUnit(vendor) && vendor.npcFlags & NPC_FLAG_REPAIR))
      throw new Error("Vendor does not repair");
    const damaged = damagedItems(this.inventory());
    if (damaged.length === 0) throw new Error("Nothing needs repair");
    this.deps.send(GameOpcode.CMSG_REPAIR_ITEM, buildRepairAll(window.guid));
    return this.request({
      action: "repair",
      ...this.base(window.guid),
      damaged,
    });
  }

  receiveInventory({ guid, items, emptyReason }: VendorInventory): void {
    if (this.disposed) return;
    const at = this.deps.now();
    this.window = {
      guid,
      items,
      emptyReason,
      openedAt: at,
      invalidatedReason: undefined,
    };
    if (this.pending?.action === "list" && this.pending.guid === guid)
      this.settle("confirmed", undefined, "listed");
    else this.emit("listed");
  }

  receiveSellFailure({ itemGuid, result }: SellItemFailure): void {
    const pending = this.pending;
    if (this.disposed || !pending) return;
    const own = pending.action === "sell" && pending.itemGuid === itemGuid;
    if (own || (itemGuid === 0n && pending.action !== "buy"))
      this.settle("refused", sellResultName(result), "refused");
  }

  receiveBuyItem(answer: BuyItemResult): void {
    const pending = this.pending;
    if (this.disposed || pending?.action !== "buy") return;
    if (answer.vendorGuid !== pending.guid || answer.slot !== pending.slot)
      return;
    pending.answer = answer;
    const good = this.window?.items.find((item) => item.slot === answer.slot);
    if (good) good.stock = answer.stock;
    this.check();
  }

  receiveBuyFailure({ itemId, result }: BuyItemFailure): void {
    const pending = this.pending;
    if (this.disposed || pending?.action !== "buy") return;
    if (itemId === 0 || itemId === pending.itemId)
      this.settle("refused", buyResultName(result), "refused");
  }

  receiveInventoryFailure(packet: InventoryChangeFailure): void {
    if (this.disposed || this.pending?.action !== "buy") return;
    if (packet.kind === "error")
      this.settle("refused", inventoryReason(packet.result), "refused");
  }

  observeEntity(event: EntityEvent): void {
    if (this.disposed) return;
    const window = this.window;
    if (
      event.type === "disappear" &&
      window?.guid === event.guid &&
      !window.invalidatedReason
    ) {
      window.invalidatedReason = "vendor_unavailable";
      this.emit("invalidated");
    }
    if (this.pending) this.check();
  }

  dispose(): void {
    this.disposed = true;
    clearTimeout(this.timer);
    this.events.clear();
    this.window = undefined;
    this.pending = undefined;
    this.lastOutcome = undefined;
  }

  private check(): void {
    const pending = this.pending;
    if (!pending) return;
    const settled = settledBy(pending, this.inventory());
    if (settled) this.settle("confirmed", undefined, settled);
  }

  private expire(): void {
    const pending = this.pending;
    if (!pending) return;
    if (pending.action !== "repair") {
      this.settle("unanswered", "server_unanswered", "unanswered");
      return;
    }
    const left = stillDamaged(this.inventory(), pending.damaged);
    if (left.length < pending.damaged.length)
      this.settle("partial", "not_repaired", "partial");
    else this.settle("unanswered", "not_repaired", "unanswered");
  }

  private settle(
    status: VendorOutcome["status"],
    reason: string | undefined,
    type: VendorEvent["type"],
  ): void {
    const request = this.pending;
    if (!request) return;
    clearTimeout(this.timer);
    this.timer = undefined;
    const coinageAfter = this.inventory().coinage;
    const before = request.coinageBefore;
    this.lastOutcome = {
      action: request.action,
      status,
      reason,
      request,
      coinageAfter,
      moneyDelta:
        coinageAfter === undefined || before === undefined
          ? undefined
          : coinageAfter - before,
      observedAt: this.deps.now(),
    };
    this.pending = undefined;
    this.emit(type);
  }

  private request(request: VendorRequest): VendorState {
    this.pending = request;
    this.timer = setTimeout(() => this.expire(), VENDOR_ANSWER_MS);
    return this.emit(`${request.action}_requested`);
  }

  private base(guid: bigint): RequestBase {
    return {
      guid,
      requestedAt: this.deps.now(),
      coinageBefore: this.inventory().coinage,
    };
  }

  private ready(): void {
    if (this.disposed) throw new Error("Vendor runtime disposed");
    const self = this.deps.selfGuid();
    if (!self) throw new Error("Authenticated player GUID is unknown");
    if (readLife(self, this.deps.getEntity).life !== "alive")
      throw new Error("Vendor action requires authoritative alive state");
    if (this.pending)
      throw new Error("Previous vendor request remains unanswered");
  }

  private openWindow(): VendorWindow {
    this.ready();
    if (!this.window) throw new Error("No listed vendor");
    if (this.window.invalidatedReason)
      throw new Error(
        `Vendor is unavailable: ${this.window.invalidatedReason}`,
      );
    return this.window;
  }

  private inventory(): InventoryState {
    return readInventory(this.deps.selfGuid(), this.deps.getEntity);
  }

  private emit(type: VendorEvent["type"]): VendorState {
    const state = this.snapshot();
    this.events.emit({ type, at: this.deps.now(), state });
    return state;
  }
}
