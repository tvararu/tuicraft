import type { EventEntry } from "daemon/commands";
import { ignoreFailure } from "lib/ignore-failure";
import type { RingBuffer } from "lib/ring-buffer";
import type { LogEntry, SessionLog } from "lib/session-log";
import {
  formatEntityEvent,
  formatEntityEventObj,
  formatFriendEvent,
  formatFriendEventObj,
  formatGroupEvent,
  formatIgnoreEvent,
  formatIgnoreEventObj,
  formatMessage,
  formatMessageObj,
  jsonSafe,
} from "ui/format";
import { formatControlEvent, formatControlEventObj } from "ui/format-control";
import type { ChatMessage, DuelEvent, GroupEvent } from "wow/client";
import type { ControlEvent } from "wow/control";
import type { EntityEvent } from "wow/entity-store";
import type { FriendEvent } from "wow/friend-store";
import type { GuildEvent } from "wow/guild-store";
import type { IgnoreEvent } from "wow/ignore-store";
import { formatGuildCommandError } from "wow/protocol/guild";

function unhandled(event: never): never {
  throw new Error(`Unhandled event type: ${(event as { type: string }).type}`);
}

function formatGroupEventObj(event: GroupEvent): Record<string, unknown> {
  switch (event.type) {
    case "invite_received":
      return { from: event.from, type: "GROUP_INVITE" };
    case "command_result":
      return {
        operation: event.operation,
        result: event.result,
        target: event.target,
        type: "GROUP_COMMAND_RESULT",
      };
    case "leader_changed":
      return { name: event.name, type: "GROUP_LEADER_CHANGED" };
    case "group_destroyed":
      return { type: "GROUP_DESTROYED" };
    case "kicked":
      return { type: "GROUP_KICKED" };
    case "invite_declined":
      return { name: event.name, type: "GROUP_INVITE_DECLINED" };
    case "group_list":
      return {
        leader: event.leader,
        members: event.members.map((m) => ({
          name: m.name,
          online: m.online,
        })),
        type: "GROUP_LIST",
      };
    case "member_stats":
      return {
        guidLow: event.guidLow,
        hp: event.hp,
        level: event.level,
        maxHp: event.maxHp,
        online: event.online,
        type: "PARTY_MEMBER_STATS",
      };
    default:
      return unhandled(event);
  }
}

export function onGroupEvent(
  event: GroupEvent,
  events: RingBuffer<EventEntry>,
  log: SessionLog,
): void {
  const text = formatGroupEvent(event);
  const obj = formatGroupEventObj(event);
  events.push({ json: JSON.stringify(obj), text });
  log.append(obj as LogEntry).catch(ignoreFailure);
}

export function onChatMessage(
  msg: ChatMessage,
  events: RingBuffer<EventEntry>,
  log: SessionLog,
): void {
  const obj = formatMessageObj(msg);
  events.push({ json: JSON.stringify(obj), text: formatMessage(msg) });
  log.append(obj).catch(ignoreFailure);
}

export function onEntityEvent(
  event: EntityEvent,
  events: RingBuffer<EventEntry>,
  log: SessionLog,
): void {
  const text = formatEntityEvent(event);
  const obj = formatEntityEventObj(event);
  if (obj) {
    events.push({ json: JSON.stringify(obj), text });
    log.append(obj as LogEntry).catch(ignoreFailure);
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
    events.push({ json: JSON.stringify(obj), text });
    log.append(obj as LogEntry).catch(ignoreFailure);
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
    events.push({ json: JSON.stringify(obj), text });
    log.append(obj as LogEntry).catch(ignoreFailure);
  }
}

function formatGuildEvent(event: GuildEvent): string | undefined {
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
    case "command_result":
      return formatGuildCommandError(event.command, event.name, event.result);
    case "guild_invite":
      return `[guild] ${event.inviter} has invited you to join ${event.guildName}. Use /gaccept or /gdecline`;
    default:
      return unhandled(event);
  }
}

type GuildStaffEvent = Extract<
  GuildEvent,
  { type: "promotion" | "demotion" | "removed" | "leader_changed" }
>;

function formatGuildStaffEventObj(
  event: GuildStaffEvent,
): Record<string, unknown> {
  switch (event.type) {
    case "promotion":
      return {
        member: event.member,
        officer: event.officer,
        rank: event.rank,
        type: "GUILD_PROMOTION",
      };
    case "demotion":
      return {
        member: event.member,
        officer: event.officer,
        rank: event.rank,
        type: "GUILD_DEMOTION",
      };
    case "removed":
      return {
        member: event.member,
        officer: event.officer,
        type: "GUILD_REMOVED",
      };
    case "leader_changed":
      return {
        newLeader: event.newLeader,
        oldLeader: event.oldLeader,
        type: "GUILD_LEADER_CHANGED",
      };
    default:
      return unhandled(event);
  }
}

function formatGuildEventObj(event: GuildEvent): Record<string, unknown> {
  switch (event.type) {
    case "guild-roster":
      return {
        message: `${event.roster.members.length} members`,
        sender: "",
        type: "GUILD_ROSTER_UPDATED",
      };
    case "promotion":
    case "demotion":
    case "removed":
    case "leader_changed":
      return formatGuildStaffEventObj(event);
    case "motd":
      return { text: event.text, type: "GUILD_MOTD" };
    case "joined":
      return { name: event.name, type: "GUILD_JOINED" };
    case "left":
      return { name: event.name, type: "GUILD_LEFT" };
    case "leader_is":
      return { name: event.name, type: "GUILD_LEADER_IS" };
    case "disbanded":
      return { type: "GUILD_DISBANDED" };
    case "signed_on":
      return { name: event.name, type: "GUILD_SIGNED_ON" };
    case "signed_off":
      return { name: event.name, type: "GUILD_SIGNED_OFF" };
    case "command_result":
      return {
        command: event.command,
        name: event.name,
        result: event.result,
        type: "GUILD_COMMAND_RESULT",
      };
    case "guild_invite":
      return {
        guildName: event.guildName,
        inviter: event.inviter,
        type: "GUILD_INVITE_RECEIVED",
      };
    default:
      return unhandled(event);
  }
}

export function onGuildEvent(
  event: GuildEvent,
  events: RingBuffer<EventEntry>,
  log: SessionLog,
): void {
  const text = formatGuildEvent(event);
  const obj = formatGuildEventObj(event);
  events.push({ json: JSON.stringify(obj), text });
  log.append(obj as LogEntry).catch(ignoreFailure);
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
    default:
      return unhandled(event);
  }
}

function formatDuelEventObj(
  event: DuelEvent,
): Record<string, unknown> | undefined {
  switch (event.type) {
    case "duel_requested":
      return { challenger: event.challenger, type: "DUEL_REQUESTED" };
    case "duel_countdown":
      return { timeMs: event.timeMs, type: "DUEL_COUNTDOWN" };
    case "duel_complete":
      return { completed: event.completed, type: "DUEL_COMPLETE" };
    case "duel_winner":
      return {
        loser: event.loser,
        reason: event.reason,
        type: "DUEL_WINNER",
        winner: event.winner,
      };
    case "duel_out_of_bounds":
      return { type: "DUEL_OUT_OF_BOUNDS" };
    case "duel_in_bounds":
      return { type: "DUEL_IN_BOUNDS" };
    default:
      return unhandled(event);
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
    events.push({ json: JSON.stringify(obj), text });
    log.append(obj as LogEntry).catch(ignoreFailure);
  }
}

export function onControlEvent(
  event: ControlEvent,
  events: RingBuffer<EventEntry>,
  log: SessionLog,
): void {
  const obj = formatControlEventObj(event);
  events.push({
    json: JSON.stringify(obj),
    text: formatControlEvent(event),
  });
  log.append(obj as LogEntry).catch(ignoreFailure);
}

export function onDomainEvent<E extends { type: string }>(
  tag: string,
  event: E,
  events: RingBuffer<EventEntry>,
  log: SessionLog,
): void {
  const obj: Record<string, unknown> = {
    data: jsonSafe(event),
    type: tag.toUpperCase(),
  };
  events.push({ json: JSON.stringify(obj), text: `[${tag}] ${event.type}` });
  log.append(obj as LogEntry).catch(ignoreFailure);
}
