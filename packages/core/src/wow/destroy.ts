import { Emitter, type Unsubscribe } from "#lib/emitter";
import type { EntityLookup } from "#wow/entity-store";
import {
  type InventorySlot,
  type InventoryState,
  readInventory,
} from "#wow/inventory";
import { readLife } from "#wow/player-state";
import {
  buildDestroyItem,
  type InventoryChangeFailure,
  inventoryResultName,
} from "#wow/protocol/inventory";
import { GameOpcode } from "#wow/protocol/opcodes";

export type DestroyDeps = {
  send: (opcode: number, body?: Uint8Array) => void;
  now: () => number;
  selfGuid: () => bigint;
  getEntity: EntityLookup;
};

export const DESTROY_ANSWER_MS = 5000;
const MAX_PARTIAL_COUNT = 255;

export type DestroyRequest = {
  bag: number;
  slot: number;
  itemGuid: bigint;
  itemId: number | undefined;
  count: number;
  stackBefore: number;
  requestedAt: number;
};

export type DestroyOutcome = {
  status: "confirmed" | "refused" | "unanswered";
  reason: string | undefined;
  request: DestroyRequest;
  stackAfter: number;
  observedAt: number;
};

export type DestroyState = {
  pending: DestroyRequest | undefined;
  lastOutcome: DestroyOutcome | undefined;
};

export type DestroyEvent = {
  type: "requested" | "destroyed" | "refused" | "unanswered";
  at: number;
  state: DestroyState;
};

type Occupied = Extract<InventorySlot, { status: "occupied" }>;

function stackAt(inventory: InventoryState, request: DestroyRequest): number {
  const held = inventory.slots.find(
    (slot): slot is Occupied =>
      slot.status === "occupied" &&
      slot.bag === request.bag &&
      slot.slot === request.slot,
  );
  return held?.guid === request.itemGuid ? (held.item.count ?? 1) : 0;
}

export class ItemDestroyRuntime {
  private readonly events = new Emitter<[DestroyEvent]>();
  private readonly deps: DestroyDeps;
  private disposed = false;
  private pending: DestroyRequest | undefined;
  private lastOutcome: DestroyOutcome | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(deps: DestroyDeps) {
    this.deps = deps;
  }

  onEvent(listener: (event: DestroyEvent) => void): Unsubscribe {
    if (this.disposed) return () => undefined;
    return this.events.subscribe(listener);
  }

  snapshot(): DestroyState {
    return {
      pending: this.pending ? { ...this.pending } : undefined,
      lastOutcome: this.lastOutcome ? { ...this.lastOutcome } : undefined,
    };
  }

  destroy(bag: number, slot: number, count?: number): DestroyState {
    const self = this.deps.selfGuid();
    if (this.disposed) throw new Error("Destroy runtime disposed");
    if (!self) throw new Error("Authenticated player GUID is unknown");
    if (readLife(self, this.deps.getEntity).life !== "alive")
      throw new Error("Destroy requires authoritative alive state");
    if (this.pending)
      throw new Error("Previous destroy request remains unanswered");
    const held = this.inventory().slots.find(
      (candidate) => candidate.bag === bag && candidate.slot === slot,
    );
    if (held?.status !== "occupied" || held.region === "equipment")
      throw new Error(`No carried bag item at bag ${bag} slot ${slot}`);
    const stackBefore = held.item.count ?? 1;
    const destroyed = count ?? stackBefore;
    if (destroyed > stackBefore)
      throw new Error("Destroy count exceeds the stack");
    const whole = destroyed === stackBefore;
    if (!whole && destroyed > MAX_PARTIAL_COUNT)
      throw new Error("Partial destroy count is limited to 255");
    this.deps.send(
      GameOpcode.CMSG_DESTROYITEM,
      buildDestroyItem(bag, slot, whole ? 0 : destroyed),
    );
    this.pending = {
      bag,
      slot,
      itemGuid: held.guid,
      itemId: held.item.entry,
      count: destroyed,
      stackBefore,
      requestedAt: this.deps.now(),
    };
    this.timer = setTimeout(
      () => this.settle("unanswered", "server_unanswered"),
      DESTROY_ANSWER_MS,
    );
    return this.emit("requested");
  }

  receiveInventoryFailure(packet: InventoryChangeFailure): void {
    if (this.disposed || !this.pending || packet.kind !== "error") return;
    this.settle("refused", inventoryResultName(packet.result));
  }

  observeInventory(): void {
    const pending = this.pending;
    if (this.disposed || !pending) return;
    const left = stackAt(this.inventory(), pending);
    if (left === pending.stackBefore - pending.count)
      this.settle("confirmed", undefined);
  }

  dispose(): void {
    this.disposed = true;
    clearTimeout(this.timer);
    this.events.clear();
    this.pending = undefined;
    this.lastOutcome = undefined;
  }

  private settle(status: DestroyOutcome["status"], reason?: string): void {
    const request = this.pending;
    if (!request) return;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.lastOutcome = {
      status,
      reason,
      request,
      stackAfter: stackAt(this.inventory(), request),
      observedAt: this.deps.now(),
    };
    this.pending = undefined;
    this.emit(status === "confirmed" ? "destroyed" : status);
  }

  private inventory(): InventoryState {
    return readInventory(this.deps.selfGuid(), this.deps.getEntity);
  }

  private emit(type: DestroyEvent["type"]): DestroyState {
    const state = this.snapshot();
    this.events.emit({ type, at: this.deps.now(), state });
    return state;
  }
}
