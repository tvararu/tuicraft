import type { EntityEvent } from "wow/entity-store";
import { readInventory, type InventoryState } from "wow/inventory";
import { readLife, type EntityLookup } from "wow/player-state";
import { ObjectType, UNIT_FIELDS } from "wow/protocol/entity-fields";
import { GameOpcode } from "wow/protocol/opcodes";
import type { PacketReader } from "wow/protocol/packet";
import {
  buildAutostoreLootItem,
  buildLoot,
  buildLootRelease,
  InventoryResult,
  parseInventoryChangeFailure,
  parseItemPushResult,
  parseLootMoneyNotify,
  parseLootReleaseResponse,
  parseLootRemoved,
  parseLootResponse,
  type InventoryChangeFailure,
  type ItemPushResult,
  type LootItem,
  type LootMoneyNotify,
  type LootReleaseResponse,
} from "wow/protocol/loot";

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

export const REWARDS_OPCODES = [
  GameOpcode.SMSG_LOOT_RESPONSE,
  GameOpcode.SMSG_LOOT_REMOVED,
  GameOpcode.SMSG_LOOT_RELEASE_RESPONSE,
  GameOpcode.SMSG_LOOT_MONEY_NOTIFY,
  GameOpcode.SMSG_LOOT_CLEAR_MONEY,
  GameOpcode.SMSG_ITEM_PUSH_RESULT,
  GameOpcode.SMSG_INVENTORY_CHANGE_FAILURE,
] as const;

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

  constructor(private deps: RewardsDeps) {}

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
    const health =
      source.rawFields.get(UNIT_FIELDS.HEALTH.offset) ??
      (source.createComplete ? 0 : undefined);
    const flags = source.rawFields.get(UNIT_FIELDS.DYNAMIC_FLAGS.offset);
    if (health !== 0)
      throw new Error("Loot source is not authoritatively dead");
    if (flags === undefined || !(flags & 1))
      throw new Error("Creature has no observed lootable flag");
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
    const item = window.items.find((item) => item.slot === slot);
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

  handleLootResponse(reader: PacketReader): void {
    if (this.disposed) return;
    const response = parseLootResponse(reader);
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

  handleLootRemoved(reader: PacketReader): void {
    if (this.disposed) return;
    const { slot } = parseLootRemoved(reader);
    if (this.loot.phase !== "open" && this.loot.phase !== "closing") return;
    const index = this.loot.items.findIndex((item) => item.slot === slot);
    if (index < 0) return;
    this.loot.items.splice(index, 1);
    if (this.pending?.action === "take" && this.pending.slot === slot)
      this.pending = undefined;
    this.emit("loot_removed");
  }

  handleLootClearMoney(reader: PacketReader): void {
    if (this.disposed) return;
    if (reader.remaining !== 0)
      throw new RangeError("Loot money-clear payload must be empty");
    if (this.loot.phase !== "open" && this.loot.phase !== "closing") return;
    this.loot.money = 0;
    if (this.pending?.action === "money") this.pending = undefined;
    this.emit("loot_money_cleared");
  }

  handleLootReleaseResponse(reader: PacketReader): void {
    if (this.disposed) return;
    const response = parseLootReleaseResponse(reader);
    if (this.loot.phase === "closed" || response.guid !== this.loot.guid)
      return;
    this.lastRelease = { ...response, observedAt: this.deps.now() };
    if (response.status === 1 && this.loot.phase !== "opening") {
      this.loot = { phase: "closed" };
      this.pending = undefined;
    }
    this.emit("loot_release_observed");
  }

  handleLootMoneyNotify(reader: PacketReader): void {
    if (this.disposed) return;
    const notice = parseLootMoneyNotify(reader);
    if (!this.deps.selfGuid()) return;
    this.lastMoneyNotice = { ...notice, observedAt: this.deps.now() };
    this.emit("money_notice");
  }

  handleItemPushResult(reader: PacketReader): void {
    if (this.disposed) return;
    const push = parseItemPushResult(reader);
    const selfGuid = this.deps.selfGuid();
    if (!selfGuid || push.guid !== selfGuid) return;
    this.lastItemPush = { ...push, observedAt: this.deps.now() };
    this.emit("item_push");
  }

  handleInventoryChangeFailure(reader: PacketReader): void {
    if (this.disposed) return;
    const packet = parseInventoryChangeFailure(reader);
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
    if (guid === this.deps.selfGuid()) {
      if (event.type === "disappear") this.selfUnavailable = true;
      else if (event.type === "appear") this.selfUnavailable = false;
      if (
        this.selfUnavailable ||
        readLife(guid, this.deps.getEntity).life !== "alive"
      )
        this.invalidate("self_unavailable");
    }
    if (
      event.type === "disappear" &&
      this.loot.phase !== "closed" &&
      guid === this.loot.guid
    )
      this.invalidate("loot_source_unavailable");
    if (!this.listener) return;
    const previous = this.lastInventory;
    if (
      guid !== this.deps.selfGuid() &&
      previous &&
      !previous.slots.some(
        (slot) => slot.status === "occupied" && slot.guid === guid,
      )
    )
      return;
    const inventory = this.inventory();
    this.lastInventory = inventory;
    if (
      guid !== this.deps.selfGuid() &&
      !inventory.slots.some(
        (slot) => slot.status === "occupied" && slot.guid === guid,
      )
    )
      return;
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
