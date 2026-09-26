export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export type JsonObject = { [key: string]: JsonValue };
export type OutputStage = "arguments" | "startup" | "command" | "wait";
export type OutputEnvelope = {
  command: string | null;
  kind: "intent" | "result" | "events" | "error";
  data: JsonValue | null;
  events: JsonObject[];
  error: { stage: OutputStage; message: string } | null;
};
export type ReplyKind = "intent" | "json" | "nearby" | "events" | "slash";

export function resultEnvelope(
  command: string,
  data: JsonValue,
): OutputEnvelope {
  return { command, data, error: null, events: [], kind: "result" };
}

export function errorEnvelope(
  command: string | null,
  stage: OutputStage,
  message: string,
  previous?: OutputEnvelope,
): OutputEnvelope {
  if (stage === "wait" && previous) {
    return {
      command,
      data: previous.data,
      error: { message, stage },
      events: previous.events,
      kind: previous.kind,
    };
  }
  return {
    command,
    data: null,
    error: { message, stage },
    events: [],
    kind: "error",
  };
}

function daemonError(line: string): string | null {
  if (line === "ERR") return line;
  if (line.startsWith("ERR ")) return line.slice(4) || "ERR";
  if (line === "UNIMPLEMENTED") return line;
  if (line.startsWith("UNIMPLEMENTED "))
    return line.slice("UNIMPLEMENTED ".length) || "UNIMPLEMENTED";
  return null;
}

function parseObjects(lines: string[]): JsonObject[] | null {
  const objects: JsonObject[] = [];
  try {
    for (const line of lines) {
      const value: unknown = JSON.parse(line);
      if (value === null || Array.isArray(value) || typeof value !== "object")
        return null;
      objects.push(value as JsonObject);
    }
  } catch {
    return null;
  }
  return objects;
}

function decodeObjectReply(
  command: string,
  kind: "nearby" | "events",
  lines: string[],
): OutputEnvelope {
  const objects = parseObjects(lines);
  if (!objects)
    return errorEnvelope(command, "command", "invalid JSON object reply");
  if (kind === "nearby") return resultEnvelope(command, objects);
  return {
    command,
    data: null,
    error: null,
    events: objects,
    kind: "events",
  };
}

function decodeLineReply(
  command: string,
  kind: "intent" | "json" | "slash",
  lines: string[],
): OutputEnvelope {
  const [line] = lines;
  if (line === undefined)
    return errorEnvelope(command, "command", "empty reply");
  const acknowledged = line === "OK" || line.startsWith("OK ");

  if (kind === "intent" || (kind === "slash" && acknowledged)) {
    if (lines.length !== 1 || !acknowledged)
      return errorEnvelope(command, "command", "invalid intent reply");
    return { command, data: null, error: null, events: [], kind: "intent" };
  }

  if (kind === "slash") return resultEnvelope(command, { lines });
  if (lines.length !== 1)
    return errorEnvelope(command, "command", "invalid JSON reply");
  try {
    const data: JsonValue = JSON.parse(line);
    return resultEnvelope(command, data);
  } catch {
    return errorEnvelope(command, "command", "invalid JSON reply");
  }
}

export function decodeReply(
  command: string,
  kind: ReplyKind,
  lines: string[],
): OutputEnvelope {
  for (const line of lines) {
    const message = daemonError(line);
    if (message !== null) return errorEnvelope(command, "command", message);
  }
  if (kind === "nearby" || kind === "events")
    return decodeObjectReply(command, kind, lines);
  return decodeLineReply(command, kind, lines);
}

export function daemonCommandFailed(lines: string[]): boolean {
  return lines.some((line) => line.startsWith("ERR"));
}

export function walkCommandFailed(lines: string[]): boolean {
  const [line] = lines;
  if (line === undefined || lines.length !== 1 || daemonCommandFailed(lines))
    return true;
  try {
    const outcome: unknown = JSON.parse(line);
    return (
      typeof outcome !== "object" ||
      outcome === null ||
      !("status" in outcome) ||
      outcome.status !== "completed"
    );
  } catch {
    return true;
  }
}

export function decodeWalkReply(
  command: string,
  lines: string[],
): OutputEnvelope {
  const reply = decodeReply(command, "json", lines);
  if (reply.error || !walkCommandFailed(lines)) return reply;
  return {
    ...reply,
    error: { message: "walk stopped without completion", stage: "command" },
  };
}

const RUNS: Record<string, string> = { cycle: "cycling", fight: "tactics" };
const LOOT = ["open-loot", "take-loot", "take-money", "release-loot"];
const RECOVERY = [
  "query-corpse",
  "release-spirit",
  "reclaim-corpse",
  "spirit-healer",
  "resurrect",
];

export function formatHumanIntent(command: string, lines: string[]): string[] {
  if (lines.length !== 1 || (lines[0] !== "OK" && !lines[0]?.startsWith("OK ")))
    return lines;
  const run = RUNS[command];
  if (run)
    return [`The ${command} run ended. Check tuicraft ${run} for its outcome.`];
  let inspection: string | undefined;
  if (LOOT.includes(command)) inspection = "loot";
  else if (RECOVERY.includes(command)) inspection = "recovery";
  return [
    `Daemon accepted request. ${inspection ? `Check tuicraft ${inspection} for observed results.` : "No server result confirmed."}`,
  ];
}
