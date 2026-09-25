import { type EntityEvent, type EntityLookup, fieldOf } from "wow/entity-store";
import { type InventoryState, readInventory } from "wow/inventory";
import { readLife } from "wow/player-state";
import { ObjectType, UNIT_FIELDS } from "wow/protocol/entity-fields";
import {
  type InventoryChangeFailure,
  InventoryResult,
} from "wow/protocol/inventory";
import {
  buildAutostoreLootItem,
  buildLoot,
  buildLootRelease,
  type ItemPushResult,
  type LootItem,
  type LootMoneyNotify,
  type LootReleaseResponse,
  type LootRemoved,
  type LootResponse,
} from "wow/protocol/loot";
import { GameOpcode } from "wow/protocol/opcodes";

export type RewardsDeps = {
  send: (opcode: number, body?: Uint8Array) => void;
  now: () => number;
  selfGuid: () => bigint;
  getEntity: EntityLookup;
};

export type RewardsOpenLoot = {
  phase: "open" | "closing";
  guid: bigint;
  lootType: number;
  money: number;
  items: LootItem[];
  openedAt: number;
  invalidatedReason: string | undefined;
};
export type RewardsLoot =
  | { phase: "closed" }
  | {
      phase: "opening";
      guid: bigint;
      requestedAt: number;
      invalidatedReason: string | undefined;
    }
  | RewardsOpenLoot;

type RequestBase = { guid: bigint; status: "unanswered"; requestedAt: number };
export type RewardsRequest = RequestBase &
  (
    | { action: "open" }
    | { action: "take"; slot: number }
    | { action: "money" }
    | { action: "close" }
  );

export type RewardsInventoryError = {
  packet: Extract<InventoryChangeFailure, { kind: "error" }>;
  inventoryFull: boolean;
  bagFull: boolean;
  observedAt: number;
};
export type RewardsLootError = {
  guid: bigint;
  error: number;
  observedAt: number;
};
export type RewardsItemPush = ItemPushResult & { observedAt: number };
export type RewardsMoneyNotice = LootMoneyNotify & { observedAt: number };
export type RewardsRelease = LootReleaseResponse & { observedAt: number };

export type RewardsState = {
  loot: RewardsLoot;
  pending: RewardsRequest | undefined;
  inventory: InventoryState;
  lastLootError: RewardsLootError | undefined;
  lastInventoryError: RewardsInventoryError | undefined;
  lastItemPush: RewardsItemPush | undefined;
  lastMoneyNotice: RewardsMoneyNotice | undefined;
  lastRelease: RewardsRelease | undefined;
  disposed: boolean;
};

export type RewardsEvent = {
  type:
    | "loot_open_requested"
    | "loot_opened"
    | "loot_take_requested"
    | "loot_money_requested"
    | "loot_close_requested"
    | "loot_removed"
    | "loot_money_cleared"
    | "loot_release_observed"
    | "loot_error"
    | "inventory_error"
    | "inventory_result"
    | "item_push"
    | "money_notice"
    | "inventory_observed"
    | "loot_invalidated";
  at: number;
  state: RewardsState;
};

export const NOT_DEAD = "Loot source is not authoritatively dead";
export const NOT_LOOTABLE = "Creature has no observed lootable flag";

function holdsItem(inventory: InventoryState, guid: bigint): boolean {
  return inventory.slots.some(
    (slot) => slot.status === "occupied" && slot.guid === guid,
  );
}

function copyLoot(loot: RewardsLoot): RewardsLoot {
  if (loot.phase === "open" || loot.phase === "closing")
    return { ...loot, items: loot.items.map((item) => ({ ...item })) };
  return { ...loot };
}

function copyInventoryError(
  error: RewardsInventoryError | undefined,
): RewardsInventoryError | undefined {
  if (!error) return undefined;
  return {
    ...error,
    packet: { ...error.packet, detail: { ...error.packet.detail } },
  };
}

export class RewardsRuntime {
  private listener: ((event: RewardsEvent) => void) | undefined;
  private disposed = false;
  private selfUnavailable = false;
  private loot: RewardsLoot = { phase: "closed" };
  private pending: RewardsRequest | undefined;
  private lastLootError: RewardsLootError | undefined;
  private lastInventoryError: RewardsInventoryError | undefined;
  private lastItemPush: RewardsItemPush | undefined;
  private lastMoneyNotice: RewardsMoneyNotice | undefined;
  private lastRelease: RewardsRelease | undefined;
  private lastInventory: InventoryState | undefined;

  private readonly deps: RewardsDeps;

  constructor(deps: RewardsDeps) {
    this.deps = deps;
  }

  onEvent(callback: ((event: RewardsEvent) => void) | undefined): void {
    if (this.disposed) return;
    this.listener = callback;
    this.lastInventory = undefined;
  }

  snapshot(): RewardsState {
    return {
      loot: copyLoot(this.loot),
      pending: this.pending ? { ...this.pending } : undefined,
      inventory: this.inventory(),
      lastLootError: this.lastLootError ? { ...this.lastLootError } : undefined,
      lastInventoryError: copyInventoryError(this.lastInventoryError),
      lastItemPush: this.lastItemPush ? { ...this.lastItemPush } : undefined,
      lastMoneyNotice: this.lastMoneyNotice
        ? { ...this.lastMoneyNotice }
        : undefined,
      lastRelease: this.lastRelease ? { ...this.lastRelease } : undefined,
      disposed: this.disposed,
    };
  }

  open(guid: bigint): RewardsState {
    this.active();
    this.alive();
    if (this.loot.phase !== "closed")
      throw new Error("Previous loot window has not closed");
    const source = this.deps.getEntity(guid);
    if (source?.guid !== guid || source.objectType !== ObjectType.UNIT)
      throw new Error("Loot source is not an observed creature");
    const health = fieldOf(source, UNIT_FIELDS.HEALTH.offset);
    const flags = source.rawFields.get(UNIT_FIELDS.DYNAMIC_FLAGS.offset);
    if (health !== 0) throw new Error(NOT_DEAD);
    if (flags === undefined || !(flags & 1)) throw new Error(NOT_LOOTABLE);
    const requestedAt = this.deps.now();
    this.deps.send(GameOpcode.CMSG_LOOT, buildLoot(guid));
    this.loot = {
      phase: "opening",
      guid,
      requestedAt,
      invalidatedReason: undefined,
    };
    this.pending = { action: "open", guid, requestedAt, status: "unanswered" };
    return this.emit("loot_open_requested");
  }

  take(slot: number): RewardsState {
    const window = this.actionWindow();
    const item = window.items.find((offered) => offered.slot === slot);
    if (!item) throw new Error("Loot slot was not offered");
    if (item.slotType !== 0 && item.slotType !== 4)
      throw new Error("Loot slot is not available for direct pickup");
    const requestedAt = this.deps.now();
    this.deps.send(
      GameOpcode.CMSG_AUTOSTORE_LOOT_ITEM,
      buildAutostoreLootItem(slot),
    );
    this.pending = {
      action: "take",
      guid: window.guid,
      slot,
      requestedAt,
      status: "unanswered",
    };
    return this.emit("loot_take_requested");
  }

  takeMoney(): RewardsState {
    const window = this.actionWindow();
    if (window.money === 0) throw new Error("Loot window has no offered money");
    const requestedAt = this.deps.now();
    this.deps.send(GameOpcode.CMSG_LOOT_MONEY);
    this.pending = {
      action: "money",
      guid: window.guid,
      requestedAt,
      status: "unanswered",
    };
    return this.emit("loot_money_requested");
  }

  close(): RewardsState {
    this.active();
    if (this.loot.phase !== "open")
      throw new Error("No open loot window to close");
    const guid = this.loot.guid;
    const requestedAt = this.deps.now();
    this.deps.send(GameOpcode.CMSG_LOOT_RELEASE, buildLootRelease(guid));
    this.loot.phase = "closing";
    this.pending = { action: "close", guid, requestedAt, status: "unanswered" };
    return this.emit("loot_close_requested");
  }

  receiveLootResponse(response: LootResponse): void {
    if (this.disposed) return;
    if (this.loot.phase === "closed" || response.guid !== this.loot.guid)
      return;
    if (response.kind === "error") {
      this.lastLootError = {
        guid: response.guid,
        error: response.error,
        observedAt: this.deps.now(),
      };
      if (this.loot.phase === "opening") this.loot = { phase: "closed" };
      if (this.pending?.action !== "close") this.pending = undefined;
      this.emit("loot_error");
      return;
    }
    if (this.loot.phase !== "opening") return;
    this.loot = {
      phase: "open",
      guid: response.guid,
      lootType: response.lootType,
      money: response.money,
      items: response.items,
      openedAt: this.deps.now(),
      invalidatedReason: this.loot.invalidatedReason,
    };
    this.pending = undefined;
    this.emit("loot_opened");
  }

  receiveLootRemoved({ slot }: LootRemoved): void {
    if (this.disposed) return;
    if (this.loot.phase !== "open" && this.loot.phase !== "closing") return;
    const index = this.loot.items.findIndex((item) => item.slot === slot);
    if (index < 0) return;
    this.loot.items.splice(index, 1);
    if (this.pending?.action === "take" && this.pending.slot === slot)
      this.pending = undefined;
    this.emit("loot_removed");
  }

  receiveLootMoneyCleared(): void {
    if (this.disposed) return;
    if (this.loot.phase !== "open" && this.loot.phase !== "closing") return;
    this.loot.money = 0;
    if (this.pending?.action === "money") this.pending = undefined;
    this.emit("loot_money_cleared");
  }

  receiveLootRelease(response: LootReleaseResponse): void {
    if (this.disposed) return;
    if (this.loot.phase === "closed" || response.guid !== this.loot.guid)
      return;
    this.lastRelease = { ...response, observedAt: this.deps.now() };
    if (response.status === 1 && this.loot.phase !== "opening") {
      this.loot = { phase: "closed" };
      this.pending = undefined;
    }
    this.emit("loot_release_observed");
  }

  receiveMoneyNotice(notice: LootMoneyNotify): void {
    if (this.disposed) return;
    if (!this.deps.selfGuid()) return;
    this.lastMoneyNotice = { ...notice, observedAt: this.deps.now() };
    this.emit("money_notice");
  }

  receiveItemPush(push: ItemPushResult): void {
    if (this.disposed) return;
    const selfGuid = this.deps.selfGuid();
    if (!selfGuid || push.guid !== selfGuid) return;
    this.lastItemPush = { ...push, observedAt: this.deps.now() };
    this.emit("item_push");
  }

  receiveInventoryFailure(packet: InventoryChangeFailure): void {
    if (this.disposed) return;
    if (packet.kind === "ok") {
      this.lastInventoryError = undefined;
      this.emit("inventory_result");
      return;
    }
    this.lastInventoryError = {
      packet,
      inventoryFull: packet.result === InventoryResult.INVENTORY_FULL,
      bagFull:
        packet.result === InventoryResult.BAG_FULL ||
        packet.result === InventoryResult.BAG_FULL3,
      observedAt: this.deps.now(),
    };
    this.emit("inventory_error");
  }

  observeEntity(event: EntityEvent): void {
    if (this.disposed) return;
    const guid = event.type === "disappear" ? event.guid : event.entity.guid;
    if (guid === this.deps.selfGuid()) this.observeSelf(event, guid);
    if (
      event.type === "disappear" &&
      this.loot.phase !== "closed" &&
      guid === this.loot.guid
    )
      this.invalidate("loot_source_unavailable");
    if (!this.listener) return;
    this.observeInventory(guid);
  }

  private observeSelf(event: EntityEvent, guid: bigint): void {
    if (event.type === "disappear") this.selfUnavailable = true;
    else if (event.type === "appear") this.selfUnavailable = false;
    if (
      this.selfUnavailable ||
      readLife(guid, this.deps.getEntity).life !== "alive"
    )
      this.invalidate("self_unavailable");
  }

  private observeInventory(guid: bigint): void {
    const previous = this.lastInventory;
    if (guid !== this.deps.selfGuid() && previous && !holdsItem(previous, guid))
      return;
    const inventory = this.inventory();
    this.lastInventory = inventory;
    if (guid !== this.deps.selfGuid() && !holdsItem(inventory, guid)) return;
    if (previous && Bun.deepEquals(inventory, previous, true)) return;
    this.emit("inventory_observed");
  }

  dispose(): void {
    this.disposed = true;
    this.listener = undefined;
    this.selfUnavailable = true;
    this.loot = { phase: "closed" };
    this.pending = undefined;
    this.lastLootError = undefined;
    this.lastInventoryError = undefined;
    this.lastItemPush = undefined;
    this.lastMoneyNotice = undefined;
    this.lastRelease = undefined;
    this.lastInventory = undefined;
  }

  private active(): void {
    if (this.disposed) throw new Error("Rewards runtime disposed");
    if (!this.deps.selfGuid())
      throw new Error("Authenticated player GUID is unknown");
  }

  private alive(): void {
    if (
      this.selfUnavailable ||
      readLife(this.deps.selfGuid(), this.deps.getEntity).life !== "alive"
    )
      throw new Error("Loot action requires authoritative alive state");
  }

  private actionWindow(): RewardsOpenLoot {
    this.active();
    this.alive();
    if (this.loot.phase !== "open")
      throw new Error("No open server-observed loot window");
    if (this.loot.invalidatedReason)
      throw new Error(`Loot window is invalid: ${this.loot.invalidatedReason}`);
    if (this.pending)
      throw new Error("Previous loot request remains unanswered");
    return this.loot;
  }

  private inventory(): InventoryState {
    const selfGuid = this.deps.selfGuid();
    if (this.selfUnavailable || this.disposed)
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
    return readInventory(selfGuid, this.deps.getEntity);
  }

  private invalidate(reason: string): void {
    if (this.loot.phase === "closed" || this.loot.invalidatedReason) return;
    this.loot.invalidatedReason = reason;
    this.emit("loot_invalidated");
  }

  private emit(type: RewardsEvent["type"]): RewardsState {
    const state = this.snapshot();
    this.listener?.({ type, at: this.deps.now(), state });
    return state;
  }
}
