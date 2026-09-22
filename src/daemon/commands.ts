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
import { formatGuildCommandError } from "wow/protocol/guild";
import { SessionLog, type LogEntry } from "lib/session-log";
import type {
  WorldHandle,
  ChatMessage,
  GroupEvent,
  DuelEvent,
} from "wow/client";
import type {
  ControlEvent,
  ControlPose,
  ControlState,
  MovementDirection,
} from "wow/control";
import type { CombatEvent } from "wow/combat";
import type { TacticsEvent } from "wow/tactics";
import { DEFAULT_FIGHT_INSTRUCTION } from "wow/standing-instructions";
import { parseFramingVariant, type FramingVariant } from "wow/framing";
import type { FollowEvent } from "wow/follow";
import type { CycleEvent } from "wow/encounter-cycle";
import type { RecoveryEvent } from "wow/recovery";
import type { QuestEvent } from "wow/quests";
import type { RewardsEvent } from "wow/rewards";
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
  | { type: "nearby"; all?: boolean }
  | { type: "nearby_json"; all?: boolean }
  | { type: "control" }
  | { type: "control_json" }
  | { type: "move"; direction: MovementDirection; durationMs: number }
  | { type: "face"; orientation: number }
  | { type: "target"; guid: bigint }
  | { type: "halt" }
  | { type: "combat" }
  | { type: "combat_json" }
  | { type: "spells" }
  | { type: "spells_json" }
  | { type: "cast"; spellId: number; guid: bigint }
  | { type: "attack"; guid: bigint }
  | { type: "cancel_cast" }
  | { type: "stop_attack" }
  | {
      type: "fight";
      guid: bigint;
      instruction: string;
      framing?: FramingVariant;
    }
  | { type: "tactics" }
  | { type: "tactics_json" }
  | {
      type: "cycle";
      guids: bigint[];
      instruction: string;
      maxStarts: number;
    }
  | { type: "cycling" }
  | { type: "cycling_json" }
  | { type: "goto"; x: number; y: number; z: number }
  | { type: "navigation" }
  | { type: "navigation_json" }
  | { type: "follow"; guid: bigint; distance?: number }
  | { type: "following" }
  | { type: "following_json" }
  | { type: "recovery" }
  | { type: "recovery_json" }
  | { type: "query_corpse" }
  | { type: "release_spirit" }
  | { type: "reclaim_corpse" }
  | { type: "resurrect"; accept: boolean }
  | { type: "quests" }
  | { type: "quests_json" }
  | { type: "talk"; guid: bigint }
  | { type: "query_quest"; questId: number }
  | { type: "select_option"; optionId: number; code?: string }
  | { type: "select_quest"; questId: number }
  | { type: "accept_quest" }
  | { type: "complete_quest"; questId: number }
  | { type: "request_reward" }
  | { type: "choose_reward"; index: number }
  | { type: "abandon_quest"; slot: number }
  | { type: "cancel_interaction" }
  | { type: "inventory" }
  | { type: "inventory_json" }
  | { type: "loot" }
  | { type: "loot_json" }
  | { type: "open_loot"; guid: bigint }
  | { type: "take_loot"; slot: number }
  | { type: "take_money" }
  | { type: "release_loot" }
  | { type: "invalid"; reason: string }
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
  | { type: "guild_invite"; target: string }
  | { type: "guild_kick"; target: string }
  | { type: "guild_leave" }
  | { type: "guild_promote"; target: string }
  | { type: "guild_demote"; target: string }
  | { type: "guild_leader"; target: string }
  | { type: "guild_motd"; message: string }
  | { type: "guild_accept" }
  | { type: "guild_decline" }
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
      case "guild-invite":
        return { type: "guild_invite", target: parsed.target };
      case "guild-kick":
        return { type: "guild_kick", target: parsed.target };
      case "guild-leave":
        return { type: "guild_leave" };
      case "guild-promote":
        return { type: "guild_promote", target: parsed.target };
      case "guild-demote":
        return { type: "guild_demote", target: parsed.target };
      case "guild-leader":
        return { type: "guild_leader", target: parsed.target };
      case "guild-motd":
        return { type: "guild_motd", message: parsed.message };
      case "guild-accept":
        return { type: "guild_accept" };
      case "guild-decline":
        return { type: "guild_decline" };
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
      return rest.trim().toLowerCase() === "all"
        ? { type: "nearby", all: true }
        : { type: "nearby" };
    case "NEARBY_JSON":
      return rest.trim().toLowerCase() === "all"
        ? { type: "nearby_json", all: true }
        : { type: "nearby_json" };
    case "CONTROL":
      return { type: "control" };
    case "CONTROL_JSON":
      return { type: "control_json" };
    case "MOVE":
      return parseMoveCommand(rest);
    case "FACE":
      return parseFaceCommand(rest);
    case "TARGET":
      return parseTargetCommand(rest);
    case "HALT":
      return { type: "halt" };
    case "COMBAT":
      return { type: "combat" };
    case "COMBAT_JSON":
      return { type: "combat_json" };
    case "SPELLS":
      return { type: "spells" };
    case "SPELLS_JSON":
      return { type: "spells_json" };
    case "CAST":
      return parseCastCommand(rest);
    case "ATTACK":
      return parseAttackCommand(rest);
    case "CANCEL_CAST":
      return { type: "cancel_cast" };
    case "STOP_ATTACK":
      return { type: "stop_attack" };
    case "FIGHT":
      return parseFightCommand(rest);
    case "TACTICS":
      return { type: "tactics" };
    case "TACTICS_JSON":
      return { type: "tactics_json" };
    case "CYCLE":
      return parseCycleCommand(rest);
    case "CYCLING":
      return { type: "cycling" };
    case "CYCLING_JSON":
      return { type: "cycling_json" };
    case "GOTO":
      return parseGotoCommand(rest);
    case "NAVIGATION":
      return { type: "navigation" };
    case "NAVIGATION_JSON":
      return { type: "navigation_json" };
    case "FOLLOW":
      return parseFollowCommand(rest);
    case "FOLLOWING":
      return { type: "following" };
    case "FOLLOWING_JSON":
      return { type: "following_json" };
    case "RECOVERY":
      return { type: "recovery" };
    case "RECOVERY_JSON":
      return { type: "recovery_json" };
    case "QUERY_CORPSE":
      return rest.trim()
        ? { type: "invalid", reason: "invalid query-corpse" }
        : { type: "query_corpse" };
    case "RELEASE_SPIRIT":
      return rest.trim()
        ? { type: "invalid", reason: "invalid release-spirit" }
        : { type: "release_spirit" };
    case "RECLAIM_CORPSE":
      return rest.trim()
        ? { type: "invalid", reason: "invalid reclaim-corpse" }
        : { type: "reclaim_corpse" };
    case "RESURRECT": {
      const decision = rest.trim();
      if (decision !== "accept" && decision !== "decline")
        return { type: "invalid", reason: "invalid resurrect" };
      return { type: "resurrect", accept: decision === "accept" };
    }
    case "QUESTS":
      return { type: "quests" };
    case "QUESTS_JSON":
      return { type: "quests_json" };
    case "TALK": {
      const guid = parseGuid(rest.trim());
      if (guid === undefined || guid === 0n)
        return { type: "invalid", reason: "invalid guid" };
      return { type: "talk", guid };
    }
    case "QUERY_QUEST":
      return parseQuestIdCommand(rest, "query_quest");
    case "SELECT_QUEST":
      return parseQuestIdCommand(rest, "select_quest");
    case "COMPLETE_QUEST":
      return parseQuestIdCommand(rest, "complete_quest");
    case "SELECT_OPTION":
      return parseSelectOptionCommand(rest);
    case "ACCEPT_QUEST":
      return rest.trim()
        ? { type: "invalid", reason: "invalid accept-quest" }
        : { type: "accept_quest" };
    case "REQUEST_REWARD":
      return rest.trim()
        ? { type: "invalid", reason: "invalid request-reward" }
        : { type: "request_reward" };
    case "CANCEL_INTERACTION":
      return rest.trim()
        ? { type: "invalid", reason: "invalid cancel-interaction" }
        : { type: "cancel_interaction" };
    case "CHOOSE_REWARD": {
      const index = parseBoundedInteger(rest, 0, 5);
      return index === undefined
        ? { type: "invalid", reason: "invalid reward index" }
        : { type: "choose_reward", index };
    }
    case "ABANDON_QUEST": {
      const slot = parseBoundedInteger(rest, 0, 24);
      return slot === undefined
        ? { type: "invalid", reason: "invalid quest slot" }
        : { type: "abandon_quest", slot };
    }
    case "INVENTORY":
      return { type: "inventory" };
    case "INVENTORY_JSON":
      return { type: "inventory_json" };
    case "LOOT":
      return { type: "loot" };
    case "LOOT_JSON":
      return { type: "loot_json" };
    case "OPEN_LOOT": {
      const guid = parseGuid(rest.trim());
      if (guid === undefined || guid === 0n)
        return { type: "invalid", reason: "invalid guid" };
      return { type: "open_loot", guid };
    }
    case "TAKE_LOOT": {
      const slot = parseBoundedInteger(rest, 0, 255);
      return slot === undefined
        ? { type: "invalid", reason: "invalid loot slot" }
        : { type: "take_loot", slot };
    }
    case "TAKE_MONEY":
      return rest.trim()
        ? { type: "invalid", reason: "invalid take-money" }
        : { type: "take_money" };
    case "RELEASE_LOOT":
      return rest.trim()
        ? { type: "invalid", reason: "invalid release-loot" }
        : { type: "release_loot" };
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
      return rest ? { type: "guild_invite", target: rest } : undefined;
    case "GKICK":
      return rest ? { type: "guild_kick", target: rest } : undefined;
    case "GLEAVE":
      return { type: "guild_leave" };
    case "GPROMOTE":
      return rest ? { type: "guild_promote", target: rest } : undefined;
    case "GDEMOTE":
      return rest ? { type: "guild_demote", target: rest } : undefined;
    case "GLEADER":
      return rest ? { type: "guild_leader", target: rest } : undefined;
    case "GMOTD":
      return { type: "guild_motd", message: rest };
    case "GACCEPT":
      return { type: "guild_accept" };
    case "GDECLINE":
      return { type: "guild_decline" };
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

function waitUnlessAborted(ms: number, abort?: AbortSignal): Promise<boolean> {
  if (abort?.aborted) return Promise.resolve(true);
  const { promise, resolve } = Promise.withResolvers<boolean>();
  const timer = setTimeout(() => resolve(false), ms);
  abort?.addEventListener(
    "abort",
    () => {
      clearTimeout(timer);
      resolve(true);
    },
    { once: true },
  );
  return promise;
}

export async function dispatchCommand(
  cmd: IpcCommand,
  handle: WorldHandle,
  events: RingBuffer<EventEntry>,
  socket: IpcSocket,
  cleanup: () => void,
  abort?: AbortSignal,
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
      const aborted = await waitUnlessAborted(cmd.ms, abort);
      if (aborted) return false;
      writeLines(socket, sliceText(events, start));
      return false;
    }
    case "read_wait_json": {
      const start = events.writePos;
      const aborted = await waitUnlessAborted(cmd.ms, abort);
      if (aborted) return false;
      writeLines(socket, sliceJson(events, start));
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
      const items = prepareNearbyEntities(handle, cmd.all);
      writeLines(
        socket,
        items.map((p) => formatNearbyLine(p.entity)),
      );
      return false;
    }
    case "nearby_json": {
      const selfGuid = handle.getControlState().selfGuid;
      const items = prepareNearbyEntities(handle, cmd.all);
      writeLines(
        socket,
        items.map((p) =>
          JSON.stringify(formatNearbyObj(p.entity, selfGuid, p.distance)),
        ),
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
    case "guild_invite":
      handle.guildInvite(cmd.target);
      writeLines(socket, ["OK"]);
      return false;
    case "guild_kick":
      handle.guildRemove(cmd.target);
      writeLines(socket, ["OK"]);
      return false;
    case "guild_leave":
      handle.guildLeave();
      writeLines(socket, ["OK"]);
      return false;
    case "guild_promote":
      handle.guildPromote(cmd.target);
      writeLines(socket, ["OK"]);
      return false;
    case "guild_demote":
      handle.guildDemote(cmd.target);
      writeLines(socket, ["OK"]);
      return false;
    case "guild_leader":
      handle.guildLeader(cmd.target);
      writeLines(socket, ["OK"]);
      return false;
    case "guild_motd":
      handle.guildMotd(cmd.message);
      writeLines(socket, ["OK"]);
      return false;
    case "guild_accept":
      handle.acceptGuildInvite();
      writeLines(socket, ["OK"]);
      return false;
    case "guild_decline":
      handle.declineGuildInvite();
      writeLines(socket, ["OK"]);
      return false;
    case "control":
      return writeControlState(handle, socket, false);
    case "control_json":
      return writeControlState(handle, socket, true);
    case "move":
      return runControlAction(socket, () => {
        handle.move(cmd.direction, cmd.durationMs);
      });
    case "face":
      return runControlAction(socket, () => {
        handle.face(cmd.orientation);
      });
    case "target":
      return runControlAction(socket, () => {
        handle.selectTarget(cmd.guid);
      });
    case "halt":
      return runControlAction(socket, () => {
        handle.halt();
      });
    case "combat":
      return writeInspect(socket, () => handle.getCombatState(), false);
    case "combat_json":
      return writeInspect(socket, () => handle.getCombatState(), true);
    case "spells":
      return await writeInspectAsync(
        socket,
        () => handle.getSpellbook(),
        false,
      );
    case "spells_json":
      return await writeInspectAsync(socket, () => handle.getSpellbook(), true);
    case "cast":
      return runControlAction(socket, () => {
        handle.cast(cmd.spellId, cmd.guid);
      });
    case "attack":
      return runControlAction(socket, () => {
        handle.attack(cmd.guid);
      });
    case "cancel_cast":
      return runControlAction(socket, () => {
        handle.cancelCast();
      });
    case "stop_attack":
      return runControlAction(socket, () => {
        handle.stopAttack();
      });
    case "fight":
      return runControlActionAsync(socket, () =>
        handle.startTactics(cmd.guid, cmd.instruction, abort, cmd.framing),
      );
    case "tactics":
      return writeInspect(socket, () => handle.getTacticsState(), false);
    case "tactics_json":
      return writeInspect(socket, () => handle.getTacticsState(), true);
    case "cycle":
      return runControlActionAsync(socket, () =>
        handle.startCycle(cmd.guids, cmd.instruction, cmd.maxStarts),
      );
    case "cycling":
      return writeInspect(socket, () => handle.getCycleState(), false);
    case "cycling_json":
      return writeInspect(socket, () => handle.getCycleState(), true);
    case "goto":
      return runControlAction(socket, () => {
        handle.goTo(cmd.x, cmd.y, cmd.z);
      });
    case "navigation":
      return writeInspect(socket, () => handle.getNavigationState(), false);
    case "navigation_json":
      return writeInspect(socket, () => handle.getNavigationState(), true);
    case "follow":
      return runControlAction(socket, () => {
        handle.follow(cmd.guid, cmd.distance);
      });
    case "following":
      return writeInspect(socket, () => handle.getFollowState(), false);
    case "following_json":
      return writeInspect(socket, () => handle.getFollowState(), true);
    case "recovery":
      return writeInspect(socket, () => handle.getRecoveryState(), false);
    case "recovery_json":
      return writeInspect(socket, () => handle.getRecoveryState(), true);
    case "query_corpse":
      return runControlAction(socket, () => {
        handle.queryCorpse();
      });
    case "release_spirit":
      return runControlAction(socket, () => {
        handle.releaseSpirit();
      });
    case "reclaim_corpse":
      return runControlAction(socket, () => {
        handle.reclaimCorpse();
      });
    case "resurrect":
      return runControlAction(socket, () => {
        handle.respondResurrection(cmd.accept);
      });
    case "quests":
      return writeInspect(socket, () => handle.getQuestState(), false);
    case "quests_json":
      return writeInspect(socket, () => handle.getQuestState(), true);
    case "talk":
      return runControlAction(socket, () => {
        handle.talk(cmd.guid);
      });
    case "query_quest":
      return runControlAction(socket, () => {
        handle.queryQuest(cmd.questId);
      });
    case "select_option":
      return runControlAction(socket, () => {
        handle.selectGossipOption(cmd.optionId, cmd.code);
      });
    case "select_quest":
      return runControlAction(socket, () => {
        handle.selectQuest(cmd.questId);
      });
    case "accept_quest":
      return runControlAction(socket, () => {
        handle.acceptQuest();
      });
    case "complete_quest":
      return runControlAction(socket, () => {
        handle.completeQuest(cmd.questId);
      });
    case "request_reward":
      return runControlAction(socket, () => {
        handle.requestQuestReward();
      });
    case "choose_reward":
      return runControlAction(socket, () => {
        handle.chooseQuestReward(cmd.index);
      });
    case "abandon_quest":
      return runControlAction(socket, () => {
        handle.abandonQuest(cmd.slot);
      });
    case "cancel_interaction":
      return runControlAction(socket, () => {
        handle.cancelInteraction();
      });
    case "inventory":
      return writeInspect(socket, () => handle.getInventoryState(), false);
    case "inventory_json":
      return writeInspect(socket, () => handle.getInventoryState(), true);
    case "loot":
      return writeInspect(socket, () => handle.getRewardsState(), false);
    case "loot_json":
      return writeInspect(socket, () => handle.getRewardsState(), true);
    case "open_loot":
      return runControlAction(socket, () => {
        handle.openLoot(cmd.guid);
      });
    case "take_loot":
      return runControlAction(socket, () => {
        handle.takeLoot(cmd.slot);
      });
    case "take_money":
      return runControlAction(socket, () => {
        handle.takeLootMoney();
      });
    case "release_loot":
      return runControlAction(socket, () => {
        handle.releaseLoot();
      });
    case "invalid":
      writeLines(socket, [`ERR ${cmd.reason}`]);
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

const NEARBY_DEFAULT_RANGE = 100;

type PreparedNearbyEntity = {
  entity: Entity;
  distance: number | null;
  self: boolean;
};

function prepareNearbyEntities(
  handle: WorldHandle,
  all = false,
): PreparedNearbyEntity[] {
  const controlState = handle.getControlState();
  const selfGuid = controlState.selfGuid;
  const entities = handle.getNearbyEntities();
  const selfEntity = entities.find((e) => e.guid === selfGuid);
  const selfPos = selfEntity?.position ?? controlState.pose;

  const prepared: PreparedNearbyEntity[] = entities.map((entity) => {
    const isSelf = entity.guid === selfGuid;
    let distance: number | null = null;
    if (isSelf) {
      distance = 0;
    } else if (
      selfPos &&
      entity.position &&
      selfPos.mapId === entity.position.mapId
    ) {
      const dx = entity.position.x - selfPos.x;
      const dy = entity.position.y - selfPos.y;
      const dz = entity.position.z - selfPos.z;
      distance = Math.round(Math.hypot(dx, dy, dz) * 100) / 100;
    }
    return { entity, distance, self: isSelf };
  });

  prepared.sort((a, b) => {
    if (a.self && !b.self) return -1;
    if (!a.self && b.self) return 1;
    if (a.distance !== null && b.distance !== null) {
      if (a.distance !== b.distance) return a.distance - b.distance;
      return a.entity.guid < b.entity.guid
        ? -1
        : a.entity.guid > b.entity.guid
          ? 1
          : 0;
    }
    if (a.distance !== null && b.distance === null) return -1;
    if (a.distance === null && b.distance !== null) return 1;
    return a.entity.guid < b.entity.guid
      ? -1
      : a.entity.guid > b.entity.guid
        ? 1
        : 0;
  });

  if (!all && selfPos) {
    return prepared.filter((p) => {
      if (p.self) return true;
      if (p.distance !== null) return p.distance <= NEARBY_DEFAULT_RANGE;
      if (p.entity.position && p.entity.position.mapId !== selfPos.mapId)
        return false;
      return true;
    });
  }

  return prepared;
}

function formatNearbyObj(
  entity: Entity,
  selfGuid: bigint,
  distance: number | null,
): Record<string, unknown> {
  const obj: Record<string, unknown> = {
    guid: `0x${entity.guid.toString(16)}`,
    type: objectTypeString(entity.objectType),
    name: entity.name,
    entry: entity.entry,
    self: entity.guid === selfGuid,
    distance,
  };
  if (
    entity.objectType === ObjectType.UNIT ||
    entity.objectType === ObjectType.PLAYER
  ) {
    const unit = entity as UnitEntity;
    obj["level"] = unit.level;
    obj["health"] = unit.health;
    obj["maxHealth"] = unit.maxHealth;
    obj["target"] = `0x${unit.target.toString(16)}`;
    obj["unitFlags"] = unit.unitFlags;
    obj["npcFlags"] = unit.npcFlags;
    obj["factionTemplate"] = unit.factionTemplate;
  }
  if (entity.objectType === ObjectType.GAMEOBJECT) {
    obj["gameObjectType"] = (entity as GameObjectEntity).gameObjectType;
  }
  if (entity.position) {
    obj["x"] = entity.position.x;
    obj["y"] = entity.position.y;
    obj["z"] = entity.position.z;
    obj["mapId"] = entity.position.mapId;
    obj["orientation"] = entity.position.orientation;
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
    case "command_result":
      return formatGuildCommandError(event.command, event.name, event.result)!;
    case "guild_invite":
      return `[guild] ${event.inviter} has invited you to join ${event.guildName}. Use /gaccept or /gdecline`;
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
    case "command_result":
      return {
        type: "GUILD_COMMAND_RESULT",
        command: event.command,
        name: event.name,
        result: event.result,
      };
    case "guild_invite":
      return {
        type: "GUILD_INVITE_RECEIVED",
        inviter: event.inviter,
        guildName: event.guildName,
      };
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

export function onControlEvent(
  event: ControlEvent,
  events: RingBuffer<EventEntry>,
  log: SessionLog,
): void {
  const obj = formatControlEventObj(event);
  events.push({
    text: formatControlEvent(event),
    json: JSON.stringify(obj),
  });
  log.append(obj as LogEntry).catch(() => {});
}

export function onCombatEvent(
  event: CombatEvent,
  events: RingBuffer<EventEntry>,
  log: SessionLog,
): void {
  const obj: Record<string, unknown> = {
    type: "COMBAT",
    data: jsonSafe(event),
  };
  events.push({
    text: formatDomainEvent("combat", event),
    json: JSON.stringify(obj),
  });
  log.append(obj as LogEntry).catch(() => {});
}

export function onTacticsEvent(
  event: TacticsEvent,
  events: RingBuffer<EventEntry>,
  log: SessionLog,
): void {
  const obj: Record<string, unknown> = {
    type: "TACTICS",
    data: jsonSafe(event),
  };
  events.push({
    text: formatDomainEvent("tactics", event),
    json: JSON.stringify(obj),
  });
  log.append(obj as LogEntry).catch(() => {});
}

export function onFollowEvent(
  event: FollowEvent,
  events: RingBuffer<EventEntry>,
  log: SessionLog,
): void {
  const obj: Record<string, unknown> = {
    type: "FOLLOW",
    data: jsonSafe(event),
  };
  events.push({
    text: formatDomainEvent("follow", event),
    json: JSON.stringify(obj),
  });
  log.append(obj as LogEntry).catch(() => {});
}

export function onCycleEvent(
  event: CycleEvent,
  events: RingBuffer<EventEntry>,
  log: SessionLog,
): void {
  const obj: Record<string, unknown> = {
    type: "CYCLE",
    data: jsonSafe(event),
  };
  events.push({
    text: formatDomainEvent("cycle", event),
    json: JSON.stringify(obj),
  });
  log.append(obj as LogEntry).catch(() => {});
}

export function onRecoveryEvent(
  event: RecoveryEvent,
  events: RingBuffer<EventEntry>,
  log: SessionLog,
): void {
  const obj: Record<string, unknown> = {
    type: "RECOVERY",
    data: jsonSafe(event),
  };
  events.push({
    text: formatDomainEvent("recovery", event),
    json: JSON.stringify(obj),
  });
  log.append(obj as LogEntry).catch(() => {});
}

export function onQuestEvent(
  event: QuestEvent,
  events: RingBuffer<EventEntry>,
  log: SessionLog,
): void {
  const obj: Record<string, unknown> = { type: "QUEST", data: jsonSafe(event) };
  events.push({
    text: formatDomainEvent("quest", event),
    json: JSON.stringify(obj),
  });
  log.append(obj as LogEntry).catch(() => {});
}

export function onRewardsEvent(
  event: RewardsEvent,
  events: RingBuffer<EventEntry>,
  log: SessionLog,
): void {
  const obj: Record<string, unknown> = {
    type: "REWARDS",
    data: jsonSafe(event),
  };
  events.push({
    text: formatDomainEvent("rewards", event),
    json: JSON.stringify(obj),
  });
  log.append(obj as LogEntry).catch(() => {});
}

const MAX_SPELL_ID = 0xffff_ffff;

function jsonSafe(value: unknown): unknown {
  if (typeof value === "bigint") return `0x${value.toString(16)}`;
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      out[key] = jsonSafe(entry);
    }
    return out;
  }
  return value;
}

function formatDomainEvent(kind: string, event: { type: string }): string {
  return `[${kind}] ${event.type}`;
}

function parseSpellId(raw: string): number | undefined {
  if (!/^[0-9]+$/.test(raw)) return undefined;
  const id = Number(raw);
  if (!Number.isInteger(id) || id < 1 || id > MAX_SPELL_ID) return undefined;
  return id;
}

function parseFiniteNumber(raw: string): number | undefined {
  const value = Number(raw);
  if (raw.trim() === "" || !Number.isFinite(value)) return undefined;
  return value;
}

function parseCastCommand(rest: string): IpcCommand {
  const parts = rest.split(" ").filter(Boolean);
  if (parts.length !== 2) return { type: "invalid", reason: "invalid cast" };
  const spellId = parseSpellId(parts[0]!);
  const guid = parseGuid(parts[1]!);
  if (spellId === undefined)
    return { type: "invalid", reason: "invalid spell" };
  if (guid === undefined) return { type: "invalid", reason: "invalid guid" };
  return { type: "cast", spellId, guid };
}

function parseAttackCommand(rest: string): IpcCommand {
  const token = rest.trim();
  if (!token || token.split(/\s+/).length !== 1) {
    return { type: "invalid", reason: "invalid guid" };
  }
  const guid = parseGuid(token);
  if (guid === undefined) return { type: "invalid", reason: "invalid guid" };
  return { type: "attack", guid };
}

function parseFightCommand(rest: string): IpcCommand {
  const parts = rest.split(" ").filter(Boolean);
  if (parts.length < 1) return { type: "invalid", reason: "invalid fight" };
  let framing: FramingVariant | undefined;
  const filtered: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    if (part === "--framing") {
      const next = parts[i + 1];
      if (!next) return { type: "invalid", reason: "missing framing variant" };
      try {
        framing = parseFramingVariant(next);
      } catch (e) {
        return {
          type: "invalid",
          reason: e instanceof Error ? e.message : "invalid framing",
        };
      }
      i++;
    } else if (part.startsWith("--framing=")) {
      const val = part.slice("--framing=".length);
      try {
        framing = parseFramingVariant(val);
      } catch (e) {
        return {
          type: "invalid",
          reason: e instanceof Error ? e.message : "invalid framing",
        };
      }
    } else {
      filtered.push(part);
    }
  }
  if (filtered.length < 1) return { type: "invalid", reason: "invalid fight" };
  const guid = parseGuid(filtered[0]!);
  if (guid === undefined) return { type: "invalid", reason: "invalid guid" };
  const instruction = filtered.slice(1).join(" ") || DEFAULT_FIGHT_INSTRUCTION;
  return { type: "fight", guid, instruction, framing };
}

const CYCLE_COMMAND_FLAGS = ["--max", "--instruction"];

function isCycleCommandFlag(token: string): boolean {
  return CYCLE_COMMAND_FLAGS.some(
    (flag) => token === flag || token.startsWith(`${flag}=`),
  );
}

function parseCycleMax(raw: string): number | undefined {
  if (!/^[0-9]+$/.test(raw)) return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) return undefined;
  return value;
}

function parseCycleCommand(rest: string): IpcCommand {
  const parts = rest.split(" ").filter(Boolean);
  if (parts.length < 1) return { type: "invalid", reason: "invalid cycle" };
  let maxStarts: number | undefined;
  let instructionWords: string[] | undefined;
  const guidTokens: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    if (part === "--max") {
      const next = parts[i + 1];
      if (!next) return { type: "invalid", reason: "invalid cycle max" };
      const value = parseCycleMax(next);
      if (value === undefined) {
        return { type: "invalid", reason: "invalid cycle max" };
      }
      maxStarts = value;
      i++;
    } else if (part.startsWith("--max=")) {
      const value = parseCycleMax(part.slice("--max=".length));
      if (value === undefined) {
        return { type: "invalid", reason: "invalid cycle max" };
      }
      maxStarts = value;
    } else if (part === "--instruction") {
      const words: string[] = [];
      let j = i + 1;
      while (j < parts.length && !isCycleCommandFlag(parts[j]!)) {
        words.push(parts[j]!);
        j++;
      }
      instructionWords = words;
      i = j - 1;
    } else if (part.startsWith("--instruction=")) {
      instructionWords = [part.slice("--instruction=".length)];
    } else {
      guidTokens.push(part);
    }
  }
  if (guidTokens.length < 1) {
    return { type: "invalid", reason: "invalid cycle" };
  }
  const guids: bigint[] = [];
  for (const token of guidTokens) {
    const guid = parseGuid(token);
    if (guid === undefined || guid === 0n) {
      return { type: "invalid", reason: "invalid guid" };
    }
    guids.push(guid);
  }
  const instruction = instructionWords?.join(" ") || DEFAULT_FIGHT_INSTRUCTION;
  return {
    type: "cycle",
    guids,
    instruction,
    maxStarts: maxStarts ?? 10,
  };
}

function parseGotoCommand(rest: string): IpcCommand {
  const parts = rest.split(" ").filter(Boolean);
  if (parts.length !== 3) return { type: "invalid", reason: "invalid goto" };
  const x = parseFiniteNumber(parts[0]!);
  const y = parseFiniteNumber(parts[1]!);
  const z = parseFiniteNumber(parts[2]!);
  if (x === undefined || y === undefined || z === undefined) {
    return { type: "invalid", reason: "invalid goto" };
  }
  return { type: "goto", x, y, z };
}

function parseFollowCommand(rest: string): IpcCommand {
  const parts = rest.split(" ").filter(Boolean);
  if (parts.length < 1 || parts.length > 2)
    return { type: "invalid", reason: "invalid follow" };
  const guid = parseGuid(parts[0]!);
  if (guid === undefined || guid === 0n)
    return { type: "invalid", reason: "invalid guid" };
  const raw = parts[1];
  const distance = raw === undefined ? undefined : parseFiniteNumber(raw);
  if (
    raw !== undefined &&
    (distance === undefined || distance < 1 || distance > 20)
  )
    return { type: "invalid", reason: "invalid follow distance" };
  return { type: "follow", guid, distance };
}

function parseBoundedInteger(
  raw: string,
  min: number,
  max: number,
): number | undefined {
  const token = raw.trim();
  if (!/^[0-9]+$/.test(token)) return undefined;
  const value = Number(token);
  return Number.isInteger(value) && value >= min && value <= max
    ? value
    : undefined;
}

function parseQuestIdCommand(
  rest: string,
  type: "query_quest" | "select_quest" | "complete_quest",
): IpcCommand {
  const questId = parseBoundedInteger(rest, 1, 0xffff_ffff);
  return questId === undefined
    ? { type: "invalid", reason: "invalid quest id" }
    : { type, questId };
}

function parseSelectOptionCommand(rest: string): IpcCommand {
  const value = rest.trim();
  const space = value.indexOf(" ");
  const rawId = space === -1 ? value : value.slice(0, space);
  const optionId = parseBoundedInteger(rawId, 0, 0xffff_ffff);
  if (optionId === undefined)
    return { type: "invalid", reason: "invalid gossip option id" };
  let code: unknown = null;
  try {
    if (space !== -1) code = JSON.parse(value.slice(space + 1));
  } catch {
    return { type: "invalid", reason: "invalid gossip code JSON" };
  }
  if (code !== null && typeof code !== "string")
    return { type: "invalid", reason: "invalid gossip code" };
  if (typeof code === "string" && code.includes("\0"))
    return { type: "invalid", reason: "invalid gossip code" };
  return {
    type: "select_option",
    optionId,
    code: code === null ? undefined : code,
  };
}

function writeInspect(
  socket: IpcSocket,
  read: () => unknown,
  json: boolean,
): boolean {
  try {
    const encoded = jsonSafe(read());
    if (json) writeLines(socket, [JSON.stringify(encoded)]);
    else writeLines(socket, JSON.stringify(encoded, null, 2).split("\n"));
  } catch (err) {
    const reason = err instanceof Error ? err.message : "internal";
    writeLines(socket, [`ERR ${reason}`]);
  }
  return false;
}

async function writeInspectAsync(
  socket: IpcSocket,
  read: () => Promise<unknown>,
  json: boolean,
): Promise<boolean> {
  try {
    const encoded = jsonSafe(await read());
    if (json) writeLines(socket, [JSON.stringify(encoded)]);
    else writeLines(socket, JSON.stringify(encoded, null, 2).split("\n"));
  } catch (err) {
    const reason = err instanceof Error ? err.message : "internal";
    writeLines(socket, [`ERR ${reason}`]);
  }
  return false;
}

async function runControlActionAsync(
  socket: IpcSocket,
  action: () => Promise<void>,
): Promise<boolean> {
  try {
    await action();
    writeLines(socket, ["OK"]);
  } catch (err) {
    const reason = err instanceof Error ? err.message : "internal";
    writeLines(socket, [`ERR ${reason}`]);
  }
  return false;
}

const DIRECTIONS: readonly MovementDirection[] = [
  "forward",
  "backward",
  "left",
  "right",
];
const DEFAULT_MOVE_MS = 1000;
const MIN_MOVE_MS = 1;
const MAX_MOVE_MS = 10_000;
const MAX_GUID = 0xffff_ffff_ffff_ffffn;

function parseDirection(
  raw: string | undefined,
): MovementDirection | undefined {
  if (!raw) return undefined;
  const value = raw.toLowerCase() as MovementDirection;
  return DIRECTIONS.includes(value) ? value : undefined;
}

function parseDuration(raw: string | undefined): number | undefined {
  if (raw === undefined) return DEFAULT_MOVE_MS;
  if (!/^[0-9]+$/.test(raw)) return undefined;
  const ms = Number(raw);
  if (ms < MIN_MOVE_MS || ms > MAX_MOVE_MS) return undefined;
  return ms;
}

function parseGuid(raw: string): bigint | undefined {
  if (!/^0[xX][0-9a-fA-F]+$/.test(raw) && !/^[0-9]+$/.test(raw)) {
    return undefined;
  }
  try {
    const guid = BigInt(raw);
    if (guid <= MAX_GUID) return guid;
  } catch {}
  return undefined;
}

function parseMoveCommand(rest: string): IpcCommand {
  const parts = rest.split(" ").filter(Boolean);
  if (parts.length < 1 || parts.length > 2) {
    return { type: "invalid", reason: "invalid move" };
  }
  const direction = parseDirection(parts[0]);
  if (!direction) return { type: "invalid", reason: "invalid direction" };
  const durationMs = parseDuration(parts[1]);
  if (durationMs === undefined) {
    return { type: "invalid", reason: "invalid duration" };
  }
  return { type: "move", direction, durationMs };
}

function parseFaceCommand(rest: string): IpcCommand {
  const token = rest.trim();
  if (!token || token.split(/\s+/).length !== 1) {
    return { type: "invalid", reason: "invalid facing" };
  }
  const orientation = Number(token);
  if (!Number.isFinite(orientation)) {
    return { type: "invalid", reason: "invalid facing" };
  }
  return { type: "face", orientation };
}

function parseTargetCommand(rest: string): IpcCommand {
  const token = rest.trim();
  if (!token || token.split(/\s+/).length !== 1) {
    return { type: "invalid", reason: "invalid guid" };
  }
  const guid = parseGuid(token);
  if (guid === undefined) return { type: "invalid", reason: "invalid guid" };
  return { type: "target", guid };
}

function runControlAction(socket: IpcSocket, action: () => void): boolean {
  try {
    action();
    writeLines(socket, ["OK"]);
  } catch (err) {
    const reason = err instanceof Error ? err.message : "internal";
    writeLines(socket, [`ERR ${reason}`]);
  }
  return false;
}

function writeControlState(
  handle: Pick<WorldHandle, "getControlState">,
  socket: IpcSocket,
  json: boolean,
): boolean {
  try {
    const state = handle.getControlState();
    if (json) {
      writeLines(socket, [JSON.stringify(formatControlStateObj(state))]);
    } else {
      writeLines(socket, formatControlState(state).split("\n"));
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : "internal";
    writeLines(socket, [`ERR ${reason}`]);
  }
  return false;
}

function formatPoseObj(pose: ControlPose): Record<string, unknown> {
  return {
    mapId: pose.mapId,
    x: pose.x,
    y: pose.y,
    z: pose.z,
    orientation: pose.orientation,
    source: pose.source,
    updatedAt: pose.updatedAt,
  };
}

function formatControlStateObj(state: ControlState): Record<string, unknown> {
  return {
    selfGuid: `0x${state.selfGuid.toString(16)}`,
    pose: state.pose ? formatPoseObj(state.pose) : null,
    serverPose: state.serverPose ? formatPoseObj(state.serverPose) : null,
    target:
      state.target === undefined ? null : `0x${state.target.toString(16)}`,
    requestedTarget:
      state.requestedTarget === undefined
        ? null
        : `0x${state.requestedTarget.toString(16)}`,
    moving: state.moving,
    direction: state.direction ?? null,
    movementAllowed: state.movementAllowed,
    blockedReason: state.blockedReason ?? null,
    speed: state.speed,
    owner: state.owner,
  };
}

function formatPoseLine(label: string, pose: ControlPose | undefined): string {
  if (!pose) return `${label} unknown`;
  const pos = `${pose.x.toFixed(2)},${pose.y.toFixed(2)},${pose.z.toFixed(2)}`;
  return `${label} ${pose.source} ${pos} map=${pose.mapId} facing=${pose.orientation}`;
}

function formatControlState(state: ControlState): string {
  const moving = state.moving ? `moving ${state.direction ?? "yes"}` : "idle";
  const allowed = state.movementAllowed ? "allowed" : "rooted";
  const blocked = state.blockedReason ? ` blocked=${state.blockedReason}` : "";
  const observed =
    state.target === undefined ? "none" : `0x${state.target.toString(16)}`;
  const requested =
    state.requestedTarget === undefined
      ? "none"
      : `0x${state.requestedTarget.toString(16)}`;
  const header = `self 0x${state.selfGuid.toString(16)} owner=${state.owner} ${moving} speed=${state.speed} ${allowed}${blocked}`;
  return `${header}\n${formatPoseLine("pose", state.pose)}\n${formatPoseLine("serverPose", state.serverPose)}\ntarget observed=${observed} requested=${requested}`;
}

function formatControlEvent(event: ControlEvent): string {
  const origin = event.state.pose?.source ?? "unknown";
  const reason = event.reason ? ` ${event.reason}` : "";
  return `[control] ${event.type} ${origin}${reason}`;
}

function formatControlEventObj(event: ControlEvent): Record<string, unknown> {
  return {
    type: "CONTROL",
    event: event.type,
    reason: event.reason,
    ...formatControlStateObj(event.state),
  };
}
