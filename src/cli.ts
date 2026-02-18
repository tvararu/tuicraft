export type CliAction =
  | { mode: "interactive" }
  | { mode: "daemon" }
  | { mode: "setup"; args: string[] }
  | { mode: "help" }
  | { mode: "stop" }
  | { mode: "status" }
  | { mode: "logs" }
  | { mode: "read"; wait: number | undefined; json: boolean }
  | { mode: "tail"; json: boolean }
  | { mode: "say"; message: string; json: boolean }
  | { mode: "yell"; message: string; json: boolean }
  | { mode: "guild"; message: string; json: boolean }
  | { mode: "party"; message: string; json: boolean }
  | { mode: "whisper"; target: string; message: string; json: boolean }
  | { mode: "who"; filter: string | undefined; json: boolean };

const SUBCOMMANDS = new Set([
  "setup",
  "stop",
  "status",
  "read",
  "tail",
  "logs",
  "help",
]);

function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

function flagValue(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx !== -1 ? args[idx + 1] : undefined;
}

function parseRead(args: string[]): CliAction {
  const rest = args.slice(1);
  const wait = flagValue(rest, "--wait");
  return {
    mode: "read",
    wait: wait !== undefined ? parseInt(wait, 10) : undefined,
    json: hasFlag(rest, "--json"),
  };
}

function parseTail(args: string[]): CliAction {
  return { mode: "tail", json: hasFlag(args.slice(1), "--json") };
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
    default:
      return { mode: cmd } as CliAction;
  }
}

function parseFlagCommands(args: string[]): CliAction | undefined {
  if (hasFlag(args, "--help")) return { mode: "help" };
  if (hasFlag(args, "--daemon")) return { mode: "daemon" };

  if (hasFlag(args, "-w")) {
    const idx = args.indexOf("-w");
    return {
      mode: "whisper",
      target: args[idx + 1] ?? "",
      message: args.slice(idx + 2).join(" "),
      json: hasFlag(args, "--json"),
    };
  }

  if (hasFlag(args, "-y")) {
    const idx = args.indexOf("-y");
    return {
      mode: "yell",
      message: args.slice(idx + 1).join(" "),
      json: hasFlag(args, "--json"),
    };
  }

  if (hasFlag(args, "-g")) {
    const idx = args.indexOf("-g");
    return {
      mode: "guild",
      message: args.slice(idx + 1).join(" "),
      json: hasFlag(args, "--json"),
    };
  }

  if (hasFlag(args, "-p")) {
    const idx = args.indexOf("-p");
    return {
      mode: "party",
      message: args.slice(idx + 1).join(" "),
      json: hasFlag(args, "--json"),
    };
  }

  if (hasFlag(args, "--who")) {
    const idx = args.indexOf("--who");
    const next = args[idx + 1];
    return {
      mode: "who",
      filter: next && !next.startsWith("-") ? next : undefined,
      json: hasFlag(args, "--json"),
    };
  }

  return undefined;
}

export function parseArgs(args: string[], _isTTY: boolean): CliAction {
  if (args.length === 0) return { mode: "interactive" };

  const sub = parseSubcommand(args);
  if (sub) return sub;

  const flag = parseFlagCommands(args);
  if (flag) return flag;

  return { mode: "say", message: args.join(" "), json: false };
}

export async function sendToSocket(command: string): Promise<string[]> {
  const { socketPath } = await import("paths");
  return new Promise((resolve, reject) => {
    let buffer = "";
    Bun.connect({
      unix: socketPath(),
      socket: {
        open(socket) {
          socket.write(command + "\n");
          socket.flush();
        },
        data(_socket, data) {
          buffer += Buffer.from(data).toString();
        },
        close() {
          const lines = buffer.split("\n");
          const result: string[] = [];
          for (const line of lines) {
            if (line === "") break;
            result.push(line);
          }
          resolve(result);
        },
        error(_socket, err) {
          reject(err);
        },
      },
    });
  });
}

async function socketExists(path: string): Promise<boolean> {
  const { access } = await import("node:fs/promises");
  return access(path)
    .then(() => true)
    .catch(() => false);
}

export async function ensureDaemon(): Promise<void> {
  const { socketPath } = await import("paths");
  const path = socketPath();
  if (await socketExists(path)) return;

  const isSource = Bun.main.endsWith(".ts");
  const args = isSource
    ? [process.execPath, Bun.main, "--daemon"]
    : [process.execPath, "--daemon"];
  const proc = Bun.spawn(args, {
    stdio: ["ignore", "ignore", "ignore"],
  });
  proc.unref();

  for (let i = 0; i < 300; i++) {
    await Bun.sleep(100);
    if (await socketExists(path)) return;
  }
  throw new Error("Daemon failed to start within 30 seconds");
}
