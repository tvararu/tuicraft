import type { CombatRuntime } from "wow/combat";
import type { ControlRuntime } from "wow/control";
import { type EntityLookup, isUnit } from "wow/entity-store";
import { UnitFlag } from "wow/protocol/entity-fields";
import type { TacticsDefense } from "wow/tactics";

type DefenseDeps = {
  combat: Pick<
    CombatRuntime,
    "snapshot" | "isAttackingSelf" | "attack" | "halt"
  >;
  control: Pick<ControlRuntime, "setMode" | "halt">;
  entity: EntityLookup;
};

export function defendTarget(
  deps: DefenseDeps,
  targetGuid: bigint,
): TacticsDefense {
  deps.control.setMode("none");
  deps.control.halt();
  const state = deps.combat.snapshot(targetGuid);
  const selfGuid = state.self.guid;
  const target = deps.entity(targetGuid);
  const threatening =
    (state.target?.health ?? 0) > 0 &&
    isUnit(target) &&
    (deps.combat.isAttackingSelf(targetGuid) ||
      (target.target === selfGuid &&
        (target.unitFlags & UnitFlag.IN_COMBAT) !== 0));
  if (threatening) {
    const swinging = state.attacking && state.attackTarget === targetGuid;
    if (!swinging && state.pendingAttack !== targetGuid)
      deps.combat.attack(targetGuid);
    return "auto_attack";
  }
  deps.combat.halt();
  const self = deps.entity(selfGuid);
  return isUnit(self) && (self.unitFlags & UnitFlag.IN_COMBAT) !== 0
    ? "uncontrolled_in_combat"
    : "none";
}
