import { readConfig } from "config";
import { authHandshake, worldSession } from "client";
import type { WorldHandle, ChatMessage } from "client";
import { RingBuffer } from "ring-buffer";
import {
  formatMessage,
  formatMessageObj,
  formatWhoResults,
  formatWhoResultsJson,
} from "tui";
import { socketPath, pidPath, runtimeDir, logPath } from "paths";
import { SessionLog } from "session-log";
import { mkdir, writeFile, unlink } from "node:fs/promises";

export type EventEntry = { text: string; json: string };

type IpcSocket = { write(data: string | Uint8Array): number; end(): void };

type SocketState = { buffer: string; processing: boolean; ended: boolean };

type ServerCtx = {
  handle: WorldHandle;
  events: RingBuffer<EventEntry>;
  cleanup: () => void;
  onActivity?: () => void;
  onStop?: () => void;
};

type DaemonServerArgs = {
  handle: WorldHandle;
  sock: string;
  log: SessionLog;
  onActivity?: () => void;
  onStop?: () => void;
};

type DaemonServer = {
  server: ReturnType<typeof Bun.listen>;
  events: RingBuffer<EventEntry>;
  cleanup: () => void;
};

export type IpcCommand =
  | { type: "say"; message: string }
  | { type: "yell"; message: string }
  | { type: "guild"; message: string }
  | { type: "party"; message: string }
  | { type: "whisper"; target: string; message: string }
  | { type: "read" }
  | { type: "read_json" }
  | { type: "read_wait"; ms: number }
  | { type: "read_wait_json"; ms: number }
  | { type: "stop" }
  | { type: "status" }
  | { type: "who"; filter?: string }
  | { type: "who_json"; filter?: string };

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
    case "READ_JSON":
      return { type: "read_json" };
    case "READ_WAIT": {
      const ms = parseInt(rest, 10);
      if (!Number.isFinite(ms) || ms < 0) return undefined;
      return { type: "read_wait", ms: Math.min(ms, 60_000) };
    }
    case "READ_WAIT_JSON": {
      const ms = parseInt(rest, 10);
      if (!Number.isFinite(ms) || ms < 0) return undefined;
      return { type: "read_wait_json", ms: Math.min(ms, 60_000) };
    }
    case "STOP":
      return { type: "stop" };
    case "STATUS":
      return { type: "status" };
    case "WHO":
      return rest ? { type: "who", filter: rest } : { type: "who" };
    case "WHO_JSON":
      return rest ? { type: "who_json", filter: rest } : { type: "who_json" };
    default:
      return undefined;
  }
}

export function writeLines(socket: IpcSocket, lines: string[]): void {
  for (const line of lines) socket.write(line + "\n");
  socket.write("\n");
}

function drainText(events: RingBuffer<EventEntry>): string[] {
  return events.drain().map((e) => e.text);
}

function drainJson(events: RingBuffer<EventEntry>): string[] {
  return events.drain().map((e) => e.json);
}

export async function dispatchCommand(
  cmd: IpcCommand,
  handle: WorldHandle,
  events: RingBuffer<EventEntry>,
  socket: IpcSocket,
  cleanup: () => void,
): Promise<boolean> {
  switch (cmd.type) {
    case "say":
      handle.sendSay(cmd.message);
      writeLines(socket, ["OK"]);
      return false;
    case "yell":
      handle.sendYell(cmd.message);
      writeLines(socket, ["OK"]);
      return false;
    case "guild":
      handle.sendGuild(cmd.message);
      writeLines(socket, ["OK"]);
      return false;
    case "party":
      handle.sendParty(cmd.message);
      writeLines(socket, ["OK"]);
      return false;
    case "whisper":
      handle.sendWhisper(cmd.target, cmd.message);
      writeLines(socket, ["OK"]);
      return false;
    case "read":
      writeLines(socket, drainText(events));
      return false;
    case "read_json":
      writeLines(socket, drainJson(events));
      return false;
    case "read_wait":
      await new Promise<void>((resolve) => {
        setTimeout(() => {
          writeLines(socket, drainText(events));
          resolve();
        }, cmd.ms);
      });
      return false;
    case "read_wait_json":
      await new Promise<void>((resolve) => {
        setTimeout(() => {
          writeLines(socket, drainJson(events));
          resolve();
        }, cmd.ms);
      });
      return false;
    case "stop":
      writeLines(socket, ["OK"]);
      cleanup();
      return true;
    case "status":
      writeLines(socket, ["CONNECTED"]);
      return false;
    case "who": {
      const results = await handle.who(cmd.filter ? { name: cmd.filter } : {});
      writeLines(socket, formatWhoResults(results).split("\n"));
      return false;
    }
    case "who_json": {
      const results = await handle.who(cmd.filter ? { name: cmd.filter } : {});
      writeLines(socket, [formatWhoResultsJson(results)]);
      return false;
    }
  }
}

export function onChatMessage(
  msg: ChatMessage,
  events: RingBuffer<EventEntry>,
  log: SessionLog,
): void {
  const obj = formatMessageObj(msg);
  events.push({ text: formatMessage(msg), json: JSON.stringify(obj) });
  log.append(obj).catch(() => {});
}

const socketStates = new WeakMap<IpcSocket, SocketState>();

function getSocketState(socket: IpcSocket): SocketState {
  const existing = socketStates.get(socket);
  if (existing) return existing;
  const state: SocketState = { buffer: "", processing: false, ended: false };
  socketStates.set(socket, state);
  return state;
}

function drainNextLine(ctx: ServerCtx, socket: IpcSocket): void {
  const state = getSocketState(socket);
  state.processing = false;
  if (state.ended) return;
  const nextBreak = state.buffer.indexOf("\n");
  if (nextBreak !== -1) {
    const next = state.buffer.slice(0, nextBreak).trim();
    state.buffer = state.buffer.slice(nextBreak + 1);
    processLine(ctx, socket, next);
    return;
  }
  state.ended = true;
  socket.end();
}

function processLine(ctx: ServerCtx, socket: IpcSocket, line: string): void {
  const state = getSocketState(socket);
  if (state.processing || state.ended) return;
  state.processing = true;
  ctx.onActivity?.();
  const cmd = parseIpcCommand(line);
  if (!cmd) {
    writeLines(socket, ["ERR unknown command"]);
    state.ended = true;
    state.processing = false;
    socket.end();
    return;
  }
  dispatchCommand(cmd, ctx.handle, ctx.events, socket, ctx.cleanup)
    .then((shouldExit) => {
      if (shouldExit) (ctx.onStop ?? (() => process.exit(0)))();
    })
    .catch(() => writeLines(socket, ["ERR internal"]))
    .finally(() => drainNextLine(ctx, socket));
}

function onSocketData(ctx: ServerCtx, socket: IpcSocket, data: Buffer): void {
  const state = getSocketState(socket);
  state.buffer += Buffer.from(data).toString();
  const breakIdx = state.buffer.indexOf("\n");
  if (breakIdx === -1) return;
  const line = state.buffer.slice(0, breakIdx).trim();
  state.buffer = state.buffer.slice(breakIdx + 1);
  processLine(ctx, socket, line);
}

export function startDaemonServer(args: DaemonServerArgs): DaemonServer {
  const { handle, sock, log, onActivity, onStop } = args;
  const events = new RingBuffer<EventEntry>(1000);
  handle.onMessage((msg) => onChatMessage(msg, events, log));

  let cleaned = false;
  function cleanup(): void {
    if (cleaned) return;
    cleaned = true;
    handle.close();
    server.stop();
    unlink(sock).catch(() => {});
  }

  const ctx: ServerCtx = { handle, events, cleanup, onActivity, onStop };
  const server = Bun.listen({
    unix: sock,
    socket: { data: (socket, data) => onSocketData(ctx, socket, data) },
  });

  return { server, events, cleanup };
}

type DaemonClient = {
  authHandshake: typeof authHandshake;
  worldSession: typeof worldSession;
};

function buildClientConfig(cfg: Awaited<ReturnType<typeof readConfig>>) {
  return {
    host: cfg.host,
    port: cfg.port,
    account: cfg.account.toUpperCase(),
    password: cfg.password.toUpperCase(),
    character: cfg.character,
    language: cfg.language,
  };
}

async function prepareDaemonPaths(): Promise<{ sock: string; pid: string }> {
  const sock = socketPath();
  const pid = pidPath();
  await mkdir(runtimeDir(), { recursive: true });
  await writeFile(pid, String(process.pid));
  await unlink(sock).catch(() => {});
  return { sock, pid };
}

export async function startDaemon(client?: DaemonClient): Promise<void> {
  const cfg = await readConfig();
  const { sock, pid } = await prepareDaemonPaths();

  const clientCfg = buildClientConfig(cfg);
  const auth = await (client?.authHandshake ?? authHandshake)(clientCfg);
  const handle = await (client?.worldSession ?? worldSession)(clientCfg, auth);
  const log = new SessionLog(logPath());

  let lastActivity = Date.now();
  const timeoutMs = cfg.timeout_minutes * 60_000;
  let cleaned = false;

  function cleanup(): void {
    if (cleaned) return;
    cleaned = true;
    stopServer();
    clearInterval(idleCheck);
    unlink(pid).catch(() => {});
  }

  function exit(): void {
    cleanup();
    process.exit(0);
  }

  const { cleanup: stopServer } = startDaemonServer({
    handle,
    sock,
    log,
    onActivity: () => {
      lastActivity = Date.now();
    },
    onStop: exit,
  });

  const idleCheck = setInterval(() => {
    if (Date.now() - lastActivity > timeoutMs) exit();
  }, 60_000);
  process.on("SIGTERM", cleanup);
  process.on("SIGINT", cleanup);

  await handle.closed;
  cleanup();
}
