import { RingBuffer } from "lib/ring-buffer";
import {
  formatMessage,
  formatMessageObj,
  formatWhoResults,
  formatWhoResultsJson,
  formatGroupEvent,
  formatEntityEvent,
  formatEntityEventObj,
  formatFriendList,
  formatFriendListJson,
  formatFriendEvent,
  formatFriendEventObj,
  parseCommand,
} from "ui/tui";
import type { FriendEvent } from "wow/friend-store";
import { SessionLog, type LogEntry } from "lib/session-log";
import type { WorldHandle, ChatMessage, GroupEvent } from "wow/client";
import { ObjectType } from "wow/protocol/entity-fields";
import type {
  Entity,
  UnitEntity,
  GameObjectEntity,
  EntityEvent,
} from "wow/entity-store";

export type EventEntry = { text: string | undefined; json: string };

export type IpcSocket = {
  write(data: string | Uint8Array): number;
  end(): void;
};

export type IpcCommand =
  | { type: "chat"; message: string }
  | { type: "say"; message: string }
  | { type: "yell"; message: string }
  | { type: "guild"; message: string }
  | { type: "party"; message: string }
  | { type: "emote"; message: string }
  | { type: "whisper"; target: string; message: string }
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
  | { type: "nearby" }
  | { type: "nearby_json" }
  | { type: "friends" }
  | { type: "friends_json" }
  | { type: "add_friend"; target: string }
  | { type: "del_friend"; target: string }
  | { type: "unimplemented"; feature: string };

export function parseIpcCommand(line: string): IpcCommand | undefined {
  if (line.startsWith("/")) {
    const parsed = parseCommand(line);
    switch (parsed.type) {
      case "say":
      case "yell":
      case "guild":
      case "party":
      case "emote":
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
      case "friends":
        return { type: "friends" };
      case "add-friend":
        return { type: "add_friend", target: parsed.target };
      case "remove-friend":
        return { type: "del_friend", target: parsed.target };
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
    case "EMOTE":
      return {
        type: verb.toLowerCase() as
          | "say"
          | "yell"
          | "guild"
          | "party"
          | "emote",
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
    case "NEARBY":
      return { type: "nearby" };
    case "NEARBY_JSON":
      return { type: "nearby_json" };
    case "FRIENDS":
      return { type: "friends" };
    case "FRIENDS_JSON":
      return { type: "friends_json" };
    case "ADD_FRIEND":
      return rest ? { type: "add_friend", target: rest } : undefined;
    case "DEL_FRIEND":
      return rest ? { type: "del_friend", target: rest } : undefined;
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
    default:
      return line ? { type: "chat", message: line } : undefined;
  }
}

export function writeLines(socket: IpcSocket, lines: string[]): void {
  for (const line of lines) socket.write(line + "\n");
  socket.write("\n");
}

function drainText(events: RingBuffer<EventEntry>): string[] {
  return events.drain().flatMap((e) => (e.text !== undefined ? [e.text] : []));
}

function drainJson(events: RingBuffer<EventEntry>): string[] {
  return events.drain().map((e) => e.json);
}

function sliceText(events: RingBuffer<EventEntry>, from: number): string[] {
  return events
    .slice(from)
    .flatMap((e) => (e.text !== undefined ? [e.text] : []));
}

function sliceJson(events: RingBuffer<EventEntry>, from: number): string[] {
  return events.slice(from).map((e) => e.json);
}

export async function dispatchCommand(
  cmd: IpcCommand,
  handle: WorldHandle,
  events: RingBuffer<EventEntry>,
  socket: IpcSocket,
  cleanup: () => void,
): Promise<boolean> {
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
      return false;
    }
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
    case "emote":
      handle.sendEmote(cmd.message);
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
    case "read_wait": {
      const start = events.writePos;
      await new Promise<void>((resolve) => {
        setTimeout(() => {
          writeLines(socket, sliceText(events, start));
          resolve();
        }, cmd.ms);
      });
      return false;
    }
    case "read_wait_json": {
      const start = events.writePos;
      await new Promise<void>((resolve) => {
        setTimeout(() => {
          writeLines(socket, sliceJson(events, start));
          resolve();
        }, cmd.ms);
      });
      return false;
    }
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
    case "invite":
      handle.invite(cmd.target);
      writeLines(socket, ["OK"]);
      return false;
    case "kick":
      handle.uninvite(cmd.target);
      writeLines(socket, ["OK"]);
      return false;
    case "leave":
      handle.leaveGroup();
      writeLines(socket, ["OK"]);
      return false;
    case "leader":
      handle.setLeader(cmd.target);
      writeLines(socket, ["OK"]);
      return false;
    case "accept":
      handle.acceptInvite();
      writeLines(socket, ["OK"]);
      return false;
    case "decline":
      handle.declineInvite();
      writeLines(socket, ["OK"]);
      return false;
    case "nearby": {
      const entities = handle.getNearbyEntities();
      writeLines(socket, entities.map(formatNearbyLine));
      return false;
    }
    case "nearby_json": {
      const entities = handle.getNearbyEntities();
      writeLines(
        socket,
        entities.map((e) => JSON.stringify(formatNearbyObj(e))),
      );
      return false;
    }
    case "friends": {
      const friends = handle.getFriends();
      writeLines(socket, formatFriendList(friends).split("\n"));
      return false;
    }
    case "friends_json": {
      const friends = handle.getFriends();
      writeLines(socket, [formatFriendListJson(friends)]);
      return false;
    }
    case "add_friend":
      handle.addFriend(cmd.target);
      writeLines(socket, ["OK"]);
      return false;
    case "del_friend":
      handle.removeFriend(cmd.target);
      writeLines(socket, ["OK"]);
      return false;
    case "unimplemented":
      writeLines(socket, [`UNIMPLEMENTED ${cmd.feature}`]);
      return false;
  }
}

function objectTypeName(type: ObjectType): string {
  switch (type) {
    case ObjectType.UNIT:
      return "NPC";
    case ObjectType.PLAYER:
      return "Player";
    default:
      return `type ${type}`;
  }
}

function formatNearbyLine(entity: Entity): string {
  if (
    entity.objectType === ObjectType.UNIT ||
    entity.objectType === ObjectType.PLAYER
  ) {
    const unit = entity as UnitEntity;
    const name = entity.name ?? "Unknown";
    const kind = objectTypeName(entity.objectType);
    const level = unit.level > 0 ? `, level ${unit.level}` : "";
    const hp = `HP ${unit.health}/${unit.maxHealth}`;
    const pos = entity.position
      ? ` at ${entity.position.x.toFixed(2)}, ${entity.position.y.toFixed(2)}, ${entity.position.z.toFixed(2)}`
      : "";
    return `${name} (${kind}${level}) ${hp}${pos}`;
  }
  if (entity.objectType === ObjectType.GAMEOBJECT) {
    const name = entity.name ?? "Unknown";
    const pos = entity.position
      ? ` at ${entity.position.x.toFixed(2)}, ${entity.position.y.toFixed(2)}, ${entity.position.z.toFixed(2)}`
      : "";
    return `${name} (GameObject)${pos}`;
  }
  return `Entity 0x${entity.guid.toString(16)} (${objectTypeName(entity.objectType)})`;
}

function objectTypeString(type: ObjectType): string {
  switch (type) {
    case ObjectType.UNIT:
      return "unit";
    case ObjectType.PLAYER:
      return "player";
    case ObjectType.GAMEOBJECT:
      return "gameobject";
    default:
      return "object";
  }
}

function formatNearbyObj(entity: Entity): Record<string, unknown> {
  const obj: Record<string, unknown> = {
    guid: `0x${entity.guid.toString(16)}`,
    type: objectTypeString(entity.objectType),
    name: entity.name,
  };
  if (
    entity.objectType === ObjectType.UNIT ||
    entity.objectType === ObjectType.PLAYER
  ) {
    const unit = entity as UnitEntity;
    obj["level"] = unit.level;
    obj["health"] = unit.health;
    obj["maxHealth"] = unit.maxHealth;
  }
  if (entity.objectType === ObjectType.GAMEOBJECT) {
    obj["gameObjectType"] = (entity as GameObjectEntity).gameObjectType;
  }
  if (entity.position) {
    obj["x"] = entity.position.x;
    obj["y"] = entity.position.y;
    obj["z"] = entity.position.z;
  }
  return obj;
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
): void {
  const text = formatGroupEvent(event);
  const obj = formatGroupEventObj(event);
  events.push({ text, json: JSON.stringify(obj) });
  log.append(obj as LogEntry).catch(() => {});
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

export function onEntityEvent(
  event: EntityEvent,
  events: RingBuffer<EventEntry>,
  log: SessionLog,
): void {
  const text = formatEntityEvent(event);
  const obj = formatEntityEventObj(event);
  if (obj) {
    events.push({ text, json: JSON.stringify(obj) });
    log.append(obj as LogEntry).catch(() => {});
  }
}

export function onFriendEvent(
  event: FriendEvent,
  events: RingBuffer<EventEntry>,
  log: SessionLog,
): void {
  const text = formatFriendEvent(event);
  const obj = formatFriendEventObj(event);
  if (obj) {
    events.push({ text, json: JSON.stringify(obj) });
    log.append(obj as LogEntry).catch(() => {});
  }
}
