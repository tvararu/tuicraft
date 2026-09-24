import type { TacticsOutcome } from "wow/tactics";
import type { RewardsEvent, RewardsState } from "wow/rewards";
import type {
  RecoveryEvent,
  RecoveryReclaim,
  RecoveryState,
} from "wow/recovery";
import type { ControlPose, MovementDirection } from "wow/control";

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
  stopDetail: Record<string, unknown> | undefined;
  startedAt: number | undefined;
  lastLoot: CycleLootRecord | undefined;
};
export type CycleEvent = {
  type: "started" | "target_done" | "loot_done" | "recovery" | "stopped";
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
export type CycleRecovery = {
  snapshot(): RecoveryState;
  releaseSpirit(): void;
  queryCorpse(): void;
  reclaimCorpse(): void;
  respondResurrection(accept: boolean): void;
  onEvent(callback: ((event: RecoveryEvent) => void) | undefined): void;
};
export type CycleControl = {
  pose(): ControlPose | undefined;
  face(orientation: number): void;
  move(direction: MovementDirection, durationMs: number): void;
};
export type CycleDeps = {
  tactics: CycleTactics;
  loot: CycleLoot;
  recovery: CycleRecovery;
  control: CycleControl;
  now: () => number;
};

const DEFAULT_MAX_STARTS = 10;
const LOOT_SETTLE_MS = 5000;
const RECLAIM_MARGIN_MS = 2000;
const LEG_LEASE_MS = 3000;
const DETOUR_RAD = Math.PI / 4;
const RECOVERY_WAIT_MS = 30000;
const POSE_MOVED_EPS = 0.05;

export class EncounterCycleRuntime {
  private readonly deps: CycleDeps;
  private listener: ((event: CycleEvent) => void) | undefined;
  private run: AbortController | undefined;
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
    stopDetail: undefined,
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
    this.run?.abort();
    const run = new AbortController();
    this.run = run;
    this.state = {
      active: true,
      phase: "fighting",
      queue: args.guids.map((guid) => ({ guid, status: "queued" })),
      currentIndex: 0,
      instruction: args.instruction,
      maxStarts,
      startsUsed: 0,
      stopCause: undefined,
      stopDetail: undefined,
      startedAt: this.deps.now(),
      lastLoot: undefined,
    };
    this.emit("started");
    await this.drive(run.signal);
  }

  stop(reason: string, detail?: Record<string, unknown>): void {
    if (!this.state.active) return;
    this.deps.tactics.stop(reason);
    this.run?.abort();
    this.state = {
      ...this.state,
      active: false,
      phase: "stopped",
      stopCause: reason,
      stopDetail: detail,
    };
    this.emit("stopped");
  }

  dispose(): void {
    this.disposed = true;
    this.run?.abort();
    this.listener = undefined;
  }

  protected live(signal: AbortSignal): boolean {
    return !this.disposed && !signal.aborted && this.state.active;
  }

  private async drive(signal: AbortSignal): Promise<void> {
    while (
      this.live(signal) &&
      this.state.currentIndex < this.state.queue.length
    ) {
      this.state.phase = "fighting";
      if (this.state.startsUsed >= this.state.maxStarts) {
        this.stop("max_starts_reached");
        return;
      }
      const record = this.state.queue[this.state.currentIndex]!;
      this.state.startsUsed++;
      try {
        await this.deps.tactics.start(
          { targetGuid: record.guid, instruction: this.state.instruction },
          signal,
        );
      } catch (error) {
        if (!this.live(signal)) return;
        record.status = "skipped";
        record.cause = error instanceof Error ? error.message : "fight_failed";
        record.outcome = this.deps.tactics.lastOutcome();
        this.advance();
        continue;
      }
      if (!this.live(signal)) return;
      if (this.deps.tactics.selfDead()) {
        await this.onDeath(signal);
        return;
      }
      const outcome = this.deps.tactics.lastOutcome();
      if (!outcome || outcome.status !== "completed") {
        record.status = "skipped";
        record.cause = outcome?.reason ?? "fight_failed";
        record.outcome = outcome;
        this.advance();
        continue;
      }
      record.status = "done";
      record.outcome = outcome;
      const proceed = await this.runLoot(record.guid, signal);
      if (!proceed) return;
      if (!this.live(signal)) return;
      this.advance();
    }
    if (this.live(signal)) this.stop("queue_exhausted");
  }

  protected async onDeath(signal: AbortSignal): Promise<void> {
    const record = this.state.queue[this.state.currentIndex]!;
    record.status = "skipped";
    record.cause = "died";
    this.state.phase = "recovering";
    this.emit("recovery");
    const recovered = await this.recover(signal);
    if (!recovered || !this.live(signal)) return;
    this.advance();
    if (!this.live(signal)) return;
    await this.drive(signal);
  }

  private async recover(signal: AbortSignal): Promise<boolean> {
    const recovery = this.deps.recovery;
    const control = this.deps.control;
    const pending: RecoveryEvent[] = [];
    let wake: (() => void) | undefined;
    recovery.onEvent((event) => {
      pending.push(event);
      wake?.();
    });
    const waitFor = (
      predicate: (event: RecoveryEvent) => boolean,
      timeoutMs: number,
    ): Promise<RecoveryEvent | undefined> => {
      const waiter = Promise.withResolvers<RecoveryEvent | undefined>();
      const drain = (): boolean => {
        const index = pending.findIndex(predicate);
        if (index === -1) return false;
        waiter.resolve(pending.splice(index, 1)[0]);
        return true;
      };
      if (drain()) return waiter.promise;
      const timer = setTimeout(() => {
        wake = undefined;
        waiter.resolve(undefined);
      }, timeoutMs);
      wake = () => {
        if (drain()) {
          clearTimeout(timer);
          wake = undefined;
        }
      };
      return waiter.promise;
    };
    const awaitLife = (life: string): Promise<RecoveryEvent | undefined> =>
      waitFor(
        (event) => event.type === "life_observed" && event.state.life === life,
        RECOVERY_WAIT_MS,
      );
    try {
      const deathEpoch = recovery.snapshot().epoch;
      const offerState = recovery.snapshot();
      const offer =
        offerState.epoch === deathEpoch ? offerState.resurrection : undefined;
      if (offer?.response === "unanswered") {
        recovery.respondResurrection(true);
        const revived = await awaitLife("alive");
        if (!this.live(signal)) return false;
        if (!revived) {
          this.stop("resurrection_not_confirmed");
          return false;
        }
        return true;
      }

      let state = recovery.snapshot();
      if (state.life === "dead") {
        recovery.releaseSpirit();
        const released = await awaitLife("ghost");
        if (!this.live(signal)) return false;
        if (!released) {
          this.stop("ghost_not_confirmed");
          return false;
        }
        state = released.state;
      } else if (state.life !== "ghost") {
        this.stop("life_unknown");
        return false;
      }

      recovery.queryCorpse();
      const queried = await waitFor(
        (event) => event.type === "corpse_observed",
        RECOVERY_WAIT_MS,
      );
      if (!this.live(signal)) return false;
      if (!queried) {
        this.stop("corpse_query_timeout");
        return false;
      }
      if (queried.state.corpse.status !== "found") {
        this.stop("corpse_absent");
        return false;
      }
      state = queried.state;

      for (let attempt = 0; attempt < 2; attempt++) {
        const remaining = state.reclaim.remainingMs;
        if (remaining === undefined || remaining <= 0) break;
        await this.sleep(remaining + RECLAIM_MARGIN_MS);
        if (!this.live(signal)) return false;
        state = recovery.snapshot();
      }
      if (
        state.reclaim.remainingMs !== undefined &&
        state.reclaim.remainingMs > 0
      ) {
        this.stop("reclaim_delayed");
        return false;
      }

      if (state.reclaim.reason === "corpse_map_mismatch") {
        this.stop("corpse_out_of_range", describePoseRange(state.reclaim));
        return false;
      }

      if (!state.reclaim.canRequest) {
        if (state.corpse.status !== "found") {
          this.stop("corpse_absent");
          return false;
        }
        const corpsePosition = state.corpse.position;
        const before = control.pose();
        if (!before) {
          this.stop("corpse_unreachable", describePoseRange(state.reclaim));
          return false;
        }
        let outcome = await this.travelLeg(signal, 0, corpsePosition, before);
        if (!outcome) return false;
        let retried = false;
        if (!outcome.arrived && !outcome.moved) {
          retried = true;
          outcome = await this.travelLeg(
            signal,
            DETOUR_RAD,
            corpsePosition,
            outcome.pose ?? before,
          );
          if (!outcome) return false;
        }
        if (!outcome.arrived) {
          const cause = retried ? "corpse_unreachable" : "corpse_out_of_range";
          this.stop(cause, describePoseRange(outcome.reclaim));
          return false;
        }
      }

      recovery.reclaimCorpse();
      const revived = await awaitLife("alive");
      if (!this.live(signal)) return false;
      if (!revived) {
        this.stop("reclaim_not_confirmed");
        return false;
      }
      return true;
    } finally {
      if (this.live(signal)) recovery.onEvent(undefined);
    }
  }

  private async travelLeg(
    signal: AbortSignal,
    bearingOffset: number,
    corpsePosition: { x: number; y: number; z: number },
    before: ControlPose,
  ): Promise<
    | {
        arrived: boolean;
        moved: boolean;
        pose: ControlPose | undefined;
        reclaim: RecoveryReclaim;
      }
    | undefined
  > {
    const bearing = normalizeAngle(
      Math.atan2(corpsePosition.y - before.y, corpsePosition.x - before.x) +
        bearingOffset,
    );
    try {
      this.deps.control.face(bearing);
      this.deps.control.move("forward", LEG_LEASE_MS);
    } catch (error) {
      this.stop("corpse_unreachable", {
        pose: before,
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
    await this.sleep(LEG_LEASE_MS);
    if (!this.live(signal)) return undefined;
    const after = this.deps.control.pose();
    const reclaim = this.deps.recovery.snapshot().reclaim;
    return {
      arrived: reclaim.canRequest,
      moved: poseMoved(before, after),
      pose: after,
      reclaim,
    };
  }

  private sleep(ms: number): Promise<void> {
    const waiter = Promise.withResolvers<void>();
    setTimeout(waiter.resolve, ms);
    return waiter.promise;
  }

  private advance(): void {
    this.state.currentIndex++;
    this.emit("target_done");
  }

  private async runLoot(guid: bigint, signal: AbortSignal): Promise<boolean> {
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
        if (!this.live(signal)) return false;
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
        if (!(await this.closeLoot(next, signal))) return false;
        this.recordLoot(guid, [], 0, coinageBefore, coinageBefore);
        return true;
      }
      const slotsTaken: number[] = [];
      for (const slot of offeredSlots) {
        try {
          loot.take(slot);
        } catch (error) {
          this.stop(`loot_denied:${describeLootFailure(error)}`);
          return false;
        }
        slotsTaken.push(slot);
        const confirmed = await this.awaitTakeConfirmation(next, signal, slot);
        if (confirmed === undefined) return false;
        if (!confirmed) {
          slotsTaken.pop();
          continue;
        }
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
        const confirmed = await this.awaitTakeConfirmation(
          next,
          signal,
          undefined,
        );
        if (confirmed === undefined) return false;
        if (!confirmed) moneyTaken = 0;
      }
      if (!(await this.closeLoot(next, signal))) return false;
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
      if (this.live(signal)) loot.onEvent(undefined);
    }
  }

  private async closeLoot(
    next: (timeoutMs: number) => Promise<RewardsEvent | undefined>,
    signal: AbortSignal,
  ): Promise<boolean> {
    try {
      this.deps.loot.close();
    } catch (error) {
      this.stop(`loot_denied:${describeLootFailure(error)}`);
      return false;
    }
    while (this.live(signal)) {
      const event = await next(LOOT_SETTLE_MS);
      if (!this.live(signal)) return false;
      if (!event) break;
      if (event.type !== "loot_release_observed") continue;
      if (
        event.state.loot.phase === "closed" &&
        event.state.lastRelease?.status === 1
      )
        return true;
      break;
    }
    this.stop("loot_release_unconfirmed");
    return false;
  }
  private async awaitTakeConfirmation(
    next: (timeoutMs: number) => Promise<RewardsEvent | undefined>,
    signal: AbortSignal,
    slot: number | undefined,
  ): Promise<boolean | undefined> {
    while (this.live(signal)) {
      const event = await next(LOOT_SETTLE_MS);
      if (!this.live(signal)) return undefined;
      if (!event) {
        this.stop("loot_denied:timeout");
        return undefined;
      }
      if (
        event.type === "inventory_error" &&
        event.state.lastInventoryError?.inventoryFull
      ) {
        this.stop("loot_inventory_full");
        return undefined;
      }
      if (event.type === "loot_error") {
        this.stop(
          `loot_denied:${event.state.lastLootError ? String(event.state.lastLootError.error) : "unknown"}`,
        );
        return undefined;
      }
      if (slot === undefined) {
        if (event.type === "loot_money_cleared") return true;
        continue;
      }
      if (event.type === "loot_removed") {
        const removed = event.state.loot;
        if (removed.phase === "open" || removed.phase === "closing") {
          if (!removed.items.some((item) => item.slot === slot)) return true;
        }
        continue;
      }
      if (event.type === "loot_release_observed") return false;
    }
    return undefined;
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

function poseMoved(
  before: ControlPose | undefined,
  after: ControlPose | undefined,
): boolean {
  if (!before || !after) return false;
  return (
    Math.hypot(after.x - before.x, after.y - before.y, after.z - before.z) >
    POSE_MOVED_EPS
  );
}

function normalizeAngle(radians: number): number {
  const twoPi = Math.PI * 2;
  return ((radians % twoPi) + twoPi) % twoPi;
}

function describePoseRange(reclaim: RecoveryReclaim): Record<string, unknown> {
  return { pose: reclaim.pose, range: reclaim.distance };
}
