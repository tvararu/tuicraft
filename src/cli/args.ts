import type { MovementDirection } from "wow/control";
import type { WalkTarget } from "wow/client";
import { DEFAULT_FIGHT_INSTRUCTION } from "wow/tactics";
import { parseFramingVariant, type FramingVariant } from "wow/framing";

export type CliAction =
  | { mode: "interactive" }
  | { mode: "daemon" }
  | { mode: "version" }
  | { mode: "setup"; args: string[] }
  | { mode: "help" }
  | { mode: "stop"; json?: true }
  | { mode: "status"; json?: true }
  | { mode: "start"; json?: true }
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
  | {
      mode: "move";
      direction: MovementDirection;
      durationMs: number;
      json?: true;
    }
  | { mode: "face"; orientation: number; json?: true }
  | { mode: "face_guid"; guid: bigint; json?: true }
  | { mode: "walk_toward"; yards: number; target: WalkTarget; json?: true }
  | { mode: "target"; guid: bigint; json?: true }
  | { mode: "halt"; json?: true }
  | { mode: "nearby"; json: boolean; all?: boolean }
  | { mode: "combat"; json: boolean }
  | { mode: "spells"; json: boolean }
  | { mode: "cast"; spellId: number; guid: bigint; json?: true }
  | { mode: "attack"; guid: bigint; json?: true }
  | { mode: "cancel_cast"; json?: true }
  | { mode: "stop_attack"; json?: true }
  | {
      mode: "fight";
      guid: bigint;
      instruction: string;
      framing?: FramingVariant;
      json?: true;
    }
  | { mode: "tactics"; json: boolean }
  | {
      mode: "cycle";
      guids: bigint[];
      instruction: string;
      maxStarts: number;
      json?: true;
    }
  | { mode: "cycling"; json: boolean }
  | { mode: "goto"; x: number; y: number; z: number; json?: true }
  | { mode: "navigation"; json: boolean }
  | { mode: "recovery"; json: boolean }
  | { mode: "query_corpse"; json?: true }
  | { mode: "release_spirit"; json?: true }
  | { mode: "reclaim_corpse"; json?: true }
  | { mode: "spirit_healer"; guid: bigint; json?: true }
  | { mode: "resurrect"; accept: boolean; json?: true }
  | { mode: "quests"; json: boolean }
  | { mode: "talk"; guid: bigint; json?: true }
  | { mode: "query_quest"; questId: number; json?: true }
  | {
      mode: "select_option";
      optionId: number;
      code?: string;
      json?: true;
    }
  | { mode: "select_quest"; questId: number; json?: true }
  | { mode: "accept_quest"; json?: true }
  | { mode: "complete_quest"; questId: number; json?: true }
  | { mode: "request_reward"; json?: true }
  | { mode: "choose_reward"; index: number; json?: true }
  | { mode: "abandon_quest"; slot: number; json?: true }
  | { mode: "cancel_interaction"; json?: true }
  | { mode: "inventory"; json: boolean }
  | { mode: "loot"; json: boolean }
  | { mode: "open_loot"; guid: bigint; json?: true }
  | { mode: "take_loot"; slot: number; json?: true }
  | { mode: "take_money"; json?: true }
  | { mode: "release_loot"; json?: true }
  | { mode: "skill" };

const SUBCOMMANDS = new Set([
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
  "face-guid",
  "walk-toward",
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
  "cycle",
  "cycling",
  "goto",
  "navigation",
  "recovery",
  "query-corpse",
  "release-spirit",
  "reclaim-corpse",
  "spirit-healer",
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

function parseWaitFlag(args: string[]): number | undefined {
  const idx = args.indexOf("--wait");
  if (idx === -1) return undefined;
  const raw = args[idx + 1];
  if (raw === undefined) throw new Error("Invalid --wait value: missing");
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
    case "face-guid":
      return parseFaceGuid(args);
    case "walk-toward":
      return parseWalkToward(args);
    case "target":
      return parseTarget(args);
    case "halt":
      return { mode: "halt" };
    case "combat":
    case "spells":
    case "tactics":
    case "cycling":
    case "navigation":
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
    case "cycle":
      return parseCycle(args);
    case "goto":
      return parseGoto(args);
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
    case "spirit-healer": {
      if (args.length !== 2) throw new Error("Invalid spirit-healer arguments");
      const guid = parseGuid(args[1]!);
      if (guid === undefined || guid === 0n)
        throw new Error("Invalid spirit-healer guid");
      return { mode: "spirit_healer", guid };
    }
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

const SETUP_VALUE_FLAGS: Record<string, true> = {
  "--account": true,
  "--password": true,
  "--character": true,
  "--host": true,
  "--port": true,
  "--language": true,
  "--timeout_minutes": true,
};

export function hasJsonOption(args: string[]): boolean {
  if (args[0] !== "setup") return args.includes("--json");
  for (let i = 1; i < args.length; i++) {
    if (args[i] === "--json" && !SETUP_VALUE_FLAGS[args[i - 1]!]) return true;
  }
  return false;
}

export function commandNameFromArgs(args: string[]): string | null {
  const first = args.find((arg) => arg !== "--json");
  if (!first) return null;
  if (SUBCOMMANDS.has(first)) return first;
  switch (first) {
    case "-w":
    case "-y":
    case "-g":
    case "-p":
      return "send";
    case "-h":
    case "--help":
      return "help";
    case "-v":
    case "--version":
      return "version";
    case "--daemon":
      return "daemon";
    default:
      return null;
  }
}

function withJson(action: CliAction, json: boolean): CliAction {
  if (!json) return action;
  switch (action.mode) {
    case "interactive":
    case "daemon":
    case "version":
    case "setup":
    case "help":
    case "logs":
    case "skill":
      throw new Error(`--json is not supported for ${action.mode}`);
    default:
      return { ...action, json: true };
  }
}

export function parseArgs(args: string[]): CliAction {
  if (args.length === 0) return { mode: "interactive" };
  if (args[0] === "setup") {
    if (hasJsonOption(args))
      throw new Error("--json is not supported for setup");
    return { mode: "setup", args: args.slice(1) };
  }

  const json = hasJsonOption(args);
  const withoutJson = json
    ? args.filter(
        (arg, index) => arg !== "--json" || args[index - 1] === "--wait",
      )
    : args;
  const sub = parseSubcommand(withoutJson);
  if (sub) return withJson(sub, json);

  const flag = parseFlagCommands(withoutJson);
  if (flag) return withJson(flag, json);

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
function parseFaceGuid(args: string[]): CliAction {
  const guid = args.length === 2 ? parseGuid(args[1]!) : undefined;
  if (guid === undefined || guid === 0n)
    throw new Error("Invalid face-guid arguments");
  return { mode: "face_guid", guid };
}

function parseWalkToward(args: string[]): CliAction {
  const yards = args[1] === undefined ? undefined : parseFiniteNumber(args[1]);
  if (yards === undefined || yards <= 0 || yards > 20)
    throw new Error("Invalid walk-toward distance");
  if (args.length === 3) {
    const guid = parseGuid(args[2]!);
    if (guid === undefined || guid === 0n)
      throw new Error("Invalid walk-toward target");
    return { mode: "walk_toward", yards, target: { kind: "guid", guid } };
  }
  if (args.length !== 5) throw new Error("Invalid walk-toward destination");
  const x = parseFiniteNumber(args[2]!);
  const y = parseFiniteNumber(args[3]!);
  const z = parseFiniteNumber(args[4]!);
  if (x === undefined || y === undefined || z === undefined)
    throw new Error("Invalid walk-toward destination");
  return { mode: "walk_toward", yards, target: { kind: "point", x, y, z } };
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

const DEFAULT_CYCLE_MAX_STARTS = 10;
const CYCLE_FLAGS = ["--max", "--instruction"];

function isCycleFlag(token: string): boolean {
  return CYCLE_FLAGS.some(
    (flag) => token === flag || token.startsWith(`${flag}=`),
  );
}

function parseCycleMax(raw: string): number {
  if (!/^[0-9]+$/.test(raw)) throw new Error("Invalid cycle max");
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error("Invalid cycle max");
  }
  return value;
}

function parseCycle(args: string[]): CliAction {
  const rest = args.slice(1);
  if (rest.length === 0) throw new Error("Invalid cycle arguments");
  let maxStarts: number | undefined;
  let instructionWords: string[] | undefined;
  const guidTokens: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const part = rest[i]!;
    if (part === "--max") {
      const next = rest[i + 1];
      if (next === undefined) throw new Error("Invalid cycle max");
      maxStarts = parseCycleMax(next);
      i++;
    } else if (part.startsWith("--max=")) {
      maxStarts = parseCycleMax(part.slice("--max=".length));
    } else if (part === "--instruction") {
      const words: string[] = [];
      let j = i + 1;
      while (j < rest.length && !isCycleFlag(rest[j]!)) {
        words.push(rest[j]!);
        j++;
      }
      instructionWords = words;
      i = j - 1;
    } else if (part.startsWith("--instruction=")) {
      instructionWords = [part.slice("--instruction=".length)];
    } else {
      guidTokens.push(part);
    }
  }
  if (guidTokens.length === 0) throw new Error("Invalid cycle arguments");
  const guids: bigint[] = [];
  for (const token of guidTokens) {
    const guid = parseGuid(token);
    if (guid === undefined || guid === 0n) {
      throw new Error("Invalid cycle guid");
    }
    guids.push(guid);
  }
  const instruction = instructionWords?.join(" ") || DEFAULT_FIGHT_INSTRUCTION;
  if (/[\r\n]/.test(instruction)) {
    throw new Error("Cycle instruction must not contain line breaks");
  }
  return {
    mode: "cycle",
    guids,
    instruction,
    maxStarts: maxStarts ?? DEFAULT_CYCLE_MAX_STARTS,
  };
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
