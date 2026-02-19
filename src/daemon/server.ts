import { readConfig } from "lib/config";
import { authHandshake, authWithRetry, worldSession } from "wow/client";
import type { WorldHandle } from "wow/client";
import { RingBuffer } from "lib/ring-buffer";
import { socketPath, pidPath, runtimeDir, logPath } from "lib/paths";
import { SessionLog } from "lib/session-log";
import { mkdir, writeFile, unlink } from "node:fs/promises";
import {
  parseIpcCommand,
  dispatchCommand,
  onChatMessage,
  onGroupEvent,
  writeLines,
  type EventEntry,
  type IpcSocket,
} from "daemon/commands";

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

type DaemonClient = {
  authHandshake: typeof authHandshake;
  worldSession: typeof worldSession;
};

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
  handle.onGroupEvent((event) => onGroupEvent(event, events, log));

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
  const auth = await (client ? client.authHandshake(clientCfg) : authWithRetry(clientCfg));
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
