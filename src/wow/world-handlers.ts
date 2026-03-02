import { inflateSync } from "node:zlib";
import { PacketReader, PacketWriter } from "wow/protocol/packet";
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
  parsePartyCommandResult,
  parseGroupInvite,
  parseGroupSetLeader,
  parseGroupDecline,
  parseGroupList,
  parsePartyMemberStats,
} from "wow/protocol/group";
import { parseUpdateObject } from "wow/protocol/update-object";
import { ObjectType } from "wow/protocol/entity-fields";
import {
  extractObjectFields,
  extractUnitFields,
  extractGameObjectFields,
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
import { parseGuildRoster, parseGuildQueryResponse } from "wow/protocol/guild";
import type { FriendEntry } from "wow/friend-store";
import type { IgnoreEntry } from "wow/ignore-store";
import type { GuildMember } from "wow/guild-store";
import type { WorldConn } from "wow/client";

function ensureNameQuery(conn: WorldConn, guid: bigint): void {
  const guidLow = Number(guid & 0xffffffffn);
  if (conn.pendingNameQueries.has(`player:${guidLow}`)) return;
  conn.pendingNameQueries.add(`player:${guidLow}`);
  sendPacket(
    conn,
    GameOpcode.CMSG_NAME_QUERY,
    buildNameQuery(guidLow, Number((guid >> 32n) & 0xffffffffn)),
  );
}

export function sendPacket(
  conn: WorldConn,
  opcode: number,
  body: Uint8Array = new Uint8Array(0),
): void {
  conn.socket.write(buildOutgoingPacket(opcode, body, conn.arc4));
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
  const entries = parseUpdateObject(r);
  for (const entry of entries) {
    switch (entry.type) {
      case "create": {
        const { _changed: _co, ...objFields } = extractObjectFields(
          entry.fields,
        );
        let extraFields: Record<string, unknown> = {};
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
        } as any);
        if (!cachedName) {
          queryEntityName(conn, entry.guid, entry.objectType, objFields.entry);
        }
        break;
      }
      case "values": {
        const entity = conn.entityStore.get(entry.guid);
        if (!entity) break;
        const objFields = extractObjectFields(entry.fields, entity.rawFields);
        let extraFields: Record<string, unknown> = {};
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
        conn.entityStore.update(entry.guid, merged);
        for (const [k, v] of entry.fields) {
          const existing = conn.entityStore.get(entry.guid);
          if (existing) existing.rawFields.set(k, v);
        }
        break;
      }
      case "movement": {
        conn.entityStore.setPosition(entry.guid, entry.position);
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
  const members: GuildMember[] = raw.members.map((m) => ({
    guid: m.guid,
    name: m.name,
    rankIndex: m.rankIndex,
    level: m.level,
    playerClass: m.playerClass,
    gender: m.gender,
    area: m.area,
    status: m.status,
    timeOffline: m.timeOffline,
    publicNote: m.publicNote,
    officerNote: m.officerNote,
  }));
  conn.guildStore.setRoster(raw.motd, raw.guildInfo, members);
}

export function handleGuildQueryResponse(
  conn: WorldConn,
  r: PacketReader,
): void {
  const result = parseGuildQueryResponse(r);
  const rankNames = result.rankNames.filter((n) => n.length > 0);
  conn.guildStore.setGuildMeta(result.name, rankNames);
}
