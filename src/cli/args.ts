import { parseFramingVariant } from "wow/framing";
import type { FramingVariant } from "wow/framing";
import type { MovementDirection } from "wow/control";
import type { WalkTarget } from "wow/client";
import {
  parseBare,
  parseGuidArg,
  parseBoundedArg,
  parseQuestId,
  parseMove,
  parseFace,
  parseGoto,
  parseWalkToward,
  parseCast,
  parseResurrect,
  parseOptionId,
  parseFight,
  parseCycle,
  type Parsed,
} from "cli/tokens";

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
      maxStarts?: number;
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

const FIXED = new Map<string, CliAction>([
  ["start", { mode: "start" }],
  ["stop", { mode: "stop" }],
  ["status", { mode: "status" }],
  ["logs", { mode: "logs" }],
  ["help", { mode: "help" }],
  ["version", { mode: "version" }],
  ["skill", { mode: "skill" }],
  ["halt", { mode: "halt" }],
  ["cancel-cast", { mode: "cancel_cast" }],
  ["stop-attack", { mode: "stop_attack" }],
]);

const STRICT = new Map<string, CliAction>(
  (
    [
      "query_corpse",
      "release_spirit",
      "reclaim_corpse",
      "accept_quest",
      "request_reward",
      "cancel_interaction",
      "take_money",
      "release_loot",
    ] as const
  ).map((mode): [string, CliAction] => [mode.replaceAll("_", "-"), { mode }]),
);

const INSPECTIONS = [
  "control",
  "combat",
  "spells",
  "tactics",
  "cycling",
  "navigation",
  "recovery",
  "quests",
  "inventory",
  "loot",
] as const;

function isInspection(cmd: string): cmd is (typeof INSPECTIONS)[number] {
  return INSPECTIONS.some((view) => view === cmd);
}

function parseSubcommand(args: string[]): CliAction | undefined {
  const cmd = args[0];
  if (!cmd || !SUBCOMMANDS.has(cmd)) return undefined;
  const rest = args.slice(1);
  const fixed = FIXED.get(cmd);
  if (fixed) return fixed;
  const strict = STRICT.get(cmd);
  if (strict) {
    take(parseBare(rest, cmd));
    return strict;
  }
  if (isInspection(cmd)) return { mode: cmd, json: hasFlag(rest, "--json") };
  switch (cmd) {
    case "read":
      return parseRead(args);
    case "tail":
      return parseTail(args);
    case "send":
      return parseSend(args);
    case "who":
      return parseWho(args);
    case "nearby": {
      const all = hasFlag(rest, "--all");
      return {
        mode: "nearby",
        json: hasFlag(rest, "--json"),
        ...(all ? { all: true } : {}),
      };
    }
    default:
      return parseGameplay(cmd, rest);
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

function take<T>(parsed: Parsed<T>): T {
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.value;
}

function parseFightArgs(rest: string[]): CliAction {
  const fight = take(parseFight(rest));
  const framing =
    fight.framing ?? parseFramingVariant(process.env["WOW_JEV_FRAMING"]);
  return { mode: "fight", ...fight, framing };
}

function parseSelectOption(rest: string[]): CliAction {
  const optionId = rest.length <= 2 ? parseOptionId(rest[0]) : undefined;
  if (optionId === undefined) throw new Error("invalid gossip option id");
  const code = rest[1];
  if (code?.includes("\0")) throw new Error("invalid gossip code");
  return { mode: "select_option", optionId, code };
}

function parseGameplay(cmd: string, rest: string[]): CliAction | undefined {
  switch (cmd) {
    case "move":
      return { mode: "move", ...take(parseMove(rest)) };
    case "face":
      return { mode: "face", ...take(parseFace(rest)) };
    case "face-guid":
      return { mode: "face_guid", ...take(parseGuidArg(rest, true)) };
    case "walk-toward":
      return { mode: "walk_toward", ...take(parseWalkToward(rest)) };
    case "target":
      return { mode: "target", ...take(parseGuidArg(rest)) };
    case "cast":
      return { mode: "cast", ...take(parseCast(rest)) };
    case "attack":
      return { mode: "attack", ...take(parseGuidArg(rest)) };
    case "fight":
      return parseFightArgs(rest);
    case "cycle":
      return { mode: "cycle", ...take(parseCycle(rest)) };
    case "goto":
      return { mode: "goto", ...take(parseGoto(rest)) };
    case "spirit-healer":
      return { mode: "spirit_healer", ...take(parseGuidArg(rest, true)) };
    case "resurrect":
      return { mode: "resurrect", ...take(parseResurrect(rest)) };
    case "talk":
      return { mode: "talk", ...take(parseGuidArg(rest, true)) };
    case "query-quest":
      return { mode: "query_quest", ...take(parseQuestId(rest)) };
    case "select-quest":
      return { mode: "select_quest", ...take(parseQuestId(rest)) };
    case "complete-quest":
      return { mode: "complete_quest", ...take(parseQuestId(rest)) };
    case "choose-reward": {
      const index = take(parseBoundedArg(rest, 0, 5, "invalid reward index"));
      return { mode: "choose_reward", index };
    }
    case "abandon-quest": {
      const slot = take(parseBoundedArg(rest, 0, 24, "invalid quest slot"));
      return { mode: "abandon_quest", slot };
    }
    case "select-option":
      return parseSelectOption(rest);
    case "open-loot":
      return { mode: "open_loot", ...take(parseGuidArg(rest, true)) };
    case "take-loot": {
      const slot = take(parseBoundedArg(rest, 0, 255, "invalid loot slot"));
      return { mode: "take_loot", slot };
    }
    default:
      return undefined;
  }
}
