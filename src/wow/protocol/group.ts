import { PacketReader, PacketWriter } from "wow/protocol/packet";

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
