import { readConfig } from "config";
import { authHandshake, worldSession } from "client";
import type { WorldHandle, ChatMessage } from "client";
import { RingBuffer } from "ring-buffer";
import { formatMessage, formatWhoResults } from "tui";
import { socketPath, pidPath, runtimeDir } from "paths";
import { mkdir, writeFile, unlink } from "node:fs/promises";

export type IpcCommand =
  | { type: "say"; message: string }
  | { type: "yell"; message: string }
  | { type: "guild"; message: string }
  | { type: "party"; message: string }
  | { type: "whisper"; target: string; message: string }
  | { type: "read" }
  | { type: "read_wait"; ms: number }
  | { type: "stop" }
  | { type: "status" }
  | { type: "who"; filter?: string };

export function parseIpcCommand(line: string): IpcCommand | undefined {
  const spaceIdx = line.indexOf(" ");
  const verb = spaceIdx === -1 ? line : line.slice(0, spaceIdx);
  const rest = spaceIdx === -1 ? "" : line.slice(spaceIdx + 1);

  switch (verb) {
    case "SAY":
    case "YELL":
    case "GUILD":
    case "PARTY":
      return {
        type: verb.toLowerCase() as "say" | "yell" | "guild" | "party",
        message: rest,
      };
    case "WHISPER": {
      const targetEnd = rest.indexOf(" ");
      if (targetEnd === -1)
        return { type: "whisper", target: rest, message: "" };
      return {
        type: "whisper",
        target: rest.slice(0, targetEnd),
        message: rest.slice(targetEnd + 1),
      };
    }
    case "READ":
      return { type: "read" };
    case "READ_WAIT":
      return { type: "read_wait", ms: parseInt(rest, 10) };
    case "STOP":
      return { type: "stop" };
    case "STATUS":
      return { type: "status" };
    case "WHO":
      return rest ? { type: "who", filter: rest } : { type: "who" };
    default:
      return undefined;
  }
}

function writeLines(
  socket: { write(data: string | Uint8Array): number },
  lines: string[],
): void {
  for (const line of lines) socket.write(line + "\n");
  socket.write("\n");
}

async function dispatchCommand(
  cmd: IpcCommand,
  handle: WorldHandle,
  events: RingBuffer<string>,
  socket: { write(data: string | Uint8Array): number; end(): void },
  cleanup: () => void,
): Promise<void> {
  switch (cmd.type) {
    case "say":
      handle.sendSay(cmd.message);
      writeLines(socket, ["OK"]);
      break;
    case "yell":
      handle.sendYell(cmd.message);
      writeLines(socket, ["OK"]);
      break;
    case "guild":
      handle.sendGuild(cmd.message);
      writeLines(socket, ["OK"]);
      break;
    case "party":
      handle.sendParty(cmd.message);
      writeLines(socket, ["OK"]);
      break;
    case "whisper":
      handle.sendWhisper(cmd.target, cmd.message);
      writeLines(socket, ["OK"]);
      break;
    case "read":
      writeLines(socket, events.drain());
      break;
    case "read_wait":
      await new Promise<void>((resolve) => {
        setTimeout(() => {
          writeLines(socket, events.drain());
          resolve();
        }, cmd.ms);
      });
      break;
    case "stop":
      writeLines(socket, ["OK"]);
      cleanup();
      process.exit(0);
      break;
    case "status":
      writeLines(socket, ["CONNECTED"]);
      break;
    case "who": {
      const results = await handle.who(cmd.filter ? { name: cmd.filter } : {});
      writeLines(socket, formatWhoResults(results).split("\n"));
      break;
    }
  }
}

function onChatMessage(msg: ChatMessage, events: RingBuffer<string>): void {
  events.push(formatMessage(msg));
}

export async function startDaemon(): Promise<void> {
  const cfg = await readConfig();
  const sock = socketPath();
  const pid = pidPath();
  const rtDir = runtimeDir();

  await mkdir(rtDir, { recursive: true });
  await writeFile(pid, String(process.pid));

  await unlink(sock).catch(() => {});

  const clientCfg = {
    host: cfg.host,
    port: cfg.port,
    account: cfg.account.toUpperCase(),
    password: cfg.password.toUpperCase(),
    character: cfg.character,
    language: cfg.language,
  };

  const auth = await authHandshake(clientCfg);
  const handle = await worldSession(clientCfg, auth);

  const events = new RingBuffer<string>(1000);
  handle.onMessage((msg) => onChatMessage(msg, events));

  function cleanup(): void {
    handle.close();
    server.stop();
    unlink(sock).catch(() => {});
    unlink(pid).catch(() => {});
  }

  let lastActivity = Date.now();
  const timeoutMs = cfg.timeout_minutes * 60 * 1000;
  const idleCheck = setInterval(() => {
    if (Date.now() - lastActivity > timeoutMs) {
      cleanup();
      process.exit(0);
    }
  }, 60_000);

  const server = Bun.listen({
    unix: sock,
    socket: {
      data(socket, data) {
        lastActivity = Date.now();
        const line = Buffer.from(data).toString().trim();
        const cmd = parseIpcCommand(line);
        if (!cmd) {
          writeLines(socket, ["ERR unknown command"]);
          socket.end();
          return;
        }
        dispatchCommand(cmd, handle, events, socket, cleanup)
          .catch(() => {
            writeLines(socket, ["ERR internal"]);
          })
          .finally(() => socket.end());
      },
    },
  });

  process.on("SIGTERM", cleanup);
  process.on("SIGINT", cleanup);

  await handle.closed;
  clearInterval(idleCheck);
  cleanup();
}
