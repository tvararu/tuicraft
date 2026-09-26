import type { CombatUnit } from "#wow/combat";
import type { Entity } from "#wow/entity-store";
import type { NavPoint } from "#wow/navigation";

export function observedTargetPosition(
  entity: Entity | undefined,
  unit: CombatUnit | undefined,
  selfMapId: number,
): NavPoint {
  if (!entity) throw new Error("target_not_observed");
  if (unit?.motion?.unsupportedReason)
    throw new Error(unit.motion.unsupportedReason);
  if (unit?.motion && !unit.pose) throw new Error("target_motion_unsupported");
  const position = unit?.pose ?? entity.position;
  if (
    !(position && [position.x, position.y, position.z].every(Number.isFinite))
  )
    throw new Error("target_not_observed");
  if (position.mapId !== selfMapId) throw new Error("target_map_changed");
  return { x: position.x, y: position.y, z: position.z };
}
