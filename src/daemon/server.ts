import { readConfig } from "lib/config";
import { authHandshake, authWithRetry } from "wow/auth";
import { worldSession } from "wow/client";
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
  onEntityEvent,
  onFriendEvent,
  onIgnoreEvent,
  onGuildEvent,
  onDuelEvent,
  onControlEvent,
  onCombatEvent,
  onTacticsEvent,
  onFollowEvent,
  onCycleEvent,
  onRecoveryEvent,
  onQuestEvent,
  onRewardsEvent,
  writeLines,
  type EventEntry,
  type IpcSocket,
} from "daemon/commands";

type SocketState = {
  buffer: string;
  queue: string[];
  processing: boolean;
  ended: boolean;
  abort: AbortController | undefined;
};

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
  const state: SocketState = {
    buffer: "",
    queue: [],
    processing: false,
    ended: false,
    abort: undefined,
  };
  socketStates.set(socket, state);
  return state;
}
function onSocketClose(socket: IpcSocket): void {
  const state = getSocketState(socket);
  if (state.ended) return;
  state.ended = true;
  state.buffer = "";
  state.queue.length = 0;
  state.abort?.abort();
}

function enqueueCompleteLines(state: SocketState): void {
  while (true) {
    const breakIdx = state.buffer.indexOf("\n");
    if (breakIdx === -1) return;
    const line = state.buffer.slice(0, breakIdx).trim();
    state.buffer = state.buffer.slice(breakIdx + 1);
    state.queue.push(line);
  }
}

function queuedType(line: string): string | undefined {
  return parseIpcCommand(line)?.type;
}

function isStaleControl(type: string | undefined): boolean {
  return (
    type === "move" ||
    type === "face" ||
    type === "face_guid" ||
    type === "walk_toward" ||
    type === "target" ||
    type === "cast" ||
    type === "attack" ||
    type === "cancel_cast" ||
    type === "stop_attack" ||
    type === "fight" ||
    type === "goto" ||
    type === "follow" ||
    type === "cycle" ||
    type === "release_spirit" ||
    type === "reclaim_corpse" ||
    type === "spirit_healer" ||
    type === "resurrect" ||
    type === "talk" ||
    type === "select_option" ||
    type === "select_quest" ||
    type === "accept_quest" ||
    type === "complete_quest" ||
    type === "request_reward" ||
    type === "choose_reward" ||
    type === "abandon_quest" ||
    type === "cancel_interaction" ||
    type === "open_loot" ||
    type === "take_loot" ||
    type === "take_money" ||
    type === "release_loot" ||
    type === "read_wait" ||
    type === "read_wait_json"
  );
}

function promoteHalt(state: SocketState): void {
  const haltIdx = state.queue.findIndex((line) => queuedType(line) === "halt");
  if (haltIdx === -1) return;
  const halt = state.queue[haltIdx]!;
  const before = state.queue.slice(0, haltIdx);
  const after = state.queue.slice(haltIdx + 1);
  const retained = before.filter((line) => !isStaleControl(queuedType(line)));
  state.queue = [halt, ...retained, ...after];
  state.abort?.abort();
}

function drainQueue(ctx: ServerCtx, socket: IpcSocket): void {
  const state = getSocketState(socket);
  state.processing = false;
  if (state.ended) return;
  enqueueCompleteLines(state);
  promoteHalt(state);
  const next = state.queue.shift();
  if (next !== undefined) {
    processLine(ctx, socket, next);
    return;
  }
  if (state.buffer.length > 0) return;
  state.ended = true;
  socket.end();
}

function processLine(ctx: ServerCtx, socket: IpcSocket, line: string): void {
  const state = getSocketState(socket);
  if (state.ended) return;
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
  const abort = new AbortController();
  state.abort = abort;
  let settled = false;
  function finish(shouldExit: boolean): void {
    if (settled) return;
    settled = true;
    if (state.abort === abort) state.abort = undefined;
    if (shouldExit) (ctx.onStop ?? (() => process.exit(0)))();
    drainQueue(ctx, socket);
  }
  const gated: IpcSocket = {
    write(data) {
      if (abort.signal.aborted) return 0;
      return socket.write(data);
    },
    end() {
      if (!abort.signal.aborted) socket.end();
    },
  };
  abort.signal.addEventListener("abort", () => finish(false), { once: true });
  dispatchCommand(cmd, ctx.handle, ctx.events, gated, ctx.cleanup, abort.signal)
    .then((shouldExit) => {
      finish(shouldExit);
    })
    .catch(() => {
      if (!abort.signal.aborted) writeLines(socket, ["ERR internal"]);
      finish(false);
    });
}

function onSocketData(ctx: ServerCtx, socket: IpcSocket, data: Buffer): void {
  const state = getSocketState(socket);
  if (state.ended) return;
  state.buffer += Buffer.from(data).toString();
  enqueueCompleteLines(state);
  promoteHalt(state);
  if (state.processing || state.queue.length === 0) return;
  drainQueue(ctx, socket);
}

export function startDaemonServer(args: DaemonServerArgs): DaemonServer {
  const { handle, sock, log, onActivity, onStop } = args;
  const events = new RingBuffer<EventEntry>(1000);
  handle.onMessage((msg) => onChatMessage(msg, events, log));
  handle.onGroupEvent((event) => onGroupEvent(event, events, log));
  handle.onEntityEvent((event) => onEntityEvent(event, events, log));
  handle.onFriendEvent((event) => onFriendEvent(event, events, log));
  handle.onIgnoreEvent((event) => onIgnoreEvent(event, events, log));
  handle.onGuildEvent((event) => onGuildEvent(event, events, log));
  handle.onDuelEvent((event) => onDuelEvent(event, events, log));
  handle.onControlEvent((event) => onControlEvent(event, events, log));
  handle.onCombatEvent((event) => onCombatEvent(event, events, log));
  handle.onTacticsEvent((event) => onTacticsEvent(event, events, log));
  handle.onFollowEvent((event) => onFollowEvent(event, events, log));
  handle.onCycleEvent((event) => onCycleEvent(event, events, log));
  handle.onRecoveryEvent((event) => onRecoveryEvent(event, events, log));
  handle.onQuestEvent((event) => onQuestEvent(event, events, log));
  handle.onRewardsEvent((event) => onRewardsEvent(event, events, log));

  let cleaned = false;
  function cleanup(): void {
    if (cleaned) return;
    cleaned = true;
    handle.onControlEvent(undefined);
    handle.onCombatEvent(undefined);
    handle.onFollowEvent(undefined);
    handle.onCycleEvent(undefined);
    handle.onRecoveryEvent(undefined);
    handle.onQuestEvent(undefined);
    handle.onRewardsEvent(undefined);
    handle.close();
    server.stop();
    unlink(sock).catch(() => {});
  }

  const ctx: ServerCtx = { handle, events, cleanup, onActivity, onStop };
  const server = Bun.listen({
    unix: sock,
    socket: {
      data: (socket, data) => onSocketData(ctx, socket, data),
      close: (socket) => onSocketClose(socket),
      error: (socket) => onSocketClose(socket),
    },
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
    spellDataDir: cfg.spell_data_dir,
    navigationDataDir: cfg.navigation_data_dir,
    navigationLibrary: cfg.navigation_library,
    jevApiKey: process.env["TYPESAFE_API_KEY"],
    jevEndpointUrl:
      process.env["JEV_ENDPOINT_URL"] ?? process.env["TYPESAFE_ENDPOINT_URL"],
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
  const auth = await (client
    ? client.authHandshake(clientCfg)
    : authWithRetry(clientCfg));
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
