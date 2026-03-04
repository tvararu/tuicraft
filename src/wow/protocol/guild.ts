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

export const GuildEventCode = {
  PROMOTION: 0,
  DEMOTION: 1,
  MOTD: 2,
  JOINED: 3,
  LEFT: 4,
  REMOVED: 5,
  LEADER_IS: 6,
  LEADER_CHANGED: 7,
  DISBANDED: 8,
  SIGNED_ON: 12,
  SIGNED_OFF: 13,
} as const;

const HAS_TRAILING_GUID = new Set<number>([
  GuildEventCode.JOINED,
  GuildEventCode.LEFT,
  GuildEventCode.SIGNED_ON,
  GuildEventCode.SIGNED_OFF,
]);

export type GuildEventRaw = {
  eventType: number;
  params: string[];
};

export function parseGuildEvent(r: PacketReader): GuildEventRaw {
  const eventType = r.uint8();
  const paramCount = r.uint8();
  const params: string[] = [];
  for (let i = 0; i < paramCount; i++) {
    params.push(r.cString());
  }
  if (HAS_TRAILING_GUID.has(eventType)) {
    r.uint64LE();
  }
  return { eventType, params };
}

export function buildGuildQuery(guildId: number): Uint8Array {
  const w = new PacketWriter();
  w.uint32LE(guildId);
  return w.finish();
}

export function buildGuildInvite(name: string): Uint8Array {
  const w = new PacketWriter();
  w.cString(name);
  return w.finish();
}

export function buildGuildRemove(name: string): Uint8Array {
  const w = new PacketWriter();
  w.cString(name);
  return w.finish();
}

export function buildGuildPromote(name: string): Uint8Array {
  const w = new PacketWriter();
  w.cString(name);
  return w.finish();
}

export function buildGuildDemote(name: string): Uint8Array {
  const w = new PacketWriter();
  w.cString(name);
  return w.finish();
}

export function buildGuildLeader(name: string): Uint8Array {
  const w = new PacketWriter();
  w.cString(name);
  return w.finish();
}

export function buildGuildMotd(motd: string): Uint8Array {
  const w = new PacketWriter();
  w.cString(motd);
  return w.finish();
}

export const GuildCommand = {
  CREATE: 0,
  INVITE: 1,
  QUIT: 2,
  PROMOTE: 3,
  FOUNDER: 0x0c,
  MEMBER: 0x0d,
  PUBLIC_NOTE_CHANGED: 0x13,
  OFFICER_NOTE_CHANGED: 0x14,
} as const;

export const GuildCommandResult = {
  PLAYER_NO_MORE_IN_GUILD: 0x00,
  GUILD_INTERNAL: 0x01,
  ALREADY_IN_GUILD: 0x02,
  ALREADY_IN_GUILD_S: 0x03,
  INVITED_TO_GUILD: 0x04,
  ALREADY_INVITED_TO_GUILD_S: 0x05,
  GUILD_NAME_INVALID: 0x06,
  GUILD_NAME_EXISTS_S: 0x07,
  GUILD_LEADER_LEAVE_OR_PERMISSIONS: 0x08,
  GUILD_PLAYER_NOT_IN_GUILD: 0x09,
  GUILD_PLAYER_NOT_IN_GUILD_S: 0x0a,
  GUILD_PLAYER_NOT_FOUND_S: 0x0b,
  GUILD_NOT_ALLIED: 0x0c,
  GUILD_RANK_TOO_HIGH_S: 0x0d,
  GUILD_RANK_TOO_LOW_S: 0x0e,
  GUILD_RANKS_LOCKED: 0x11,
  GUILD_RANK_IN_USE: 0x12,
  GUILD_IGNORING_YOU_S: 0x13,
} as const;

export type GuildCommandResultPacket = {
  command: number;
  name: string;
  result: number;
};

export function parseGuildCommandResult(
  r: PacketReader,
): GuildCommandResultPacket {
  return {
    command: r.uint32LE(),
    name: r.cString(),
    result: r.uint32LE(),
  };
}

export type GuildInvitePacket = {
  inviterName: string;
  guildName: string;
};

export function parseGuildInvitePacket(r: PacketReader): GuildInvitePacket {
  return {
    inviterName: r.cString(),
    guildName: r.cString(),
  };
}

export function formatGuildCommandError(
  _command: number,
  name: string,
  result: number,
): string | undefined {
  switch (result) {
    case GuildCommandResult.PLAYER_NO_MORE_IN_GUILD:
      return undefined;
    case GuildCommandResult.GUILD_INTERNAL:
      return "[guild] Internal guild error";
    case GuildCommandResult.ALREADY_IN_GUILD:
      return "[guild] You are already in a guild";
    case GuildCommandResult.ALREADY_IN_GUILD_S:
      return `[guild] ${name} is already in a guild`;
    case GuildCommandResult.INVITED_TO_GUILD:
      return "[guild] You have already been invited to a guild";
    case GuildCommandResult.ALREADY_INVITED_TO_GUILD_S:
      return `[guild] ${name} has already been invited to a guild`;
    case GuildCommandResult.GUILD_NAME_INVALID:
      return "[guild] Invalid guild name";
    case GuildCommandResult.GUILD_NAME_EXISTS_S:
      return `[guild] Guild name "${name}" already exists`;
    case GuildCommandResult.GUILD_LEADER_LEAVE_OR_PERMISSIONS:
      return "[guild] You don't have permission to do that";
    case GuildCommandResult.GUILD_PLAYER_NOT_IN_GUILD:
      return "[guild] You are not in a guild";
    case GuildCommandResult.GUILD_PLAYER_NOT_IN_GUILD_S:
      return `[guild] ${name} is not in your guild`;
    case GuildCommandResult.GUILD_PLAYER_NOT_FOUND_S:
      return `[guild] Player "${name}" not found`;
    case GuildCommandResult.GUILD_NOT_ALLIED:
      return `[guild] ${name} is not the same alliance as you`;
    case GuildCommandResult.GUILD_RANK_TOO_HIGH_S:
      return `[guild] ${name} has a rank too high for that`;
    case GuildCommandResult.GUILD_RANK_TOO_LOW_S:
      return `[guild] ${name} has a rank too low for that`;
    case GuildCommandResult.GUILD_RANKS_LOCKED:
      return "[guild] Guild ranks are locked";
    case GuildCommandResult.GUILD_RANK_IN_USE:
      return "[guild] That guild rank is in use";
    case GuildCommandResult.GUILD_IGNORING_YOU_S:
      return `[guild] ${name} is ignoring you`;
    default:
      return `[guild] Guild command error (${result})`;
  }
}
