import type { MovementDirection } from "wow/control";
import { DEFAULT_FIGHT_INSTRUCTION } from "wow/standing-instructions";
import { parseFramingVariant, type FramingVariant } from "wow/framing";

export type CliAction =
  | { mode: "interactive" }
  | { mode: "daemon" }
  | { mode: "version" }
  | { mode: "setup"; args: string[] }
  | { mode: "help" }
  | { mode: "stop" }
  | { mode: "status" }
  | { mode: "start" }
  | { mode: "logs" }
  | { mode: "read"; wait: number | undefined; json: boolean }
  | { mode: "tail"; json: boolean }
  | { mode: "say"; message: string; json: boolean; wait: number | undefined }
  | { mode: "slash"; input: string; json: boolean; wait: number | undefined }
  | { mode: "yell"; message: string; json: boolean; wait: number | undefined }
  | { mode: "guild"; message: string; json: boolean; wait: number | undefined }
  | { mode: "party"; message: string; json: boolean; wait: number | undefined }
  | {
      mode: "whisper";
      target: string;
      message: string;
      json: boolean;
      wait: number | undefined;
    }
  | { mode: "who"; filter: string | undefined; json: boolean }
  | { mode: "control"; json: boolean }
  | { mode: "move"; direction: MovementDirection; durationMs: number }
  | { mode: "face"; orientation: number }
  | { mode: "target"; guid: bigint }
  | { mode: "halt" }
  | { mode: "nearby"; json: boolean; all?: boolean }
  | { mode: "combat"; json: boolean }
  | { mode: "spells"; json: boolean }
  | { mode: "cast"; spellId: number; guid: bigint }
  | { mode: "attack"; guid: bigint }
  | { mode: "cancel_cast" }
  | { mode: "stop_attack" }
  | {
      mode: "fight";
      guid: bigint;
      instruction: string;
      framing?: FramingVariant;
    }
  | { mode: "tactics"; json: boolean }
  | { mode: "goto"; x: number; y: number; z: number }
  | { mode: "navigation"; json: boolean }
  | { mode: "follow"; guid: bigint; distance?: number }
  | { mode: "following"; json: boolean }
  | { mode: "recovery"; json: boolean }
  | { mode: "query_corpse" }
  | { mode: "release_spirit" }
  | { mode: "reclaim_corpse" }
  | { mode: "resurrect"; accept: boolean }
  | { mode: "quests"; json: boolean }
  | { mode: "talk"; guid: bigint }
  | { mode: "query_quest"; questId: number }
  | { mode: "select_option"; optionId: number; code?: string }
  | { mode: "select_quest"; questId: number }
  | { mode: "accept_quest" }
  | { mode: "complete_quest"; questId: number }
  | { mode: "request_reward" }
  | { mode: "choose_reward"; index: number }
  | { mode: "abandon_quest"; slot: number }
  | { mode: "cancel_interaction" }
  | { mode: "inventory"; json: boolean }
  | { mode: "loot"; json: boolean }
  | { mode: "open_loot"; guid: bigint }
  | { mode: "take_loot"; slot: number }
  | { mode: "take_money" }
  | { mode: "release_loot" }
  | { mode: "skill" };

const SUBCOMMANDS = new Set([
  "setup",
  "start",
  "stop",
  "status",
  "read",
  "tail",
  "logs",
  "help",
  "version",
  "send",
  "who",
  "skill",
  "control",
  "move",
  "face",
  "target",
  "halt",
  "nearby",
  "combat",
  "spells",
  "cast",
  "attack",
  "cancel-cast",
  "stop-attack",
  "fight",
  "tactics",
  "goto",
  "navigation",
  "follow",
  "following",
  "recovery",
  "query-corpse",
  "release-spirit",
  "reclaim-corpse",
  "resurrect",
  "quests",
  "talk",
  "query-quest",
  "select-option",
  "select-quest",
  "accept-quest",
  "complete-quest",
  "request-reward",
  "choose-reward",
  "abandon-quest",
  "cancel-interaction",
  "inventory",
  "loot",
  "open-loot",
  "take-loot",
  "take-money",
  "release-loot",
]);

function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

function flagValue(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx !== -1 ? args[idx + 1] : undefined;
}

function parseWaitFlag(args: string[]): number | undefined {
  const raw = flagValue(args, "--wait");
  if (raw === undefined) return undefined;
  const n = parseFloat(raw);
  if (!Number.isFinite(n) || n < 0)
    throw new Error(`Invalid --wait value: ${raw}`);
  return n;
}

function parseRead(args: string[]): CliAction {
  const rest = args.slice(1);
  return {
    mode: "read",
    wait: parseWaitFlag(rest),
    json: hasFlag(rest, "--json"),
  };
}

function parseTail(args: string[]): CliAction {
  return { mode: "tail", json: hasFlag(args.slice(1), "--json") };
}

function parseWho(args: string[]): CliAction {
  const rest = args.slice(1);
  const next = rest[0];
  return {
    mode: "who",
    filter: next && !next.startsWith("-") ? next : undefined,
    json: hasFlag(rest, "--json"),
  };
}

function parseSend(args: string[]): CliAction {
  const rest = args.slice(1);
  const json = hasFlag(rest, "--json");
  const wait = parseWaitFlag(rest);
  const filtered = filterFlags(rest);

  if (hasFlag(filtered, "-w")) {
    const idx = filtered.indexOf("-w");
    return {
      mode: "whisper",
      target: filtered[idx + 1] ?? "",
      message: filtered.slice(idx + 2).join(" "),
      json,
      wait,
    };
  }
  if (hasFlag(filtered, "-y")) {
    const idx = filtered.indexOf("-y");
    return {
      mode: "yell",
      message: filtered.slice(idx + 1).join(" "),
      json,
      wait,
    };
  }
  if (hasFlag(filtered, "-g")) {
    const idx = filtered.indexOf("-g");
    return {
      mode: "guild",
      message: filtered.slice(idx + 1).join(" "),
      json,
      wait,
    };
  }
  if (hasFlag(filtered, "-p")) {
    const idx = filtered.indexOf("-p");
    return {
      mode: "party",
      message: filtered.slice(idx + 1).join(" "),
      json,
      wait,
    };
  }

  const message = filtered.filter((a) => a !== "-s").join(" ");
  if (message.startsWith("/"))
    return { mode: "slash", input: message, json, wait };
  return { mode: "say", message, json, wait };
}

function parseSubcommand(args: string[]): CliAction | undefined {
  const cmd = args[0];
  if (!cmd || !SUBCOMMANDS.has(cmd)) return undefined;

  switch (cmd) {
    case "setup":
      return { mode: "setup", args: args.slice(1) };
    case "start":
      return { mode: "start" };
    case "read":
      return parseRead(args);
    case "tail":
      return parseTail(args);
    case "send":
      return parseSend(args);
    case "who":
      return parseWho(args);
    case "control":
      return {
        mode: "control",
        json: hasFlag(args.slice(1), "--json"),
      };
    case "nearby": {
      const all = hasFlag(args.slice(1), "--all");
      return {
        mode: "nearby",
        json: hasFlag(args.slice(1), "--json"),
        ...(all ? { all: true } : {}),
      };
    }
    case "move":
      return parseMove(args);
    case "face":
      return parseFace(args);
    case "target":
      return parseTarget(args);
    case "halt":
      return { mode: "halt" };
    case "combat":
    case "spells":
    case "tactics":
    case "navigation":
    case "following":
    case "recovery":
    case "quests":
    case "inventory":
    case "loot":
      return { mode: cmd, json: hasFlag(args.slice(1), "--json") };
    case "cast":
      return parseCast(args);
    case "attack":
      return parseAttack(args);
    case "cancel-cast":
      return { mode: "cancel_cast" };
    case "stop-attack":
      return { mode: "stop_attack" };
    case "fight":
      return parseFight(args);
    case "goto":
      return parseGoto(args);
    case "follow":
      return parseFollow(args);
    case "query-corpse":
      if (args.length !== 1) throw new Error("Invalid query-corpse arguments");
      return { mode: "query_corpse" };
    case "release-spirit":
      if (args.length !== 1)
        throw new Error("Invalid release-spirit arguments");
      return { mode: "release_spirit" };
    case "reclaim-corpse":
      if (args.length !== 1)
        throw new Error("Invalid reclaim-corpse arguments");
      return { mode: "reclaim_corpse" };
    case "resurrect":
      if (args.length !== 2 || (args[1] !== "accept" && args[1] !== "decline"))
        throw new Error("Invalid resurrect arguments");
      return { mode: "resurrect", accept: args[1] === "accept" };
    case "talk": {
      if (args.length !== 2) throw new Error("Invalid talk arguments");
      const guid = parseGuid(args[1]!);
      if (guid === undefined || guid === 0n)
        throw new Error("Invalid talk guid");
      return { mode: "talk", guid };
    }
    case "query-quest":
      return {
        mode: "query_quest",
        questId: parseBoundedArgument(args, 1, 0xffff_ffff),
      };
    case "select-quest":
      return {
        mode: "select_quest",
        questId: parseBoundedArgument(args, 1, 0xffff_ffff),
      };
    case "complete-quest":
      return {
        mode: "complete_quest",
        questId: parseBoundedArgument(args, 1, 0xffff_ffff),
      };
    case "choose-reward":
      return { mode: "choose_reward", index: parseBoundedArgument(args, 0, 5) };
    case "abandon-quest":
      return { mode: "abandon_quest", slot: parseBoundedArgument(args, 0, 24) };
    case "select-option":
      return parseSelectOption(args);
    case "accept-quest":
      if (args.length !== 1) throw new Error("Invalid accept-quest arguments");
      return { mode: "accept_quest" };
    case "request-reward":
      if (args.length !== 1)
        throw new Error("Invalid request-reward arguments");
      return { mode: "request_reward" };
    case "cancel-interaction":
      if (args.length !== 1)
        throw new Error("Invalid cancel-interaction arguments");
      return { mode: "cancel_interaction" };
    case "open-loot": {
      if (args.length !== 2) throw new Error("Invalid open-loot arguments");
      const guid = parseGuid(args[1]!);
      if (guid === undefined || guid === 0n)
        throw new Error("Invalid loot guid");
      return { mode: "open_loot", guid };
    }
    case "take-loot":
      return { mode: "take_loot", slot: parseBoundedArgument(args, 0, 255) };
    case "take-money":
      if (args.length !== 1) throw new Error("Invalid take-money arguments");
      return { mode: "take_money" };
    case "release-loot":
      if (args.length !== 1) throw new Error("Invalid release-loot arguments");
      return { mode: "release_loot" };
    default:
      return { mode: cmd } as CliAction;
  }
}

function filterFlags(args: string[]): string[] {
  const result: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--json") continue;
    if (args[i] === "--wait") {
      i++;
      continue;
    }
    result.push(args[i]!);
  }
  return result;
}

function parseFlagCommands(args: string[]): CliAction | undefined {
  if (hasFlag(args, "--help") || hasFlag(args, "-h")) return { mode: "help" };
  if (hasFlag(args, "--version") || hasFlag(args, "-v"))
    return { mode: "version" };
  if (hasFlag(args, "--daemon")) return { mode: "daemon" };

  if (hasFlag(args, "-w")) {
    const filtered = filterFlags(args);
    const idx = filtered.indexOf("-w");
    return {
      mode: "whisper",
      target: filtered[idx + 1] ?? "",
      message: filtered.slice(idx + 2).join(" "),
      json: hasFlag(args, "--json"),
      wait: parseWaitFlag(args),
    };
  }

  if (hasFlag(args, "-y")) {
    const filtered = filterFlags(args);
    const idx = filtered.indexOf("-y");
    return {
      mode: "yell",
      message: filtered.slice(idx + 1).join(" "),
      json: hasFlag(args, "--json"),
      wait: parseWaitFlag(args),
    };
  }

  if (hasFlag(args, "-g")) {
    const filtered = filterFlags(args);
    const idx = filtered.indexOf("-g");
    return {
      mode: "guild",
      message: filtered.slice(idx + 1).join(" "),
      json: hasFlag(args, "--json"),
      wait: parseWaitFlag(args),
    };
  }

  if (hasFlag(args, "-p")) {
    const filtered = filterFlags(args);
    const idx = filtered.indexOf("-p");
    return {
      mode: "party",
      message: filtered.slice(idx + 1).join(" "),
      json: hasFlag(args, "--json"),
      wait: parseWaitFlag(args),
    };
  }

  return undefined;
}

export function parseArgs(args: string[]): CliAction {
  if (args.length === 0) return { mode: "interactive" };

  const sub = parseSubcommand(args);
  if (sub) return sub;

  const flag = parseFlagCommands(args);
  if (flag) return flag;

  throw new Error(
    `Unknown command: ${args.join(" ")}\nRun tuicraft --help for usage.`,
  );
}

const DIRECTIONS: readonly MovementDirection[] = [
  "forward",
  "backward",
  "left",
  "right",
];
const DEFAULT_MOVE_MS = 1000;
const MIN_MOVE_MS = 1;
const MAX_MOVE_MS = 10_000;
const MAX_GUID = 0xffff_ffff_ffff_ffffn;

function parseDirection(
  raw: string | undefined,
): MovementDirection | undefined {
  if (!raw) return undefined;
  const value = raw.toLowerCase() as MovementDirection;
  return DIRECTIONS.includes(value) ? value : undefined;
}

function parseDuration(raw: string | undefined): number | undefined {
  if (raw === undefined) return DEFAULT_MOVE_MS;
  if (!/^[0-9]+$/.test(raw)) return undefined;
  const ms = Number(raw);
  if (ms < MIN_MOVE_MS || ms > MAX_MOVE_MS) return undefined;
  return ms;
}

function parseGuid(raw: string): bigint | undefined {
  if (!/^0[xX][0-9a-fA-F]+$/.test(raw) && !/^[0-9]+$/.test(raw)) {
    return undefined;
  }
  try {
    const guid = BigInt(raw);
    if (guid <= MAX_GUID) return guid;
  } catch {}
  return undefined;
}

function parseMove(args: string[]): CliAction {
  const rest = args.slice(1);
  const direction = parseDirection(rest[0]);
  if (!direction) {
    throw new Error(`Invalid move direction: ${rest[0] ?? ""}`);
  }
  if (rest.length > 2) throw new Error("Invalid move arguments");
  const durationMs = parseDuration(rest[1]);
  if (durationMs === undefined) {
    throw new Error(`Invalid move duration: ${rest[1]}`);
  }
  return { mode: "move", direction, durationMs };
}

function parseFace(args: string[]): CliAction {
  const raw = args[1];
  if (raw === undefined || args.length !== 2 || raw.trim() === "") {
    throw new Error("Invalid face arguments");
  }
  const orientation = Number(raw);
  if (!Number.isFinite(orientation)) {
    throw new Error(`Invalid facing: ${raw}`);
  }
  return { mode: "face", orientation };
}

function parseTarget(args: string[]): CliAction {
  const raw = args[1];
  if (raw === undefined || args.length !== 2) {
    throw new Error("Invalid target arguments");
  }
  const guid = parseGuid(raw);
  if (guid === undefined) throw new Error(`Invalid target guid: ${raw}`);
  return { mode: "target", guid };
}

const MAX_SPELL_ID = 0xffff_ffff;

function parseSpellId(raw: string): number | undefined {
  if (!/^[0-9]+$/.test(raw)) return undefined;
  const id = Number(raw);
  if (!Number.isInteger(id) || id < 1 || id > MAX_SPELL_ID) return undefined;
  return id;
}

function parseFiniteNumber(raw: string): number | undefined {
  const value = Number(raw);
  if (raw.trim() === "" || !Number.isFinite(value)) return undefined;
  return value;
}

function parseCast(args: string[]): CliAction {
  const spellRaw = args[1];
  const guidRaw = args[2];
  if (spellRaw === undefined || guidRaw === undefined || args.length !== 3) {
    throw new Error("Invalid cast arguments");
  }
  const spellId = parseSpellId(spellRaw);
  if (spellId === undefined) throw new Error(`Invalid spell id: ${spellRaw}`);
  const guid = parseGuid(guidRaw);
  if (guid === undefined) throw new Error(`Invalid target guid: ${guidRaw}`);
  return { mode: "cast", spellId, guid };
}

function parseAttack(args: string[]): CliAction {
  const raw = args[1];
  if (raw === undefined || args.length !== 2) {
    throw new Error("Invalid attack arguments");
  }
  const guid = parseGuid(raw);
  if (guid === undefined) throw new Error(`Invalid target guid: ${raw}`);
  return { mode: "attack", guid };
}

function parseFight(args: string[]): CliAction {
  const rest = args.slice(1);
  if (rest.length === 0) throw new Error("Invalid fight arguments");
  let framing: FramingVariant | undefined;
  const filtered: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const part = rest[i]!;
    if (part === "--framing") {
      const next = rest[i + 1];
      if (!next) throw new Error("Missing value for --framing");
      framing = parseFramingVariant(next);
      i++;
    } else if (part.startsWith("--framing=")) {
      const val = part.slice("--framing=".length);
      framing = parseFramingVariant(val);
    } else {
      filtered.push(part);
    }
  }
  framing ??= parseFramingVariant(process.env["WOW_JEV_FRAMING"]);
  const raw = filtered[0];
  if (raw === undefined) throw new Error("Invalid fight arguments");
  const guid = parseGuid(raw);
  if (guid === undefined) throw new Error(`Invalid target guid: ${raw}`);
  const instruction = filtered.slice(1).join(" ") || DEFAULT_FIGHT_INSTRUCTION;
  if (/[\r\n]/.test(instruction)) {
    throw new Error("Fight instruction must not contain line breaks");
  }
  return { mode: "fight", guid, instruction, framing };
}

function parseGoto(args: string[]): CliAction {
  if (args.length !== 4) throw new Error("Invalid goto arguments");
  const x = parseFiniteNumber(args[1]!);
  const y = parseFiniteNumber(args[2]!);
  const z = parseFiniteNumber(args[3]!);
  if (x === undefined || y === undefined || z === undefined) {
    throw new Error("Invalid goto arguments");
  }
  return { mode: "goto", x, y, z };
}

function parseFollow(args: string[]): CliAction {
  if (args.length < 2 || args.length > 3)
    throw new Error("Invalid follow arguments");
  const guid = parseGuid(args[1]!);
  if (guid === undefined || guid === 0n)
    throw new Error(`Invalid follow guid: ${args[1]}`);
  const raw = args[2];
  const distance = raw === undefined ? undefined : parseFiniteNumber(raw);
  if (
    raw !== undefined &&
    (distance === undefined || distance < 1 || distance > 20)
  )
    throw new Error(`Invalid follow distance: ${raw}`);
  return { mode: "follow", guid, distance };
}

function parseBoundedArgument(
  args: string[],
  min: number,
  max: number,
): number {
  if (args.length !== 2) throw new Error(`Invalid ${args[0]} arguments`);
  const value = parseUnsignedInteger(args[1]!);
  if (value === undefined || value < min || value > max)
    throw new Error(`Invalid ${args[0]} value`);
  return value;
}

function parseUnsignedInteger(raw: string): number | undefined {
  if (!/^[0-9]+$/.test(raw)) return undefined;
  const value = Number(raw);
  return Number.isInteger(value) && value <= 0xffff_ffff ? value : undefined;
}

function parseSelectOption(args: string[]): CliAction {
  if (args.length < 2 || args.length > 3)
    throw new Error("Invalid select-option arguments");
  const optionId = parseUnsignedInteger(args[1]!);
  if (optionId === undefined) throw new Error("Invalid gossip option id");
  const code = args[2];
  if (code?.includes("\0")) throw new Error("Invalid gossip code");
  return { mode: "select_option", optionId, code };
}
