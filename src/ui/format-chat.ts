import type { LogEntry } from "lib/session-log";
import { stripColorCodes } from "lib/strip-colors";
import { type ChatMessage, ChatType } from "wow";

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
  [ChatType.ROLL]: "roll",
  [ChatType.MONSTER_SAY]: "monster say",
  [ChatType.MONSTER_PARTY]: "monster party",
  [ChatType.MONSTER_YELL]: "monster yell",
  [ChatType.MONSTER_WHISPER]: "monster whisper",
  [ChatType.RAID_BOSS_WHISPER]: "boss whisper",
};

const MONSTER_EMOTES: readonly number[] = [
  ChatType.MONSTER_EMOTE,
  ChatType.RAID_BOSS_EMOTE,
];

function chatText(msg: ChatMessage): string {
  const message = stripColorCodes(msg.message);
  return MONSTER_EMOTES.includes(msg.type)
    ? message.replaceAll("%s", msg.sender)
    : message;
}

export function formatMessage(msg: ChatMessage): string {
  const message = chatText(msg);
  const label = CHAT_TYPE_LABELS[msg.type] ?? `type ${msg.type}`;

  if (msg.type === ChatType.WHISPER) {
    return `[whisper from ${msg.sender}] ${message}`;
  }
  if (msg.type === ChatType.WHISPER_INFORM) {
    return `[whisper to ${msg.sender}] ${message}`;
  }
  if (
    msg.type === ChatType.SYSTEM &&
    (msg.origin === "server" || msg.origin === "notification")
  ) {
    return `[server] ${message}`;
  }
  if (msg.type === ChatType.SYSTEM && msg.origin === "mail") {
    return `[mail] ${message}`;
  }
  if (msg.type === ChatType.SYSTEM) {
    return `[system] ${message}`;
  }
  if (msg.type === ChatType.ROLL) {
    return `[roll] ${msg.sender} ${message}`;
  }
  if (msg.type === ChatType.MONSTER_EMOTE) return `[monster emote] ${message}`;
  if (msg.type === ChatType.RAID_BOSS_EMOTE) return `[boss emote] ${message}`;
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
  [ChatType.ROLL]: "ROLL",
  [ChatType.MONSTER_SAY]: "MONSTER_SAY",
  [ChatType.MONSTER_PARTY]: "MONSTER_PARTY",
  [ChatType.MONSTER_YELL]: "MONSTER_YELL",
  [ChatType.MONSTER_WHISPER]: "MONSTER_WHISPER",
  [ChatType.MONSTER_EMOTE]: "MONSTER_EMOTE",
  [ChatType.RAID_BOSS_EMOTE]: "RAID_BOSS_EMOTE",
  [ChatType.RAID_BOSS_WHISPER]: "RAID_BOSS_WHISPER",
};

function messageObjType(msg: ChatMessage): string {
  if (msg.origin === "server") return "SERVER_BROADCAST";
  if (msg.origin === "notification") return "NOTIFICATION";
  if (msg.origin === "mail") return "MAIL";
  return JSON_TYPE_LABELS[msg.type] ?? `TYPE_${msg.type}`;
}

export function formatMessageObj(msg: ChatMessage): LogEntry {
  const obj: LogEntry = {
    message: chatText(msg),
    sender: msg.sender,
    type: messageObjType(msg),
  };
  if (msg.channel) obj.channel = msg.channel;
  return obj;
}

export function formatMessageJson(msg: ChatMessage): string {
  return JSON.stringify(formatMessageObj(msg));
}
