import { inflateSync } from "node:zlib";
import {
  PacketReader,
  PacketWriter,
  joinGuid,
  splitGuid,
} from "wow/protocol/packet";
import { GameOpcode, ChatType } from "wow/protocol/opcodes";
import {
  parseChatMessage,
  buildNameQuery,
  parseNameQueryResponse,
  parseChannelNotify,
  parseRandomRoll,
  parseServerBroadcast,
  parseNotification,
  type ChatMessage as RawChatMessage,
} from "wow/protocol/chat";
import { buildOutgoingPacket } from "wow/protocol/world";
import {
  parseDuelRequested,
  parseDuelCountdown,
  parseDuelComplete,
  parseDuelWinner,
} from "wow/protocol/duel";
import {
  parsePartyCommandResult,
  parseGroupInvite,
  parseGroupSetLeader,
  parseGroupDecline,
  parseGroupList,
  parsePartyMemberStats,
} from "wow/protocol/group";
import {
  SPEED_ACKS,
  parseClientControl,
  parseForceSpeed,
  parseKnockBack,
  parseMoveCounter,
  parseMovementInfo,
  parseTeleportAck,
  parseWorldPosition,
  type SpeedAck,
} from "wow/protocol/movement";
import { parseUpdateObject } from "wow/protocol/update-object";
import {
  ATTACK_SWING_ERRORS,
  parseAttackStart,
  parseAttackStop,
  parseXpGain,
} from "wow/protocol/combat";
import { parseAuraUpdate, parseAuraUpdateAll } from "wow/protocol/aura";
import {
  parseCastFailed,
  parseCooldownNotice,
  parseInitialSpells,
  parseLearnedSpell,
  parseRemovedSpell,
  parseSpellCooldown,
  parseSpellDelayed,
  parseSpellFailure,
  parseSpellGo,
  parseSpellStart,
  parseSupersededSpell,
} from "wow/protocol/spell";
import { parseMonsterMove } from "wow/protocol/monster-move";
import { parseGossipMessage } from "wow/protocol/gossip";
import {
  parseQuestgiverOfferReward,
  parseQuestgiverQuestComplete,
  parseQuestgiverQuestDetails,
  parseQuestgiverQuestList,
  parseQuestgiverRequestItems,
  parseQuestgiverStatus,
} from "wow/protocol/questgiver";
import { parseQuestQueryResponse } from "wow/protocol/quest-query";
import {
  parseQuestFailed,
  parseQuestInvalid,
  parseQuestUpdateAddItem,
  parseQuestUpdateAddKill,
  parseQuestUpdateComplete,
  parseQuestUpdateFailed,
  parseQuestUpdateFailedTimer,
} from "wow/protocol/quest-log";
import type { QuestDialog } from "wow/quests";
import { ObjectType, UpdateFlag } from "wow/protocol/entity-fields";
import {
  extractObjectFields,
  extractUnitFields,
  extractGameObjectFields,
  type UnitFieldsResult,
  type GameObjectFieldsResult,
} from "wow/protocol/extract-fields";
import {
  buildCreatureQuery,
  parseCreatureQueryResponse,
  buildGameObjectQuery,
  parseGameObjectQueryResponse,
} from "wow/protocol/entity-queries";
import {
  parseContactList,
  parseFriendStatus,
  SocialFlag,
  FriendStatus,
  FriendResult,
} from "wow/protocol/social";
import {
  parseGuildRoster,
  parseGuildQueryResponse,
  parseGuildEvent,
  GuildEventCode,
  parseGuildCommandResult,
  parseGuildInvitePacket,
  GuildCommandResult,
} from "wow/protocol/guild";
import type { FriendEntry } from "wow/friend-store";
import type { IgnoreEntry } from "wow/ignore-store";
import type { GuildMember } from "wow/guild-store";
import type { WorldConn } from "wow/client";

function ensureNameQuery(conn: WorldConn, guid: bigint): void {
  const { low, high } = splitGuid(guid);
  if (conn.pendingNameQueries.has(`player:${low}`)) return;
  conn.pendingNameQueries.add(`player:${low}`);
  sendPacket(conn, GameOpcode.CMSG_NAME_QUERY, buildNameQuery(low, high));
}

export function sendPacket(
  conn: WorldConn,
  opcode: number,
  body: Uint8Array = new Uint8Array(0),
): void {
  conn.socket.write(buildOutgoingPacket(opcode, body, conn.arc4));
}

export function selfGuid(conn: WorldConn): bigint {
  return joinGuid(conn.selfGuidLow, conn.selfGuidHigh);
}

export function handleTimeSync(conn: WorldConn, r: PacketReader): void {
  const counter = r.uint32LE();
  const elapsed = Date.now() - conn.startTime;
  const w = new PacketWriter();
  w.uint32LE(counter);
  w.uint32LE(elapsed);
  sendPacket(conn, GameOpcode.CMSG_TIME_SYNC_RESP, w.finish());
}

export function deliverMessage(
  conn: WorldConn,
  raw: RawChatMessage,
  name: string,
): void {
  conn.onMessage?.({
    type: raw.type,
    sender: name,
    message: raw.message,
    channel: raw.channel,
  });
}

export function resolveAndDeliver(conn: WorldConn, raw: RawChatMessage): void {
  if (raw.senderGuidLow === 0) {
    deliverMessage(conn, raw, "");
    return;
  }

  if (raw.senderName !== undefined) {
    deliverMessage(conn, raw, raw.senderName);
    return;
  }

  if (conn.ignoreStore.has(raw.senderGuidLow)) return;

  const cached = conn.nameCache.get(raw.senderGuidLow);
  if (cached !== undefined) {
    deliverMessage(conn, raw, cached);
    return;
  }

  const pending = conn.pendingMessages.get(raw.senderGuidLow);
  if (pending) {
    pending.push(raw);
  } else {
    conn.pendingMessages.set(raw.senderGuidLow, [raw]);
    sendPacket(
      conn,
      GameOpcode.CMSG_NAME_QUERY,
      buildNameQuery(raw.senderGuidLow, raw.senderGuidHigh),
    );
  }
}

export function handleChatMessage(conn: WorldConn, r: PacketReader): void {
  resolveAndDeliver(conn, parseChatMessage(r));
}

export function handleRandomRoll(conn: WorldConn, r: PacketReader): void {
  const roll = parseRandomRoll(r);
  resolveAndDeliver(conn, {
    type: ChatType.ROLL,
    language: 0,
    senderGuidLow: roll.guidLow,
    senderGuidHigh: roll.guidHigh,
    message: `rolled ${roll.result} (${roll.min}-${roll.max})`,
  });
}

export function handleGmChatMessage(conn: WorldConn, r: PacketReader): void {
  const raw = parseChatMessage(r, true);
  deliverMessage(conn, raw, raw.senderName ?? "");
}

export function handleNameQueryResponse(
  conn: WorldConn,
  r: PacketReader,
): void {
  const result = parseNameQueryResponse(r);

  const name = result.found && result.name ? result.name : "";
  conn.pendingNameQueries.delete(`player:${result.guidLow}`);
  if (result.found && result.name) {
    conn.nameCache.set(result.guidLow, result.name);
    for (const entity of conn.entityStore.all()) {
      if (
        entity.objectType === ObjectType.PLAYER &&
        Number(entity.guid & 0xffffffffn) === result.guidLow &&
        !entity.name
      ) {
        conn.entityStore.setName(entity.guid, result.name);
      }
    }
    for (const friend of conn.friendStore.all()) {
      if (
        Number(friend.guid & 0xffffffffn) === result.guidLow &&
        !friend.name
      ) {
        conn.friendStore.setName(friend.guid, result.name);
      }
    }
    for (const entry of conn.ignoreStore.all()) {
      if (Number(entry.guid & 0xffffffffn) === result.guidLow && !entry.name) {
        conn.ignoreStore.setName(entry.guid, result.name);
      }
    }
  }

  const pending = conn.pendingMessages.get(result.guidLow);
  if (!pending) return;
  for (const raw of pending) deliverMessage(conn, raw, name);
  conn.pendingMessages.delete(result.guidLow);
}

export function handleChannelNotify(conn: WorldConn, r: PacketReader): void {
  const event = parseChannelNotify(r);
  if (event.type === "joined") {
    conn.channels.push(event.channel);
    conn.onMessage?.({
      type: ChatType.SYSTEM,
      sender: "",
      message: `Joined channel: ${event.channel}`,
    });
  } else if (event.type === "left") {
    const idx = conn.channels.indexOf(event.channel);
    if (idx !== -1) conn.channels.splice(idx, 1);
    conn.onMessage?.({
      type: ChatType.SYSTEM,
      sender: "",
      message: `Left channel: ${event.channel}`,
    });
  } else if (event.type === "error") {
    conn.onMessage?.({
      type: ChatType.SYSTEM,
      sender: "",
      message: event.message,
    });
  }
}

export function handleMotd(conn: WorldConn, r: PacketReader): void {
  const lineCount = r.uint32LE();
  const lines: string[] = [];
  for (let i = 0; i < lineCount; i++) {
    lines.push(r.cString());
  }
  conn.onMessage?.({
    type: ChatType.SYSTEM,
    sender: "",
    message: lines.join("\n"),
  });
}

export function handlePlayerNotFound(conn: WorldConn, r: PacketReader): void {
  const name = r.cString();
  conn.onMessage?.({
    type: ChatType.SYSTEM,
    sender: "",
    message: `No player named "${name}" is currently playing.`,
  });
}

const CHAT_RESTRICTION_MESSAGES: Record<number, string> = {
  0: "Chat is restricted",
  1: "Chat is throttled",
  2: "You have been squelched",
  3: "Yell is restricted",
};

export function handleChatRestricted(conn: WorldConn, r: PacketReader): void {
  const restriction = r.uint8();
  conn.onMessage?.({
    type: ChatType.SYSTEM,
    sender: "",
    message:
      CHAT_RESTRICTION_MESSAGES[restriction] ??
      `Chat restriction ${restriction}`,
  });
}

export function handleChatWrongFaction(conn: WorldConn): void {
  conn.onMessage?.({
    type: ChatType.SYSTEM,
    sender: "",
    message: "You cannot speak to members of the opposing faction",
  });
}

export function handleServerBroadcast(conn: WorldConn, r: PacketReader): void {
  const { message } = parseServerBroadcast(r);
  conn.onMessage?.({
    type: ChatType.SYSTEM,
    sender: "",
    message,
    origin: "server",
  });
}

export function handleNotification(conn: WorldConn, r: PacketReader): void {
  const { message } = parseNotification(r);
  conn.onMessage?.({
    type: ChatType.SYSTEM,
    sender: "",
    message,
    origin: "notification",
  });
}

export function handleReceivedMail(conn: WorldConn, r: PacketReader): void {
  r.uint32LE();
  conn.onMessage?.({
    type: ChatType.SYSTEM,
    sender: "",
    message: "You have new mail.",
    origin: "mail",
  });
}

export function handleDuelRequested(conn: WorldConn, r: PacketReader): void {
  const duel = parseDuelRequested(r);
  conn.duelArbiter = duel.arbiter;
  conn.pendingRequest = "duel";
  const guidLow = Number(duel.initiator & 0xffffffffn);
  const name = conn.nameCache.get(guidLow) ?? "Unknown";
  conn.onDuelEvent?.({ type: "duel_requested", challenger: name });
}

export function handleDuelCountdown(conn: WorldConn, r: PacketReader): void {
  const { timeMs } = parseDuelCountdown(r);
  conn.onDuelEvent?.({ type: "duel_countdown", timeMs });
}

export function handleDuelComplete(conn: WorldConn, r: PacketReader): void {
  const { completed } = parseDuelComplete(r);
  conn.onDuelEvent?.({ type: "duel_complete", completed });
}

export function handleDuelWinner(conn: WorldConn, r: PacketReader): void {
  const { reason, winner, loser } = parseDuelWinner(r);
  conn.duelArbiter = 0n;
  conn.onDuelEvent?.({ type: "duel_winner", reason, winner, loser });
}

export function handleDuelOutOfBounds(conn: WorldConn): void {
  conn.onDuelEvent?.({ type: "duel_out_of_bounds" });
}

export function handleDuelInBounds(conn: WorldConn): void {
  conn.onDuelEvent?.({ type: "duel_in_bounds" });
}

export function handlePartyCommandResult(
  conn: WorldConn,
  r: PacketReader,
): void {
  const result = parsePartyCommandResult(r);
  conn.onGroupEvent?.({
    type: "command_result",
    operation: result.operation,
    target: result.member,
    result: result.result,
  });
}

export function handleGroupInviteReceived(
  conn: WorldConn,
  r: PacketReader,
): void {
  const invite = parseGroupInvite(r);
  conn.pendingRequest = "group";
  conn.onGroupEvent?.({ type: "invite_received", from: invite.name });
}

export function handleGroupSetLeaderMsg(
  conn: WorldConn,
  r: PacketReader,
): void {
  const { name } = parseGroupSetLeader(r);
  conn.onGroupEvent?.({ type: "leader_changed", name });
}

export function handleGroupListMsg(conn: WorldConn, r: PacketReader): void {
  const list = parseGroupList(r);
  conn.partyMembers.clear();
  let leaderName = "";
  if (
    conn.selfGuidLow === list.leaderGuidLow &&
    conn.selfGuidHigh === list.leaderGuidHigh
  ) {
    leaderName = conn.selfName;
  }
  for (const m of list.members) {
    conn.partyMembers.set(m.name, {
      guidLow: m.guidLow,
      guidHigh: m.guidHigh,
    });
    if (
      m.guidLow === list.leaderGuidLow &&
      m.guidHigh === list.leaderGuidHigh
    ) {
      leaderName = m.name;
    }
  }
  conn.onGroupEvent?.({
    type: "group_list",
    members: list.members,
    leader: leaderName,
  });
}

export function handleGroupDestroyed(conn: WorldConn): void {
  conn.partyMembers.clear();
  conn.onGroupEvent?.({ type: "group_destroyed" });
}

export function handleGroupUninvite(conn: WorldConn): void {
  conn.partyMembers.clear();
  conn.onGroupEvent?.({ type: "kicked" });
}

export function handleGroupDeclineMsg(conn: WorldConn, r: PacketReader): void {
  const { name } = parseGroupDecline(r);
  conn.onGroupEvent?.({ type: "invite_declined", name });
}

export function handleUpdateObject(conn: WorldConn, r: PacketReader): void {
  const mapId = conn.control?.currentMapId() ?? 0;
  const entries = parseUpdateObject(r, mapId);
  const self = selfGuid(conn);
  for (const entry of entries) {
    switch (entry.type) {
      case "create": {
        const { _changed: _co, ...objFields } = extractObjectFields(
          entry.fields,
        );
        let extraFields: Partial<UnitFieldsResult> &
          Partial<GameObjectFieldsResult> = {};
        if (
          entry.objectType === ObjectType.UNIT ||
          entry.objectType === ObjectType.PLAYER
        ) {
          const { _changed: _cu, ...rest } = extractUnitFields(entry.fields);
          extraFields = rest;
        } else if (entry.objectType === ObjectType.GAMEOBJECT) {
          const { _changed: _cg, ...rest } = extractGameObjectFields(
            entry.fields,
          );
          extraFields = rest;
        }
        const cachedName = lookupCachedName(
          conn,
          entry.guid,
          entry.objectType,
          objFields.entry,
        );
        conn.entityStore.create(entry.guid, entry.objectType, {
          ...objFields,
          ...extraFields,
          ...(cachedName ? { name: cachedName } : {}),
          ...(entry.position ? { position: entry.position } : {}),
          rawFields: new Map(entry.fields),
          createComplete: true,
        } as any);
        if (entry.guid === self) {
          const created = conn.entityStore.get(self);
          if (created) conn.quests?.observeSelfCreate(created);
        }
        if (entry.position)
          conn.combat?.observePosition(
            entry.guid,
            entry.position,
            entry.spline,
          );
        if (!cachedName)
          queryEntityName(conn, entry.guid, entry.objectType, objFields.entry);
        if (
          entry.guid === self ||
          (entry.updateFlags & UpdateFlag.SELF) !== 0
        ) {
          conn.control?.observeSelf({
            position: entry.position,
            movementFlags: entry.movementFlags,
            runSpeed: entry.runSpeed,
            runBackSpeed: entry.runBackSpeed,
            target: extraFields.target as bigint | undefined,
            unitFlags: extraFields.unitFlags as number | undefined,
          });
        }
        break;
      }
      case "values": {
        const entity = conn.entityStore.get(entry.guid);
        if (!entity) break;
        const objFields = extractObjectFields(entry.fields, entity.rawFields);
        let extraFields: Partial<UnitFieldsResult> &
          Partial<GameObjectFieldsResult> = {};
        if (
          entity.objectType === ObjectType.UNIT ||
          entity.objectType === ObjectType.PLAYER
        ) {
          extraFields = extractUnitFields(entry.fields, entity.rawFields);
        } else if (entity.objectType === ObjectType.GAMEOBJECT) {
          extraFields = extractGameObjectFields(entry.fields);
        }
        const allChanged = [
          ...(objFields._changed || []),
          ...((extraFields as any)._changed || []),
        ];
        const merged: Record<string, unknown> = {};
        for (const key of allChanged) {
          if (key in extraFields) merged[key] = (extraFields as any)[key];
          else if (key in objFields) merged[key] = (objFields as any)[key];
        }
        for (const [k, v] of entry.fields) entity.rawFields.set(k, v);
        merged["rawFields"] = entity.rawFields;
        conn.entityStore.update(entry.guid, merged);
        if (entry.guid === self) {
          conn.control?.observeSelf({
            target: extraFields.target as bigint | undefined,
            unitFlags: extraFields.unitFlags as number | undefined,
          });
        }
        break;
      }
      case "movement": {
        conn.entityStore.setPosition(entry.guid, entry.position);
        conn.combat?.observePosition(entry.guid, entry.position, entry.spline);
        if (entry.guid === self) {
          conn.control?.observeSelf({
            position: entry.position,
            movementFlags: entry.movementFlags,
            runSpeed: entry.runSpeed,
            runBackSpeed: entry.runBackSpeed,
          });
        }
        break;
      }
      case "outOfRange": {
        for (const guid of entry.guids) conn.entityStore.destroy(guid);
        break;
      }
      case "nearObjects": {
        break;
      }
    }
  }
  conn.quests?.observeQuestLog();
}

export function handleCompressedUpdateObject(
  conn: WorldConn,
  r: PacketReader,
): void {
  const uncompressedSize = r.uint32LE();
  const compressed = r.bytes(r.remaining);
  const decompressed = inflateSync(compressed);
  if (decompressed.length !== uncompressedSize) {
    throw new Error(
      `Compressed update size mismatch: expected ${uncompressedSize}, got ${decompressed.length}`,
    );
  }
  handleUpdateObject(conn, new PacketReader(new Uint8Array(decompressed)));
}

export function handleDestroyObject(conn: WorldConn, r: PacketReader): void {
  const guid = r.uint64LE();
  r.skip(1);
  conn.entityStore.destroy(guid);
  conn.quests?.observeQuestLog();
}

export function lookupCachedName(
  conn: WorldConn,
  guid: bigint,
  objectType: number,
  entry: number | undefined,
): string | undefined {
  if (objectType === ObjectType.PLAYER) {
    const guidLow = Number(guid & 0xffffffffn);
    return conn.nameCache.get(guidLow);
  }
  if (entry === undefined) return undefined;
  if (objectType === ObjectType.UNIT) return conn.creatureNameCache.get(entry);
  if (objectType === ObjectType.GAMEOBJECT)
    return conn.gameObjectNameCache.get(entry);
  return undefined;
}

export function queryEntityName(
  conn: WorldConn,
  guid: bigint,
  objectType: number,
  entry: number | undefined,
): void {
  if (objectType === ObjectType.PLAYER) {
    const guidLow = Number(guid & 0xffffffffn);
    const key = `player:${guidLow}`;
    if (conn.pendingNameQueries.has(key)) return;
    conn.pendingNameQueries.add(key);
    const w = new PacketWriter();
    w.uint64LE(guid);
    sendPacket(conn, GameOpcode.CMSG_NAME_QUERY, w.finish());
    return;
  }
  if (entry === undefined) return;
  const key = `${objectType}:${entry}`;
  if (conn.pendingNameQueries.has(key)) return;
  conn.pendingNameQueries.add(key);
  if (objectType === ObjectType.UNIT) {
    sendPacket(
      conn,
      GameOpcode.CMSG_CREATURE_QUERY,
      buildCreatureQuery(entry, guid),
    );
    return;
  }
  if (objectType === ObjectType.GAMEOBJECT) {
    sendPacket(
      conn,
      GameOpcode.CMSG_GAMEOBJECT_QUERY,
      buildGameObjectQuery(entry, guid),
    );
    return;
  }
}

export function handleCreatureQueryResponse(
  conn: WorldConn,
  r: PacketReader,
): void {
  const result = parseCreatureQueryResponse(r);
  conn.pendingNameQueries.delete(`${ObjectType.UNIT}:${result.entry}`);
  if (!result.name) return;
  conn.creatureNameCache.set(result.entry, result.name);
  for (const entity of conn.entityStore.all()) {
    if (entity.entry === result.entry && !entity.name) {
      conn.entityStore.setName(entity.guid, result.name);
    }
  }
}

export function handleGameObjectQueryResponse(
  conn: WorldConn,
  r: PacketReader,
): void {
  const result = parseGameObjectQueryResponse(r);
  conn.pendingNameQueries.delete(`${ObjectType.GAMEOBJECT}:${result.entry}`);
  if (!result.name) return;
  conn.gameObjectNameCache.set(result.entry, result.name);
  for (const entity of conn.entityStore.all()) {
    if (entity.entry === result.entry) {
      if (!entity.name) conn.entityStore.setName(entity.guid, result.name);
      if (result.gameObjectType !== undefined) {
        conn.entityStore.update(entity.guid, {
          gameObjectType: result.gameObjectType,
        });
      }
    }
  }
}

export function handlePartyMemberStatsMsg(
  conn: WorldConn,
  r: PacketReader,
  isFull = false,
): void {
  const stats = parsePartyMemberStats(r, isFull);
  conn.onGroupEvent?.({
    type: "member_stats",
    guidLow: stats.guidLow,
    online: stats.online,
    hp: stats.hp,
    maxHp: stats.maxHp,
    level: stats.level,
  });
}

export function handleContactList(conn: WorldConn, r: PacketReader): void {
  const list = parseContactList(r);
  const friends: FriendEntry[] = [];
  for (const contact of list.contacts) {
    if (!(contact.flags & SocialFlag.FRIEND)) continue;
    const guidLow = Number(contact.guid & 0xffffffffn);
    const name = conn.nameCache.get(guidLow) ?? "";
    friends.push({
      guid: contact.guid,
      name,
      note: contact.note,
      status: contact.status ?? 0,
      area: contact.area ?? 0,
      level: contact.level ?? 0,
      playerClass: contact.playerClass ?? 0,
    });
    if (!name) ensureNameQuery(conn, contact.guid);
  }
  conn.friendStore.set(friends);

  const ignored: IgnoreEntry[] = [];
  for (const contact of list.contacts) {
    if (!(contact.flags & SocialFlag.IGNORED)) continue;
    const guidLow = Number(contact.guid & 0xffffffffn);
    const name = conn.nameCache.get(guidLow) ?? "";
    ignored.push({ guid: contact.guid, name });
    if (!name) ensureNameQuery(conn, contact.guid);
  }
  conn.ignoreStore.set(ignored);
}

export function handleFriendStatus(conn: WorldConn, r: PacketReader): void {
  const packet = parseFriendStatus(r);
  const guidLow = Number(packet.guid & 0xffffffffn);

  switch (packet.result) {
    case FriendResult.ADDED_ONLINE:
    case FriendResult.ADDED_OFFLINE: {
      const name = conn.nameCache.get(guidLow) ?? "";
      conn.friendStore.add({
        guid: packet.guid,
        name,
        note: packet.note ?? "",
        status: packet.status ?? 0,
        area: packet.area ?? 0,
        level: packet.level ?? 0,
        playerClass: packet.playerClass ?? 0,
      });
      if (!name) ensureNameQuery(conn, packet.guid);
      break;
    }
    case FriendResult.ONLINE:
      conn.friendStore.update(packet.guid, {
        status: packet.status ?? FriendStatus.ONLINE,
        area: packet.area ?? 0,
        level: packet.level ?? 0,
        playerClass: packet.playerClass ?? 0,
      });
      break;
    case FriendResult.OFFLINE:
      conn.friendStore.update(packet.guid, { status: FriendStatus.OFFLINE });
      break;
    case FriendResult.REMOVED:
      conn.friendStore.remove(packet.guid);
      break;
    case FriendResult.IGNORE_ADDED: {
      const name = conn.nameCache.get(guidLow) ?? "";
      conn.ignoreStore.add({ guid: packet.guid, name });
      if (!name) ensureNameQuery(conn, packet.guid);
      break;
    }
    case FriendResult.IGNORE_REMOVED:
      conn.ignoreStore.remove(packet.guid);
      break;
    case FriendResult.IGNORE_FULL:
    case FriendResult.IGNORE_SELF:
    case FriendResult.IGNORE_NOT_FOUND:
    case FriendResult.IGNORE_ALREADY:
    case FriendResult.IGNORE_AMBIGUOUS: {
      const name = conn.nameCache.get(guidLow) ?? `guid:${guidLow}`;
      conn.onIgnoreEvent?.({
        type: "ignore-error",
        result: packet.result,
        name,
      });
      break;
    }
    default: {
      const name = conn.nameCache.get(guidLow) ?? `guid:${guidLow}`;
      conn.onFriendEvent?.({
        type: "friend-error",
        result: packet.result,
        name,
      });
      break;
    }
  }
}

export function handleGuildRoster(conn: WorldConn, r: PacketReader): void {
  const raw = parseGuildRoster(r);
  const members: GuildMember[] = raw.members.map((m) => ({ ...m }));
  conn.guildStore.setRoster(raw.motd, raw.guildInfo, members);
}

export function handleGuildQueryResponse(
  conn: WorldConn,
  r: PacketReader,
): void {
  const result = parseGuildQueryResponse(r);
  conn.guildStore.setGuildMeta(result.name, result.rankNames);
}

export function handleGuildEvent(conn: WorldConn, r: PacketReader): void {
  const raw = parseGuildEvent(r);
  const p = raw.params;
  switch (raw.eventType) {
    case GuildEventCode.PROMOTION:
      conn.onGuildEvent?.({
        type: "promotion",
        officer: p[0] ?? "",
        member: p[1] ?? "",
        rank: p[2] ?? "",
      });
      break;
    case GuildEventCode.DEMOTION:
      conn.onGuildEvent?.({
        type: "demotion",
        officer: p[0] ?? "",
        member: p[1] ?? "",
        rank: p[2] ?? "",
      });
      break;
    case GuildEventCode.MOTD:
      conn.onGuildEvent?.({ type: "motd", text: p[0] ?? "" });
      break;
    case GuildEventCode.JOINED:
      conn.onGuildEvent?.({ type: "joined", name: p[0] ?? "" });
      break;
    case GuildEventCode.LEFT:
      conn.onGuildEvent?.({ type: "left", name: p[0] ?? "" });
      break;
    case GuildEventCode.REMOVED:
      conn.onGuildEvent?.({
        type: "removed",
        member: p[0] ?? "",
        officer: p[1] ?? "",
      });
      break;
    case GuildEventCode.LEADER_IS:
      conn.onGuildEvent?.({ type: "leader_is", name: p[0] ?? "" });
      break;
    case GuildEventCode.LEADER_CHANGED:
      conn.onGuildEvent?.({
        type: "leader_changed",
        oldLeader: p[0] ?? "",
        newLeader: p[1] ?? "",
      });
      break;
    case GuildEventCode.DISBANDED:
      conn.onGuildEvent?.({ type: "disbanded" });
      break;
    case GuildEventCode.SIGNED_ON:
      conn.onGuildEvent?.({ type: "signed_on", name: p[0] ?? "" });
      break;
    case GuildEventCode.SIGNED_OFF:
      conn.onGuildEvent?.({ type: "signed_off", name: p[0] ?? "" });
      break;
  }
}

export function handleGuildCommandResult(
  conn: WorldConn,
  r: PacketReader,
): void {
  const packet = parseGuildCommandResult(r);
  if (packet.result !== GuildCommandResult.PLAYER_NO_MORE_IN_GUILD) {
    conn.onGuildEvent?.({
      type: "command_result",
      command: packet.command,
      name: packet.name,
      result: packet.result,
    });
  }
}

export function handleGuildInvitePacket(
  conn: WorldConn,
  r: PacketReader,
): void {
  const packet = parseGuildInvitePacket(r);
  conn.onGuildEvent?.({
    type: "guild_invite",
    inviter: packet.inviterName,
    guildName: packet.guildName,
  });
}

export function handleNearTeleport(conn: WorldConn, r: PacketReader): void {
  const guid = r.packedGuidBig();
  const info = parseMovementInfo(r);
  if (guid === selfGuid(conn)) {
    conn.control?.nearTeleport(info);
    return;
  }
  const position = {
    mapId: conn.control?.currentMapId() ?? 0,
    x: info.x,
    y: info.y,
    z: info.z,
    orientation: info.orientation,
  };
  conn.entityStore.setPosition(guid, position);
  conn.combat?.observePosition(guid, position);
}

export function handleTeleportAckRequest(
  conn: WorldConn,
  r: PacketReader,
): void {
  conn.control?.teleportAck(parseTeleportAck(r));
}

export function handleTransferPending(conn: WorldConn): void {
  conn.control?.handleTransferPending();
}

export function handleNewWorld(conn: WorldConn, r: PacketReader): void {
  conn.control?.newWorld(parseWorldPosition(r));
  conn.quests?.resetInteraction();
  conn.entityStore.clear();
  conn.quests?.observeQuestLog();
}

export function handleForceMoveRoot(conn: WorldConn, r: PacketReader): void {
  conn.control?.forceRoot(parseMoveCounter(r).counter);
}

export function handleForceMoveUnroot(conn: WorldConn, r: PacketReader): void {
  conn.control?.forceUnroot(parseMoveCounter(r).counter);
}

export function handleMoveKnockBack(conn: WorldConn, r: PacketReader): void {
  conn.control?.knockBack(parseKnockBack(r));
}

export function handleClientControlUpdate(
  conn: WorldConn,
  r: PacketReader,
): void {
  conn.control?.clientControl(parseClientControl(r));
}

export function handleForceSpeedChange(
  conn: WorldConn,
  r: PacketReader,
  spec: SpeedAck,
): void {
  conn.control?.forceSpeed(spec, parseForceSpeed(r, spec));
}

export function handleCanFly(
  conn: WorldConn,
  r: PacketReader,
  enable: boolean,
): void {
  conn.control?.setCanFly(parseMoveCounter(r).counter, enable);
}

export function registerMovementHandlers(conn: WorldConn): void {
  conn.dispatch.on(GameOpcode.SMSG_LOGIN_VERIFY_WORLD, (r) => {
    conn.control?.loginVerified(parseWorldPosition(r));
  });
  conn.dispatch.on(GameOpcode.MSG_MOVE_TELEPORT, (r) =>
    handleNearTeleport(conn, r),
  );
  conn.dispatch.on(GameOpcode.MSG_MOVE_TELEPORT_ACK, (r) =>
    handleTeleportAckRequest(conn, r),
  );
  conn.dispatch.on(GameOpcode.SMSG_TRANSFER_PENDING, () =>
    handleTransferPending(conn),
  );
  conn.dispatch.on(GameOpcode.SMSG_NEW_WORLD, (r) => handleNewWorld(conn, r));
  conn.dispatch.on(GameOpcode.SMSG_FORCE_MOVE_ROOT, (r) =>
    handleForceMoveRoot(conn, r),
  );
  conn.dispatch.on(GameOpcode.SMSG_FORCE_MOVE_UNROOT, (r) =>
    handleForceMoveUnroot(conn, r),
  );
  conn.dispatch.on(GameOpcode.SMSG_MOVE_KNOCK_BACK, (r) =>
    handleMoveKnockBack(conn, r),
  );
  conn.dispatch.on(GameOpcode.SMSG_CLIENT_CONTROL_UPDATE, (r) =>
    handleClientControlUpdate(conn, r),
  );
  conn.dispatch.on(GameOpcode.SMSG_MOVE_SET_CAN_FLY, (r) =>
    handleCanFly(conn, r, true),
  );
  conn.dispatch.on(GameOpcode.SMSG_MOVE_UNSET_CAN_FLY, (r) =>
    handleCanFly(conn, r, false),
  );
  for (const spec of SPEED_ACKS)
    conn.dispatch.on(spec.smsg, (r) => handleForceSpeedChange(conn, r, spec));
}

export function registerCombatHandlers(conn: WorldConn): void {
  const on = (opcode: number, handle: (r: PacketReader) => void) =>
    conn.dispatch.on(opcode, handle);
  on(GameOpcode.SMSG_INITIAL_SPELLS, (r) =>
    conn.combat?.applyInitialSpells(parseInitialSpells(r)),
  );
  on(GameOpcode.SMSG_LEARNED_SPELL, (r) =>
    conn.combat?.applyLearned(parseLearnedSpell(r)),
  );
  on(GameOpcode.SMSG_REMOVED_SPELL, (r) =>
    conn.combat?.applyRemoved(parseRemovedSpell(r)),
  );
  on(GameOpcode.SMSG_SUPERCEDED_SPELL, (r) =>
    conn.combat?.applySuperseded(parseSupersededSpell(r)),
  );
  on(GameOpcode.SMSG_SPELL_START, (r) =>
    conn.combat?.applySpellStart(parseSpellStart(r)),
  );
  on(GameOpcode.SMSG_SPELL_GO, (r) =>
    conn.combat?.applySpellGo(parseSpellGo(r)),
  );
  on(GameOpcode.SMSG_CAST_FAILED, (r) =>
    conn.combat?.applyCastFailed(parseCastFailed(r)),
  );
  on(GameOpcode.SMSG_SPELL_FAILURE, (r) =>
    conn.combat?.applySpellFailure(parseSpellFailure(r)),
  );
  on(GameOpcode.SMSG_SPELL_COOLDOWN, (r) =>
    conn.combat?.applyCooldown(parseSpellCooldown(r)),
  );
  on(GameOpcode.SMSG_CLEAR_COOLDOWN, (r) =>
    conn.combat?.applyClearCooldown(parseCooldownNotice(r)),
  );
  on(GameOpcode.SMSG_COOLDOWN_EVENT, (r) =>
    conn.combat?.applyCooldownEvent(parseCooldownNotice(r)),
  );
  on(GameOpcode.SMSG_SPELL_DELAYED, (r) =>
    conn.combat?.applySpellDelayed(parseSpellDelayed(r)),
  );
  on(GameOpcode.SMSG_CANCEL_COMBAT, () => conn.combat?.applyCancelCombat());
  for (const [opcode, error] of ATTACK_SWING_ERRORS)
    on(opcode, () => conn.combat?.applyAttackError(error));
  on(GameOpcode.SMSG_ATTACKSTART, (r) =>
    conn.combat?.applyAttackStart(parseAttackStart(r)),
  );
  on(GameOpcode.SMSG_ATTACKSTOP, (r) =>
    conn.combat?.applyAttackStop(parseAttackStop(r)),
  );
  on(GameOpcode.SMSG_AURA_UPDATE, (r) =>
    conn.combat?.applyAura(parseAuraUpdate(r)),
  );
  on(GameOpcode.SMSG_AURA_UPDATE_ALL, (r) =>
    conn.combat?.applyAuraAll(parseAuraUpdateAll(r)),
  );
  on(GameOpcode.SMSG_LOG_XPGAIN, (r) => conn.combat?.applyXp(parseXpGain(r)));
  on(GameOpcode.SMSG_MONSTER_MOVE, (r) =>
    conn.combat?.applyMonsterMove(
      parseMonsterMove(r),
      conn.control?.currentMapId() ?? 0,
    ),
  );
}

export function registerQuestHandlers(conn: WorldConn): void {
  const on = (opcode: number, handle: (r: PacketReader) => void) =>
    conn.dispatch.on(opcode, handle);
  const dialog = (opcode: number, read: (r: PacketReader) => QuestDialog) =>
    on(opcode, (r) => conn.quests?.openDialog(read(r)));
  dialog(GameOpcode.SMSG_GOSSIP_MESSAGE, (r) => ({
    kind: "gossip",
    data: parseGossipMessage(r),
  }));
  dialog(GameOpcode.SMSG_QUESTGIVER_QUEST_LIST, (r) => ({
    kind: "list",
    data: parseQuestgiverQuestList(r),
  }));
  dialog(GameOpcode.SMSG_QUESTGIVER_QUEST_DETAILS, (r) => ({
    kind: "details",
    data: parseQuestgiverQuestDetails(r),
  }));
  dialog(GameOpcode.SMSG_QUESTGIVER_REQUEST_ITEMS, (r) => ({
    kind: "requestItems",
    data: parseQuestgiverRequestItems(r),
  }));
  dialog(GameOpcode.SMSG_QUESTGIVER_OFFER_REWARD, (r) => ({
    kind: "offer",
    data: parseQuestgiverOfferReward(r),
  }));
  on(GameOpcode.SMSG_GOSSIP_COMPLETE, () => conn.quests?.closeDialog());
  on(GameOpcode.SMSG_QUEST_QUERY_RESPONSE, (r) =>
    conn.quests?.receiveQuery(parseQuestQueryResponse(r)),
  );
  on(GameOpcode.SMSG_QUESTGIVER_QUEST_COMPLETE, (r) =>
    conn.quests?.receiveReward(parseQuestgiverQuestComplete(r)),
  );
  on(GameOpcode.SMSG_QUESTGIVER_STATUS, (r) =>
    conn.quests?.receiveStatus(parseQuestgiverStatus(r)),
  );
  on(GameOpcode.SMSG_QUESTUPDATE_ADD_KILL, (r) =>
    conn.quests?.receiveProgress({
      kind: "kill",
      data: parseQuestUpdateAddKill(r),
    }),
  );
  on(GameOpcode.SMSG_QUESTUPDATE_ADD_ITEM, (r) =>
    conn.quests?.receiveProgress({
      kind: "item",
      data: parseQuestUpdateAddItem(r),
    }),
  );
  on(GameOpcode.SMSG_QUESTUPDATE_COMPLETE, (r) =>
    conn.quests?.receiveProgress({
      kind: "complete",
      ...parseQuestUpdateComplete(r),
    }),
  );
  on(GameOpcode.SMSG_QUESTGIVER_QUEST_INVALID, (r) =>
    conn.quests?.receiveError({ kind: "invalid", ...parseQuestInvalid(r) }),
  );
  on(GameOpcode.SMSG_QUESTGIVER_QUEST_FAILED, (r) =>
    conn.quests?.receiveError({ kind: "quest_failed", ...parseQuestFailed(r) }),
  );
  on(GameOpcode.SMSG_QUESTUPDATE_FAILED, (r) =>
    conn.quests?.receiveError({ kind: "failed", ...parseQuestUpdateFailed(r) }),
  );
  on(GameOpcode.SMSG_QUESTUPDATE_FAILEDTIMER, (r) =>
    conn.quests?.receiveError({
      kind: "timer_failed",
      ...parseQuestUpdateFailedTimer(r),
    }),
  );
  on(GameOpcode.SMSG_QUESTLOG_FULL, () =>
    conn.quests?.receiveError({ kind: "log_full" }),
  );
}
