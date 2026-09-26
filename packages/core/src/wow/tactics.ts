import { abortable, abortReason, bounded, pause } from "#lib/abort";
import { Emitter, type Unsubscribe } from "#lib/emitter";
import { messageOf } from "#lib/errors";
import { ignoreFailure } from "#lib/ignore-failure";
import type { FramingVariant } from "#wow/framing";
import type { JevActionResult, JevCandidate, JevSelect } from "#wow/jev";
import { JevTransportError, JevUnavailableError } from "#wow/jev-failure";

const WAIT = {
  id: "wait",
  description:
    "Hold current state and start nothing new: if moving, this refreshes the current direction's movement lease; if stationary, this is a no-op. Use stop_moving to release movement explicitly.",
} as const;
export const DEFAULT_FIGHT_INSTRUCTION =
  "defeat the selected target while keeping the character alive";
const DEFAULT_MAX_AGE_MS = 2000;
const DEFAULT_INTERVAL_MS = 200;
const DEFAULT_TIMEOUT_MS = 5000;
export const MAX_CONSECUTIVE_TIMEOUTS = 3;
export const SERVER_REJECTION = "server_action_rejected:";
export const TRANSPORT_LIMIT = 3;

export type TacticsContext = {
  targetGuid: bigint;
  instruction: string;
  framing?: FramingVariant;
};

export type TacticsOutcome = {
  status: "completed" | "blocked" | "failed";
  reason: string;
  observation?: Readonly<Record<string, unknown>>;
};

export type TacticsDefense = "auto_attack" | "uncontrolled_in_combat" | "none";

export type TacticsFrame = {
  observation: Readonly<Record<string, unknown>>;
  candidates: readonly JevCandidate[];
  outcome?: TacticsOutcome;
};

export type TacticsDeps = {
  apiKey: string | undefined;
  prepare: (context: TacticsContext, signal: AbortSignal) => Promise<void>;
  activate: (context: TacticsContext) => void;
  observe: (context: TacticsContext) => TacticsFrame;
  execute: (actionId: string, context: TacticsContext) => void;
  halt: () => void;
  defend: (context: TacticsContext) => TacticsDefense;
  select: JevSelect;
  now?: () => number;
  maxResultAgeMs?: number;
  minIntervalMs?: number;
  requestTimeoutMs?: number;
  fault?: string;
  characterClass?: () => string | undefined;
};

type TacticsRequest = {
  observation: Readonly<Record<string, unknown>>;
  candidates: readonly JevCandidate[];
  instruction: string;
  sentAtMs: number;
  framing: FramingVariant;
  characterClass?: string;
};

export type TacticsState = {
  status: "idle" | "preparing" | "active";
  runId: string | undefined;
  targetGuid: bigint | undefined;
  instruction: string;
  framing?: FramingVariant;
  lastRequest: TacticsRequest | undefined;
  lastResult: JevActionResult | undefined;
  lastDecision:
    | { actionId: string; disposition: "applied" | "discarded"; reason: string }
    | undefined;
  lastOutcome: TacticsOutcome | undefined;
  lastDiscardReason: string | undefined;
  lastStopReason?: string;
  fault?: string;
  timeouts: { consecutive: number; total: number; limit: number };
  defense?: TacticsDefense;
};

export type TacticsEvent =
  | {
      type: "started";
      runId: string;
      targetGuid: string;
      instruction: string;
      framing: FramingVariant;
      fault?: string;
    }
  | { type: "activated"; runId: string }
  | ({ type: "request"; runId: string } & TacticsRequest)
  | ({ type: "result"; runId: string } & JevActionResult)
  | { type: "applied"; runId: string; actionId: string; ageMs: number }
  | { type: "discarded"; runId: string; reason: string; actionId?: string }
  | ({ type: "outcome"; runId: string } & TacticsOutcome)
  | { type: "transport"; runId: string; error: string }
  | { type: "stopped"; runId: string; reason: string; state: TacticsState };

type Run = {
  runId: string;
  context: TacticsContext & { framing: FramingVariant };
  apiKey: string;
  abort: AbortController;
  detach: () => void;
  timeouts: number;
  transportFailures: number;
};

type Decision = {
  run: Run;
  candidates: readonly JevCandidate[];
  sentAtMs: number;
  result: JevActionResult;
};

export class TacticsLoop {
  private readonly deps: TacticsDeps;
  private readonly maxResultAgeMs: number;
  private readonly minIntervalMs: number;
  private readonly requestTimeoutMs: number;
  private readonly events = new Emitter<[TacticsEvent]>();
  private run: Run | undefined;
  private pending: Promise<void> | undefined;
  private state: TacticsState = {
    status: "idle",
    runId: undefined,
    targetGuid: undefined,
    instruction: "",
    lastRequest: undefined,
    lastResult: undefined,
    lastDecision: undefined,
    lastOutcome: undefined,
    lastDiscardReason: undefined,
    timeouts: noTimeouts(),
  };

  constructor(deps: TacticsDeps) {
    this.deps = deps;
    this.maxResultAgeMs = deps.maxResultAgeMs ?? DEFAULT_MAX_AGE_MS;
    this.minIntervalMs = deps.minIntervalMs ?? DEFAULT_INTERVAL_MS;
    this.requestTimeoutMs = deps.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async start(context: TacticsContext, signal?: AbortSignal): Promise<void> {
    this.stop("replaced");
    const apiKey = this.deps.apiKey;
    if (!apiKey) throw new JevUnavailableError("missing_jev_key");
    if (signal?.aborted) throw abortReason(signal);
    const run = this.begin(context, apiKey, signal);
    try {
      await this.activate(run);
    } catch (error) {
      if (!this.live(run)) return;
      this.fail(run, error);
      throw error;
    }
    try {
      await this.decide(run);
    } catch (error) {
      const live = this.live(run);
      this.fail(run, error, true);
      if (live && error instanceof JevUnavailableError) throw error;
    }
  }

  stop(reason: string): void {
    this.end(reason, false);
  }

  stopAndDefend(reason: string): boolean {
    const running = this.run !== undefined;
    this.end(reason, true);
    return running;
  }

  private end(reason: string, defend: boolean): void {
    const run = this.run;
    if (!run) return;
    this.run = undefined;
    this.state.status = "idle";
    this.state.lastStopReason = reason;
    run.detach();
    run.abort.abort();
    try {
      if (defend) this.state.defense = this.deps.defend(run.context);
      else this.deps.halt();
    } finally {
      const state = this.snapshot();
      this.emit({ type: "stopped", runId: run.runId, reason, state });
    }
  }

  snapshot(): TacticsState {
    return structuredClone(this.state);
  }

  onEvent(listener: (event: TacticsEvent) => void): Unsubscribe {
    return this.events.subscribe(listener);
  }

  dispose(): void {
    this.events.clear();
    this.stop("disposed");
  }

  private now(): number {
    return this.deps.now ? this.deps.now() : performance.now();
  }

  private emit(event: TacticsEvent): void {
    this.events.emit(structuredClone(event));
  }

  private begin(
    context: TacticsContext,
    apiKey: string,
    external: AbortSignal | undefined,
  ): Run {
    const framing = context.framing ?? "none";
    const run: Run = {
      runId: crypto.randomUUID(),
      context: { ...context, framing },
      apiKey,
      abort: new AbortController(),
      detach: () => external?.removeEventListener("abort", onExternal),
      timeouts: 0,
      transportFailures: 0,
    };
    const onExternal = () => {
      if (this.live(run)) this.stop("aborted");
    };
    external?.addEventListener("abort", onExternal, { once: true });
    this.run = run;
    const { targetGuid, instruction } = context;
    const fault = this.deps.fault;
    this.state = {
      status: "preparing",
      runId: run.runId,
      targetGuid,
      instruction,
      framing,
      lastRequest: undefined,
      lastResult: undefined,
      lastDecision: undefined,
      lastOutcome: undefined,
      lastDiscardReason: undefined,
      timeouts: noTimeouts(),
      fault,
    };
    const guid = `0x${targetGuid.toString(16)}`;
    const started = { runId: run.runId, targetGuid: guid, instruction };
    this.emit({ type: "started", ...started, framing, fault });
    return run;
  }

  private async activate(run: Run): Promise<void> {
    const signal = run.abort.signal;
    await abortable(this.deps.prepare(run.context, signal), signal);
    if (this.pending)
      await bounded(this.pending, signal, this.requestTimeoutMs, TIMEOUT);
    if (!this.live(run)) return;
    this.deps.activate(run.context);
    if (!this.live(run)) return;
    this.state.status = "active";
    this.emit({ type: "activated", runId: run.runId });
  }

  private live(run: Run): boolean {
    return this.run === run && !run.abort.signal.aborted;
  }

  private fail(run: Run, error: unknown, defend = false): void {
    if (!this.live(run)) return;
    const reason = messageOf(error);
    this.state.lastDiscardReason = reason;
    this.emit({ type: "transport", runId: run.runId, error: reason });
    this.finish(run, { status: "failed", reason }, undefined, defend);
  }

  private finish(
    run: Run,
    outcome: TacticsOutcome,
    observation?: TacticsFrame["observation"],
    defend = false,
  ): void {
    if (!this.live(run)) return;
    const recorded = structuredClone(
      observation === undefined ? outcome : { ...outcome, observation },
    );
    this.state.lastOutcome = recorded;
    this.emit({ type: "outcome", runId: run.runId, ...recorded });
    if (this.live(run)) this.end(recorded.status, defend);
  }

  private async decide(run: Run): Promise<void> {
    while (this.live(run)) {
      const frame = this.deps.observe(run.context);
      if (!this.live(run)) return;
      if (frame.outcome) {
        const defend = frame.outcome.reason.startsWith(SERVER_REJECTION);
        this.finish(run, frame.outcome, frame.observation, defend);
        return;
      }
      const candidates = withWait(frame.candidates);
      const sentAtMs = this.now();
      if (candidates.some((candidate) => candidate.id !== WAIT.id)) {
        const result = await this.attempt(run, { ...frame, candidates });
        if (result) this.commit({ run, result, candidates, sentAtMs });
      }
      if (this.live(run)) {
        const delay = Math.max(0, this.minIntervalMs - (this.now() - sentAtMs));
        await pause(delay, run.abort.signal);
      }
    }
  }

  private async attempt(
    run: Run,
    frame: TacticsFrame,
  ): Promise<JevActionResult | undefined> {
    try {
      const result = await this.select(run, frame);
      run.timeouts = 0;
      run.transportFailures = 0;
      this.state.timeouts.consecutive = 0;
      return result;
    } catch (error) {
      if (!this.live(run)) throw error;
      this.retry(run, error);
      const reason = messageOf(error);
      this.state.lastDiscardReason = reason;
      this.emit({ type: "transport", runId: run.runId, error: reason });
      return undefined;
    }
  }

  private retry(run: Run, error: unknown): void {
    if (error instanceof JevTransportError) {
      run.transportFailures += 1;
      if (run.transportFailures < TRANSPORT_LIMIT) return;
      const detail = `transport ${error.message} (${TRANSPORT_LIMIT} in a row)`;
      throw new JevUnavailableError(detail, { cause: error });
    }
    if (messageOf(error) !== TIMEOUT) throw error;
    run.timeouts += 1;
    this.state.timeouts.consecutive = run.timeouts;
    this.state.timeouts.total += 1;
    if (run.timeouts >= MAX_CONSECUTIVE_TIMEOUTS) throw error;
  }

  private async select(
    run: Run,
    frame: TacticsFrame,
  ): Promise<JevActionResult> {
    const request: TacticsRequest = structuredClone({
      observation: frame.observation,
      candidates: frame.candidates,
      instruction: run.context.instruction,
      sentAtMs: this.now(),
      framing: run.context.framing,
      characterClass: this.deps.characterClass?.(),
    });
    this.state.lastRequest = request;
    this.emit({ type: "request", runId: run.runId, ...request });
    if (!this.live(run)) throw abortReason(run.abort.signal);
    const abort = new AbortController();
    const signal = AbortSignal.any([run.abort.signal, abort.signal]);
    const pending = this.deps.select(request, { apiKey: run.apiKey, signal });
    this.track(pending.then((result) => this.late(run, result, signal)));
    try {
      return await bounded(pending, signal, this.requestTimeoutMs, TIMEOUT);
    } finally {
      abort.abort();
    }
  }

  private track(settling: Promise<void>): void {
    const settled = settling.catch(ignoreFailure);
    this.pending = settled;
    void settled.then(() => {
      if (this.pending === settled) this.pending = undefined;
    });
  }

  private late(run: Run, result: JevActionResult, signal: AbortSignal): void {
    if (this.live(run) && !signal.aborted) return;
    this.emit({ type: "result", runId: run.runId, ...result });
    this.emit({
      type: "discarded",
      runId: run.runId,
      reason: "aborted",
      actionId: result.choice,
    });
  }

  private commit({ run, result, candidates, sentAtMs }: Decision): void {
    if (!this.live(run)) return;
    this.state.lastResult = structuredClone(result);
    this.emit({ type: "result", runId: run.runId, ...result });
    if (!this.live(run)) return;
    const ageMs = this.now() - sentAtMs;
    const choice = result.choice;
    const rejected = judge(choice, ageMs, this.maxResultAgeMs, candidates);
    if (rejected) {
      this.discard(run, rejected, choice);
      return;
    }
    const current = this.deps.observe(run.context);
    if (!this.live(run)) return;
    if (current.outcome) {
      const defend = current.outcome.reason.startsWith(SERVER_REJECTION);
      this.finish(run, current.outcome, current.observation, defend);
      return;
    }
    if (!offers(withWait(current.candidates), choice)) {
      this.discard(run, "unavailable", choice);
      return;
    }
    try {
      this.deps.execute(choice, run.context);
    } catch (error) {
      this.discard(run, messageOf(error), choice);
      return;
    }
    if (this.live(run)) this.applied(run, choice, ageMs);
  }

  private applied(run: Run, actionId: string, ageMs: number): void {
    this.state.lastDecision = {
      actionId,
      disposition: "applied",
      reason: "ok",
    };
    this.state.lastDiscardReason = undefined;
    this.emit({ type: "applied", runId: run.runId, actionId, ageMs });
  }

  private discard(run: Run, reason: string, actionId: string): void {
    if (!this.live(run)) return;
    this.state.lastDiscardReason = reason;
    this.state.lastDecision = { actionId, disposition: "discarded", reason };
    this.emit({ type: "discarded", runId: run.runId, reason, actionId });
  }
}

const TIMEOUT = "jev_timeout";

function judge(
  choice: string,
  ageMs: number,
  maxAgeMs: number,
  offered: readonly JevCandidate[],
): string | undefined {
  if (ageMs > maxAgeMs) return "stale_age";
  if (!offers(offered, choice)) return "unknown_id";
  return undefined;
}

function offers(candidates: readonly JevCandidate[], id: string): boolean {
  return candidates.some((candidate) => candidate.id === id);
}

function withWait(candidates: readonly JevCandidate[]): JevCandidate[] {
  const list = candidates.map((candidate) => ({ ...candidate }));
  if (!offers(list, WAIT.id)) list.push({ ...WAIT });
  return list;
}

function noTimeouts(): TacticsState["timeouts"] {
  return { consecutive: 0, total: 0, limit: MAX_CONSECUTIVE_TIMEOUTS };
}
