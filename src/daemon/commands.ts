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
  MoveEvent,
  CombatFeedEvent,
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
  | { type: "guild_invite"; target: string }
  | { type: "guild_kick"; target: string }
  | { type: "guild_leave" }
  | { type: "guild_promote"; target: string }
  | { type: "guild_demote"; target: string }
  | { type: "guild_leader"; target: string }
  | { type: "guild_motd"; message: string }
  | { type: "guild_accept" }
  | { type: "guild_decline" }
  | { type: "goto"; x: number; y: number; z: number }
  | { type: "follow"; target: string }
  | { type: "face"; orientation: number }
  | { type: "halt" }
  | { type: "pos" }
  | { type: "pos_json" }
  | { type: "target"; name: string }
  | { type: "attack" }
  | { type: "stop_attack" }
  | { type: "cast"; spellId: number; self: boolean }
  | { type: "loot" }
  | { type: "hunt"; name: string }
  | { type: "release" }
  | { type: "reclaim" }
  | { type: "corpse_query" }
  | { type: "res_accept" }
  | { type: "sit" }
  | { type: "stand" }
  | { type: "spells" }
  | { type: "auras"; unit: "self" | "target" }
  | { type: "vitals" }
  | { type: "vitals_json" }
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
    case "GOTO": {
      const parts = rest.split(" ").filter(Boolean).map(parseFloat);
      if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n)))
        return undefined;
      return { type: "goto", x: parts[0]!, y: parts[1]!, z: parts[2]! };
    }
    case "FOLLOW":
      return rest ? { type: "follow", target: rest } : undefined;
    case "FACE": {
      const orientation = parseFloat(rest);
      if (!Number.isFinite(orientation)) return undefined;
      return { type: "face", orientation };
    }
    case "HALT":
      return { type: "halt" };
    case "POS":
      return { type: "pos" };
    case "POS_JSON":
      return { type: "pos_json" };
    case "TARGET":
      return rest ? { type: "target", name: rest } : undefined;
    case "ATTACK":
      return { type: "attack" };
    case "STOPATTACK":
      return { type: "stop_attack" };
    case "CAST": {
      const parts = rest.split(" ").filter(Boolean);
      const spellId = parseInt(parts[0] ?? "", 10);
      if (!Number.isFinite(spellId)) return undefined;
      return { type: "cast", spellId, self: parts[1] === "SELF" };
    }
    case "LOOT":
      return { type: "loot" };
    case "HUNT":
      return rest ? { type: "hunt", name: rest } : undefined;
    case "RELEASE":
      return { type: "release" };
    case "RECLAIM":
      return { type: "reclaim" };
    case "CORPSE":
      return { type: "corpse_query" };
    case "RESACCEPT":
      return { type: "res_accept" };
    case "SIT":
      return { type: "sit" };
    case "STAND":
      return { type: "stand" };
    case "SPELLS":
      return { type: "spells" };
    case "AURAS":
      return { type: "auras", unit: rest === "TARGET" ? "target" : "self" };
    case "VITALS":
      return { type: "vitals" };
    case "VITALS_JSON":
      return { type: "vitals_json" };
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
    case "goto":
      handle.moveTo(cmd.x, cmd.y, cmd.z);
      writeLines(socket, ["OK"]);
      return false;
    case "follow": {
      const found = handle.follow(cmd.target);
      writeLines(socket, found ? ["OK"] : [`ERR "${cmd.target}" not nearby`]);
      return false;
    }
    case "face":
      handle.face(cmd.orientation);
      writeLines(socket, ["OK"]);
      return false;
    case "halt":
      handle.stopMoving();
      writeLines(socket, ["OK"]);
      return false;
    case "pos": {
      const pos = handle.getOwnPosition();
      writeLines(socket, [formatOwnPosition(pos)]);
      return false;
    }
    case "pos_json": {
      const pos = handle.getOwnPosition();
      writeLines(socket, [
        JSON.stringify({
          type: "POSITION",
          mapId: pos.mapId,
          x: pos.x,
          y: pos.y,
          z: pos.z,
          orientation: pos.orientation,
          runSpeed: pos.runSpeed,
          state: pos.state,
        }),
      ]);
      return false;
    }
    case "target": {
      const found = handle.targetByName(cmd.name);
      writeLines(socket, found ? ["OK"] : [`ERR "${cmd.name}" not nearby`]);
      return false;
    }
    case "attack": {
      const ok = handle.attackTarget();
      writeLines(socket, ok ? ["OK"] : ["ERR no target"]);
      return false;
    }
    case "stop_attack":
      handle.stopAttack();
      writeLines(socket, ["OK"]);
      return false;
    case "cast": {
      const ok = handle.castSpell(cmd.spellId, cmd.self);
      writeLines(socket, ok ? ["OK"] : ["ERR no target"]);
      return false;
    }
    case "loot": {
      const ok = handle.lootTarget();
      writeLines(socket, ok ? ["OK"] : ["ERR no target"]);
      return false;
    }
    case "hunt": {
      const found = handle.hunt(cmd.name);
      writeLines(socket, found ? ["OK"] : [`ERR "${cmd.name}" not nearby`]);
      return false;
    }
    case "release":
      handle.releaseSpirit();
      writeLines(socket, ["OK"]);
      return false;
    case "reclaim":
      handle.reclaimCorpse();
      writeLines(socket, ["OK"]);
      return false;
    case "corpse_query":
      handle.queryCorpse();
      writeLines(socket, ["OK"]);
      return false;
    case "res_accept":
      handle.acceptResurrect();
      writeLines(socket, ["OK"]);
      return false;
    case "sit":
      handle.sit();
      writeLines(socket, ["OK"]);
      return false;
    case "stand":
      handle.stand();
      writeLines(socket, ["OK"]);
      return false;
    case "spells": {
      const spells = handle.getSpellbook();
      writeLines(socket, [
        `[spells] ${spells.length} known: ${spells.join(", ")}`,
      ]);
      return false;
    }
    case "auras": {
      const auras = handle.getAuras(cmd.unit);
      if (auras.length === 0) {
        writeLines(socket, [`[auras] none on ${cmd.unit}`]);
        return false;
      }
      writeLines(
        socket,
        auras.map(
          (a) =>
            `[auras] ${a.spellId}${a.remainingMs !== undefined ? ` (${(a.remainingMs / 1000).toFixed(0)}s left)` : ""}`,
        ),
      );
      return false;
    }
    case "vitals": {
      const v = handle.getVitals();
      const state = handle.getCombatState();
      writeLines(socket, [
        `[vitals] HP ${v.health}/${v.maxHealth} mana ${v.mana}/${v.maxMana} level ${v.level}${v.dead ? " DEAD" : ""} (${state})`,
      ]);
      return false;
    }
    case "vitals_json": {
      const v = handle.getVitals();
      writeLines(socket, [
        JSON.stringify({
          type: "VITALS",
          ...v,
          combatState: handle.getCombatState(),
        }),
      ]);
      return false;
    }
    case "unimplemented":
      writeLines(socket, [`UNIMPLEMENTED ${cmd.feature}`]);
      return false;
  }
}

function formatOwnPosition(
  pos: ReturnType<WorldHandle["getOwnPosition"]>,
): string {
  const base = `[pos] map ${pos.mapId} (${pos.x.toFixed(2)}, ${pos.y.toFixed(2)}, ${pos.z.toFixed(2)}) facing ${pos.orientation.toFixed(2)}`;
  if (pos.state.kind === "moving")
    return `${base} — moving to (${pos.state.x.toFixed(2)}, ${pos.state.y.toFixed(2)}, ${pos.state.z.toFixed(2)})`;
  if (pos.state.kind === "following")
    return `${base} — following ${pos.state.name}`;
  return base;
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

function formatMoveEvent(event: MoveEvent): string {
  switch (event.type) {
    case "move_started":
      return `[move] Moving to (${event.x.toFixed(1)}, ${event.y.toFixed(1)}, ${event.z.toFixed(1)})`;
    case "follow_started":
      return `[move] Following ${event.name}`;
    case "progress":
      return `[move] ${event.remaining.toFixed(1)} yd remaining at (${event.x.toFixed(1)}, ${event.y.toFixed(1)}, ${event.z.toFixed(1)})`;
    case "arrived":
      return `[move] Arrived at (${event.x.toFixed(1)}, ${event.y.toFixed(1)}, ${event.z.toFixed(1)})`;
    case "move_stopped":
      return `[move] Stopped (${event.reason})`;
  }
}

function formatMoveEventObj(event: MoveEvent): Record<string, unknown> {
  switch (event.type) {
    case "move_started":
      return { type: "MOVE_STARTED", x: event.x, y: event.y, z: event.z };
    case "follow_started":
      return { type: "FOLLOW_STARTED", name: event.name };
    case "progress":
      return {
        type: "MOVE_PROGRESS",
        x: event.x,
        y: event.y,
        z: event.z,
        remaining: event.remaining,
      };
    case "arrived":
      return { type: "MOVE_ARRIVED", x: event.x, y: event.y, z: event.z };
    case "move_stopped":
      return { type: "MOVE_STOPPED", reason: event.reason };
  }
}

export function onMoveEvent(
  event: MoveEvent,
  events: RingBuffer<EventEntry>,
  log: SessionLog,
): void {
  const text = formatMoveEvent(event);
  const obj = formatMoveEventObj(event);
  events.push({ text, json: JSON.stringify(obj) });
  log.append(obj as LogEntry).catch(() => {});
}

function formatCombatEvent(event: CombatFeedEvent): string {
  switch (event.type) {
    case "aggro":
      return `[combat] ${event.name} is attacking you!`;
    case "melee_start":
      return `[combat] ${event.attacker} attacks ${event.victim}`;
    case "melee_stop":
      return event.dead
        ? `[combat] ${event.victim} dies`
        : `[combat] ${event.attacker} stops attacking`;
    case "damage": {
      const what =
        event.kind === "spell" ? ` (spell ${event.spellId})` : " (melee)";
      if (event.miss) return `[combat] ${event.source} misses ${event.target}`;
      return `[combat] ${event.source} hits ${event.target} for ${event.amount}${event.crit ? " CRIT" : ""}${what}`;
    }
    case "heal":
      return `[combat] ${event.target} healed for ${event.amount}${event.crit ? " CRIT" : ""} (spell ${event.spellId})`;
    case "cast_started":
      return `[cast] casting ${event.spellId} (${event.castTimeMs}ms)`;
    case "cast_go":
      return `[cast] ${event.spellId} hit ${event.target}${event.powerLeft !== undefined ? ` (${event.powerLeft} mana left)` : ""}`;
    case "cast_failed":
      return `[cast] ${event.spellId} FAILED: ${event.resultName}`;
    case "spellbook":
      return `[spells] spellbook loaded: ${event.spells.length} spells`;
    case "aura":
      return event.applied
        ? `[aura] ${event.unit} gained ${event.spellId}${event.timeLeftMs !== undefined ? ` (${(event.timeLeftMs / 1000).toFixed(0)}s)` : ""}`
        : `[aura] ${event.unit} lost ${event.spellId}`;
    case "loot_window":
      return `[loot] ${event.gold} copper, ${event.items.length} items: ${event.items.map((i) => i.name ?? i.itemId).join(", ")}`;
    case "loot_error":
      return `[loot] failed (error ${event.error})`;
    case "loot_item":
      return `[loot] received ${event.count}x ${event.name ?? event.itemId} (${event.total} total)`;
    case "loot_money":
      return `[loot] ${event.copper} copper`;
    case "xp":
      return `[xp] +${event.amount} XP${event.kill ? " (kill)" : ""}`;
    case "level_up":
      return `[xp] LEVEL UP! Now level ${event.level}`;
    case "died":
      return "[death] You died";
    case "release_loc":
      return `[death] Released — graveyard at (${event.x.toFixed(1)}, ${event.y.toFixed(1)})`;
    case "corpse_location":
      return `[death] Corpse at (${event.x.toFixed(1)}, ${event.y.toFixed(1)}, ${event.z.toFixed(1)})`;
    case "reclaim_delay":
      return `[death] Reclaim delay ${event.ms}ms`;
    case "resurrect_offer":
      return `[death] ${event.from} offers to resurrect you (RESACCEPT to accept)`;
    case "swing_error":
      return `[combat] swing error: ${event.error}`;
    case "hunt_started":
      return `[hunt] Hunting ${event.name}`;
    case "hunt_phase":
      return `[hunt] Phase: ${event.phase}`;
    case "hunt_complete":
      return `[hunt] ${event.name} killed and looted (${(event.durationMs / 1000).toFixed(1)}s)`;
    case "hunt_aborted":
      return `[hunt] ABORTED: ${event.reason}`;
  }
}

function formatCombatEventObj(event: CombatFeedEvent): Record<string, unknown> {
  switch (event.type) {
    case "aggro":
      return { type: "AGGRO", name: event.name };
    case "melee_start":
      return {
        type: "MELEE_START",
        attacker: event.attacker,
        victim: event.victim,
      };
    case "melee_stop":
      return {
        type: "MELEE_STOP",
        attacker: event.attacker,
        victim: event.victim,
        dead: event.dead,
      };
    case "damage":
      return {
        type: "DAMAGE",
        kind: event.kind,
        source: event.source,
        target: event.target,
        amount: event.amount,
        crit: event.crit,
        miss: event.miss,
        spellId: event.spellId,
      };
    case "heal":
      return {
        type: "HEAL",
        target: event.target,
        amount: event.amount,
        crit: event.crit,
        spellId: event.spellId,
      };
    case "cast_started":
      return {
        type: "CAST_STARTED",
        spellId: event.spellId,
        castTimeMs: event.castTimeMs,
      };
    case "cast_go":
      return {
        type: "CAST_GO",
        spellId: event.spellId,
        target: event.target,
        powerLeft: event.powerLeft,
      };
    case "cast_failed":
      return {
        type: "CAST_FAILED",
        spellId: event.spellId,
        result: event.result,
        resultName: event.resultName,
      };
    case "spellbook":
      return { type: "SPELLBOOK_LOADED", spells: event.spells };
    case "aura":
      return {
        type: "AURA",
        unit: event.unit,
        spellId: event.spellId,
        applied: event.applied,
        timeLeftMs: event.timeLeftMs,
      };
    case "loot_window":
      return { type: "LOOT_WINDOW", gold: event.gold, items: event.items };
    case "loot_error":
      return { type: "LOOT_ERROR", error: event.error };
    case "loot_item":
      return {
        type: "LOOT_ITEM",
        itemId: event.itemId,
        name: event.name,
        count: event.count,
        total: event.total,
      };
    case "loot_money":
      return { type: "LOOT_MONEY", copper: event.copper };
    case "xp":
      return { type: "XP_GAIN", amount: event.amount, kill: event.kill };
    case "level_up":
      return { type: "LEVEL_UP", level: event.level };
    case "died":
      return { type: "DIED" };
    case "release_loc":
      return {
        type: "RELEASED",
        mapId: event.mapId,
        x: event.x,
        y: event.y,
        z: event.z,
      };
    case "corpse_location":
      return { type: "CORPSE_LOCATION", x: event.x, y: event.y, z: event.z };
    case "reclaim_delay":
      return { type: "RECLAIM_DELAY", ms: event.ms };
    case "resurrect_offer":
      return { type: "RESURRECT_OFFER", from: event.from };
    case "swing_error":
      return { type: "SWING_ERROR", error: event.error };
    case "hunt_started":
      return { type: "HUNT_STARTED", name: event.name };
    case "hunt_phase":
      return { type: "HUNT_PHASE", phase: event.phase };
    case "hunt_complete":
      return {
        type: "HUNT_COMPLETE",
        name: event.name,
        durationMs: event.durationMs,
      };
    case "hunt_aborted":
      return { type: "HUNT_ABORTED", reason: event.reason };
  }
}

export function onCombatEvent(
  event: CombatFeedEvent,
  events: RingBuffer<EventEntry>,
  log: SessionLog,
): void {
  const text = formatCombatEvent(event);
  const obj = formatCombatEventObj(event);
  events.push({ text, json: JSON.stringify(obj) });
  log.append(obj as LogEntry).catch(() => {});
}
