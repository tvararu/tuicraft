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

function object(value: JsonValue | undefined): JsonObject | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value
    : undefined;
}

function label(value: JsonValue | undefined): string {
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : "unknown";
}

function formatCycleLoot(loot: JsonObject): string[] {
  const coinage =
    typeof loot["coinageBefore"] === "number" &&
    typeof loot["coinageAfter"] === "number"
      ? `${loot["coinageBefore"]} -> ${loot["coinageAfter"]}`
      : "unknown";
  const slots = Array.isArray(loot["slotsTaken"]) ? loot["slotsTaken"] : [];
  return [
    `Money: ${label(loot["moneyTaken"])} copper requested`,
    `Coinage change: ${coinage}`,
    `Item slots requested: ${slots.length ? slots.map(label).join(", ") : "none"}`,
  ];
}

function formatCycle(data: JsonObject): string[] {
  const lines = [
    `Cycle: ${label(data["phase"])}`,
    `Starts: ${label(data["startsUsed"])}/${label(data["maxStarts"])}`,
  ];
  for (const entry of Array.isArray(data["queue"]) ? data["queue"] : []) {
    const target = object(entry);
    const outcome = object(target?.["outcome"]);
    const xp = object(object(outcome?.["observation"])?.["lastXp"]);
    const reason = outcome?.["reason"] ?? target?.["cause"];
    const credit =
      reason === "server_kill_credit" &&
      xp?.["kind"] === "kill" &&
      xp["victim"] === target?.["guid"] &&
      typeof xp["total"] === "number"
        ? `, ${xp["total"]} XP`
        : "";
    lines.push(
      `Target ${label(target?.["guid"])}: ${label(target?.["status"])} (${label(reason)})${credit}`,
    );
  }
  const loot = object(data["lastLoot"]);
  if (loot) lines.push(...formatCycleLoot(loot));
  if (data["stopCause"]) lines.push(`Stop reason: ${label(data["stopCause"])}`);
  return lines;
}

function formatRecovery(data: JsonObject): string[] {
  const corpse = object(data["corpse"]);
  const reclaim = object(data["reclaim"]);
  const request = object(data["request"]);
  let reclaimAllowed = "unknown";
  if (reclaim?.["canRequest"] === true) reclaimAllowed = "yes";
  else if (reclaim?.["canRequest"] === false) reclaimAllowed = "no";
  const lines = [
    `Life: ${label(data["life"])}`,
    `Health: ${label(data["health"])}`,
    `Corpse: ${label(corpse?.["status"])}`,
    `Reclaim: ${label(reclaim?.["readiness"])}${reclaim?.["reason"] ? ` (${label(reclaim["reason"])})` : ""}`,
    `Reclaim request allowed: ${reclaimAllowed}`,
  ];
  if (corpse?.["status"] === "found")
    lines.push(
      `Corpse maps: ${label(corpse["mapId"])} / ${label(corpse["corpseMapId"])}`,
    );
  if (typeof reclaim?.["distance"] === "number")
    lines.push(`Corpse distance: ${reclaim["distance"].toFixed(2)} yards`);
  if (typeof reclaim?.["remainingMs"] === "number")
    lines.push(`Reclaim delay: ${reclaim["remainingMs"]} ms`);
  if (request)
    lines.push(
      `Request: ${label(request["action"])} ${label(request["status"])}`,
    );
  return lines;
}

function formatInventory(data: JsonObject): string[] {
  const slots = Array.isArray(data["slots"]) ? data["slots"] : [];
  const lines = [
    `Inventory: ${label(data["status"])} (carried)`,
    `Coinage: ${label(data["coinage"])}`,
    `Free slots: ${label(data["freeSlots"])}`,
  ];
  for (const value of slots) {
    const slot = object(value);
    if (slot?.["status"] !== "occupied") continue;
    const item = object(slot["item"]);
    lines.push(
      `Item ${label(item?.["entry"])} x${label(item?.["count"])} at bag ${label(slot["bag"])} slot ${label(slot["slot"])}`,
    );
  }
  lines.push(
    `Unknown slots: ${slots.filter((value) => object(value)?.["status"] === "unknown").length}`,
  );
  const issues = Array.isArray(data["issues"]) ? data["issues"] : [];
  if (issues.length) lines.push(`Inventory issues: ${issues.length}`);
  return lines;
}

function formatLootErrors(data: JsonObject): string[] {
  const lines: string[] = [];
  const inventory = object(data["lastInventoryError"]);
  if (inventory) {
    let reason = `code ${label(object(inventory["packet"])?.["result"])}`;
    if (inventory["inventoryFull"] === true) reason = "inventory full";
    else if (inventory["bagFull"] === true) reason = "bag full";
    lines.push(`Last inventory error: ${reason}`);
  }
  const loot = object(data["lastLootError"]);
  if (loot) lines.push(`Last loot error code: ${label(loot["error"])}`);
  return lines;
}

function formatLoot(data: JsonObject): string[] {
  const loot = object(data["loot"]);
  const pending = object(data["pending"]);
  const lines = [`Loot: ${label(loot?.["phase"])}`];
  if (loot?.["phase"] === "open" || loot?.["phase"] === "closing") {
    lines.push(`Offer: ${label(loot["money"])} copper`);
    for (const value of Array.isArray(loot["items"]) ? loot["items"] : []) {
      const item = object(value);
      let permission = "pickup permission unknown";
      if (item?.["slotType"] === 0 || item?.["slotType"] === 4)
        permission = "pickup allowed";
      else if (typeof item?.["slotType"] === "number")
        permission = "no direct pickup";
      lines.push(
        `Slot ${label(item?.["slot"])}: item ${label(item?.["itemId"])} x${label(item?.["count"])} (${permission})`,
      );
    }
  }
  if (pending)
    lines.push(
      `Request: ${label(pending["action"])} ${label(pending["status"])}`,
    );
  lines.push(
    `Carried coinage: ${label(object(data["inventory"])?.["coinage"])}`,
  );
  lines.push(...formatLootErrors(data));
  return lines;
}

export function formatHumanInspection(
  command: string,
  data: JsonValue,
): string[] {
  const state = object(data);
  if (!state) return [`${command}: unavailable`];
  switch (command) {
    case "cycling":
      return formatCycle(state);
    case "recovery":
      return formatRecovery(state);
    case "inventory":
      return formatInventory(state);
    case "loot":
      return formatLoot(state);
    default:
      return [JSON.stringify(data)];
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
