import type { FriendEntry } from "wow/friend-store";
import type { IgnoreEntry } from "wow/ignore-store";
import { buildNameQuery } from "wow/protocol/chat";
import { GameOpcode } from "wow/protocol/opcodes";
import { type PacketReader, splitGuid } from "wow/protocol/packet";
import {
  type ContactEntry,
  FriendResult,
  FriendStatus,
  type FriendStatusPacket,
  parseContactList,
  parseFriendStatus,
  SocialFlag,
} from "wow/protocol/social";
import type { WorldConn } from "wow/world-conn";
import { sendPacket } from "wow/world-handlers";

function ensureNameQuery(conn: WorldConn, guid: bigint): void {
  const { low, high } = splitGuid(guid);
  if (conn.pendingNameQueries.has(`player:${low}`)) return;
  conn.pendingNameQueries.add(`player:${low}`);
  sendPacket(conn, GameOpcode.CMSG_NAME_QUERY, buildNameQuery(low, high));
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
      conn.events.ignore.emit({
        type: "ignore-error",
        result: packet.result,
        name: conn.nameCache.get(guidLow) ?? `guid:${guidLow}`,
      });
      break;
    default:
      conn.events.friend.emit({
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
