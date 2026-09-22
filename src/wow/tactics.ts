import {
  selectJevAction,
  type JevActionOptions,
  type JevActionRequest,
  type JevActionResult,
} from "wow/jev";
import { parseFramingVariant, type FramingVariant } from "wow/framing";

const WAIT = {
  id: "wait",
  description:
    "Hold current state and start nothing new: if moving, this refreshes the current direction's movement lease; if stationary, this is a no-op. Use stop_moving to release movement explicitly.",
} as const;
const DEFAULT_MAX_AGE_MS = 2000;
const DEFAULT_INTERVAL_MS = 200;
const DEFAULT_TIMEOUT_MS = 5000;

export type TacticsContext = {
  targetGuid: bigint;
  instruction: string;
  framing?: FramingVariant;
  characterClass?: string;
};

export type TacticsCandidate = {
  id: string;
  description: string;
};

export type TacticsOutcome = {
  status: "completed" | "blocked" | "failed";
  reason: string;
  observation?: Readonly<Record<string, unknown>>;
};

export type TacticsFrame = {
  observation: Readonly<Record<string, unknown>>;
  candidates: readonly TacticsCandidate[];
  outcome?: TacticsOutcome;
};

export type TacticsSelect = (
  request: JevActionRequest,
  options: JevActionOptions,
) => Promise<JevActionResult>;

export type TacticsDeps = {
  apiKey: string | undefined;
  prepare: (context: TacticsContext, signal: AbortSignal) => Promise<void>;
  activate: (context: TacticsContext) => void;
  observe: (context: TacticsContext) => TacticsFrame;
  execute: (actionId: string, context: TacticsContext) => void;
  halt: () => void;
  select?: TacticsSelect;
  now?: () => number;
  maxResultAgeMs?: number;
  minIntervalMs?: number;
  requestTimeoutMs?: number;
  framing?: FramingVariant;
  characterClass?: string;
  fault?: string;
};

export type TacticsState = {
  status: "idle" | "preparing" | "active";
  runId: string | undefined;
  targetGuid: bigint | undefined;
  instruction: string;
  framing?: FramingVariant;
  characterClass?: string;
  ownerEpoch: number;
  instructionEpoch: number;
  targetIntentEpoch: number;
  lastRequest:
    | {
        observation: Readonly<Record<string, unknown>>;
        candidates: readonly TacticsCandidate[];
        instruction: string;
        sentAtMs: number;
        framing: FramingVariant;
      }
    | undefined;
  lastResult: JevActionResult | undefined;
  lastDecision:
    | { actionId: string; disposition: "applied" | "discarded"; reason: string }
    | undefined;
  lastOutcome: TacticsOutcome | undefined;
  lastElapsedMs: number | undefined;
  lastInterApplyMs: number | undefined;
  lastDiscardReason: string | undefined;
  lastStopReason?: string;
  lastInterRequestMs?: number;
  fault?: string;
};

export type TacticsEvent =
  | {
      type: "started";
      runId: string;
      targetGuid: string;
      instruction: string;
      ownerEpoch: number;
      instructionEpoch: number;
      targetIntentEpoch: number;
      framing?: FramingVariant;
      fault?: string;
    }
  | { type: "activated"; runId: string; fault?: string }
  | {
      type: "request";
      runId: string;
      instruction: string;
      observation: Readonly<Record<string, unknown>>;
      candidates: readonly TacticsCandidate[];
      sentAtMs: number;
      framing: FramingVariant;
      fault?: string;
    }
  | ({ type: "result"; runId: string; fault?: string } & JevActionResult)
  | {
      type: "applied";
      runId: string;
      actionId: string;
      ageMs: number;
      fault?: string;
    }
  | {
      type: "discarded";
      runId: string;
      reason: string;
      actionId?: string;
      fault?: string;
    }
  | ({ type: "outcome"; runId: string; fault?: string } & TacticsOutcome)
  | { type: "transport"; runId: string; error: string; fault?: string }
  | {
      type: "stopped";
      runId: string;
      reason: string;
      state: TacticsState;
      fault?: string;
    };

type Run = {
  generation: number;
  runId: string;
  context: TacticsContext;
  abort: AbortController;
  detach: () => void;
  framing: FramingVariant;
  characterClass: string | undefined;
};

type Decision = {
  run: Run;
  candidates: readonly TacticsCandidate[];
  sentAtMs: number;
  result: JevActionResult;
};

export class TacticsLoop {
  private readonly deps: TacticsDeps;
  private readonly maxResultAgeMs: number;
  private readonly minIntervalMs: number;
  private readonly requestTimeoutMs: number;
  private listener: ((event: TacticsEvent) => void) | undefined;
  private generation = 0;
  private run: Run | undefined;
  private pending: Promise<void> | undefined;
  private lastApplyAtMs: number | undefined;
  private state: TacticsState = {
    status: "idle",
    runId: undefined,
    targetGuid: undefined,
    instruction: "",
    ownerEpoch: 0,
    instructionEpoch: 0,
    targetIntentEpoch: 0,
    lastRequest: undefined,
    lastResult: undefined,
    lastDecision: undefined,
    lastOutcome: undefined,
    lastElapsedMs: undefined,
    lastInterApplyMs: undefined,
    lastDiscardReason: undefined,
  };

  constructor(deps: TacticsDeps) {
    this.deps = deps;
    this.maxResultAgeMs = deps.maxResultAgeMs ?? DEFAULT_MAX_AGE_MS;
    this.minIntervalMs = deps.minIntervalMs ?? DEFAULT_INTERVAL_MS;
    this.requestTimeoutMs = deps.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async start(context: TacticsContext, signal?: AbortSignal): Promise<void> {
    this.stop("replaced");
    if (!this.deps.apiKey) throw new Error("missing_jev_key");
    if (signal?.aborted) throw abortReason(signal);
    parseFramingVariant(context.framing ?? this.deps.framing);
    const run = this.begin(context, signal);
    try {
      if (!this.live(run)) return;
      await abortable(
        this.deps.prepare(run.context, run.abort.signal),
        run.abort.signal,
      );
      if (this.pending)
        await bounded(this.pending, run.abort.signal, this.requestTimeoutMs);
      if (!this.live(run)) return;
      this.deps.activate(run.context);
      if (!this.live(run)) return;
      this.state.status = "active";
      this.emit({ type: "activated", runId: run.runId });
    } catch (error) {
      if (!this.live(run)) return;
      this.fail(run, error);
      throw error;
    }
    try {
      await this.decide(run);
    } catch (error) {
      this.fail(run, error);
    }
  }

  stop(reason: string): void {
    const run = this.run;
    if (!run) return;
    this.run = undefined;
    this.state.status = "idle";
    this.state.ownerEpoch += 1;
    this.state.lastStopReason = reason;
    const state = this.snapshot();
    run.detach();
    run.abort.abort();
    try {
      this.deps.halt();
    } finally {
      this.emit({ type: "stopped", runId: run.runId, reason, state });
    }
  }

  snapshot(): TacticsState {
    return structuredClone(this.state);
  }

  onEvent(callback: ((event: TacticsEvent) => void) | undefined): void {
    this.listener = callback;
  }

  dispose(): void {
    this.listener = undefined;
    this.stop("disposed");
  }

  private now(): number {
    return this.deps.now ? this.deps.now() : performance.now();
  }

  private emit(event: TacticsEvent): void {
    const payload =
      this.deps.fault !== undefined && event.fault === undefined
        ? { ...event, fault: this.deps.fault }
        : event;
    this.listener?.(structuredClone(payload));
  }

  private begin(context: TacticsContext, external?: AbortSignal): Run {
    const framing = parseFramingVariant(context.framing ?? this.deps.framing);
    const characterClass = context.characterClass ?? this.deps.characterClass;
    const run: Run = {
      generation: ++this.generation,
      runId: crypto.randomUUID(),
      context: { ...context, framing, characterClass },
      abort: new AbortController(),
      detach: () => external?.removeEventListener("abort", onExternal),
      framing,
      characterClass,
    };
    const onExternal = () => {
      if (this.live(run)) this.stop("aborted");
    };
    external?.addEventListener("abort", onExternal, { once: true });
    this.run = run;
    this.lastApplyAtMs = undefined;
    this.state = {
      status: "preparing",
      runId: run.runId,
      targetGuid: context.targetGuid,
      instruction: context.instruction,
      framing,
      characterClass,
      ownerEpoch: this.state.ownerEpoch + 1,
      instructionEpoch: this.state.instructionEpoch + 1,
      targetIntentEpoch: this.state.targetIntentEpoch + 1,
      lastRequest: undefined,
      lastResult: undefined,
      lastDecision: undefined,
      lastOutcome: undefined,
      lastElapsedMs: undefined,
      lastInterApplyMs: undefined,
      lastDiscardReason: undefined,
      fault: this.deps.fault,
    };
    this.emit({
      type: "started",
      runId: run.runId,
      targetGuid: `0x${context.targetGuid.toString(16)}`,
      instruction: context.instruction,
      framing,
      ownerEpoch: this.state.ownerEpoch,
      instructionEpoch: this.state.instructionEpoch,
      targetIntentEpoch: this.state.targetIntentEpoch,
    });
    return run;
  }

  private live(run: Run): boolean {
    return (
      this.run === run &&
      run.generation === this.generation &&
      !run.abort.signal.aborted
    );
  }

  private fail(run: Run, error: unknown): void {
    if (!this.live(run)) return;
    const reason = messageOf(error);
    this.state.lastDiscardReason = reason;
    this.emit({ type: "transport", runId: run.runId, error: reason });
    this.finish(run, { status: "failed", reason });
  }

  private finish(
    run: Run,
    outcome: TacticsOutcome,
    observation?: TacticsFrame["observation"],
  ): void {
    if (!this.live(run)) return;
    const recorded = structuredClone(
      observation === undefined ? outcome : { ...outcome, observation },
    );
    this.state.lastOutcome = recorded;
    this.emit({ type: "outcome", runId: run.runId, ...recorded });
    if (this.live(run)) this.stop(recorded.status);
  }

  private async decide(run: Run): Promise<void> {
    while (this.live(run)) {
      const frame = this.deps.observe(run.context);
      if (!this.live(run)) return;
      if (frame.outcome) {
        this.finish(run, frame.outcome, frame.observation);
        return;
      }
      const candidates = withWait(frame.candidates);
      const sentAtMs = this.now();
      if (candidates.some((candidate) => candidate.id !== WAIT.id)) {
        const result = await this.select(run, { ...frame, candidates });
        this.commit({ run, result, candidates, sentAtMs });
      }
      if (this.live(run)) {
        const delay = Math.max(0, this.minIntervalMs - (this.now() - sentAtMs));
        await pause(delay, run.abort.signal);
      }
    }
  }

  private async select(
    run: Run,
    frame: TacticsFrame,
  ): Promise<JevActionResult> {
    const apiKey = this.deps.apiKey;
    if (!apiKey) throw new Error("missing_jev_key");
    const sentAtMs = this.now();
    const previous = this.state.lastRequest;
    this.state.lastInterRequestMs = previous
      ? sentAtMs - previous.sentAtMs
      : undefined;
    const request = structuredClone({
      observation: frame.observation,
      candidates: frame.candidates,
      instruction: run.context.instruction,
      sentAtMs,
      framing: run.framing,
      characterClass: run.characterClass,
    });
    this.state.lastRequest = {
      observation: request.observation,
      candidates: request.candidates,
      instruction: request.instruction,
      sentAtMs: request.sentAtMs,
      framing: run.framing,
    };
    this.emit({ type: "request", runId: run.runId, ...request });
    if (!this.live(run)) throw abortReason(run.abort.signal);
    const abort = new AbortController();
    const signal = AbortSignal.any([run.abort.signal, abort.signal]);
    const select = this.deps.select ?? selectJevAction;
    const pending = select(request, { apiKey, signal });
    const settled = pending.then(
      (result) => this.late(run, result, signal),
      () => {},
    );
    this.pending = settled;
    void settled.then(() => {
      if (this.pending === settled) this.pending = undefined;
    });
    try {
      return await bounded(pending, signal, this.requestTimeoutMs);
    } finally {
      if (this.live(run)) this.state.lastElapsedMs = this.now() - sentAtMs;
      abort.abort();
    }
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
    if (ageMs > this.maxResultAgeMs) {
      this.discard(run, "stale_age", result.choice);
      return;
    }
    if (!candidates.some((candidate) => candidate.id === result.choice)) {
      this.discard(run, "unknown_id", result.choice);
      return;
    }
    const current = this.deps.observe(run.context);
    if (!this.live(run)) return;
    if (current.outcome) {
      this.finish(run, current.outcome, current.observation);
      return;
    }
    if (
      !withWait(current.candidates).some(
        (candidate) => candidate.id === result.choice,
      )
    ) {
      this.discard(run, "unavailable", result.choice);
      return;
    }
    try {
      this.deps.execute(result.choice, run.context);
    } catch (error) {
      this.discard(run, messageOf(error), result.choice);
      return;
    }
    if (!this.live(run)) return;
    this.applied(run, result.choice, ageMs);
  }

  private applied(run: Run, actionId: string, ageMs: number): void {
    const now = this.now();
    this.state.lastDecision = {
      actionId,
      disposition: "applied",
      reason: "ok",
    };
    this.state.lastDiscardReason = undefined;
    this.state.lastInterApplyMs =
      this.lastApplyAtMs === undefined ? undefined : now - this.lastApplyAtMs;
    this.lastApplyAtMs = now;
    this.emit({ type: "applied", runId: run.runId, actionId, ageMs });
  }

  private discard(run: Run, reason: string, actionId: string): void {
    if (!this.live(run)) return;
    this.state.lastDiscardReason = reason;
    this.state.lastDecision = { actionId, disposition: "discarded", reason };
    this.emit({ type: "discarded", runId: run.runId, reason, actionId });
  }
}

function withWait(candidates: readonly TacticsCandidate[]): TacticsCandidate[] {
  const list = candidates.map((candidate) => ({ ...candidate }));
  if (!list.some((candidate) => candidate.id === WAIT.id))
    list.push({ ...WAIT });
  return list;
}

async function abortable<T>(
  pending: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  const aborted = Promise.withResolvers<never>();
  const fail = () => aborted.reject(abortReason(signal));
  if (signal.aborted) fail();
  else signal.addEventListener("abort", fail, { once: true });
  try {
    return await Promise.race([pending, aborted.promise]);
  } finally {
    signal.removeEventListener("abort", fail);
  }
}

async function bounded<T>(
  pending: Promise<T>,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<T> {
  const timeout = Promise.withResolvers<never>();
  const timer = setTimeout(
    () => timeout.reject(new Error("jev_timeout")),
    timeoutMs,
  );
  try {
    return await abortable(Promise.race([pending, timeout.promise]), signal);
  } finally {
    clearTimeout(timer);
  }
}

async function pause(ms: number, signal: AbortSignal): Promise<void> {
  const elapsed = Promise.withResolvers<void>();
  const timer = setTimeout(elapsed.resolve, ms);
  try {
    await abortable(elapsed.promise, signal);
  } finally {
    clearTimeout(timer);
  }
}

function abortReason(signal: AbortSignal): DOMException {
  if (
    signal.reason instanceof DOMException &&
    signal.reason.name === "AbortError"
  )
    return signal.reason;
  return new DOMException("The operation was aborted.", "AbortError");
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
