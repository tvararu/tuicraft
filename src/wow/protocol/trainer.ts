import { type PacketReader, PacketWriter } from "wow/protocol/packet";

export type TrainerOfferedSpell = {
  spellId: number;
  usable: number;
  cost: number;
  talentPointCost: number;
  firstRank: number;
  requiredLevel: number;
  requiredSkill: number;
  requiredSkillValue: number;
  requiredSpells: number[];
};

export type TrainerList = {
  guid: bigint;
  trainerType: number;
  spells: TrainerOfferedSpell[];
  greeting: string;
};

export type TrainerBuyResult = { guid: bigint; spellId: number };
export type TrainerBuyFailure = TrainerBuyResult & { reason: number };

const FAIL_REASONS: Record<number, string> = {
  0: "unavailable",
  1: "not_enough_money",
  2: "not_enough_skill",
};

export function trainerFailureName(reason: number): string {
  return FAIL_REASONS[reason] ?? `trainer_failure_${reason}`;
}

export function buildTrainerList(guid: bigint): Uint8Array {
  const w = new PacketWriter();
  w.uint64LE(guid);
  return w.finish();
}

export function buildTrainerBuySpell(
  guid: bigint,
  spellId: number,
): Uint8Array {
  const w = new PacketWriter();
  w.uint64LE(guid);
  w.uint32LE(spellId);
  return w.finish();
}

function readSpell(r: PacketReader): TrainerOfferedSpell {
  return {
    spellId: r.uint32LE(),
    usable: r.uint8(),
    cost: r.uint32LE(),
    talentPointCost: r.uint32LE(),
    firstRank: r.uint32LE(),
    requiredLevel: r.uint8(),
    requiredSkill: r.uint32LE(),
    requiredSkillValue: r.uint32LE(),
    requiredSpells: [r.uint32LE(), r.uint32LE(), r.uint32LE()],
  };
}

export function parseTrainerList(r: PacketReader): TrainerList {
  const guid = r.uint64LE();
  const trainerType = r.uint32LE();
  const count = r.uint32LE();
  const spells: TrainerOfferedSpell[] = [];
  for (let i = 0; i < count; i++) spells.push(readSpell(r));
  return { guid, trainerType, spells, greeting: r.cString() };
}

export function parseTrainerBuySucceeded(r: PacketReader): TrainerBuyResult {
  return { guid: r.uint64LE(), spellId: r.uint32LE() };
}

export function parseTrainerBuyFailed(r: PacketReader): TrainerBuyFailure {
  return { guid: r.uint64LE(), spellId: r.uint32LE(), reason: r.uint32LE() };
}
