import { inflateSync } from "node:zlib";
import type { WorldConn } from "wow/client";
import type { FriendEntry } from "wow/friend-store";
import type { GuildMember } from "wow/guild-store";
import type { IgnoreEntry } from "wow/ignore-store";
import {
  buildNameQuery,
  parseChannelNotify,
  parseChatMessage,
  parseNameQueryResponse,
  parseNotification,
  parseRandomRoll,
  parseServerBroadcast,
  type ChatMessage as RawChatMessage,
} from "wow/protocol/chat";
import {
  parseDuelComplete,
  parseDuelCountdown,
  parseDuelRequested,
  parseDuelWinner,
} from "wow/protocol/duel";
import { ObjectType, UpdateFlag } from "wow/protocol/entity-fields";
import {
  buildCreatureQuery,
  buildGameObjectQuery,
  parseCreatureQueryResponse,
  parseGameObjectQueryResponse,
} from "wow/protocol/entity-queries";
import {
  extractGameObjectFields,
  extractObjectFields,
  extractUnitFields,
  type GameObjectFieldsResult,
  type UnitFieldsResult,
} from "wow/protocol/extract-fields";
import {
  parseGroupDecline,
  parseGroupInvite,
  parseGroupList,
  parseGroupSetLeader,
  parsePartyCommandResult,
  parsePartyMemberStats,
} from "wow/protocol/group";
import {
  GuildCommandResult,
  GuildEventCode,
  parseGuildCommandResult,
  parseGuildEvent,
  parseGuildInvitePacket,
  parseGuildQueryResponse,
  parseGuildRoster,
} from "wow/protocol/guild";
import { ChatType, GameOpcode } from "wow/protocol/opcodes";
import {
  joinGuid,
  PacketReader,
  PacketWriter,
  splitGuid,
} from "wow/protocol/packet";
import {
  type ContactEntry,
  FriendResult,
  FriendStatus,
  type FriendStatusPacket,
  parseContactList,
  parseFriendStatus,
  SocialFlag,
} from "wow/protocol/social";
import {
  parseUpdateObject,
  type UpdateEntry,
} from "wow/protocol/update-object";
import { buildOutgoingPacket } from "wow/protocol/world";

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
  if (!conn.socket) throw new Error("World socket is not connected");
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
  if (result.found && result.name)
    backfillName(conn, result.guidLow, result.name);

  const pending = conn.pendingMessages.get(result.guidLow);
  if (!pending) return;
  for (const raw of pending) deliverMessage(conn, raw, name);
  conn.pendingMessages.delete(result.guidLow);
}

function backfillName(conn: WorldConn, guidLow: number, name: string): void {
  conn.nameCache.set(guidLow, name);
  for (const entity of conn.entityStore.all()) {
    if (
      entity.objectType === ObjectType.PLAYER &&
      Number(entity.guid & 0xffffffffn) === guidLow &&
      !entity.name
    ) {
      conn.entityStore.setName(entity.guid, name);
    }
  }
  for (const friend of conn.friendStore.all()) {
    if (Number(friend.guid & 0xffffffffn) === guidLow && !friend.name) {
      conn.friendStore.setName(friend.guid, name);
    }
  }
  for (const entry of conn.ignoreStore.all()) {
    if (Number(entry.guid & 0xffffffffn) === guidLow && !entry.name) {
      conn.ignoreStore.setName(entry.guid, name);
    }
  }
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

type TypeFields = Partial<UnitFieldsResult> & Partial<GameObjectFieldsResult>;
type Entry<T extends UpdateEntry["type"]> = Extract<UpdateEntry, { type: T }>;

export function handleUpdateObject(conn: WorldConn, r: PacketReader): void {
  const entries = parseUpdateObject(r, conn.control?.currentMapId() ?? 0);
  for (const entry of entries) applyEntry(conn, entry);
  conn.quests?.observeQuestLog();
}

function applyEntry(conn: WorldConn, entry: UpdateEntry): void {
  switch (entry.type) {
    case "create":
      applyCreate(conn, entry);
      return;
    case "values":
      applyValues(conn, entry);
      return;
    case "movement":
      applyMovement(conn, entry);
      return;
    case "outOfRange":
      for (const guid of entry.guids) conn.entityStore.destroy(guid);
      return;
    case "nearObjects":
      return;
    default: {
      const unhandled: never = entry;
      throw new Error("unhandled update entry type", { cause: unhandled });
    }
  }
}

function typeFields(
  objectType: ObjectType,
  fields: Map<number, number>,
  previous?: Map<number, number>,
): TypeFields {
  if (objectType === ObjectType.UNIT || objectType === ObjectType.PLAYER)
    return extractUnitFields(fields, previous);
  if (objectType === ObjectType.GAMEOBJECT)
    return extractGameObjectFields(fields);
  return {};
}

function applyCreate(conn: WorldConn, entry: Entry<"create">): void {
  const { guid, objectType, fields, position } = entry;
  const { _changed: _o, ...object } = extractObjectFields(fields);
  const { _changed: _t, ...extra } = typeFields(objectType, fields);
  const name = lookupCachedName(conn, guid, objectType, object.entry);
  conn.entityStore.create(guid, objectType, {
    ...object,
    ...extra,
    ...(name ? { name } : {}),
    ...(position ? { position } : {}),
    rawFields: new Map(fields),
    createComplete: true,
  });
  const self = selfGuid(conn);
  const created = guid === self ? conn.entityStore.get(self) : undefined;
  if (created) conn.quests?.observeSelfCreate(created);
  if (position) conn.combat?.observePosition(guid, position, entry.spline);
  if (!name) queryEntityName(conn, guid, objectType, object.entry);
  if (guid !== self && (entry.updateFlags & UpdateFlag.SELF) === 0) return;
  conn.control?.observeSelf({
    position,
    movementFlags: entry.movementFlags,
    runSpeed: entry.runSpeed,
    runBackSpeed: entry.runBackSpeed,
    target: extra.target,
    unitFlags: extra.unitFlags,
  });
}

function applyValues(conn: WorldConn, entry: Entry<"values">): void {
  const entity = conn.entityStore.get(entry.guid);
  if (!entity) return;
  const object = extractObjectFields(entry.fields, entity.rawFields);
  const extra = typeFields(entity.objectType, entry.fields, entity.rawFields);
  const changed = new Set([...object._changed, ...(extra._changed ?? [])]);
  const merged = Object.fromEntries(
    Object.entries({ ...object, ...extra }).filter(([key]) => changed.has(key)),
  );
  for (const [k, v] of entry.fields) entity.rawFields.set(k, v);
  conn.entityStore.update(entry.guid, {
    ...merged,
    rawFields: entity.rawFields,
  });
  if (entry.guid === selfGuid(conn))
    conn.control?.observeSelf({
      target: extra.target,
      unitFlags: extra.unitFlags,
    });
}

function applyMovement(conn: WorldConn, entry: Entry<"movement">): void {
  conn.entityStore.setPosition(entry.guid, entry.position);
  conn.combat?.observePosition(entry.guid, entry.position, entry.spline);
  if (entry.guid !== selfGuid(conn)) return;
  conn.control?.observeSelf({
    position: entry.position,
    movementFlags: entry.movementFlags,
    runSpeed: entry.runSpeed,
    runBackSpeed: entry.runBackSpeed,
  });
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
  conn.friendStore.set(collectFriends(conn, list.contacts));
  conn.ignoreStore.set(collectIgnored(conn, list.contacts));
}

function collectFriends(
  conn: WorldConn,
  contacts: readonly ContactEntry[],
): FriendEntry[] {
  const friends: FriendEntry[] = [];
  for (const contact of contacts) {
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
  return friends;
}

function collectIgnored(
  conn: WorldConn,
  contacts: readonly ContactEntry[],
): IgnoreEntry[] {
  const ignored: IgnoreEntry[] = [];
  for (const contact of contacts) {
    if (!(contact.flags & SocialFlag.IGNORED)) continue;
    const guidLow = Number(contact.guid & 0xffffffffn);
    const name = conn.nameCache.get(guidLow) ?? "";
    ignored.push({ guid: contact.guid, name });
    if (!name) ensureNameQuery(conn, contact.guid);
  }
  return ignored;
}

export function handleFriendStatus(conn: WorldConn, r: PacketReader): void {
  const packet = parseFriendStatus(r);
  const guidLow = Number(packet.guid & 0xffffffffn);

  switch (packet.result) {
    case FriendResult.ADDED_ONLINE:
    case FriendResult.ADDED_OFFLINE:
      addFriend(conn, packet, guidLow);
      break;
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
    case FriendResult.IGNORE_AMBIGUOUS:
      conn.onIgnoreEvent?.({
        type: "ignore-error",
        result: packet.result,
        name: conn.nameCache.get(guidLow) ?? `guid:${guidLow}`,
      });
      break;
    default:
      conn.onFriendEvent?.({
        type: "friend-error",
        result: packet.result,
        name: conn.nameCache.get(guidLow) ?? `guid:${guidLow}`,
      });
      break;
  }
}

function addFriend(
  conn: WorldConn,
  packet: FriendStatusPacket,
  guidLow: number,
): void {
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
  const param = (index: number): string => raw.params[index] ?? "";
  switch (raw.eventType) {
    case GuildEventCode.PROMOTION:
      conn.onGuildEvent?.({
        type: "promotion",
        officer: param(0),
        member: param(1),
        rank: param(2),
      });
      break;
    case GuildEventCode.DEMOTION:
      conn.onGuildEvent?.({
        type: "demotion",
        officer: param(0),
        member: param(1),
        rank: param(2),
      });
      break;
    case GuildEventCode.REMOVED:
      conn.onGuildEvent?.({
        type: "removed",
        member: param(0),
        officer: param(1),
      });
      break;
    case GuildEventCode.LEADER_CHANGED:
      conn.onGuildEvent?.({
        type: "leader_changed",
        oldLeader: param(0),
        newLeader: param(1),
      });
      break;
    default:
      emitGuildNotice(conn, raw.eventType, param);
      break;
  }
}

function emitGuildNotice(
  conn: WorldConn,
  eventType: number,
  param: (index: number) => string,
): void {
  switch (eventType) {
    case GuildEventCode.MOTD:
      conn.onGuildEvent?.({ type: "motd", text: param(0) });
      break;
    case GuildEventCode.JOINED:
      conn.onGuildEvent?.({ type: "joined", name: param(0) });
      break;
    case GuildEventCode.LEFT:
      conn.onGuildEvent?.({ type: "left", name: param(0) });
      break;
    case GuildEventCode.LEADER_IS:
      conn.onGuildEvent?.({ type: "leader_is", name: param(0) });
      break;
    case GuildEventCode.DISBANDED:
      conn.onGuildEvent?.({ type: "disbanded" });
      break;
    case GuildEventCode.SIGNED_ON:
      conn.onGuildEvent?.({ type: "signed_on", name: param(0) });
      break;
    case GuildEventCode.SIGNED_OFF:
      conn.onGuildEvent?.({ type: "signed_off", name: param(0) });
      break;
    default:
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
