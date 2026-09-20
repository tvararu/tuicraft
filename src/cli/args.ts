import type { MovementDirection } from "wow/control";

export type CliAction =
  | { mode: "interactive" }
  | { mode: "daemon" }
  | { mode: "version" }
  | { mode: "setup"; args: string[] }
  | { mode: "help" }
  | { mode: "stop" }
  | { mode: "status" }
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
  | { mode: "nearby"; json: boolean }
  | { mode: "skill" };

const SUBCOMMANDS = new Set([
  "setup",
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
    case "nearby":
      return {
        mode: "nearby",
        json: hasFlag(args.slice(1), "--json"),
      };
    case "move":
      return parseMove(args);
    case "face":
      return parseFace(args);
    case "target":
      return parseTarget(args);
    case "halt":
      return { mode: "halt" };
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
