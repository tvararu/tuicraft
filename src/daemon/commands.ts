import { RingBuffer } from "lib/ring-buffer";
import { parseCommand } from "ui/commands";
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
  formatIgnoreList,
  formatIgnoreListJson,
  formatIgnoreEvent,
  formatIgnoreEventObj,
  formatGuildRoster,
  formatGuildRosterJson,
} from "ui/format";
import type { FriendEvent } from "wow/friend-store";
import type { IgnoreEvent } from "wow/ignore-store";
import type { GuildEvent } from "wow/guild-store";
import { SessionLog, type LogEntry } from "lib/session-log";
import type {
  WorldHandle,
  ChatMessage,
  GroupEvent,
  DuelEvent,
} from "wow/client";
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
  | { type: "dnd"; message: string }
  | { type: "afk"; message: string }
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
  | { type: "join_channel"; channel: string; password?: string }
  | { type: "leave_channel"; channel: string }
  | { type: "leader"; target: string }
  | { type: "accept" }
  | { type: "decline" }
  | { type: "nearby" }
  | { type: "nearby_json" }
  | { type: "friends" }
  | { type: "friends_json" }
  | { type: "add_friend"; target: string }
  | { type: "del_friend"; target: string }
  | { type: "ignored" }
  | { type: "ignored_json" }
  | { type: "add_ignore"; target: string }
  | { type: "del_ignore"; target: string }
  | { type: "roll"; min: number; max: number }
  | { type: "guild_roster" }
  | { type: "guild_roster_json" }
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
      case "dnd":
      case "afk":
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
      case "join-channel":
        return {
          type: "join_channel",
          channel: parsed.channel,
          password: parsed.password,
        };
      case "leave-channel":
        return { type: "leave_channel", channel: parsed.channel };
      case "friends":
        return { type: "friends" };
      case "add-friend":
        return { type: "add_friend", target: parsed.target };
      case "remove-friend":
        return { type: "del_friend", target: parsed.target };
      case "ignored":
        return { type: "ignored" };
      case "add-ignore":
        return { type: "add_ignore", target: parsed.target };
      case "remove-ignore":
        return { type: "del_ignore", target: parsed.target };
      case "roll":
        return parsed;
      case "guild-roster":
        return { type: "guild_roster" };
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
    case "DND":
    case "AFK":
      return {
        type: verb.toLowerCase() as
          | "say"
          | "yell"
          | "guild"
          | "party"
          | "emote"
          | "dnd"
          | "afk",
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
      if (rest) {
        const channel = rest.split(" ")[0]!;
        return { type: "leave_channel", channel };
      }
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
    case "IGNORED":
      return { type: "ignored" };
    case "IGNORED_JSON":
      return { type: "ignored_json" };
    case "ADD_IGNORE":
      return rest ? { type: "add_ignore", target: rest } : undefined;
    case "DEL_IGNORE":
      return rest ? { type: "del_ignore", target: rest } : undefined;
    case "JOIN": {
      if (!rest) return undefined;
      const [channel, password] = rest.split(" ") as [string, string?];
      return { type: "join_channel", channel, password };
    }
    case "GUILD_ROSTER":
      return { type: "guild_roster" };
    case "GUILD_ROSTER_JSON":
      return { type: "guild_roster_json" };
    case "GINVITE":
    case "GKICK":
    case "GLEAVE":
    case "GPROMOTE":
      return { type: "unimplemented", feature: "Guild management" };
    case "MAIL":
      return { type: "unimplemented", feature: "Mail reading" };
    case "ROLL": {
      const parts = rest.split(" ").filter(Boolean);
      if (parts.length >= 2)
        return {
          type: "roll",
          min: parseInt(parts[0]!, 10),
          max: parseInt(parts[1]!, 10),
        };
      if (parts.length === 1)
        return { type: "roll", min: 1, max: parseInt(parts[0]!, 10) };
      return { type: "roll", min: 1, max: 100 };
    }
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
    case "dnd":
      handle.sendDnd(cmd.message);
      writeLines(socket, ["OK"]);
      return false;
    case "afk":
      handle.sendAfk(cmd.message);
      writeLines(socket, ["OK"]);
      return false;
    case "whisper":
      handle.sendWhisper(cmd.target, cmd.message);
      writeLines(socket, ["OK"]);
      return false;
    case "roll":
      handle.sendRoll(cmd.min, cmd.max);
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
    case "ignored": {
      const ignored = handle.getIgnored();
      writeLines(socket, formatIgnoreList(ignored).split("\n"));
      return false;
    }
    case "ignored_json": {
      const ignored = handle.getIgnored();
      writeLines(socket, [formatIgnoreListJson(ignored)]);
      return false;
    }
    case "add_ignore":
      handle.addIgnore(cmd.target);
      writeLines(socket, ["OK"]);
      return false;
    case "del_ignore":
      handle.removeIgnore(cmd.target);
      writeLines(socket, ["OK"]);
      return false;
    case "join_channel":
      handle.joinChannel(cmd.channel, cmd.password);
      writeLines(socket, ["OK"]);
      return false;
    case "leave_channel":
      handle.leaveChannel(cmd.channel);
      writeLines(socket, ["OK"]);
      return false;
    case "guild_roster": {
      const roster = await handle.requestGuildRoster();
      if (roster) {
        writeLines(socket, formatGuildRoster(roster).split("\n"));
      } else {
        writeLines(socket, ["[guild] No guild roster available"]);
      }
      return false;
    }
    case "guild_roster_json": {
      const roster = await handle.requestGuildRoster();
      if (roster) {
        writeLines(socket, [formatGuildRosterJson(roster)]);
      } else {
        writeLines(socket, [
          JSON.stringify({ type: "GUILD_ROSTER", members: [] }),
        ]);
      }
      return false;
    }
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

export function onIgnoreEvent(
  event: IgnoreEvent,
  events: RingBuffer<EventEntry>,
  log: SessionLog,
): void {
  const text = formatIgnoreEvent(event);
  const obj = formatIgnoreEventObj(event);
  if (obj) {
    events.push({ text, json: JSON.stringify(obj) });
    log.append(obj as LogEntry).catch(() => {});
  }
}

function formatGuildEvent(event: GuildEvent): string {
  switch (event.type) {
    case "guild-roster":
      return `[guild] Roster updated: ${event.roster.members.length} members`;
    case "promotion":
      return `[guild] ${event.officer} promoted ${event.member} to ${event.rank}`;
    case "demotion":
      return `[guild] ${event.officer} demoted ${event.member} to ${event.rank}`;
    case "motd":
      return `[guild] MOTD: ${event.text}`;
    case "joined":
      return `[guild] ${event.name} has joined the guild`;
    case "left":
      return `[guild] ${event.name} has left the guild`;
    case "removed":
      return `[guild] ${event.officer} removed ${event.member} from the guild`;
    case "leader_is":
      return `[guild] ${event.name} is the guild leader`;
    case "leader_changed":
      return `[guild] ${event.oldLeader} has made ${event.newLeader} the new guild leader`;
    case "disbanded":
      return "[guild] Guild has been disbanded";
    case "signed_on":
      return `[guild] ${event.name} has come online`;
    case "signed_off":
      return `[guild] ${event.name} has gone offline`;
  }
}

function formatGuildEventObj(event: GuildEvent): Record<string, unknown> {
  switch (event.type) {
    case "guild-roster":
      return {
        type: "GUILD_ROSTER_UPDATED",
        sender: "",
        message: `${event.roster.members.length} members`,
      };
    case "promotion":
      return {
        type: "GUILD_PROMOTION",
        officer: event.officer,
        member: event.member,
        rank: event.rank,
      };
    case "demotion":
      return {
        type: "GUILD_DEMOTION",
        officer: event.officer,
        member: event.member,
        rank: event.rank,
      };
    case "motd":
      return { type: "GUILD_MOTD", text: event.text };
    case "joined":
      return { type: "GUILD_JOINED", name: event.name };
    case "left":
      return { type: "GUILD_LEFT", name: event.name };
    case "removed":
      return {
        type: "GUILD_REMOVED",
        member: event.member,
        officer: event.officer,
      };
    case "leader_is":
      return { type: "GUILD_LEADER_IS", name: event.name };
    case "leader_changed":
      return {
        type: "GUILD_LEADER_CHANGED",
        oldLeader: event.oldLeader,
        newLeader: event.newLeader,
      };
    case "disbanded":
      return { type: "GUILD_DISBANDED" };
    case "signed_on":
      return { type: "GUILD_SIGNED_ON", name: event.name };
    case "signed_off":
      return { type: "GUILD_SIGNED_OFF", name: event.name };
  }
}

export function onGuildEvent(
  event: GuildEvent,
  events: RingBuffer<EventEntry>,
  log: SessionLog,
): void {
  const text = formatGuildEvent(event);
  const obj = formatGuildEventObj(event);
  events.push({ text, json: JSON.stringify(obj) });
  log.append(obj as LogEntry).catch(() => {});
}

function formatDuelEvent(event: DuelEvent): string | undefined {
  switch (event.type) {
    case "duel_requested":
      return `[duel] ${event.challenger} challenges you to a duel`;
    case "duel_countdown":
      return `[duel] Duel starting in ${event.timeMs / 1000} seconds`;
    case "duel_complete":
      return event.completed ? undefined : "[duel] Duel interrupted";
    case "duel_winner":
      return event.reason === "won"
        ? `[duel] ${event.winner} has defeated ${event.loser} in a duel`
        : `[duel] ${event.loser} has fled from ${event.winner} in a duel`;
    case "duel_out_of_bounds":
      return "[duel] Out of bounds \u2014 return to the duel area";
    case "duel_in_bounds":
      return "[duel] Back in bounds";
  }
}

function formatDuelEventObj(
  event: DuelEvent,
): Record<string, unknown> | undefined {
  switch (event.type) {
    case "duel_requested":
      return { type: "DUEL_REQUESTED", challenger: event.challenger };
    case "duel_countdown":
      return { type: "DUEL_COUNTDOWN", timeMs: event.timeMs };
    case "duel_complete":
      return { type: "DUEL_COMPLETE", completed: event.completed };
    case "duel_winner":
      return {
        type: "DUEL_WINNER",
        reason: event.reason,
        winner: event.winner,
        loser: event.loser,
      };
    case "duel_out_of_bounds":
      return { type: "DUEL_OUT_OF_BOUNDS" };
    case "duel_in_bounds":
      return { type: "DUEL_IN_BOUNDS" };
  }
}

export function onDuelEvent(
  event: DuelEvent,
  events: RingBuffer<EventEntry>,
  log: SessionLog,
): void {
  const text = formatDuelEvent(event);
  const obj = formatDuelEventObj(event);
  if (obj) {
    events.push({ text, json: JSON.stringify(obj) });
    log.append(obj as LogEntry).catch(() => {});
  }
}
