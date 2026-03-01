import { createInterface } from "node:readline";
import { ChatType, PartyOperation, PartyResult } from "wow/protocol/opcodes";
import { ObjectType } from "wow/protocol/entity-fields";
import type {
  WorldHandle,
  ChatMessage,
  ChatMode,
  WhoResult,
  GroupEvent,
} from "wow/client";
import type { EntityEvent, UnitEntity } from "wow/entity-store";
import type { FriendEntry, FriendEvent } from "wow/friend-store";
import { FriendStatus } from "wow/protocol/social";
import type { LogEntry } from "lib/session-log";
import { stripColorCodes } from "lib/strip-colors";

export type Command =
  | { type: "chat"; message: string }
  | { type: "say"; message: string }
  | { type: "yell"; message: string }
  | { type: "guild"; message: string }
  | { type: "party"; message: string }
  | { type: "raid"; message: string }
  | { type: "emote"; message: string }
  | { type: "dnd"; message: string }
  | { type: "afk"; message: string }
  | { type: "whisper"; target: string; message: string }
  | { type: "reply"; message: string }
  | { type: "channel"; target: string; message: string }
  | { type: "who"; target?: string }
  | { type: "invite"; target: string }
  | { type: "kick"; target: string }
  | { type: "leave" }
  | { type: "leader"; target: string }
  | { type: "accept" }
  | { type: "decline" }
  | { type: "quit" }
  | { type: "tuicraft"; subcommand: string; value: string }
  | { type: "friends" }
  | { type: "add-friend"; target: string }
  | { type: "remove-friend"; target: string }
  | { type: "unimplemented"; feature: string };

export function parseCommand(input: string): Command {
  if (!input.startsWith("/")) return { type: "chat", message: input };

  const spaceIdx = input.indexOf(" ");
  const cmd = spaceIdx === -1 ? input : input.slice(0, spaceIdx);
  const rest = spaceIdx === -1 ? "" : input.slice(spaceIdx + 1);

  switch (cmd) {
    case "/s":
    case "/say":
      return { type: "say", message: rest };
    case "/y":
    case "/yell":
      return { type: "yell", message: rest };
    case "/g":
    case "/guild":
      return { type: "guild", message: rest };
    case "/p":
    case "/party":
      return { type: "party", message: rest };
    case "/raid":
      return { type: "raid", message: rest };
    case "/w":
    case "/whisper": {
      const targetEnd = rest.indexOf(" ");
      if (targetEnd === -1)
        return { type: "whisper", target: rest, message: "" };
      return {
        type: "whisper",
        target: rest.slice(0, targetEnd),
        message: rest.slice(targetEnd + 1),
      };
    }
    case "/r":
      return { type: "reply", message: rest };
    case "/who":
      return rest ? { type: "who", target: rest } : { type: "who" };
    case "/invite":
      return rest
        ? { type: "invite", target: rest }
        : { type: "say", message: input };
    case "/kick":
      return rest
        ? { type: "kick", target: rest }
        : { type: "say", message: input };
    case "/leave":
      return { type: "leave" };
    case "/leader":
      return rest
        ? { type: "leader", target: rest }
        : { type: "say", message: input };
    case "/accept":
      return { type: "accept" };
    case "/decline":
      return { type: "decline" };
    case "/quit":
      return { type: "quit" };
    case "/tuicraft": {
      const parts = rest.split(" ");
      return {
        type: "tuicraft",
        subcommand: parts[0] ?? "",
        value: parts[1] ?? "",
      };
    }
    case "/friends":
      return { type: "friends" };
    case "/f":
      return { type: "friends" };
    case "/friend": {
      const parts = rest.split(" ");
      const sub = parts[0] ?? "";
      const target = parts.slice(1).join(" ");
      if (sub === "add" && target) return { type: "add-friend", target };
      if (sub === "remove" && target) return { type: "remove-friend", target };
      return { type: "friends" };
    }
    case "/ignore":
      return { type: "unimplemented", feature: "Ignore list" };
    case "/join":
      return { type: "unimplemented", feature: "Channel join/leave" };
    case "/ginvite":
    case "/gkick":
    case "/gleave":
    case "/gpromote":
      return { type: "unimplemented", feature: "Guild management" };
    case "/mail":
      return { type: "unimplemented", feature: "Mail" };
    case "/roll":
      return { type: "unimplemented", feature: "Random roll" };
    case "/dnd":
      return { type: "dnd", message: rest };
    case "/afk":
      return { type: "afk", message: rest };
    case "/e":
    case "/emote":
      return { type: "emote", message: rest };
    default: {
      const channelMatch = cmd.match(/^\/(\d+)$/);
      if (channelMatch) {
        return { type: "channel", target: channelMatch[1]!, message: rest };
      }
      return { type: "say", message: input };
    }
  }
}

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
  if (msg.type === ChatType.SYSTEM) {
    return `[system] ${message}`;
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
};

export function formatMessageObj(msg: ChatMessage): LogEntry {
  const type = JSON_TYPE_LABELS[msg.type] ?? `TYPE_${msg.type}`;
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

export type TuiState = {
  handle: WorldHandle;
  write: (s: string) => void;
  lastWhisperFrom: string | undefined;
  showEntityEvents: boolean;
};

export async function executeCommand(
  state: TuiState,
  cmd: Command,
): Promise<boolean> {
  switch (cmd.type) {
    case "chat":
      state.handle.sendInCurrentMode(cmd.message);
      break;
    case "say":
      state.handle.sendSay(cmd.message);
      break;
    case "yell":
      state.handle.sendYell(cmd.message);
      break;
    case "guild":
      state.handle.sendGuild(cmd.message);
      break;
    case "party":
      state.handle.sendParty(cmd.message);
      break;
    case "raid":
      state.handle.sendRaid(cmd.message);
      break;
    case "emote":
      state.handle.sendEmote(cmd.message);
      break;
    case "dnd":
      state.handle.sendDnd(cmd.message);
      break;
    case "afk":
      state.handle.sendAfk(cmd.message);
      break;
    case "whisper":
      state.handle.sendWhisper(cmd.target, cmd.message);
      state.lastWhisperFrom = cmd.target;
      break;
    case "reply":
      if (!state.lastWhisperFrom) {
        state.write(formatError("No one has whispered you yet.") + "\n");
      } else {
        state.handle.sendWhisper(state.lastWhisperFrom, cmd.message);
      }
      break;
    case "channel": {
      const channel = /^\d+$/.test(cmd.target)
        ? state.handle.getChannel(parseInt(cmd.target, 10))
        : cmd.target;
      if (!channel) {
        state.write(formatError(`Not in channel ${cmd.target}.`) + "\n");
      } else {
        state.handle.sendChannel(channel, cmd.message);
      }
      break;
    }
    case "who": {
      const results = await state.handle.who(
        cmd.target ? { name: cmd.target } : {},
      );
      state.write(formatWhoResults(results) + "\n");
      break;
    }
    case "invite":
      state.handle.invite(cmd.target);
      break;
    case "kick":
      state.handle.uninvite(cmd.target);
      break;
    case "leave":
      state.handle.leaveGroup();
      break;
    case "leader":
      state.handle.setLeader(cmd.target);
      break;
    case "accept":
      state.handle.acceptInvite();
      break;
    case "decline":
      state.handle.declineInvite();
      break;
    case "quit":
      return true;
    case "tuicraft":
      if (cmd.subcommand === "entities") {
        if (cmd.value === "on") {
          state.showEntityEvents = true;
          state.write("[system] Entity events enabled\n");
        } else if (cmd.value === "off") {
          state.showEntityEvents = false;
          state.write("[system] Entity events disabled\n");
        } else {
          state.write("[system] Usage: /tuicraft entities on|off\n");
        }
      } else {
        state.write(`[system] Unknown tuicraft command: ${cmd.subcommand}\n`);
      }
      break;
    case "friends": {
      const friends = state.handle.getFriends();
      state.write(formatFriendList(friends) + "\n");
      break;
    }
    case "add-friend":
      state.handle.addFriend(cmd.target);
      break;
    case "remove-friend":
      state.handle.removeFriend(cmd.target);
      break;
    case "unimplemented":
      state.write(formatError(`${cmd.feature} is not yet implemented`) + "\n");
      break;
  }
  return false;
}

export type TuiOptions = {
  input?: NodeJS.ReadableStream;
  write?: (s: string) => void;
};

export function startTui(
  handle: WorldHandle,
  interactive: boolean,
  opts: TuiOptions = {},
): Promise<void> {
  const write = opts.write ?? ((s: string) => void process.stdout.write(s));
  const state: TuiState = {
    handle,
    write,
    lastWhisperFrom: undefined,
    showEntityEvents: false,
  };

  return new Promise<void>((resolve) => {
    handle.onMessage((msg) => {
      if (msg.type === ChatType.WHISPER) state.lastWhisperFrom = msg.sender;
      const line = formatMessage(msg);
      write(interactive ? `\r\x1b[K${line}\n` : line + "\n");
      if (interactive) rl.prompt(true);
    });

    handle.onGroupEvent((event) => {
      const line = formatGroupEvent(event);
      if (!line) return;
      write(interactive ? `\r\x1b[K${line}\n` : line + "\n");
      if (interactive) rl.prompt(true);
    });

    handle.onEntityEvent((event) => {
      if (!state.showEntityEvents) return;
      const line = formatEntityEvent(event);
      if (!line) return;
      write(interactive ? `\r\x1b[K${line}\n` : line + "\n");
      if (interactive) rl.prompt(true);
    });

    const rl = createInterface({
      input: opts.input ?? process.stdin,
      output: interactive ? process.stdout : undefined,
      prompt: interactive ? formatPrompt(handle.getLastChatMode()) : "",
      terminal: interactive,
    });

    if (interactive) rl.prompt();

    rl.on("line", async (input) => {
      try {
        if (await executeCommand(state, parseCommand(input.trim()))) {
          handle.close();
          rl.close();
          resolve();
          return;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        write(formatError(msg) + "\n");
      }
      if (interactive) {
        rl.setPrompt(formatPrompt(handle.getLastChatMode()));
        rl.prompt();
      }
    });

    rl.on("SIGINT", () => {
      handle.close();
      rl.close();
    });

    rl.on("close", () => {
      handle.close();
      resolve();
    });

    handle.closed.then(() => rl.close());
  });
}
