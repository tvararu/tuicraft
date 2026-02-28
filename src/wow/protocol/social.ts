import { PacketReader, PacketWriter } from "wow/protocol/packet";

export const SocialFlag = {
  FRIEND: 0x01,
  IGNORED: 0x02,
  MUTED: 0x04,
} as const;

export const FriendStatus = {
  OFFLINE: 0,
  ONLINE: 1,
  AFK: 2,
  DND: 4,
} as const;

export const FriendResult = {
  DB_ERROR: 0x00,
  LIST_FULL: 0x01,
  ONLINE: 0x02,
  OFFLINE: 0x03,
  NOT_FOUND: 0x04,
  REMOVED: 0x05,
  ADDED_ONLINE: 0x06,
  ADDED_OFFLINE: 0x07,
  ALREADY: 0x08,
  SELF: 0x09,
  ENEMY: 0x0a,
} as const;

export function buildAddFriend(name: string, note: string): Uint8Array {
  const w = new PacketWriter();
  w.cString(name);
  w.cString(note);
  return w.finish();
}

export function buildDelFriend(guid: bigint): Uint8Array {
  const w = new PacketWriter();
  w.uint64LE(guid);
  return w.finish();
}

export type ContactEntry = {
  guid: bigint;
  flags: number;
  note: string;
  status?: number;
  area?: number;
  level?: number;
  playerClass?: number;
};

export type ContactList = {
  listMask: number;
  contacts: ContactEntry[];
};

export type FriendStatusPacket = {
  result: number;
  guid: bigint;
  note?: string;
  status?: number;
  area?: number;
  level?: number;
  playerClass?: number;
};

export function parseContactList(r: PacketReader): ContactList {
  const listMask = r.uint32LE();
  const count = r.uint32LE();
  const contacts: ContactEntry[] = [];
  for (let i = 0; i < count; i++) {
    const guid = r.uint64LE();
    const flags = r.uint32LE();
    const note = r.cString();
    const entry: ContactEntry = { guid, flags, note };
    if (flags & SocialFlag.FRIEND) {
      entry.status = r.uint8();
      if (entry.status !== 0) {
        entry.area = r.uint32LE();
        entry.level = r.uint32LE();
        entry.playerClass = r.uint32LE();
      }
    }
    contacts.push(entry);
  }
  return { listMask, contacts };
}

export function parseFriendStatus(r: PacketReader): FriendStatusPacket {
  const result = r.uint8();
  const guid = r.uint64LE();
  const packet: FriendStatusPacket = { result, guid };
  if (
    result === FriendResult.ADDED_ONLINE ||
    result === FriendResult.ADDED_OFFLINE
  ) {
    packet.note = r.cString();
  }
  if (result === FriendResult.ADDED_ONLINE || result === FriendResult.ONLINE) {
    packet.status = r.uint8();
    packet.area = r.uint32LE();
    packet.level = r.uint32LE();
    packet.playerClass = r.uint32LE();
  }
  return packet;
}
