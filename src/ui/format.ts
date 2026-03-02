import { ChatType, PartyOperation, PartyResult } from "wow/protocol/opcodes";
import { ObjectType } from "wow/protocol/entity-fields";
import { FriendStatus, FriendResult } from "wow/protocol/social";
import { stripColorCodes } from "lib/strip-colors";
import type { ChatMessage, ChatMode, WhoResult, GroupEvent } from "wow/client";
import type { EntityEvent, UnitEntity } from "wow/entity-store";
import type { FriendEntry, FriendEvent } from "wow/friend-store";
import type { IgnoreEntry, IgnoreEvent } from "wow/ignore-store";
import type { GuildRoster } from "wow/guild-store";
import { GuildMemberStatus } from "wow/protocol/guild";
import type { LogEntry } from "lib/session-log";

const CHAT_TYPE_LABELS: Record<number, string> = {
  [ChatType.SYSTEM]: "system",
  [ChatType.SAY]: "say",
  [ChatType.PARTY]: "party",
  [ChatType.RAID]: "raid",
  [ChatType.GUILD]: "guild",
  [ChatType.OFFICER]: "officer",
  [ChatType.YELL]: "yell",
  [ChatType.WHISPER]: "whisper from",
  [ChatType.WHISPER_INFORM]: "whisper to",
  [ChatType.EMOTE]: "emote",
  [ChatType.CHANNEL]: "channel",
  [ChatType.RAID_LEADER]: "raid leader",
  [ChatType.RAID_WARNING]: "raid warning",
  [ChatType.PARTY_LEADER]: "party leader",
  [ChatType.ROLL]: "roll",
};

export function formatMessage(msg: ChatMessage): string {
  const message = stripColorCodes(msg.message);
  const label = CHAT_TYPE_LABELS[msg.type] ?? `type ${msg.type}`;

  if (msg.type === ChatType.WHISPER) {
    return `[whisper from ${msg.sender}] ${message}`;
  }
  if (msg.type === ChatType.WHISPER_INFORM) {
    return `[whisper to ${msg.sender}] ${message}`;
  }
  if (
    msg.type === ChatType.SYSTEM &&
    (msg.origin === "server" || msg.origin === "notification")
  ) {
    return `[server] ${message}`;
  }
  if (msg.type === ChatType.SYSTEM) {
    return `[system] ${message}`;
  }
  if (msg.type === ChatType.ROLL) {
    return `[roll] ${msg.sender} ${message}`;
  }
  if (msg.type === ChatType.CHANNEL && msg.channel) {
    return `[${msg.channel}] ${msg.sender}: ${message}`;
  }
  return `[${label}] ${msg.sender}: ${message}`;
}

const JSON_TYPE_LABELS: Record<number, string> = {
  [ChatType.SYSTEM]: "SYSTEM",
  [ChatType.SAY]: "SAY",
  [ChatType.PARTY]: "PARTY",
  [ChatType.RAID]: "RAID",
  [ChatType.GUILD]: "GUILD",
  [ChatType.OFFICER]: "OFFICER",
  [ChatType.YELL]: "YELL",
  [ChatType.WHISPER]: "WHISPER_FROM",
  [ChatType.WHISPER_INFORM]: "WHISPER_TO",
  [ChatType.EMOTE]: "EMOTE",
  [ChatType.CHANNEL]: "CHANNEL",
  [ChatType.RAID_LEADER]: "RAID_LEADER",
  [ChatType.RAID_WARNING]: "RAID_WARNING",
  [ChatType.PARTY_LEADER]: "PARTY_LEADER",
  [ChatType.ROLL]: "ROLL",
};

export function formatMessageObj(msg: ChatMessage): LogEntry {
  const type =
    msg.origin === "server"
      ? "SERVER_BROADCAST"
      : msg.origin === "notification"
        ? "NOTIFICATION"
        : (JSON_TYPE_LABELS[msg.type] ?? `TYPE_${msg.type}`);
  const obj: LogEntry = {
    type,
    sender: msg.sender,
    message: stripColorCodes(msg.message),
  };
  if (msg.channel) obj.channel = msg.channel;
  return obj;
}

export function formatMessageJson(msg: ChatMessage): string {
  return JSON.stringify(formatMessageObj(msg));
}

export function formatError(message: string): string {
  return `[system] ${message}`;
}

export function formatWhoResults(results: WhoResult[]): string {
  const names =
    results.map((r) => `${r.name} (${r.level})`).join(", ") || "none";
  return `[who] ${results.length} results: ${names}`;
}

export function formatWhoResultsJson(results: WhoResult[]): string {
  return JSON.stringify({
    type: "WHO",
    count: results.length,
    results: results.map((r) => ({
      name: r.name,
      guild: r.guild,
      level: r.level,
      classId: r.classId,
      race: r.race,
      gender: r.gender,
      zone: r.zone,
    })),
  });
}

export function formatPrompt(mode: ChatMode): string {
  switch (mode.type) {
    case "whisper":
      return `[whisper: ${mode.target}] > `;
    case "channel":
      return `[${mode.channel}] > `;
    default:
      return `[${mode.type}] > `;
  }
}

function partyResultLabel(result: number): string {
  switch (result) {
    case PartyResult.BAD_PLAYER_NAME:
      return "player not found";
    case PartyResult.GROUP_FULL:
      return "group is full";
    case PartyResult.ALREADY_IN_GROUP:
      return "already in a group";
    case PartyResult.NOT_LEADER:
      return "you are not the leader";
    case PartyResult.PLAYER_WRONG_FACTION:
      return "wrong faction";
    case PartyResult.IGNORING_YOU:
      return "player is ignoring you";
    default:
      return `error ${result}`;
  }
}

export function formatGroupEvent(event: GroupEvent): string | undefined {
  switch (event.type) {
    case "invite_received":
      return `[group] ${event.from} invites you to a group`;
    case "command_result": {
      const verb =
        event.operation === PartyOperation.UNINVITE
          ? "kick"
          : event.operation === PartyOperation.LEAVE
            ? "leave"
            : "invite";
      const label =
        event.result === PartyResult.SUCCESS
          ? verb === "kick"
            ? `Removed ${event.target} from group`
            : verb === "leave"
              ? "Left the group"
              : `Invited ${event.target}`
          : `Cannot ${verb}${event.target ? ` ${event.target}` : ""}: ${partyResultLabel(event.result)}`;
      return `[group] ${label}`;
    }
    case "leader_changed":
      return `[group] ${event.name} is now the group leader`;
    case "group_destroyed":
      return "[group] Group has been disbanded";
    case "kicked":
      return "[group] You have been removed from the group";
    case "invite_declined":
      return `[group] ${event.name} has declined your invitation`;
    case "group_list":
    case "member_stats":
      return undefined;
  }
}

export function formatEntityEvent(event: EntityEvent): string | undefined {
  switch (event.type) {
    case "appear": {
      const e = event.entity;
      if (!e.name) return undefined;
      if (
        e.objectType === ObjectType.UNIT ||
        e.objectType === ObjectType.PLAYER
      ) {
        const unit = e as UnitEntity;
        const kind = e.objectType === ObjectType.PLAYER ? "Player" : "NPC";
        const levelStr = unit.level > 0 ? `, level ${unit.level}` : "";
        return `[world] ${e.name} appeared (${kind}${levelStr})`;
      }
      if (e.objectType === ObjectType.GAMEOBJECT) {
        return `[world] ${e.name} appeared (GameObject)`;
      }
      return undefined;
    }
    case "disappear": {
      const name = event.name ?? "Unknown entity";
      return `[world] ${name} left range`;
    }
    case "update": {
      if (!event.changed.includes("name") || !event.entity.name)
        return undefined;
      return formatEntityEvent({ type: "appear", entity: event.entity });
    }
  }
}

export function formatEntityEventObj(
  event: EntityEvent,
): Record<string, unknown> | undefined {
  switch (event.type) {
    case "appear": {
      const e = event.entity;
      const obj: Record<string, unknown> = {
        type: "ENTITY_APPEAR",
        guid: `0x${e.guid.toString(16)}`,
        objectType: e.objectType,
        name: e.name,
      };
      if (
        e.objectType === ObjectType.UNIT ||
        e.objectType === ObjectType.PLAYER
      ) {
        const unit = e as UnitEntity;
        obj["level"] = unit.level;
        obj["health"] = unit.health;
        obj["maxHealth"] = unit.maxHealth;
      }
      if (e.position) {
        obj["x"] = e.position.x;
        obj["y"] = e.position.y;
        obj["z"] = e.position.z;
      }
      return obj;
    }
    case "disappear":
      return {
        type: "ENTITY_DISAPPEAR",
        guid: `0x${event.guid.toString(16)}`,
        name: event.name,
      };
    case "update":
      return undefined;
  }
}

const CLASS_NAMES: Record<number, string> = {
  1: "Warrior",
  2: "Paladin",
  3: "Hunter",
  4: "Rogue",
  5: "Priest",
  6: "Death Knight",
  7: "Shaman",
  8: "Mage",
  9: "Warlock",
  11: "Druid",
};

function friendStatusLabel(status: number): string {
  if (status === FriendStatus.AFK) return "AFK";
  if (status === FriendStatus.DND) return "DND";
  if (status !== FriendStatus.OFFLINE) return "Online";
  return "Offline";
}

export function formatFriendList(friends: FriendEntry[]): string {
  if (friends.length === 0) return "[friends] No friends on your list";
  const lines = friends.map((f) => {
    const name = f.name || `guid:${Number(f.guid & 0xffffffffn)}`;
    if (f.status === FriendStatus.OFFLINE) return `  ${name} — Offline`;
    const cls = CLASS_NAMES[f.playerClass] ?? `class ${f.playerClass}`;
    const statusLabel = friendStatusLabel(f.status);
    return `  ${name} — ${statusLabel}, Level ${f.level} ${cls}`;
  });
  const online = friends.filter(
    (f) => f.status !== FriendStatus.OFFLINE,
  ).length;
  return `[friends] ${online}/${friends.length} online\n${lines.join("\n")}`;
}

export function formatFriendListJson(friends: FriendEntry[]): string {
  return JSON.stringify({
    type: "FRIENDS",
    count: friends.length,
    online: friends.filter((f) => f.status !== FriendStatus.OFFLINE).length,
    friends: friends.map((f) => ({
      guid: `0x${f.guid.toString(16)}`,
      name: f.name,
      note: f.note,
      status: friendStatusLabel(f.status).toUpperCase(),
      level: f.level,
      class: CLASS_NAMES[f.playerClass] ?? `class ${f.playerClass}`,
      area: f.area,
    })),
  });
}

function friendResultLabel(result: number): string {
  const labels: Record<number, string> = {
    0x00: "database error",
    0x01: "friends list is full",
    0x04: "player not found",
    0x08: "already on friends list",
    0x09: "cannot add yourself",
    0x0a: "cannot add enemy faction",
  };
  return labels[result] ?? `error ${result}`;
}

export function formatFriendEvent(event: FriendEvent): string | undefined {
  switch (event.type) {
    case "friend-online": {
      const f = event.friend;
      const cls = CLASS_NAMES[f.playerClass] ?? "";
      const lvl = f.level ? `Level ${f.level}` : "";
      const detail = [lvl, cls].filter(Boolean).join(" ");
      return `[friends] ${f.name || "Unknown"} is now online${detail ? ` (${detail})` : ""}`;
    }
    case "friend-offline":
      return `[friends] ${event.name || "Unknown"} went offline`;
    case "friend-added": {
      const f = event.friend;
      return `[friends] ${f.name || "Unknown"} added to friends list`;
    }
    case "friend-removed":
      return `[friends] ${event.name || "Unknown"} removed from friends list`;
    case "friend-error":
      return `[friends] Error: ${friendResultLabel(event.result)}`;
    case "friend-list":
      return undefined;
  }
}

export function formatFriendEventObj(
  event: FriendEvent,
): Record<string, unknown> | undefined {
  switch (event.type) {
    case "friend-online":
      return {
        type: "FRIEND_ONLINE",
        name: event.friend.name,
        level: event.friend.level,
        class: CLASS_NAMES[event.friend.playerClass],
        area: event.friend.area,
      };
    case "friend-offline":
      return { type: "FRIEND_OFFLINE", name: event.name };
    case "friend-added":
      return { type: "FRIEND_ADDED", name: event.friend.name };
    case "friend-removed":
      return { type: "FRIEND_REMOVED", name: event.name };
    case "friend-error":
      return {
        type: "FRIEND_ERROR",
        result: event.result,
        message: friendResultLabel(event.result),
      };
    case "friend-list":
      return undefined;
  }
}

export function formatIgnoreList(ignored: IgnoreEntry[]): string {
  if (ignored.length === 0) return "[ignore] Ignore list is empty";
  const lines = ignored.map((e) => {
    const name = e.name || `guid:${Number(e.guid & 0xffffffffn)}`;
    return `  ${name}`;
  });
  return `[ignore] ${ignored.length} ignored\n${lines.join("\n")}`;
}

export function formatIgnoreListJson(ignored: IgnoreEntry[]): string {
  return JSON.stringify({
    type: "IGNORED",
    count: ignored.length,
    ignored: ignored.map((e) => ({
      guid: `0x${e.guid.toString(16)}`,
      name: e.name,
    })),
  });
}

function ignoreResultLabel(result: number): string {
  const labels: Record<number, string> = {
    [FriendResult.IGNORE_FULL]: "ignore list is full",
    [FriendResult.IGNORE_SELF]: "cannot ignore yourself",
    [FriendResult.IGNORE_NOT_FOUND]: "player not found",
    [FriendResult.IGNORE_ALREADY]: "already ignoring",
    [FriendResult.IGNORE_AMBIGUOUS]: "name is ambiguous",
  };
  return labels[result] ?? `error ${result}`;
}

export function formatIgnoreEvent(event: IgnoreEvent): string | undefined {
  switch (event.type) {
    case "ignore-added":
      return `[ignore] ${event.entry.name || "Unknown"} added to ignore list`;
    case "ignore-removed":
      return `[ignore] ${event.name || "Unknown"} removed from ignore list`;
    case "ignore-error":
      return `[ignore] Error: ${ignoreResultLabel(event.result)}`;
    case "ignore-list":
      return undefined;
  }
}

export function formatIgnoreEventObj(
  event: IgnoreEvent,
): Record<string, unknown> | undefined {
  switch (event.type) {
    case "ignore-added":
      return { type: "IGNORE_ADDED", name: event.entry.name };
    case "ignore-removed":
      return { type: "IGNORE_REMOVED", name: event.name };
    case "ignore-error":
      return {
        type: "IGNORE_ERROR",
        result: event.result,
        message: ignoreResultLabel(event.result),
      };
    case "ignore-list":
      return undefined;
  }
}

function rankName(roster: GuildRoster, index: number): string {
  return roster.rankNames[index] ?? `Rank ${index}`;
}

function formatOfflineTime(days: number): string {
  if (days < 1) {
    const hours = Math.floor(days * 24);
    return hours <= 1 ? "< 1 hr ago" : `${hours} hrs ago`;
  }
  const d = Math.floor(days);
  return d === 1 ? "1 day ago" : `${d} days ago`;
}

export function formatGuildRoster(roster: GuildRoster): string {
  const online = roster.members.filter(
    (m) => m.status !== GuildMemberStatus.OFFLINE,
  );
  const offline = roster.members.filter(
    (m) => m.status === GuildMemberStatus.OFFLINE,
  );
  const header = roster.guildName
    ? `[guild] ${roster.guildName} — ${online.length}/${roster.members.length} online`
    : `[guild] ${online.length}/${roster.members.length} online`;
  const lines: string[] = [header];
  if (roster.motd) lines.push(`  MOTD: ${roster.motd}`);
  if (roster.guildInfo) lines.push(`  Info: ${roster.guildInfo}`);
  for (const m of online) {
    const cls = CLASS_NAMES[m.playerClass] ?? `class ${m.playerClass}`;
    const rank = rankName(roster, m.rankIndex);
    lines.push(`  ${m.name} — ${rank}, Level ${m.level} ${cls}`);
  }
  for (const m of offline) {
    const rank = rankName(roster, m.rankIndex);
    const ago = formatOfflineTime(m.timeOffline);
    lines.push(`  ${m.name} — ${rank}, Offline (${ago})`);
  }
  return lines.join("\n");
}

export function formatGuildRosterJson(roster: GuildRoster): string {
  return JSON.stringify({
    type: "GUILD_ROSTER",
    guildName: roster.guildName,
    motd: roster.motd,
    guildInfo: roster.guildInfo,
    rankNames: roster.rankNames,
    count: roster.members.length,
    online: roster.members.filter((m) => m.status !== GuildMemberStatus.OFFLINE)
      .length,
    members: roster.members.map((m) => ({
      guid: `0x${m.guid.toString(16)}`,
      name: m.name,
      rank: rankName(roster, m.rankIndex),
      rankIndex: m.rankIndex,
      level: m.level,
      class: CLASS_NAMES[m.playerClass] ?? `class ${m.playerClass}`,
      status: m.status === GuildMemberStatus.OFFLINE ? "OFFLINE" : "ONLINE",
      area: m.area,
      publicNote: m.publicNote,
      officerNote: m.officerNote,
    })),
  });
}
