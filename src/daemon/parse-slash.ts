import type { IpcCommand, TargetIpcType } from "daemon/parse";
import type { Command } from "ui/commands";

type SlashTargetType =
  | "add-friend"
  | "remove-friend"
  | "add-ignore"
  | "remove-ignore"
  | "guild-invite"
  | "guild-kick"
  | "guild-promote"
  | "guild-demote"
  | "guild-leader";

type SlashBareType =
  | "friends"
  | "ignored"
  | "guild-roster"
  | "guild-leave"
  | "guild-accept"
  | "guild-decline";

const SLASH_TARGET_TYPES: Record<SlashTargetType, TargetIpcType> = {
  "add-friend": "add_friend",
  "add-ignore": "add_ignore",
  "guild-demote": "guild_demote",
  "guild-invite": "guild_invite",
  "guild-kick": "guild_kick",
  "guild-leader": "guild_leader",
  "guild-promote": "guild_promote",
  "remove-friend": "del_friend",
  "remove-ignore": "del_ignore",
};

const SLASH_BARE_TYPES: Record<
  SlashBareType,
  | "friends"
  | "ignored"
  | "guild_roster"
  | "guild_leave"
  | "guild_accept"
  | "guild_decline"
> = {
  friends: "friends",
  "guild-accept": "guild_accept",
  "guild-decline": "guild_decline",
  "guild-leave": "guild_leave",
  "guild-roster": "guild_roster",
  ignored: "ignored",
};

export function fromSlashCommand(parsed: Command, line: string): IpcCommand {
  switch (parsed.type) {
    case "say":
    case "yell":
    case "guild":
    case "party":
    case "emote":
    case "dnd":
    case "afk":
    case "whisper":
    case "invite":
    case "kick":
    case "leave":
    case "leader":
    case "accept":
    case "decline":
    case "roll":
    case "unimplemented":
      return parsed;
    case "who":
      return parsed.target
        ? { filter: parsed.target, type: "who" }
        : { type: "who" };
    case "join-channel":
      return {
        channel: parsed.channel,
        password: parsed.password,
        type: "join_channel",
      };
    case "leave-channel":
      return { channel: parsed.channel, type: "leave_channel" };
    case "guild-motd":
      return { message: parsed.message, type: "guild_motd" };
    case "add-friend":
    case "remove-friend":
    case "add-ignore":
    case "remove-ignore":
    case "guild-invite":
    case "guild-kick":
    case "guild-promote":
    case "guild-demote":
    case "guild-leader":
      return { target: parsed.target, type: SLASH_TARGET_TYPES[parsed.type] };
    case "friends":
    case "ignored":
    case "guild-roster":
    case "guild-leave":
    case "guild-accept":
    case "guild-decline":
      return { type: SLASH_BARE_TYPES[parsed.type] };
    default:
      return { message: line, type: "say" };
  }
}
