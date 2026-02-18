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
  if (wait !== undefined && Number.isNaN(parseInt(wait, 10))) {
    throw new Error(`Invalid --wait value: ${wait}`);
  }
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

function filterFlags(args: string[]): string[] {
  return args.filter((a) => a !== "--json");
}

function parseFlagCommands(args: string[]): CliAction | undefined {
  if (hasFlag(args, "--help")) return { mode: "help" };
  if (hasFlag(args, "--daemon")) return { mode: "daemon" };

  if (hasFlag(args, "-w")) {
    const filtered = filterFlags(args);
    const idx = filtered.indexOf("-w");
    return {
      mode: "whisper",
      target: filtered[idx + 1] ?? "",
      message: filtered.slice(idx + 2).join(" "),
      json: hasFlag(args, "--json"),
    };
  }

  if (hasFlag(args, "-y")) {
    const filtered = filterFlags(args);
    const idx = filtered.indexOf("-y");
    return {
      mode: "yell",
      message: filtered.slice(idx + 1).join(" "),
      json: hasFlag(args, "--json"),
    };
  }

  if (hasFlag(args, "-g")) {
    const filtered = filterFlags(args);
    const idx = filtered.indexOf("-g");
    return {
      mode: "guild",
      message: filtered.slice(idx + 1).join(" "),
      json: hasFlag(args, "--json"),
    };
  }

  if (hasFlag(args, "-p")) {
    const filtered = filterFlags(args);
    const idx = filtered.indexOf("-p");
    return {
      mode: "party",
      message: filtered.slice(idx + 1).join(" "),
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

export function parseArgs(args: string[]): CliAction {
  if (args.length === 0) return { mode: "interactive" };

  const sub = parseSubcommand(args);
  if (sub) return sub;

  const flag = parseFlagCommands(args);
  if (flag) return flag;

  return {
    mode: "say",
    message: filterFlags(args).join(" "),
    json: hasFlag(args, "--json"),
  };
}

function parseResponseLines(buffer: string): string[] {
  const result: string[] = [];
  for (const line of buffer.split("\n")) {
    if (line === "") break;
    result.push(line);
  }
  return result;
}

export async function sendToSocket(
  command: string,
  path?: string,
): Promise<string[]> {
  const sock = path ?? (await import("paths")).socketPath();
  let buffer = "";
  return new Promise<string[]>((resolve, reject) => {
    Bun.connect({
      unix: sock,
      socket: {
        open(socket) {
          socket.write(command + "\n");
          socket.flush();
        },
        data(socket, data) {
          buffer += Buffer.from(data).toString();
          if (buffer.endsWith("\n\n") || buffer === "\n") {
            socket.end();
            resolve(parseResponseLines(buffer));
          }
        },
        close() {
          resolve(parseResponseLines(buffer));
        },
        error(_socket, err) {
          reject(err);
        },
      },
    }).catch(reject);
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
  if (await socketExists(path)) {
    try {
      await sendToSocket("STATUS", path);
      return;
    } catch {
      const { unlink } = await import("node:fs/promises");
      await unlink(path).catch(() => {});
    }
  }

  const isSource = Bun.main.endsWith(".ts");
  const args = isSource
    ? [process.execPath, Bun.main, "--daemon"]
    : [process.execPath, "--daemon"];
  const proc = Bun.spawn(args, {
    stdio: ["ignore", "ignore", "pipe"],
  });
  proc.unref();

  for (let i = 0; i < 300; i++) {
    await Bun.sleep(100);
    if (await socketExists(path)) return;
  }
  const stderr = (await new Response(proc.stderr).text()).trim();
  throw new Error(
    stderr
      ? `Daemon failed to start within 30 seconds:\n${stderr}`
      : "Daemon failed to start within 30 seconds",
  );
}
