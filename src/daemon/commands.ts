import { RingBuffer } from "lib/ring-buffer";
import type { IpcCommand } from "daemon/parse";
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
import type { ControlEvent, ControlPose, ControlState } from "wow/control";
import type { CombatEvent } from "wow/combat";
import type { TacticsEvent } from "wow/tactics";
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
      writeLines(socket, items.map(formatNearbyLine));
      return false;
    }
    case "nearby_json": {
      const items = prepareNearbyEntities(handle, cmd.all);
      writeLines(
        socket,
        items.map((p) => JSON.stringify(formatNearbyObj(p))),
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
    case "face_guid":
      return runControlAction(socket, () => {
        handle.faceGuid(cmd.guid);
      });
    case "walk_toward":
      try {
        const result = await handle.walkToward(cmd.target, cmd.yards, abort);
        writeLines(socket, [JSON.stringify(result)]);
      } catch (err) {
        const reason = err instanceof Error ? err.message : "internal";
        writeLines(socket, [`ERR ${reason}`]);
      }
      return false;
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
      return writeInspect(socket, () => navigationObservation(handle), false);
    case "navigation_json":
      return writeInspect(socket, () => navigationObservation(handle), true);
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
    case "spirit_healer":
      return runControlAction(socket, () => {
        handle.activateSpiritHealer(cmd.guid);
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

function formatNearbyLine(p: PreparedNearbyEntity): string {
  const entity = p.entity;
  const guid = `0x${entity.guid.toString(16)}`;
  const distance =
    p.distance === null ? "distance=unknown" : `${p.distance.toFixed(2)} yd`;
  const xy =
    p.horizontalDistance === null
      ? "xy=unknown"
      : `xy=${p.horizontalDistance.toFixed(2)} yd`;
  const face =
    p.bearingRadians === null ? "unknown" : p.bearingRadians.toFixed(4);
  const turn = p.turnRadians === null ? "unknown" : p.turnRadians.toFixed(4);
  const spatial = ` [${distance} ${xy} face=${face} turn=${turn} origin=${p.originSource ?? "unknown"}]`;
  if (
    entity.objectType === ObjectType.UNIT ||
    entity.objectType === ObjectType.PLAYER
  ) {
    const unit = entity as UnitEntity;
    const name = entity.name ?? "Unknown";
    const kind = objectTypeName(entity.objectType);
    const level = unit.level > 0 ? `, level ${unit.level}` : "";
    const hp = `HP ${unit.health}/${unit.maxHealth}`;
    const pos = p.position
      ? ` at ${p.position.x.toFixed(2)}, ${p.position.y.toFixed(2)}, ${p.position.z.toFixed(2)}`
      : "";
    return `${name} (${kind}${level}) ${hp}${pos} ${guid}${spatial}`;
  }
  if (entity.objectType === ObjectType.GAMEOBJECT) {
    const name = entity.name ?? "Unknown";
    const pos = p.position
      ? ` at ${p.position.x.toFixed(2)}, ${p.position.y.toFixed(2)}, ${p.position.z.toFixed(2)}`
      : "";
    return `${name} (GameObject)${pos} ${guid}${spatial}`;
  }
  return `Entity ${guid} (${objectTypeName(entity.objectType)})${spatial}`;
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
  position: Entity["position"];
  distance: number | null;
  horizontalDistance: number | null;
  bearingRadians: number | null;
  turnRadians: number | null;
  originSource: "predicted" | "server" | "self_entity" | null;
  originUpdatedAt: number | null;
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
  const selfPose = controlState.pose;
  const selfPos = selfPose ?? selfEntity?.position;
  const originSource = selfPose?.source ?? (selfPos ? "self_entity" : null);
  const originUpdatedAt = selfPose?.updatedAt ?? null;

  const prepared: PreparedNearbyEntity[] = entities.map((entity) => {
    const isSelf = entity.guid === selfGuid;
    let distance: number | null = null;
    let horizontalDistance: number | null = null;
    let bearingRadians: number | null = null;
    let turnRadians: number | null = null;
    if (isSelf) {
      distance = 0;
      if (selfPos) horizontalDistance = 0;
    } else if (
      selfPos &&
      entity.position &&
      selfPos.mapId === entity.position.mapId
    ) {
      const dx = entity.position.x - selfPos.x;
      const dy = entity.position.y - selfPos.y;
      const dz = entity.position.z - selfPos.z;
      horizontalDistance = Math.hypot(dx, dy);
      distance = Math.hypot(horizontalDistance, dz);
      if (horizontalDistance > 0) {
        const angle = Math.atan2(dy, dx);
        bearingRadians = angle < 0 ? angle + Math.PI * 2 : angle;
        const turn = bearingRadians - selfPos.orientation;
        turnRadians =
          ((((turn + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) -
          Math.PI;
      }
    }
    return {
      position: isSelf ? selfPos : entity.position,
      entity,
      distance,
      horizontalDistance,
      bearingRadians,
      turnRadians,
      originSource,
      originUpdatedAt,
      self: isSelf,
    };
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

function formatNearbyObj(p: PreparedNearbyEntity): Record<string, unknown> {
  const {
    entity,
    position,
    self,
    distance,
    horizontalDistance,
    bearingRadians,
    turnRadians,
    originSource,
    originUpdatedAt,
  } = p;
  const obj: Record<string, unknown> = {
    guid: `0x${entity.guid.toString(16)}`,
    type: objectTypeString(entity.objectType),
    name: entity.name,
    entry: entity.entry,
    self,
    distance: distance === null ? null : Math.round(distance * 100) / 100,
    horizontalDistance:
      horizontalDistance === null
        ? null
        : Math.round(horizontalDistance * 100) / 100,
    bearingRadians,
    turnRadians,
    originSource,
    originUpdatedAt,
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
  if (position) {
    obj["x"] = position.x;
    obj["y"] = position.y;
    obj["z"] = position.z;
    obj["mapId"] = position.mapId;
    obj["orientation"] = position.orientation;
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

function nextStepFor(reason: string | undefined): string | null {
  if (reason === "obstructed")
    return "Choose a different route. Inspect the ground before moving.";
  if (reason === "height_unresolved")
    return "Choose a different short heading or a known grounded waypoint. Do not retry this heading.";
  if (reason?.includes("ambiguous ground column"))
    return "Choose a destination with one ground height. Do not guess Z.";
  return null;
}

function navigationObservation(handle: WorldHandle) {
  const state = handle.getNavigationState();
  return { ...state, nextStep: nextStepFor(state.blockedReason) };
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
    nextStep: nextStepFor(state.blockedReason),
    speed: state.speed,
    owner: state.owner,
  };
}

function formatPoseLine(label: string, pose: ControlPose | undefined): string {
  if (!pose) return `${label} unknown`;
  const pos = `${pose.x.toFixed(2)},${pose.y.toFixed(2)},${pose.z.toFixed(2)}`;
  return `${label} ${pose.source} ${pos} map=${pose.mapId} facing=${pose.orientation} updatedAt=${pose.updatedAt}`;
}

function formatControlState(state: ControlState): string {
  const moving = state.moving ? `moving ${state.direction ?? "yes"}` : "idle";
  const allowed = state.movementAllowed ? "allowed" : "rooted";
  const blocked = state.blockedReason ? ` blocked=${state.blockedReason}` : "";
  const nextStep = nextStepFor(state.blockedReason);
  const observed =
    state.target === undefined ? "none" : `0x${state.target.toString(16)}`;
  const requested =
    state.requestedTarget === undefined
      ? "none"
      : `0x${state.requestedTarget.toString(16)}`;
  const header = `self 0x${state.selfGuid.toString(16)} owner=${state.owner} ${moving} speed=${state.speed} ${allowed}${blocked}`;
  return `${header}\n${formatPoseLine("current pose", state.pose)}\n${formatPoseLine("last server pose", state.serverPose)}\ntarget observed=${observed} requested=${requested}${nextStep ? `\nnext step: ${nextStep}` : ""}`;
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
