import { PacketReader, PacketWriter } from "wow/protocol/packet";

export const GuildMemberStatus = {
  OFFLINE: 0,
  ONLINE: 1,
} as const;

export type GuildMemberRaw = {
  guid: bigint;
  status: number;
  name: string;
  rankIndex: number;
  level: number;
  playerClass: number;
  gender: number;
  area: number;
  timeOffline: number;
  publicNote: string;
  officerNote: string;
};

export type GuildRosterRaw = {
  memberCount: number;
  motd: string;
  guildInfo: string;
  rankCount: number;
  members: GuildMemberRaw[];
};

export type GuildQueryResult = {
  guildId: number;
  name: string;
  rankNames: string[];
};

export function parseGuildRoster(r: PacketReader): GuildRosterRaw {
  const memberCount = r.uint32LE();
  const motd = r.cString();
  const guildInfo = r.cString();
  const rankCount = r.uint32LE();
  for (let i = 0; i < rankCount; i++) {
    r.skip(4);
    r.skip(4);
    for (let j = 0; j < 6; j++) {
      r.skip(4);
      r.skip(4);
    }
  }
  const members: GuildMemberRaw[] = [];
  for (let i = 0; i < memberCount; i++) {
    const guid = r.uint64LE();
    const status = r.uint8();
    const name = r.cString();
    const rankIndex = r.uint32LE();
    const level = r.uint8();
    const playerClass = r.uint8();
    const gender = r.uint8();
    const area = r.uint32LE();
    let timeOffline = 0;
    if (status === GuildMemberStatus.OFFLINE) {
      timeOffline = r.floatLE();
    }
    const publicNote = r.cString();
    const officerNote = r.cString();
    members.push({
      guid,
      status,
      name,
      rankIndex,
      level,
      playerClass,
      gender,
      area,
      timeOffline,
      publicNote,
      officerNote,
    });
  }
  return { memberCount, motd, guildInfo, rankCount, members };
}

export function parseGuildQueryResponse(r: PacketReader): GuildQueryResult {
  const guildId = r.uint32LE();
  const name = r.cString();
  const rankNames: string[] = [];
  for (let i = 0; i < 10; i++) {
    rankNames.push(r.cString());
  }
  return { guildId, name, rankNames };
}

export function buildGuildQuery(guildId: number): Uint8Array {
  const w = new PacketWriter();
  w.uint32LE(guildId);
  return w.finish();
}
