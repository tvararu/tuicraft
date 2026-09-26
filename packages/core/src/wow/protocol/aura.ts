import type { PacketReader } from "#wow/protocol/packet";

export const AuraFlag = {
  NOT_CASTER: 0x08,
  DURATION: 0x20,
} as const;

export type AuraUpdate =
  | { unit: bigint; slot: number; removed: true }
  | {
      unit: bigint;
      slot: number;
      removed: false;
      spellId: number;
      flags: number;
      level: number;
      stacks: number;
      caster?: bigint;
      duration?: number;
      timeLeft?: number;
    };

export type AuraUpdateAll = { unit: bigint; auras: AuraUpdate[] };

export function parseAuraUpdate(r: PacketReader): AuraUpdate {
  return readAura(r, r.packedGuidBig());
}

export function parseAuraUpdateAll(r: PacketReader): AuraUpdateAll {
  const unit = r.packedGuidBig();
  const auras: AuraUpdate[] = [];
  while (r.remaining > 0) auras.push(readAura(r, unit));
  return { unit, auras };
}

function readAura(r: PacketReader, unit: bigint): AuraUpdate {
  const slot = r.uint8();
  const spellId = r.uint32LE();
  if (spellId === 0) return { unit, slot, removed: true };
  const flags = r.uint8();
  const level = r.uint8();
  const stacks = r.uint8();
  const caster = flags & AuraFlag.NOT_CASTER ? undefined : r.packedGuidBig();
  const timed = flags & AuraFlag.DURATION;
  const duration = timed ? r.uint32LE() : undefined;
  const timeLeft = timed ? r.uint32LE() : undefined;
  return {
    unit,
    slot,
    removed: false,
    spellId,
    flags,
    level,
    stacks,
    caster,
    duration,
    timeLeft,
  };
}
