import type { TacticsEvent } from "@tuicraft/core";
import { resolvePaths } from "@tuicraft/core/lib/paths";

type Stamped = { at: number; event: TacticsEvent };
type Json = Record<string, unknown>;

export type Decision = {
  n: number;
  offered: string[];
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
  latencyMs: number;
  appliedAgeMs?: number;
  applied: boolean;
};

export type EncounterRecord = {
  runId: string;
  recordedAt: string;
  instruction: string;
  promptVariant: string;
  character: { level?: number; maxPower?: number; maxHealth?: number };
  target: {
    guid?: string;
    name?: string;
    level?: number;
    maxHealth?: number;
  };
  decisions: Decision[];
  discarded: { reason: string; actionId?: string }[];
  transportErrors: string[];
  cadence: { decisions: number; elapsedMs: number; perSecond: number };
  outcome: { status?: string; reason?: string };
  model: string | undefined;
  fault?: string;
  rawLines: number;
};

type Draft = Omit<EncounterRecord, "recordedAt" | "cadence" | "rawLines"> & {
  offered: string[];
  pending: Decision | undefined;
};

export function parseLog(text: string): Stamped[] {
  return text.split("\n").flatMap((line) => {
    const stamped = line.trim() ? readLine(line) : undefined;
    return stamped ? [stamped] : [];
  });
}

export function runIds(stamped: Stamped[]): string[] {
  return [...new Set(stamped.map(({ event }) => event.runId))];
}

export function distil(
  stamped: Stamped[],
  runId: string,
  promptVariant: string,
): EncounterRecord {
  const mine = stamped.filter((s) => s.event.runId === runId);
  const first = mine[0];
  const last = mine.at(-1);
  if (!(first && last)) throw new Error(`No tactics events for run ${runId}`);
  const draft: Draft = {
    character: {},
    decisions: [],
    discarded: [],
    instruction: "",
    model: undefined,
    offered: [],
    outcome: {},
    pending: undefined,
    promptVariant,
    runId,
    target: {},
    transportErrors: [],
  };
  for (const { event } of mine) reduce(draft, event);
  const elapsedMs = last.at - first.at;
  const count = draft.decisions.length;
  const perSecond = elapsedMs > 0 ? (count / elapsedMs) * 1000 : 0;
  return {
    cadence: {
      decisions: count,
      elapsedMs,
      perSecond: Math.round(perSecond * 1000) / 1000,
    },
    character: draft.character,
    decisions: draft.decisions,
    discarded: draft.discarded,
    instruction: draft.instruction,
    model: draft.model,
    outcome: draft.outcome,
    promptVariant: draft.promptVariant,
    recordedAt: new Date(first.at).toISOString(),
    runId,
    target: draft.target,
    transportErrors: draft.transportErrors,
    ...(draft.fault === undefined ? {} : { fault: draft.fault }),
    rawLines: mine.length,
  };
}

function reduce(draft: Draft, event: TacticsEvent): void {
  switch (event.type) {
    case "started":
      draft.instruction = event.instruction ?? draft.instruction;
      draft.target = { ...draft.target, guid: event.targetGuid };
      draft.fault = event.fault ?? draft.fault;
      return;
    case "request":
      onRequest(draft, event);
      return;
    case "result":
      onResult(draft, event);
      return;
    case "applied":
      if (!draft.pending) return;
      draft.pending.applied = true;
      if (event.ageMs !== undefined) draft.pending.appliedAgeMs = event.ageMs;
      draft.pending = undefined;
      return;
    case "discarded":
      draft.discarded.push(
        event.actionId === undefined
          ? { reason: event.reason ?? "unknown" }
          : { actionId: event.actionId, reason: event.reason ?? "unknown" },
      );
      return;
    case "transport":
      if (event.error !== undefined) draft.transportErrors.push(event.error);
      return;
    case "outcome":
      draft.outcome = { reason: event.reason, status: event.status };
      return;
    default:
      break;
  }
}

function onRequest(
  draft: Draft,
  event: Extract<TacticsEvent, { type: "request" }>,
): void {
  draft.instruction = event.instruction ?? draft.instruction;
  if (event.framing) draft.promptVariant = event.framing;
  draft.offered = (event.candidates ?? []).map(({ id }) => id ?? "?");
  const self = record(event.observation?.["self"]);
  const target = record(event.observation?.["target"]);
  if (self)
    draft.character = {
      level: num(self["level"]),
      maxHealth: num(self["maxHealth"]),
      maxPower: num(self["maxPower"]),
    };
  if (target)
    draft.target = {
      guid: str(target["guid"]) ?? draft.target.guid,
      level: num(target["level"]),
      maxHealth: num(target["maxHealth"]),
      name: str(target["name"]),
    };
}

function onResult(
  draft: Draft,
  event: Extract<TacticsEvent, { type: "result" }>,
): void {
  draft.model = event.model ?? draft.model;
  draft.pending = {
    applied: false,
    choice: event.choice ?? "?",
    confidence: event.confidence ?? Number.NaN,
    latencyMs: event.elapsedMs ?? Number.NaN,
    n: draft.decisions.length + 1,
    offered: draft.offered,
    probabilities: event.probabilities ?? {},
  };
  draft.decisions.push(draft.pending);
}

function readLine(line: string): Stamped | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return undefined;
  }
  const entry = record(parsed);
  if (entry?.["type"] !== "TACTICS") return undefined;
  const data = entry["data"];
  const at = entry["timestamp"];
  if (!isTacticsEvent(data) || typeof at !== "number") return undefined;
  return { at, event: data };
}

function isTacticsEvent(value: unknown): value is TacticsEvent {
  const event = record(value);
  return (
    typeof event?.["type"] === "string" && typeof event["runId"] === "string"
  );
}

function record(value: unknown): Json | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  return Object.fromEntries(Object.entries(value));
}

function num(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const variant = args[1] ?? "unrecorded";
  const text = await Bun.file(resolvePaths().logPath).text();
  const stamped = parseLog(text);
  const ids = runIds(stamped);
  const wanted = args[0] && args[0] !== "latest" ? args[0] : ids.at(-1);
  if (!wanted) {
    process.stderr.write("No tactics runs found in the session log\n");
    process.exit(1);
  }
  process.stdout.write(
    `${JSON.stringify(distil(stamped, wanted, variant), null, 2)}\n`,
  );
}

if (import.meta.main) await main();
