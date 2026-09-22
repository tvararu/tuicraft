import type { TacticsOutcome } from "wow/tactics";
import type { RewardsEvent, RewardsState } from "wow/rewards";

export type CyclePhase =
  | "idle"
  | "fighting"
  | "looting"
  | "recovering"
  | "stopped";
export type CycleTargetRecord = {
  guid: bigint;
  status: "queued" | "done" | "skipped";
  cause?: string;
  outcome?: TacticsOutcome;
};
export type CycleState = {
  active: boolean;
  phase: CyclePhase;
  queue: CycleTargetRecord[];
  currentIndex: number;
  instruction: string;
  maxStarts: number;
  startsUsed: number;
  stopCause: string | undefined;
  startedAt: number | undefined;
  lastLoot: CycleLootRecord | undefined;
};
export type CycleEvent = {
  type: "started" | "target_done" | "loot_done" | "stopped";
  state: CycleState;
  at: number;
};
export type CycleTactics = {
  start(
    context: { targetGuid: bigint; instruction: string },
    signal: AbortSignal,
  ): Promise<void>;
  stop(reason: string): void;
  lastOutcome(): TacticsOutcome | undefined;
  selfDead(): boolean;
};
export type CycleLoot = {
  snapshot(): RewardsState;
  open(guid: bigint): void;
  take(slot: number): void;
  takeMoney(): void;
  close(): void;
  onEvent(callback: ((event: RewardsEvent) => void) | undefined): void;
};
export type CycleLootRecord = {
  guid: string;
  slotsTaken: number[];
  moneyTaken: number;
  coinageBefore: number | undefined;
  coinageAfter: number | undefined;
};
export type CycleDeps = {
  tactics: CycleTactics;
  loot: CycleLoot;
  now: () => number;
};

const DEFAULT_MAX_STARTS = 10;
const LOOT_SETTLE_MS = 5000;

export class EncounterCycleRuntime {
  private readonly deps: CycleDeps;
  private listener: ((event: CycleEvent) => void) | undefined;
  private generation = 0;
  private disposed = false;
  private state: CycleState = {
    active: false,
    phase: "idle",
    queue: [],
    currentIndex: 0,
    instruction: "",
    maxStarts: DEFAULT_MAX_STARTS,
    startsUsed: 0,
    stopCause: undefined,
    startedAt: undefined,
    lastLoot: undefined,
  };

  constructor(deps: CycleDeps) {
    this.deps = deps;
  }

  snapshot(): CycleState {
    return {
      ...this.state,
      queue: this.state.queue.map((record) => ({ ...record })),
    };
  }

  onEvent(callback: ((event: CycleEvent) => void) | undefined): void {
    this.listener = callback;
  }

  async start(args: {
    guids: bigint[];
    instruction: string;
    maxStarts?: number;
  }): Promise<void> {
    if (this.disposed) throw new Error("cycle_disposed");
    if (args.guids.length === 0) throw new Error("cycle_empty_queue");
    const maxStarts = args.maxStarts ?? DEFAULT_MAX_STARTS;
    if (!Number.isInteger(maxStarts) || maxStarts < 1)
      throw new Error("cycle_invalid_max");
    const generation = ++this.generation;
    this.state = {
      active: true,
      phase: "fighting",
      queue: args.guids.map((guid) => ({ guid, status: "queued" })),
      currentIndex: 0,
      instruction: args.instruction,
      maxStarts,
      startsUsed: 0,
      stopCause: undefined,
      startedAt: this.deps.now(),
      lastLoot: undefined,
    };
    this.emit("started");
    await this.drive(generation);
  }

  stop(reason: string): void {
    if (!this.state.active) return;
    this.generation++;
    this.state = {
      ...this.state,
      active: false,
      phase: "stopped",
      stopCause: reason,
    };
    this.emit("stopped");
  }

  dispose(): void {
    this.disposed = true;
    this.generation++;
    this.listener = undefined;
  }

  protected live(generation: number): boolean {
    return (
      !this.disposed && generation === this.generation && this.state.active
    );
  }

  private async drive(generation: number): Promise<void> {
    while (
      this.live(generation) &&
      this.state.currentIndex < this.state.queue.length
    ) {
      if (this.state.startsUsed >= this.state.maxStarts) {
        this.stop("max_starts_reached");
        return;
      }
      const record = this.state.queue[this.state.currentIndex]!;
      const controller = new AbortController();
      this.state.startsUsed++;
      try {
        await this.deps.tactics.start(
          { targetGuid: record.guid, instruction: this.state.instruction },
          controller.signal,
        );
      } catch (error) {
        if (!this.live(generation)) return;
        record.status = "skipped";
        record.cause = error instanceof Error ? error.message : "fight_failed";
        record.outcome = this.deps.tactics.lastOutcome();
        this.advance();
        continue;
      }
      if (!this.live(generation)) return;
      if (this.deps.tactics.selfDead()) {
        await this.onDeath(generation);
        return;
      }
      record.status = "done";
      record.outcome = this.deps.tactics.lastOutcome();
      const proceed = await this.runLoot(record.guid, generation);
      if (!proceed) return;
      if (!this.live(generation)) return;
      this.advance();
    }
    if (this.live(generation)) this.stop("queue_exhausted");
  }

  protected async onDeath(_generation: number): Promise<void> {
    throw new Error("cycle_no_recovery");
  }

  private advance(): void {
    this.state.currentIndex++;
    this.emit("target_done");
  }

  private async runLoot(guid: bigint, generation: number): Promise<boolean> {
    const loot = this.deps.loot;
    this.state.phase = "looting";
    const pending: RewardsEvent[] = [];
    let wake: (() => void) | undefined;
    loot.onEvent((event) => {
      pending.push(event);
      wake?.();
    });
    const next = (timeoutMs: number): Promise<RewardsEvent | undefined> => {
      const queued = pending.shift();
      if (queued) return Promise.resolve(queued);
      const waiter = Promise.withResolvers<RewardsEvent | undefined>();
      const timer = setTimeout(() => {
        wake = undefined;
        waiter.resolve(undefined);
      }, timeoutMs);
      wake = () => {
        clearTimeout(timer);
        wake = undefined;
        waiter.resolve(pending.shift());
      };
      return waiter.promise;
    };
    try {
      try {
        loot.open(guid);
      } catch (error) {
        this.stop(`loot_denied:${describeLootFailure(error)}`);
        return false;
      }
      let opened: RewardsEvent | undefined;
      while (!opened) {
        const event = await next(LOOT_SETTLE_MS);
        if (!this.live(generation)) return false;
        if (!event) {
          this.stop("loot_denied:timeout");
          return false;
        }
        if (event.type === "loot_opened") {
          opened = event;
          break;
        }
        if (event.type === "loot_error") {
          this.stop(
            `loot_denied:${event.state.lastLootError ? String(event.state.lastLootError.error) : "unknown"}`,
          );
          return false;
        }
        if (event.type === "loot_release_observed") {
          this.stop("loot_release_only_reconnect_required");
          return false;
        }
      }
      const offer = opened.state.loot;
      if (offer.phase !== "open") {
        this.stop("loot_denied:unexpected_phase");
        return false;
      }
      const coinageBefore = opened.state.inventory.coinage;
      const offeredSlots = offer.items.map((item) => item.slot);
      const offeredMoney = offer.money;
      if (offeredSlots.length === 0 && offeredMoney === 0) {
        try {
          loot.close();
        } catch {
          /* window already empty and closed server-side */
        }
        this.recordLoot(guid, [], 0, coinageBefore, coinageBefore);
        return true;
      }
      const slotsTaken: number[] = [];
      let pendingConfirmations = 0;
      for (const slot of offeredSlots) {
        try {
          loot.take(slot);
        } catch (error) {
          this.stop(`loot_denied:${describeLootFailure(error)}`);
          return false;
        }
        slotsTaken.push(slot);
        pendingConfirmations++;
      }
      let moneyTaken = 0;
      if (offeredMoney > 0) {
        try {
          loot.takeMoney();
        } catch (error) {
          this.stop(`loot_denied:${describeLootFailure(error)}`);
          return false;
        }
        moneyTaken = offeredMoney;
        pendingConfirmations++;
      }
      while (pendingConfirmations > 0) {
        const event = await next(LOOT_SETTLE_MS);
        if (!this.live(generation)) return false;
        if (!event) break;
        if (
          event.type === "inventory_error" &&
          event.state.lastInventoryError?.inventoryFull
        ) {
          this.stop("loot_inventory_full");
          return false;
        }
        if (event.type === "loot_error") {
          this.stop(
            `loot_denied:${event.state.lastLootError ? String(event.state.lastLootError.error) : "unknown"}`,
          );
          return false;
        }
        if (
          event.type === "loot_removed" ||
          event.type === "loot_money_cleared"
        )
          pendingConfirmations--;
      }
      try {
        loot.close();
      } catch {
        /* best-effort close after confirmed takes */
      }
      const coinageAfter = loot.snapshot().inventory.coinage;
      this.recordLoot(
        guid,
        slotsTaken,
        moneyTaken,
        coinageBefore,
        coinageAfter,
      );
      return true;
    } finally {
      loot.onEvent(undefined);
    }
  }

  private recordLoot(
    guid: bigint,
    slotsTaken: number[],
    moneyTaken: number,
    coinageBefore: number | undefined,
    coinageAfter: number | undefined,
  ): void {
    this.state.lastLoot = {
      guid: guid.toString(),
      slotsTaken,
      moneyTaken,
      coinageBefore,
      coinageAfter,
    };
    this.emit("loot_done");
  }

  private emit(type: CycleEvent["type"]): void {
    this.listener?.({ type, state: this.snapshot(), at: this.deps.now() });
  }
}

function describeLootFailure(error: unknown): string {
  return error instanceof Error ? error.message : "loot_request_failed";
}
