export type LatencyDraft = {
  runs: Map<string, { start: number; end?: number }>;
  latencies: number[];
  requests: number;
  decisionRequests: number;
  decisions: number;
  waits: number;
};

export type SessionLatency = {
  activeMs: number;
  requests: number;
  decisionRequests: number;
  loopRatePerSec: number;
  meanRequestMs: number | undefined;
  p95RequestMs: number | undefined;
  appliedDecisions: number;
  appliedWaits: number;
  decisionRatePerSec: number;
};

export function newLatencyDraft(): LatencyDraft {
  return {
    decisionRequests: 0,
    decisions: 0,
    latencies: [],
    requests: 0,
    runs: new Map(),
    waits: 0,
  };
}

export function observeLatency(
  draft: LatencyDraft,
  at: number,
  data: Record<string, unknown>,
): void {
  const runId = data["runId"];
  if (typeof runId !== "string") return;
  switch (data["type"]) {
    case "started":
      draft.runs.set(runId, { start: at });
      return;
    case "stopped": {
      const run = draft.runs.get(runId);
      if (run && run.end === undefined) run.end = at;
      return;
    }
    case "request":
      draft.requests++;
      if (offersDecision(data["candidates"])) draft.decisionRequests++;
      return;
    case "result":
      if (typeof data["elapsedMs"] === "number")
        draft.latencies.push(data["elapsedMs"]);
      return;
    case "applied":
      if (data["actionId"] === "wait") draft.waits++;
      else draft.decisions++;
      return;
    default:
      return;
  }
}

export function latencyOf(draft: LatencyDraft, to: number): SessionLatency {
  let activeMs = 0;
  for (const { start, end } of draft.runs.values())
    activeMs += (end ?? to) - start;
  const seconds = activeMs / 1000;
  const sorted = [...draft.latencies].sort((a, b) => a - b);
  const total = sorted.reduce((sum, value) => sum + value, 0);
  const p95 =
    sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)];
  return {
    activeMs,
    appliedDecisions: draft.decisions,
    appliedWaits: draft.waits,
    decisionRatePerSec:
      seconds > 0 ? round(draft.decisionRequests / seconds) : 0,
    decisionRequests: draft.decisionRequests,
    loopRatePerSec: seconds > 0 ? round(draft.requests / seconds) : 0,
    meanRequestMs: sorted.length > 0 ? round(total / sorted.length) : undefined,
    p95RequestMs: p95 === undefined ? undefined : round(p95),
    requests: draft.requests,
  };
}

const HOLD: Record<string, true> = { cancel: true, wait: true };

function offersDecision(candidates: unknown): boolean {
  if (!Array.isArray(candidates)) return false;
  return candidates.some((candidate: unknown) => {
    const id =
      typeof candidate === "object" && candidate !== null && "id" in candidate
        ? candidate.id
        : undefined;
    return typeof id === "string" && !HOLD[id];
  });
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
