import { RingBuffer } from "lib/ring-buffer";
import {
  formatMessage,
  formatMessageObj,
  formatWhoResults,
  formatWhoResultsJson,
  formatGroupEvent,
  parseCommand,
} from "ui/tui";
import { SessionLog, type LogEntry } from "lib/session-log";
import type { WorldHandle, ChatMessage, GroupEvent } from "wow/client";

export type EventEntry = { text: string | undefined; json: string };

export type IpcSocket = {
  write(data: string | Uint8Array): number;
  end(): void;
  flush?(): void;
};

export type IpcCommand =
  | { type: "chat"; message: string }
  | { type: "say"; message: string }
  | { type: "yell"; message: string }
  | { type: "guild"; message: string }
  | { type: "party"; message: string }
  | { type: "whisper"; target: string; message: string }
  | { type: "subscribe" }
  | { type: "subscribe_json" }
  | { type: "read" }
  | { type: "read_json" }
  | { type: "read_wait"; ms: number }
  | { type: "read_wait_json"; ms: number }
  | { type: "stop" }
  | { type: "status" }
  | { type: "who"; filter?: string }
  | { type: "who_json"; filter?: string }
  | { type: "invite"; target: string }
  | { type: "kick"; target: string }
  | { type: "leave" }
  | { type: "leader"; target: string }
  | { type: "accept" }
  | { type: "decline" }
  | { type: "unimplemented"; feature: string };

export function parseIpcCommand(line: string): IpcCommand | undefined {
  if (line.startsWith("/")) {
    const parsed = parseCommand(line);
    switch (parsed.type) {
      case "say":
      case "yell":
      case "guild":
      case "party":
        return parsed;
      case "whisper":
        return parsed;
      case "who":
        return parsed.target
          ? { type: "who", filter: parsed.target }
          : { type: "who" };
      case "invite":
      case "kick":
      case "leave":
      case "leader":
      case "accept":
      case "decline":
        return parsed;
      case "unimplemented":
        return parsed;
      default:
        return { type: "say", message: line };
    }
  }

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
    case "SUBSCRIBE":
      return { type: "subscribe" };
    case "SUBSCRIBE_JSON":
      return { type: "subscribe_json" };
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
    case "INVITE":
      return rest ? { type: "invite", target: rest } : undefined;
    case "KICK":
      return rest ? { type: "kick", target: rest } : undefined;
    case "LEAVE":
      return { type: "leave" };
    case "LEADER":
      return rest ? { type: "leader", target: rest } : undefined;
    case "ACCEPT":
      return { type: "accept" };
    case "DECLINE":
      return { type: "decline" };
    case "FRIENDS":
      return { type: "unimplemented", feature: "Friends list" };
    case "IGNORE":
      return { type: "unimplemented", feature: "Ignore list" };
    case "JOIN":
      return { type: "unimplemented", feature: "Channel join/leave" };
    case "GINVITE":
    case "GKICK":
    case "GLEAVE":
    case "GPROMOTE":
      return { type: "unimplemented", feature: "Guild management" };
    case "MAIL":
      return { type: "unimplemented", feature: "Mail" };
    case "ROLL":
      return { type: "unimplemented", feature: "Random roll" };
    case "DND":
    case "AFK":
      return { type: "unimplemented", feature: "Player status" };
    case "EMOTE":
      return { type: "unimplemented", feature: "Text emotes" };
    default:
      return line ? { type: "chat", message: line } : undefined;
  }
}

export function writeLines(socket: IpcSocket, lines: string[]): void {
  for (const line of lines) socket.write(line + "\n");
  socket.write("\n");
  socket.flush?.();
}

function drainText(events: RingBuffer<EventEntry>): string[] {
  return events.drain().flatMap((e) => (e.text !== undefined ? [e.text] : []));
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
  subscribers?: {
    text: Set<IpcSocket>;
    json: Set<IpcSocket>;
  },
): Promise<{ keepOpen: boolean; shouldExit: boolean }> {
  switch (cmd.type) {
    case "chat": {
      handle.sendInCurrentMode(cmd.message);
      const mode = handle.getLastChatMode();
      const label =
        mode.type === "whisper"
          ? `WHISPER ${mode.target}`
          : mode.type === "channel"
            ? `CHANNEL ${mode.channel}`
            : mode.type.toUpperCase();
      writeLines(socket, [`OK ${label}`]);
      return { keepOpen: false, shouldExit: false };
    }
    case "say":
      handle.sendSay(cmd.message);
      writeLines(socket, ["OK"]);
      return { keepOpen: false, shouldExit: false };
    case "yell":
      handle.sendYell(cmd.message);
      writeLines(socket, ["OK"]);
      return { keepOpen: false, shouldExit: false };
    case "guild":
      handle.sendGuild(cmd.message);
      writeLines(socket, ["OK"]);
      return { keepOpen: false, shouldExit: false };
    case "party":
      handle.sendParty(cmd.message);
      writeLines(socket, ["OK"]);
      return { keepOpen: false, shouldExit: false };
    case "whisper":
      handle.sendWhisper(cmd.target, cmd.message);
      writeLines(socket, ["OK"]);
      return { keepOpen: false, shouldExit: false };
    case "subscribe":
      subscribers?.text.add(socket);
      return { keepOpen: true, shouldExit: false };
    case "subscribe_json":
      subscribers?.json.add(socket);
      return { keepOpen: true, shouldExit: false };
    case "read":
      writeLines(socket, drainText(events));
      return { keepOpen: false, shouldExit: false };
    case "read_json":
      writeLines(socket, drainJson(events));
      return { keepOpen: false, shouldExit: false };
    case "read_wait":
      await new Promise<void>((resolve) => {
        setTimeout(() => {
          writeLines(socket, drainText(events));
          resolve();
        }, cmd.ms);
      });
      return { keepOpen: false, shouldExit: false };
    case "read_wait_json":
      await new Promise<void>((resolve) => {
        setTimeout(() => {
          writeLines(socket, drainJson(events));
          resolve();
        }, cmd.ms);
      });
      return { keepOpen: false, shouldExit: false };
    case "stop":
      writeLines(socket, ["OK"]);
      cleanup();
      return { keepOpen: false, shouldExit: true };
    case "status":
      writeLines(socket, ["CONNECTED"]);
      return { keepOpen: false, shouldExit: false };
    case "who": {
      const results = await handle.who(cmd.filter ? { name: cmd.filter } : {});
      writeLines(socket, formatWhoResults(results).split("\n"));
      return { keepOpen: false, shouldExit: false };
    }
    case "who_json": {
      const results = await handle.who(cmd.filter ? { name: cmd.filter } : {});
      writeLines(socket, [formatWhoResultsJson(results)]);
      return { keepOpen: false, shouldExit: false };
    }
    case "invite":
      handle.invite(cmd.target);
      writeLines(socket, ["OK"]);
      return { keepOpen: false, shouldExit: false };
    case "kick":
      handle.uninvite(cmd.target);
      writeLines(socket, ["OK"]);
      return { keepOpen: false, shouldExit: false };
    case "leave":
      handle.leaveGroup();
      writeLines(socket, ["OK"]);
      return { keepOpen: false, shouldExit: false };
    case "leader":
      handle.setLeader(cmd.target);
      writeLines(socket, ["OK"]);
      return { keepOpen: false, shouldExit: false };
    case "accept":
      handle.acceptInvite();
      writeLines(socket, ["OK"]);
      return { keepOpen: false, shouldExit: false };
    case "decline":
      handle.declineInvite();
      writeLines(socket, ["OK"]);
      return { keepOpen: false, shouldExit: false };
    case "unimplemented":
      writeLines(socket, [`UNIMPLEMENTED ${cmd.feature}`]);
      return { keepOpen: false, shouldExit: false };
  }
}

export function fanoutEvent(
  event: EventEntry,
  subscribers: {
    text: Set<IpcSocket>;
    json: Set<IpcSocket>;
  },
): void {
  if (event.text !== undefined) {
    for (const socket of subscribers.text) {
      try {
        socket.write(event.text + "\n");
        socket.flush?.();
      } catch {
        subscribers.text.delete(socket);
      }
    }
  }
  for (const socket of subscribers.json) {
    try {
      socket.write(event.json + "\n");
      socket.flush?.();
    } catch {
      subscribers.json.delete(socket);
    }
  }
}

function formatGroupEventObj(event: GroupEvent): Record<string, unknown> {
  switch (event.type) {
    case "invite_received":
      return { type: "GROUP_INVITE", from: event.from };
    case "command_result":
      return {
        type: "GROUP_COMMAND_RESULT",
        operation: event.operation,
        target: event.target,
        result: event.result,
      };
    case "leader_changed":
      return { type: "GROUP_LEADER_CHANGED", name: event.name };
    case "group_destroyed":
      return { type: "GROUP_DESTROYED" };
    case "kicked":
      return { type: "GROUP_KICKED" };
    case "invite_declined":
      return { type: "GROUP_INVITE_DECLINED", name: event.name };
    case "group_list":
      return {
        type: "GROUP_LIST",
        members: event.members.map((m) => ({
          name: m.name,
          online: m.online,
        })),
        leader: event.leader,
      };
    case "member_stats":
      return {
        type: "PARTY_MEMBER_STATS",
        guidLow: event.guidLow,
        online: event.online,
        hp: event.hp,
        maxHp: event.maxHp,
        level: event.level,
      };
  }
}

export function onGroupEvent(
  event: GroupEvent,
  events: RingBuffer<EventEntry>,
  log: SessionLog,
  subscribers?: {
    text: Set<IpcSocket>;
    json: Set<IpcSocket>;
  },
): void {
  const text = formatGroupEvent(event);
  const obj = formatGroupEventObj(event);
  const entry = { text, json: JSON.stringify(obj) };
  events.push(entry);
  if (subscribers) fanoutEvent(entry, subscribers);
  log.append(obj as LogEntry).catch(() => {});
}

export function onChatMessage(
  msg: ChatMessage,
  events: RingBuffer<EventEntry>,
  log: SessionLog,
  subscribers?: {
    text: Set<IpcSocket>;
    json: Set<IpcSocket>;
  },
): void {
  const obj = formatMessageObj(msg);
  const entry = { text: formatMessage(msg), json: JSON.stringify(obj) };
  events.push(entry);
  if (subscribers) fanoutEvent(entry, subscribers);
  log.append(obj).catch(() => {});
}
