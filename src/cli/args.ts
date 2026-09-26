import {
  hasFlag,
  parseFlagCommands,
  parseRead,
  parseSend,
  parseTail,
  parseWho,
} from "cli/args-chat";
import { parseGameplay, take } from "cli/args-gameplay";
import { parseBare, parseUnsigned } from "cli/tokens";
import type {
  FramingVariant,
  GotoTarget,
  MovementDirection,
  RollVote,
  WalkTarget,
} from "wow";

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
  | { mode: "record"; since?: number }
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
      questId?: number;
      sources?: number[];
      json?: true;
    }
  | {
      mode: "cycle_resume";
      instruction?: string;
      maxStarts?: number;
      json?: true;
    }
  | { mode: "cycling"; json: boolean }
  | { mode: "defend"; enabled: boolean; instruction?: string; json?: true }
  | { mode: "defense"; json: boolean }
  | { mode: "goto"; target: GotoTarget; json?: true }
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
  | { mode: "experience"; json: boolean }
  | { mode: "loot"; json: boolean }
  | { mode: "group"; json: boolean }
  | { mode: "open_loot"; guid: bigint; json?: true }
  | { mode: "take_loot"; slot: number; json?: true }
  | { mode: "take_money"; json?: true }
  | { mode: "release_loot"; json?: true }
  | { mode: "use"; bag: number; slot: number; json?: true }
  | { mode: "trainer"; json: boolean }
  | { mode: "open_trainer"; guid: bigint; json?: true }
  | { mode: "train"; spellId: number; json?: true }
  | { mode: "vendor"; json: boolean }
  | { mode: "open_vendor"; guid: bigint; json?: true }
  | { mode: "sell"; bag: number; slot: number; count?: number; json?: true }
  | { mode: "buy"; slot: number; count: number; json?: true }
  | { mode: "repair"; json?: true }
  | {
      mode: "loot_roll";
      guid: bigint;
      slot: number;
      vote: RollVote;
      json?: true;
    }
  | { mode: "destroy"; bag: number; slot: number; count?: number; json?: true }
  | { mode: "skill" };

const SUBCOMMANDS = new Set([
  "start",
  "stop",
  "status",
  "read",
  "tail",
  "logs",
  "record",
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
  "defend",
  "defense",
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
  "experience",
  "loot",
  "open-loot",
  "take-loot",
  "take-money",
  "release-loot",
  "use",
  "group",
  "trainer",
  "open-trainer",
  "train",
  "vendor",
  "open-vendor",
  "sell",
  "buy",
  "repair",
  "loot-roll",
  "destroy",
]);

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
      "repair",
    ] as const
  ).map((mode): [string, CliAction] => [mode.replaceAll("_", "-"), { mode }]),
);

const INSPECTIONS = [
  "control",
  "combat",
  "spells",
  "tactics",
  "cycling",
  "defense",
  "navigation",
  "recovery",
  "quests",
  "inventory",
  "experience",
  "loot",
  "group",
  "trainer",
  "vendor",
] as const;

function isInspection(cmd: string): cmd is (typeof INSPECTIONS)[number] {
  return INSPECTIONS.some((view) => view === cmd);
}

function parseSubcommand(args: string[]): CliAction | undefined {
  const cmd = args[0];
  if (!(cmd && SUBCOMMANDS.has(cmd))) return undefined;
  const rest = args.slice(1);
  const fixed = FIXED.get(cmd);
  if (fixed) return fixed;
  const strict = STRICT.get(cmd);
  if (strict) {
    take(parseBare(rest, cmd));
    return strict;
  }
  if (isInspection(cmd))
    return hasFlag(rest, "--json")
      ? { json: true, mode: cmd }
      : { json: false, mode: cmd };
  switch (cmd) {
    case "read":
      return parseRead(args);
    case "tail":
      return parseTail(args);
    case "send":
      return parseSend(args);
    case "who":
      return parseWho(args);
    case "record":
      return parseRecord(rest);
    case "nearby": {
      const all = hasFlag(rest, "--all");
      return {
        json: hasFlag(rest, "--json"),
        mode: "nearby",
        ...(all ? { all: true } : {}),
      };
    }
    default:
      return parseGameplay(cmd, rest);
  }
}

function parseRecord(rest: string[]): CliAction {
  if (rest.length === 0) return { mode: "record" };
  const since =
    rest.length === 2 && rest[0] === "--since"
      ? parseUnsigned(rest[1] ?? "", 0, Number.MAX_SAFE_INTEGER)
      : undefined;
  if (since === undefined) throw new Error("invalid record");
  return { mode: "record", since };
}

const SETUP_VALUE_FLAGS: Record<string, true> = {
  "--account": true,
  "--character": true,
  "--host": true,
  "--language": true,
  "--password": true,
  "--port": true,
  "--timeout_minutes": true,
};

export function hasJsonOption(args: string[]): boolean {
  if (args[0] !== "setup") return args.includes("--json");
  for (let i = 1; i < args.length; i++) {
    const prev = args[i - 1];
    if (
      args[i] === "--json" &&
      !(prev !== undefined && SETUP_VALUE_FLAGS[prev])
    )
      return true;
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
    case "record":
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
    return { args: args.slice(1), mode: "setup" };
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
