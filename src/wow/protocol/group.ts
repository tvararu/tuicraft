import { PacketReader, PacketWriter } from "wow/protocol/packet";
import { GroupUpdateFlag } from "wow/protocol/opcodes";

export function buildGroupInvite(name: string): Uint8Array {
  const w = new PacketWriter();
  w.cString(name);
  w.uint32LE(0);
  return w.finish();
}

export function buildGroupAccept(): Uint8Array {
  const w = new PacketWriter();
  w.uint32LE(0);
  return w.finish();
}

export function buildGroupDecline(): Uint8Array {
  return new Uint8Array(0);
}

export function buildGroupUninvite(name: string): Uint8Array {
  const w = new PacketWriter();
  w.cString(name);
  return w.finish();
}

export function buildGroupDisband(): Uint8Array {
  return new Uint8Array(0);
}

export function buildGroupSetLeader(
  guidLow: number,
  guidHigh: number,
): Uint8Array {
  const w = new PacketWriter();
  w.uint32LE(guidLow);
  w.uint32LE(guidHigh);
  return w.finish();
}

export type PartyCommandResult = {
  operation: number;
  member: string;
  result: number;
  val: number;
};

export function parsePartyCommandResult(r: PacketReader): PartyCommandResult {
  return {
    operation: r.uint32LE(),
    member: r.cString(),
    result: r.uint32LE(),
    val: r.uint32LE(),
  };
}

export type GroupInviteReceived = {
  status: number;
  name: string;
};

export function parseGroupInvite(r: PacketReader): GroupInviteReceived {
  const status = r.uint8();
  const name = r.cString();
  r.uint32LE();
  r.uint8();
  r.uint32LE();
  return { status, name };
}

export function parseGroupSetLeader(r: PacketReader): { name: string } {
  return { name: r.cString() };
}

export function parseGroupDecline(r: PacketReader): { name: string } {
  return { name: r.cString() };
}

export type GroupMember = {
  name: string;
  guidLow: number;
  guidHigh: number;
  online: boolean;
};

export type GroupList = {
  members: GroupMember[];
  leaderGuidLow: number;
  leaderGuidHigh: number;
};

export function parseGroupList(r: PacketReader): GroupList {
  r.uint8();
  r.uint8();
  r.uint8();
  r.uint8();
  r.uint32LE();
  r.uint32LE();
  r.uint32LE();
  const memberCount = r.uint32LE();
  const members: GroupMember[] = [];
  for (let i = 0; i < memberCount; i++) {
    const name = r.cString();
    const guidLow = r.uint32LE();
    const guidHigh = r.uint32LE();
    const online = r.uint8() !== 0;
    r.uint8();
    r.uint8();
    r.uint8();
    members.push({ name, guidLow, guidHigh, online });
  }
  const leaderGuidLow = r.uint32LE();
  const leaderGuidHigh = r.uint32LE();
  return { members, leaderGuidLow, leaderGuidHigh };
}

export type PartyMemberStats = {
  guidLow: number;
  guidHigh: number;
  online?: boolean;
  hp?: number;
  maxHp?: number;
  level?: number;
};

function skipAuras(r: PacketReader): void {
  const lo = r.uint32LE();
  const hi = r.uint32LE();
  for (let i = 0; i < 32; i++) {
    if (lo & (1 << i)) {
      r.uint32LE();
      r.uint8();
    }
  }
  for (let i = 0; i < 32; i++) {
    if (hi & (1 << i)) {
      r.uint32LE();
      r.uint8();
    }
  }
}

export function parsePartyMemberStats(
  r: PacketReader,
  isFull = false,
): PartyMemberStats {
  if (isFull) r.uint8();
  const { low: guidLow, high: guidHigh } = r.packedGuid();
  const mask = r.uint32LE();
  const result: PartyMemberStats = { guidLow, guidHigh };

  if (mask & GroupUpdateFlag.STATUS) {
    const status = r.uint16LE();
    result.online = (status & 0x01) !== 0;
  }
  if (mask & GroupUpdateFlag.CUR_HP) result.hp = r.uint32LE();
  if (mask & GroupUpdateFlag.MAX_HP) result.maxHp = r.uint32LE();
  if (mask & GroupUpdateFlag.POWER_TYPE) r.uint8();
  if (mask & GroupUpdateFlag.CUR_POWER) r.uint16LE();
  if (mask & GroupUpdateFlag.MAX_POWER) r.uint16LE();
  if (mask & GroupUpdateFlag.LEVEL) result.level = r.uint16LE();
  if (mask & GroupUpdateFlag.ZONE) r.uint16LE();
  if (mask & GroupUpdateFlag.POSITION) {
    r.uint16LE();
    r.uint16LE();
  }
  if (mask & GroupUpdateFlag.AURAS) skipAuras(r);
  if (mask & GroupUpdateFlag.PET_GUID) {
    r.uint32LE();
    r.uint32LE();
  }
  if (mask & GroupUpdateFlag.PET_NAME) r.cString();
  if (mask & GroupUpdateFlag.PET_MODEL_ID) r.uint16LE();
  if (mask & GroupUpdateFlag.PET_CUR_HP) r.uint32LE();
  if (mask & GroupUpdateFlag.PET_MAX_HP) r.uint32LE();
  if (mask & GroupUpdateFlag.PET_POWER_TYPE) r.uint8();
  if (mask & GroupUpdateFlag.PET_CUR_POWER) r.uint16LE();
  if (mask & GroupUpdateFlag.PET_MAX_POWER) r.uint16LE();
  if (mask & GroupUpdateFlag.PET_AURAS) skipAuras(r);
  if (mask & GroupUpdateFlag.VEHICLE_SEAT) r.uint32LE();

  return result;
}
