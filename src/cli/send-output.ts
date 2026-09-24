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
  return { command, kind: "result", data, events: [], error: null };
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
      kind: previous.kind,
      data: previous.data,
      events: previous.events,
      error: { stage, message },
    };
  }
  return {
    command,
    kind: "error",
    data: null,
    events: [],
    error: { stage, message },
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

export function decodeReply(
  command: string,
  kind: ReplyKind,
  lines: string[],
): OutputEnvelope {
  for (const line of lines) {
    const message = daemonError(line);
    if (message !== null) return errorEnvelope(command, "command", message);
  }

  if (kind === "nearby" || kind === "events") {
    const objects = parseObjects(lines);
    if (!objects)
      return errorEnvelope(command, "command", "invalid JSON object reply");
    if (kind === "nearby") return resultEnvelope(command, objects);
    return {
      command,
      kind: "events",
      data: null,
      events: objects,
      error: null,
    };
  }

  const [line] = lines;
  if (line === undefined)
    return errorEnvelope(command, "command", "empty reply");
  const acknowledged = line === "OK" || line.startsWith("OK ");

  if (kind === "intent" || (kind === "slash" && acknowledged)) {
    if (lines.length !== 1 || !acknowledged)
      return errorEnvelope(command, "command", "invalid intent reply");
    return { command, kind: "intent", data: null, events: [], error: null };
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

export function daemonCommandFailed(lines: string[]): boolean {
  return lines.some((line) => line.startsWith("ERR"));
}

export function walkCommandFailed(lines: string[]): boolean {
  if (lines.length !== 1 || daemonCommandFailed(lines)) return true;
  try {
    const outcome: unknown = JSON.parse(lines[0]!);
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

export function formatHumanIntent(command: string, lines: string[]): string[] {
  if (lines.length !== 1 || (lines[0] !== "OK" && !lines[0]?.startsWith("OK ")))
    return lines;
  let inspection: string | undefined;
  if (command === "cycle") inspection = "cycling";
  else if (command === "fight") inspection = "tactics";
  else if (
    ["open-loot", "take-loot", "take-money", "release-loot"].includes(command)
  )
    inspection = "loot";
  else if (
    [
      "query-corpse",
      "release-spirit",
      "reclaim-corpse",
      "spirit-healer",
      "resurrect",
    ].includes(command)
  )
    inspection = "recovery";
  return [
    `Daemon accepted request. ${inspection ? `Check tuicraft ${inspection} for observed results.` : "No server result confirmed."}`,
  ];
}
