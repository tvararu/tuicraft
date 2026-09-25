import { GameOpcode } from "wow/protocol/opcodes";
import { type PacketReader, PacketWriter } from "wow/protocol/packet";

export const ATTACK_SWING_ERRORS = [
  [GameOpcode.SMSG_ATTACKSWING_NOTINRANGE, "not_in_range"],
  [GameOpcode.SMSG_ATTACKSWING_BADFACING, "bad_facing"],
  [GameOpcode.SMSG_ATTACKSWING_DEADTARGET, "dead_target"],
  [GameOpcode.SMSG_ATTACKSWING_CANT_ATTACK, "cant_attack"],
] as const;

export type AttackSwingError = (typeof ATTACK_SWING_ERRORS)[number][1];

export type AttackStart = { attacker: bigint; victim: bigint };
export type AttackStop = { attacker: bigint; victim: bigint; dead: number };

export type XpGain = {
  victim: bigint;
  total: number;
  kind: "kill" | "other";
  original?: number;
  groupRate?: number;
  recruitAFriend: boolean;
};

export function buildAttackSwing(guid: bigint): Uint8Array {
  const w = new PacketWriter();
  w.uint64LE(guid);
  return w.finish();
}

export function parseAttackStart(r: PacketReader): AttackStart {
  return { attacker: r.uint64LE(), victim: r.uint64LE() };
}

export function parseAttackStop(r: PacketReader): AttackStop {
  return {
    attacker: r.packedGuidBig(),
    victim: r.packedGuidBig(),
    dead: r.uint32LE(),
  };
}

export function parseXpGain(r: PacketReader): XpGain {
  const victim = r.uint64LE();
  const total = r.uint32LE();
  const kind = r.uint8() === 0 ? "kill" : "other";
  const original = kind === "kill" ? r.uint32LE() : undefined;
  const groupRate = kind === "kill" ? r.floatLE() : undefined;
  const recruitAFriend = r.uint8() !== 0;
  return { victim, total, kind, original, groupRate, recruitAFriend };
}
