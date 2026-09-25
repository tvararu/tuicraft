import type { CombatDeps, CombatUnit } from "wow/combat";
import { type Entity, fieldOf, isUnit } from "wow/entity-store";
import type { CombatPose, MotionStore } from "wow/motion-store";
import { UNIT_FIELDS } from "wow/protocol/entity-fields";

type UnitSources = { deps: CombatDeps; motions: MotionStore };

export function combatUnitOf(
  { deps, motions }: UnitSources,
  guid: bigint,
  pose: CombatPose | undefined,
  entity: Entity | undefined,
): CombatUnit {
  const unit = isUnit(entity) ? entity : undefined;
  const bytes = fieldOf(unit, UNIT_FIELDS.BYTES_0.offset);
  const powerType = bytes === undefined ? undefined : bytes >>> 24;
  const formBytes = fieldOf(unit, UNIT_FIELDS.BYTES_2.offset);
  return {
    guid,
    name: entity?.name,
    health: fieldOf(unit, UNIT_FIELDS.HEALTH.offset),
    maxHealth: fieldOf(unit, UNIT_FIELDS.MAXHEALTH.offset),
    power:
      powerType === undefined || powerType > 6
        ? undefined
        : fieldOf(unit, UNIT_FIELDS.POWER1.offset + powerType),
    maxPower:
      powerType === undefined || powerType > 6
        ? undefined
        : fieldOf(unit, UNIT_FIELDS.MAXPOWER1.offset + powerType),
    powerType,
    baseMana: fieldOf(unit, UNIT_FIELDS.BASE_MANA.offset),
    shapeshiftForm: formBytes === undefined ? undefined : formBytes >>> 24,
    level: fieldOf(unit, UNIT_FIELDS.LEVEL.offset),
    pose,
    motion: motions.motion(guid),
    serverPose: serverPoseOf({ deps, motions }, guid, pose),
  };
}

function serverPoseOf(
  { deps, motions }: UnitSources,
  guid: bigint,
  pose: CombatPose | undefined,
): CombatPose | undefined {
  if (guid === deps.selfGuid()) {
    const self = deps.selfServerPose?.();
    if (self) return { ...self };
    return pose?.source === "server" ? { ...pose } : undefined;
  }
  return motions.serverPose(guid);
}
