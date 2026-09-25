import type { WorldConn } from "wow/client";
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
import { ObjectType } from "wow/protocol/entity-fields";
import { ChatType, GameOpcode } from "wow/protocol/opcodes";
import type { PacketReader } from "wow/protocol/packet";
import { sendPacket } from "wow/world-handlers";

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
