import { messageOf } from "lib/errors";
import type { ControlRuntime, ControlState } from "wow/control";
import { recoverCorpse } from "wow/corpse-run";
import type { CycleStop } from "wow/cycle-stop";
import { EventWaiter } from "wow/event-waiter";
import { lootCorpse } from "wow/loot-run";
import type { RecoveryEvent, RecoveryRuntime } from "wow/recovery";
import type { RewardsEvent, RewardsRuntime } from "wow/rewards";
import type { TacticsLoop, TacticsOutcome, TacticsState } from "wow/tactics";

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
export type CycleLootRecord = {
  guid: string;
  slotsTaken: number[];
  moneyTaken: number;
  coinageBefore: number | undefined;
  coinageAfter: number | undefined;
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
export type CycleDeps = {
  tactics: Pick<TacticsLoop, "start" | "stop"> & {
    snapshot(): Pick<TacticsState, "lastOutcome">;
  };
  rewards: Pick<
    RewardsRuntime,
    "snapshot" | "open" | "take" | "takeMoney" | "close"
  >;
  recovery: Pick<
    RecoveryRuntime,
    | "snapshot"
    | "releaseSpirit"
    | "queryCorpse"
    | "reclaimCorpse"
    | "respondResurrection"
  >;
  control: Pick<ControlRuntime, "face" | "move"> & {
    snapshot(): Pick<ControlState, "pose">;
  };
  now: () => number;
};

const DEFAULT_MAX_STARTS = 10;

export class EncounterCycleRuntime {
  private readonly deps: CycleDeps;
  private listener: ((event: CycleEvent) => void) | undefined;
  private run: AbortController | undefined;
  private disposed = false;
  private recoveryEvents: EventWaiter<RecoveryEvent> | undefined;
  private rewardsEvents: EventWaiter<RewardsEvent> | undefined;
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

  observeRecovery(event: RecoveryEvent): void {
    this.recoveryEvents?.push(event);
  }

  observeRewards(event: RewardsEvent): void {
    this.rewardsEvents?.push(event);
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
    try {
      await this.drive(run.signal);
    } catch (error) {
      if (!run.signal.aborted) throw error;
    }
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

  private async drive(signal: AbortSignal): Promise<void> {
    const { queue } = this.state;
    while (this.state.currentIndex < queue.length) {
      if (this.state.startsUsed >= this.state.maxStarts)
        return this.stop("max_starts_reached");
      const record = queue[this.state.currentIndex]!;
      const failed = await this.engage(record, signal);
      if (failed) return this.stop(failed.cause, failed.detail);
      signal.throwIfAborted();
      this.state.currentIndex++;
      this.emit("target_done");
    }
    this.stop("queue_exhausted");
  }

  private async engage(
    record: CycleTargetRecord,
    signal: AbortSignal,
  ): Promise<CycleStop | undefined> {
    const { tactics } = this.deps;
    this.state.phase = "fighting";
    this.state.startsUsed++;
    const context = {
      targetGuid: record.guid,
      instruction: this.state.instruction,
    };
    try {
      await tactics.start(context, signal);
    } catch (error) {
      signal.throwIfAborted();
      const outcome = tactics.snapshot().lastOutcome;
      return skip(record, messageOf(error, "fight_failed"), outcome);
    }
    signal.throwIfAborted();
    if (this.selfDead()) return this.recover(record, signal);
    const outcome = tactics.snapshot().lastOutcome;
    if (outcome?.status !== "completed")
      return skip(record, outcome?.reason ?? "fight_failed", outcome);
    record.status = "done";
    record.outcome = outcome;
    return this.loot(record.guid, signal);
  }

  private async recover(
    record: CycleTargetRecord,
    signal: AbortSignal,
  ): Promise<CycleStop | undefined> {
    record.status = "skipped";
    record.cause = "died";
    this.state.phase = "recovering";
    this.emit("recovery");
    const events = new EventWaiter<RecoveryEvent>();
    this.recoveryEvents = events;
    try {
      const { recovery, control } = this.deps;
      const result = await recoverCorpse({ recovery, control, events, signal });
      return result.ok ? undefined : result;
    } finally {
      if (this.recoveryEvents === events) this.recoveryEvents = undefined;
    }
  }

  private async loot(
    guid: bigint,
    signal: AbortSignal,
  ): Promise<CycleStop | undefined> {
    this.state.phase = "looting";
    const events = new EventWaiter<RewardsEvent>();
    this.rewardsEvents = events;
    try {
      const { rewards } = this.deps;
      const result = await lootCorpse({ rewards, events, signal }, guid);
      if (!result.ok) return result;
      this.state.lastLoot = result.record;
      this.emit("loot_done");
      return undefined;
    } finally {
      if (this.rewardsEvents === events) this.rewardsEvents = undefined;
    }
  }

  private selfDead(): boolean {
    const life = this.deps.recovery.snapshot().life;
    return life === "dead" || life === "ghost";
  }

  private emit(type: CycleEvent["type"]): void {
    this.listener?.({ type, state: this.snapshot(), at: this.deps.now() });
  }
}

function skip(
  record: CycleTargetRecord,
  cause: string,
  outcome: TacticsOutcome | undefined,
): undefined {
  record.status = "skipped";
  record.cause = cause;
  record.outcome = outcome;
  return undefined;
}
