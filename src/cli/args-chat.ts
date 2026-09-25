import type { CliAction } from "cli/args";

export function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

function parseWaitFlag(args: string[]): number | undefined {
  const idx = args.indexOf("--wait");
  if (idx === -1) return undefined;
  const raw = args[idx + 1];
  if (raw === undefined) throw new Error("Invalid --wait value: missing");
  const n = Number.parseFloat(raw);
  if (!Number.isFinite(n) || n < 0)
    throw new Error(`Invalid --wait value: ${raw}`);
  return n;
}

export function parseRead(args: string[]): CliAction {
  const rest = args.slice(1);
  return {
    json: hasFlag(rest, "--json"),
    mode: "read",
    wait: parseWaitFlag(rest),
  };
}

export function parseTail(args: string[]): CliAction {
  return { json: hasFlag(args.slice(1), "--json"), mode: "tail" };
}

export function parseWho(args: string[]): CliAction {
  const rest = args.slice(1);
  const next = rest[0];
  return {
    filter: next && !next.startsWith("-") ? next : undefined,
    json: hasFlag(rest, "--json"),
    mode: "who",
  };
}

export function parseSend(args: string[]): CliAction {
  const rest = args.slice(1);
  const json = hasFlag(rest, "--json");
  const wait = parseWaitFlag(rest);
  const filtered = filterFlags(rest);

  if (hasFlag(filtered, "-w")) {
    const idx = filtered.indexOf("-w");
    return {
      json,
      message: filtered.slice(idx + 2).join(" "),
      mode: "whisper",
      target: filtered[idx + 1] ?? "",
      wait,
    };
  }
  if (hasFlag(filtered, "-y")) {
    const idx = filtered.indexOf("-y");
    return {
      json,
      message: filtered.slice(idx + 1).join(" "),
      mode: "yell",
      wait,
    };
  }
  if (hasFlag(filtered, "-g")) {
    const idx = filtered.indexOf("-g");
    return {
      json,
      message: filtered.slice(idx + 1).join(" "),
      mode: "guild",
      wait,
    };
  }
  if (hasFlag(filtered, "-p")) {
    const idx = filtered.indexOf("-p");
    return {
      json,
      message: filtered.slice(idx + 1).join(" "),
      mode: "party",
      wait,
    };
  }

  const message = filtered.filter((a) => a !== "-s").join(" ");
  if (message.startsWith("/"))
    return { input: message, json, mode: "slash", wait };
  return { json, message, mode: "say", wait };
}

function filterFlags(args: string[]): string[] {
  const result: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--json") continue;
    if (arg === "--wait") {
      i++;
      continue;
    }
    if (arg !== undefined) result.push(arg);
  }
  return result;
}

export function parseFlagCommands(args: string[]): CliAction | undefined {
  if (hasFlag(args, "--help") || hasFlag(args, "-h")) return { mode: "help" };
  if (hasFlag(args, "--version") || hasFlag(args, "-v"))
    return { mode: "version" };
  if (hasFlag(args, "--daemon")) return { mode: "daemon" };

  if (hasFlag(args, "-w")) {
    const filtered = filterFlags(args);
    const idx = filtered.indexOf("-w");
    return {
      json: hasFlag(args, "--json"),
      message: filtered.slice(idx + 2).join(" "),
      mode: "whisper",
      target: filtered[idx + 1] ?? "",
      wait: parseWaitFlag(args),
    };
  }

  if (hasFlag(args, "-y")) {
    const filtered = filterFlags(args);
    const idx = filtered.indexOf("-y");
    return {
      json: hasFlag(args, "--json"),
      message: filtered.slice(idx + 1).join(" "),
      mode: "yell",
      wait: parseWaitFlag(args),
    };
  }

  if (hasFlag(args, "-g")) {
    const filtered = filterFlags(args);
    const idx = filtered.indexOf("-g");
    return {
      json: hasFlag(args, "--json"),
      message: filtered.slice(idx + 1).join(" "),
      mode: "guild",
      wait: parseWaitFlag(args),
    };
  }

  if (hasFlag(args, "-p")) {
    const filtered = filterFlags(args);
    const idx = filtered.indexOf("-p");
    return {
      json: hasFlag(args, "--json"),
      message: filtered.slice(idx + 1).join(" "),
      mode: "party",
      wait: parseWaitFlag(args),
    };
  }

  return undefined;
}
