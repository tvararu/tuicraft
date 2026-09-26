import { Emitter, type Unsubscribe } from "lib/emitter";
import { messageOf } from "lib/errors";
import type { ControlEvent, ControlRuntime, ControlState } from "wow/control";
import { type CycleRecovery, recoverCorpse } from "wow/corpse-run";
import { type CycleStop, cycleStop } from "wow/cycle-stop";
import type { EntityEvent } from "wow/entity-store";
import { EventWaiter } from "wow/event-waiter";
import { JEV_UNAVAILABLE, JevUnavailableError } from "wow/jev-failure";
import { lootCorpse } from "wow/loot-run";
import type { ObjectivePick, ObjectiveProgress } from "wow/quest-objective";
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
  loot?: "looted" | "none";
};
export type CycleLootRecord = {
  guid: string;
  slotsTaken: number[];
  slotsLeft: number[];
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
  resumes: number;
  lastLoot: CycleLootRecord | undefined;
  lastRecovery: (CycleRecovery & { at: number }) | undefined;
  objective: ObjectiveProgress | undefined;
};
export type CycleObjective = {
  pick: (tried: ReadonlySet<bigint>) => ObjectivePick;
  progress: () => ObjectiveProgress | undefined;
};
export type CycleEvent = {
  type:
    | "started"
    | "resumed"
    | "target_done"
    | "loot_done"
    | "recovery"
    | "recovered"
    | "stopped";
  state: CycleState;
  at: number;
};
export type CycleDeps = {
  tactics: Pick<TacticsLoop, "start" | "stop"> & {
    snapshot: () => Pick<TacticsState, "lastOutcome">;
  };
  rewards: Pick<
    RewardsRuntime,
    "snapshot" | "open" | "take" | "takeMoney" | "close"
  >;
  bags: {
    questItems: () => ReadonlySet<number>;
    stackSize: (entry: number) => Promise<number | undefined>;
  };
  recovery: Pick<
    RecoveryRuntime,
    | "snapshot"
    | "releaseSpirit"
    | "queryCorpse"
    | "reclaimCorpse"
    | "respondResurrection"
  >;
  control: Pick<ControlRuntime, "face" | "move"> & {
    snapshot: () => Pick<ControlState, "pose" | "speed">;
  };
  now: () => number;
};

const DEFAULT_MAX_STARTS = 10;

export class EncounterCycleRuntime {
  private readonly deps: CycleDeps;
  private readonly events = new Emitter<[CycleEvent]>();
  private run: AbortController | undefined;
  private disposed = false;
  private recoveryEvents: EventWaiter<RecoveryEvent> | undefined;
  private motionEvents: EventWaiter<ControlEvent> | undefined;
  private rewardsEvents: EventWaiter<RewardsEvent> | undefined;
  private bodyEvents:
    | { guid: bigint; waiter: EventWaiter<EntityEvent> }
    | undefined;
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
    resumes: 0,
    lastLoot: undefined,
    lastRecovery: undefined,
    objective: undefined,
  };
  private objective: CycleObjective | undefined;

  constructor(deps: CycleDeps) {
    this.deps = deps;
  }

  snapshot(): CycleState {
    return {
      ...this.state,
      queue: this.state.queue.map((record) => ({ ...record })),
    };
  }

  onEvent(listener: (event: CycleEvent) => void): Unsubscribe {
    return this.events.subscribe(listener);
  }

  observeRecovery(event: RecoveryEvent): void {
    this.recoveryEvents?.push(event);
  }

  observeControl(event: ControlEvent): void {
    this.motionEvents?.push(event);
  }

  observeRewards(event: RewardsEvent): void {
    this.rewardsEvents?.push(event);
  }

  observeEntity(event: EntityEvent): void {
    const guid = event.type === "disappear" ? event.guid : event.entity.guid;
    if (guid === this.bodyEvents?.guid) this.bodyEvents.waiter.push(event);
  }

  async start(args: {
    guids: bigint[];
    instruction: string;
    maxStarts?: number;
    objective?: CycleObjective;
  }): Promise<void> {
    if (this.disposed) throw new Error("cycle_disposed");
    if (args.guids.length === 0 && !args.objective)
      throw new Error("cycle_empty_queue");
    const maxStarts = args.maxStarts ?? DEFAULT_MAX_STARTS;
    if (!Number.isInteger(maxStarts) || maxStarts < 1)
      throw new Error("cycle_invalid_max");
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
      resumes: 0,
      lastLoot: undefined,
      lastRecovery: undefined,
      objective: args.objective?.progress(),
    };
    this.objective = args.objective;
    await this.launch("started");
  }

  async resume(args: {
    instruction?: string;
    maxStarts?: number;
  }): Promise<void> {
    if (this.disposed) throw new Error("cycle_disposed");
    if (this.state.active) throw new Error("cycle_active");
    const { queue, currentIndex } = this.state;
    const next = queue.findIndex(
      (record, index) => index >= currentIndex && record.status === "queued",
    );
    const recoverOnly = next === -1 && queue.length > 0 && this.selfDead();
    if (next === -1 && !recoverOnly && !this.objective)
      throw new Error("cycle_nothing_to_resume");
    const maxStarts = args.maxStarts ?? this.state.maxStarts;
    if (!Number.isInteger(maxStarts) || maxStarts < 1)
      throw new Error("cycle_invalid_max");
    this.state = {
      ...this.state,
      active: true,
      phase: "fighting",
      currentIndex: next === -1 ? queue.length : next,
      instruction: args.instruction ?? this.state.instruction,
      maxStarts,
      startsUsed: 0,
      stopCause: undefined,
      stopDetail: undefined,
      resumes: this.state.resumes + 1,
    };
    await this.launch("resumed");
  }

  private async launch(type: "started" | "resumed"): Promise<void> {
    this.run?.abort();
    const run = new AbortController();
    this.run = run;
    this.emit(type);
    try {
      if (this.objective) await this.pursue(this.objective, run.signal);
      else await this.drive(run.signal);
    } catch (error) {
      if (!run.signal.aborted) throw error;
    }
    const { stopCause, stopDetail } = this.state;
    if (this.run === run && stopCause === JEV_UNAVAILABLE)
      throw new JevUnavailableError(String(stopDetail?.["reason"]));
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
    this.events.clear();
  }

  private async drive(signal: AbortSignal): Promise<void> {
    const { queue } = this.state;
    for (;;) {
      const recovered = await this.recoverIfDead(signal);
      if (recovered) return this.stop(recovered.cause, recovered.detail);
      const record = queue[this.state.currentIndex];
      if (record === undefined) return this.stop("queue_exhausted");
      if (this.state.startsUsed >= this.state.maxStarts)
        return this.stop("max_starts_reached");
      const failed = await this.engage(record, signal);
      signal.throwIfAborted();
      if (failed) {
        if (!this.selfDead()) return this.stop(failed.cause, failed.detail);
        record.cause = failed.cause;
      }
      this.state.currentIndex++;
      this.emit("target_done");
    }
  }

  private async pursue(
    objective: CycleObjective,
    signal: AbortSignal,
  ): Promise<void> {
    const tried = new Set(this.state.queue.map((record) => record.guid));
    for (;;) {
      const recovered = await this.recoverIfDead(signal);
      if (recovered) return this.stop(recovered.cause, recovered.detail);
      const pick = objective.pick(tried);
      if ("ok" in pick) return this.stop(pick.cause, pick.detail);
      if (pick.kind === "complete") {
        this.state.objective = pick.progress;
        return this.stop("objective_complete");
      }
      if (this.state.startsUsed >= this.state.maxStarts)
        return this.stop("max_starts_reached");
      tried.add(pick.guid);
      const record: CycleTargetRecord = { guid: pick.guid, status: "queued" };
      this.state.queue.push(record);
      this.state.currentIndex = this.state.queue.length - 1;
      const failed = await this.engage(record, signal);
      signal.throwIfAborted();
      this.state.objective = objective.progress();
      if (failed && !this.selfDead())
        return this.stop(failed.cause, failed.detail);
      if (failed) record.cause = failed.cause;
      this.emit("target_done");
    }
  }

  private async recoverIfDead(
    signal: AbortSignal,
  ): Promise<CycleStop | undefined> {
    if (!this.selfDead()) return undefined;
    const recovered = await this.recover(signal);
    signal.throwIfAborted();
    return recovered;
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
      if (error instanceof JevUnavailableError)
        return cycleStop(JEV_UNAVAILABLE, { reason: error.detail });
      const outcome = tactics.snapshot().lastOutcome;
      return skip(record, messageOf(error, "fight_failed"), outcome);
    }
    signal.throwIfAborted();
    const outcome = tactics.snapshot().lastOutcome;
    if (this.selfDead()) return skip(record, "died", outcome);
    if (outcome?.status !== "completed")
      return skip(record, outcome?.reason ?? "fight_failed", outcome);
    record.status = "done";
    record.outcome = outcome;
    return this.loot(record, signal);
  }

  private async recover(signal: AbortSignal): Promise<CycleStop | undefined> {
    this.state.phase = "recovering";
    this.emit("recovery");
    const events = new EventWaiter<RecoveryEvent>();
    const motion = new EventWaiter<ControlEvent>();
    this.recoveryEvents = events;
    this.motionEvents = motion;
    try {
      const { recovery, control } = this.deps;
      const run = { recovery, control, events, motion, signal };
      const result = await recoverCorpse(run);
      if (!result.ok) return result;
      signal.throwIfAborted();
      const { outcome, detail } = result;
      this.state.lastRecovery = { outcome, detail, at: this.deps.now() };
      this.emit("recovered");
      return undefined;
    } finally {
      if (this.recoveryEvents === events) this.recoveryEvents = undefined;
      if (this.motionEvents === motion) this.motionEvents = undefined;
    }
  }

  private async loot(
    target: CycleTargetRecord,
    signal: AbortSignal,
  ): Promise<CycleStop | undefined> {
    this.state.phase = "looting";
    const events = new EventWaiter<RewardsEvent>();
    const bodies = {
      guid: target.guid,
      waiter: new EventWaiter<EntityEvent>(),
    };
    this.rewardsEvents = events;
    this.bodyEvents = bodies;
    try {
      const { rewards, bags } = this.deps;
      const run = { rewards, bags, events, bodies: bodies.waiter, signal };
      const result = await lootCorpse(run, target.guid);
      if (!result.ok) return result;
      target.loot = result.record ? "looted" : "none";
      if (!result.record) return undefined;
      this.state.lastLoot = result.record;
      this.emit("loot_done");
      return undefined;
    } finally {
      if (this.rewardsEvents === events) this.rewardsEvents = undefined;
      if (this.bodyEvents === bodies) this.bodyEvents = undefined;
    }
  }

  private selfDead(): boolean {
    const life = this.deps.recovery.snapshot().life;
    return life === "dead" || life === "ghost";
  }

  private emit(type: CycleEvent["type"]): void {
    this.events.emit({ type, state: this.snapshot(), at: this.deps.now() });
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
}
