import {
  type LatencyDraft,
  latencyOf,
  newLatencyDraft,
  observeLatency,
  type SessionLatency,
} from "tools/session-latency";

type Json = Record<string, unknown>;
type Entry = { at: number; type: string; data: Json };

export type CycleTargetSummary = {
  guid: string;
  status: string;
  cause?: string;
  outcome?: string;
  loot?: string;
};

export type CycleRunSummary = {
  kind: "started" | "resumed";
  startedAt: number;
  stoppedAt?: number;
  instruction: string;
  maxStarts?: number;
  startsUsed?: number;
  stopCause?: string;
  stopDetail?: Json;
  recoveries: { at: number; outcome: string; detail?: Json }[];
  targets: CycleTargetSummary[];
};

export type Intervention = {
  at: number;
  kind: "halt" | "manual_override" | "resume" | "instruction_change";
  scope: "cycle" | "fight";
  detail?: string;
};

export type SessionRecord = {
  window: { from: number; to: number; durationMs: number };
  entries: number;
  cycles: CycleRunSummary[];
  fights: {
    started: number;
    byStatus: Record<string, number>;
    byReason: Record<string, number>;
  };
  completions: { targetsDone: number; serverKillCredit: number };
  blocked: {
    targetsSkipped: number;
    skipsByCause: Record<string, number>;
    cycleStops: { at: number; cause: string; detail?: Json }[];
  };
  recoveries: {
    deaths: number;
    recovered: number;
    byOutcome: Record<string, number>;
  };
  interventions: Intervention[];
  staleActions: { discarded: number; byReason: Record<string, number> };
  latency: SessionLatency;
};

const INTERVENTIONS: Record<string, Intervention["kind"]> = {
  halt: "halt",
  manual_override: "manual_override",
};
const HALT_ECHO_MS = 50;
const UNBLOCKED_STOPS: Record<string, true> = {
  halt: true,
  manual_override: true,
  max_starts_reached: true,
  queue_exhausted: true,
};

type Draft = {
  cycles: CycleRunSummary[];
  open: CycleRunSummary | undefined;
  lastInstruction: string | undefined;
  record: Omit<SessionRecord, "window" | "entries" | "cycles" | "latency">;
  latency: LatencyDraft;
  life: string | undefined;
};

export function sessionRecord(text: string, since = 0): SessionRecord {
  const entries = parseEntries(text).filter((entry) => entry.at >= since);
  const draft: Draft = {
    cycles: [],
    lastInstruction: undefined,
    latency: newLatencyDraft(),
    life: undefined,
    open: undefined,
    record: {
      blocked: { cycleStops: [], skipsByCause: {}, targetsSkipped: 0 },
      completions: { serverKillCredit: 0, targetsDone: 0 },
      fights: { byReason: {}, byStatus: {}, started: 0 },
      interventions: [],
      recoveries: { byOutcome: {}, deaths: 0, recovered: 0 },
      staleActions: { byReason: {}, discarded: 0 },
    },
  };
  for (const entry of entries) reduce(draft, entry);
  const from = entries[0]?.at ?? since;
  const to = entries.at(-1)?.at ?? from;
  return {
    cycles: draft.cycles,
    entries: entries.length,
    window: { durationMs: to - from, from, to },
    ...draft.record,
    latency: latencyOf(draft.latency, to),
  };
}

function reduce(draft: Draft, entry: Entry): void {
  if (entry.type === "CYCLE") onCycle(draft, entry);
  else if (entry.type === "TACTICS") onTactics(draft, entry);
  else if (entry.type === "RECOVERY") onRecovery(draft, entry);
}

function onCycle(draft: Draft, { at, data }: Entry): void {
  const state = record(data["state"]);
  if (!state) return;
  const kind = str(data["type"]);
  const instruction = str(state["instruction"]) ?? "";
  if (kind === "started" || kind === "resumed") {
    if (kind === "resumed")
      intervene(draft, { at, kind: "resume", scope: "cycle" });
    if (
      kind === "resumed" &&
      draft.lastInstruction !== undefined &&
      draft.lastInstruction !== instruction
    )
      intervene(draft, {
        at,
        detail: instruction,
        kind: "instruction_change",
        scope: "cycle",
      });
    draft.lastInstruction = instruction;
    draft.open = {
      instruction,
      kind,
      recoveries: [],
      startedAt: at,
      targets: [],
    };
    draft.cycles.push(draft.open);
    return;
  }
  if (kind === "recovered") onRecovered(draft, at, state);
  if (kind === "stopped") onCycleStopped(draft, at, state);
}

function onRecovered(draft: Draft, at: number, state: Json): void {
  const last = record(state["lastRecovery"]);
  const outcome = str(last?.["outcome"]) ?? "unknown";
  const detail = record(last?.["detail"]);
  draft.open?.recoveries.push(
    detail ? { at, detail, outcome } : { at, outcome },
  );
  const { recoveries } = draft.record;
  recoveries.recovered++;
  bump(recoveries.byOutcome, outcome);
}

function onCycleStopped(draft: Draft, at: number, state: Json): void {
  const run = draft.open;
  const cause = str(state["stopCause"]) ?? "unknown";
  const detail = record(state["stopDetail"]);
  const intervention = INTERVENTIONS[cause];
  if (intervention)
    intervene(draft, { at, kind: intervention, scope: "cycle" });
  if (!UNBLOCKED_STOPS[cause])
    draft.record.blocked.cycleStops.push(
      detail ? { at, cause, detail } : { at, cause },
    );
  if (!run) return;
  run.stoppedAt = at;
  run.stopCause = cause;
  if (detail) run.stopDetail = detail;
  run.maxStarts = num(state["maxStarts"]);
  run.startsUsed = num(state["startsUsed"]);
  run.targets = targetsOf(state["queue"]);
  draft.open = undefined;
  countTargets(draft, run);
}

function countTargets(draft: Draft, run: CycleRunSummary): void {
  const { completions, blocked } = draft.record;
  const resumed = run.kind === "resumed" ? draft.cycles.at(-2)?.targets : [];
  for (const [index, target] of run.targets.entries()) {
    if (resumed?.[index]?.status === target.status) continue;
    if (target.status === "done") {
      completions.targetsDone++;
      if (target.outcome === "server_kill_credit")
        completions.serverKillCredit++;
    }
    if (target.status === "skipped") {
      blocked.targetsSkipped++;
      bump(blocked.skipsByCause, target.cause ?? "unknown");
    }
  }
}

function targetsOf(value: unknown): CycleTargetSummary[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const target = record(item);
    if (!target) return [];
    const summary: CycleTargetSummary = {
      guid: str(target["guid"]) ?? "?",
      status: str(target["status"]) ?? "?",
    };
    const cause = str(target["cause"]);
    const outcome = str(record(target["outcome"])?.["reason"]);
    const loot = str(target["loot"]);
    if (cause) summary.cause = cause;
    if (outcome) summary.outcome = outcome;
    if (loot) summary.loot = loot;
    return [summary];
  });
}

function onTactics(draft: Draft, { at, data }: Entry): void {
  const type = str(data["type"]);
  const { fights, staleActions } = draft.record;
  observeLatency(draft.latency, at, data);
  if (type === "started") fights.started++;
  if (type === "outcome") {
    bump(fights.byStatus, str(data["status"]) ?? "unknown");
    bump(fights.byReason, str(data["reason"]) ?? "unknown");
  }
  if (type === "discarded") {
    staleActions.discarded++;
    bump(staleActions.byReason, str(data["reason"]) ?? "unknown");
  }
  const intervention = INTERVENTIONS[str(data["reason"]) ?? ""];
  if (type === "stopped" && intervention && !draft.open)
    intervene(draft, { at, kind: intervention, scope: "fight" });
}

function onRecovery(draft: Draft, { data }: Entry): void {
  if (str(data["type"]) !== "life_observed") return;
  const life = str(record(data["state"])?.["life"]);
  if (life === "dead" && draft.life !== "dead" && draft.life !== "ghost")
    draft.record.recoveries.deaths++;
  if (life) draft.life = life;
}

function intervene(draft: Draft, intervention: Intervention): void {
  const { interventions } = draft.record;
  const echo = interventions.findIndex(
    (other) =>
      other.kind === intervention.kind &&
      other.scope !== intervention.scope &&
      Math.abs(other.at - intervention.at) <= HALT_ECHO_MS,
  );
  if (echo === -1) interventions.push(intervention);
  else if (intervention.scope === "cycle") interventions[echo] = intervention;
}

function parseEntries(text: string): Entry[] {
  return text.split("\n").flatMap((line) => {
    if (!line.trim()) return [];
    try {
      const entry = record(JSON.parse(line));
      const data = record(entry?.["data"]);
      const at = num(entry?.["timestamp"]);
      const type = str(entry?.["type"]);
      return data && at !== undefined && type ? [{ at, data, type }] : [];
    } catch {
      return [];
    }
  });
}

function bump(counts: Record<string, number>, key: string): void {
  counts[key] = (counts[key] ?? 0) + 1;
}

function record(value: unknown): Json | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return undefined;
  return Object.fromEntries(Object.entries(value));
}

function num(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
