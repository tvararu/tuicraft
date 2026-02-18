import { PacketWriter } from "wow/protocol/packet";

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
