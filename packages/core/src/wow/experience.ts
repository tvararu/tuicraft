import type { CombatState } from "#wow/combat";
import type { EntityLookup } from "#wow/entity-store";
import { readSelfField } from "#wow/player-state";
import { PLAYER_FIELDS, UNIT_FIELDS } from "#wow/protocol/entity-fields";

export type ExperienceState = {
  level: number | undefined;
  xp: number | undefined;
  nextLevelXp: number | undefined;
  lastXp: CombatState["lastXp"];
  lastLevelUp: CombatState["lastLevelUp"];
};

export function readExperience(
  selfGuid: bigint,
  getEntity: EntityLookup,
  combat: Pick<CombatState, "lastXp" | "lastLevelUp">,
): ExperienceState {
  const self = getEntity(selfGuid);
  const field = (offset: number) => readSelfField(selfGuid, self, offset);
  return {
    level: field(UNIT_FIELDS.LEVEL.offset),
    xp: field(PLAYER_FIELDS.XP.offset),
    nextLevelXp: field(PLAYER_FIELDS.NEXT_LEVEL_XP.offset),
    lastXp: combat.lastXp,
    lastLevelUp: combat.lastLevelUp,
  };
}
