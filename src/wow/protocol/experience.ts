import type { PacketReader } from "wow/protocol/packet";

const POWER_TYPES = 7;
const STATS = 5;

export type LevelUpInfo = {
  level: number;
  healthDelta: number;
  powerDeltas: number[];
  statDeltas: number[];
};

export function parseLevelUpInfo(r: PacketReader): LevelUpInfo {
  const level = r.uint32LE();
  const healthDelta = r.uint32LE();
  const powerDeltas = Array.from({ length: POWER_TYPES }, () => r.uint32LE());
  const statDeltas = Array.from({ length: STATS }, () => r.uint32LE());
  return { level, healthDelta, powerDeltas, statDeltas };
}
