import { logPath } from "lib/paths";

type LogLine = { type: string; data?: unknown; timestamp: number };

type Event = Record<string, unknown> & { type: string; runId: string };

type Stamped = { at: number; event: Event };

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

export function parseLog(text: string): Stamped[] {
  const out: Stamped[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let parsed: LogLine;
    try {
      parsed = JSON.parse(line) as LogLine;
    } catch {
      continue;
    }
    if (parsed.type !== "TACTICS") continue;
    const data = parsed.data;
    if (!data || typeof data !== "object") continue;
    const event = data as Event;
    if (typeof event.type !== "string" || typeof event.runId !== "string")
      continue;
    out.push({ at: parsed.timestamp, event });
  }
  return out;
}

export function runIds(stamped: Stamped[]): string[] {
  const seen: string[] = [];
  for (const { event } of stamped)
    if (!seen.includes(event.runId)) seen.push(event.runId);
  return seen;
}

function num(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

export function distil(
  stamped: Stamped[],
  runId: string,
  promptVariant: string,
): EncounterRecord {
  const mine = stamped.filter((s) => s.event.runId === runId);
  if (mine.length === 0) throw new Error(`No tactics events for run ${runId}`);

  const decisions: Decision[] = [];
  const discarded: { reason: string; actionId?: string }[] = [];
  const transportErrors: string[] = [];
  let instruction = "";
  let character: EncounterRecord["character"] = {};
  let target: EncounterRecord["target"] = {};
  let outcome: EncounterRecord["outcome"] = {};
  let model: string | undefined;
  let fault: string | undefined;
  let offered: string[] = [];
  let pending: Decision | undefined;

  for (const { event } of mine) {
    if (event["fault"]) fault = str(event["fault"]) ?? fault;
    if (event.type === "started") {
      instruction = str(event["instruction"]) ?? instruction;
      target = { ...target, guid: str(event["targetGuid"]) };
    }
    if (event.type === "request") {
      instruction = str(event["instruction"]) ?? instruction;
      const framing = str(event["framing"]);
      if (framing) promptVariant = framing;
      const candidates = Array.isArray(event["candidates"])
        ? event["candidates"]
        : [];
      offered = candidates.map((c) => str(record(c)?.["id"]) ?? "?");
      const obs = record(event["observation"]);
      const self = record(obs?.["self"]);
      const tgt = record(obs?.["target"]);
      if (self)
        character = {
          level: num(self["level"]),
          maxPower: num(self["maxPower"]),
          maxHealth: num(self["maxHealth"]),
        };
      if (tgt)
        target = {
          guid: str(tgt["guid"]) ?? target.guid,
          name: str(tgt["name"]),
          level: num(tgt["level"]),
          maxHealth: num(tgt["maxHealth"]),
        };
    }
    if (event.type === "result") {
      model = str(event["model"]) ?? model;
      pending = {
        n: decisions.length + 1,
        offered,
        choice: str(event["choice"]) ?? "?",
        confidence: num(event["confidence"]) ?? Number.NaN,
        probabilities: (record(event["probabilities"]) ?? {}) as Record<
          string,
          number
        >,
        latencyMs: num(event["elapsedMs"]) ?? Number.NaN,
        applied: false,
      };
      decisions.push(pending);
    }
    if (event.type === "applied" && pending) {
      pending.applied = true;
      const age = num(event["ageMs"]);
      if (age !== undefined) pending.appliedAgeMs = age;
      pending = undefined;
    }
    if (event.type === "discarded") {
      const entry: { reason: string; actionId?: string } = {
        reason: str(event["reason"]) ?? "unknown",
      };
      const actionId = str(event["actionId"]);
      if (actionId !== undefined) entry.actionId = actionId;
      discarded.push(entry);
    }
    if (event.type === "transport") {
      const error = str(event["error"]);
      if (error !== undefined) transportErrors.push(error);
    }
    if (event.type === "outcome")
      outcome = { status: str(event["status"]), reason: str(event["reason"]) };
  }

  const first = mine[0];
  const last = mine[mine.length - 1];
  const elapsedMs = first && last ? last.at - first.at : 0;
  const perSecond = elapsedMs > 0 ? (decisions.length / elapsedMs) * 1000 : 0;

  return {
    runId,
    recordedAt: new Date(first?.at ?? Date.now()).toISOString(),
    instruction,
    promptVariant,
    character,
    target,
    decisions,
    discarded,
    transportErrors,
    cadence: {
      decisions: decisions.length,
      elapsedMs,
      perSecond: Math.round(perSecond * 1000) / 1000,
    },
    outcome,
    model,
    ...(fault !== undefined ? { fault } : {}),
    rawLines: mine.length,
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const variant = args[1] ?? "unrecorded";
  const text = await Bun.file(logPath()).text();
  const stamped = parseLog(text);
  const ids = runIds(stamped);
  const wanted =
    args[0] && args[0] !== "latest" ? args[0] : ids[ids.length - 1];
  if (!wanted) {
    process.stderr.write("No tactics runs found in the session log\n");
    process.exit(1);
  }
  process.stdout.write(
    JSON.stringify(distil(stamped, wanted, variant), null, 2) + "\n",
  );
}

if (import.meta.main) await main();
