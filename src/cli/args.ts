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
  | { mode: "goto"; x: number; y: number; z: number; wait: number | undefined }
  | { mode: "follow"; target: string; wait: number | undefined }
  | { mode: "face"; orientation: number }
  | { mode: "halt" }
  | { mode: "pos"; json: boolean }
  | { mode: "target"; name: string }
  | { mode: "attack"; wait: number | undefined }
  | {
      mode: "cast";
      spellId: number;
      self: boolean;
      wait: number | undefined;
    }
  | { mode: "loot"; wait: number | undefined }
  | { mode: "hunt"; name: string; wait: number | undefined }
  | { mode: "release" }
  | { mode: "reclaim" }
  | { mode: "spells" }
  | { mode: "auras"; unit: "self" | "target" }
  | { mode: "vitals"; json: boolean }
  | { mode: "sit" }
  | { mode: "stand" }
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
  "goto",
  "follow",
  "face",
  "halt",
  "pos",
  "target",
  "attack",
  "cast",
  "loot",
  "hunt",
  "release",
  "reclaim",
  "spells",
  "auras",
  "vitals",
  "sit",
  "stand",
  "skill",
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

function parseGoto(args: string[]): CliAction {
  const rest = args.slice(1);
  const wait = parseWaitFlag(rest);
  const coords = filterFlags(rest).map(parseFloat);
  if (coords.length !== 3 || coords.some((n) => !Number.isFinite(n)))
    throw new Error("Usage: tuicraft goto <x> <y> <z>");
  return { mode: "goto", x: coords[0]!, y: coords[1]!, z: coords[2]!, wait };
}

function parseFollow(args: string[]): CliAction {
  const rest = args.slice(1);
  const wait = parseWaitFlag(rest);
  const target = filterFlags(rest)[0];
  if (!target) throw new Error("Usage: tuicraft follow <player>");
  return { mode: "follow", target, wait };
}

function parseFace(args: string[]): CliAction {
  const orientation = parseFloat(args[1] ?? "");
  if (!Number.isFinite(orientation))
    throw new Error("Usage: tuicraft face <radians>");
  return { mode: "face", orientation };
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
    case "goto":
      return parseGoto(args);
    case "follow":
      return parseFollow(args);
    case "face":
      return parseFace(args);
    case "pos":
      return { mode: "pos", json: hasFlag(args.slice(1), "--json") };
    case "target": {
      const name = filterFlags(args.slice(1))[0];
      if (!name) throw new Error("Usage: tuicraft target <name>");
      return { mode: "target", name };
    }
    case "attack":
      return { mode: "attack", wait: parseWaitFlag(args.slice(1)) };
    case "cast": {
      const rest = args.slice(1);
      const self = rest.includes("--self");
      const spellId = parseInt(
        filterFlags(rest.filter((a) => a !== "--self"))[0] ?? "",
        10,
      );
      if (!Number.isFinite(spellId))
        throw new Error("Usage: tuicraft cast <spellId> [--self]");
      return { mode: "cast", spellId, self, wait: parseWaitFlag(rest) };
    }
    case "loot":
      return { mode: "loot", wait: parseWaitFlag(args.slice(1)) };
    case "hunt": {
      const rest = args.slice(1);
      const name = filterFlags(rest).join(" ");
      if (!name) throw new Error("Usage: tuicraft hunt <name>");
      return { mode: "hunt", name, wait: parseWaitFlag(rest) };
    }
    case "auras":
      return {
        mode: "auras",
        unit: args[1] === "target" ? "target" : "self",
      };
    case "vitals":
      return { mode: "vitals", json: hasFlag(args.slice(1), "--json") };
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
