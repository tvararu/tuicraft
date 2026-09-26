import { type Entity, type EntityLookup, fieldOf } from "wow/entity-store";
import {
  ObjectType,
  PLAYER_FIELDS,
  UNIT_FIELDS,
} from "wow/protocol/entity-fields";

export type PlayerLife = "unknown" | "alive" | "dead" | "ghost";
export type PlayerLifeState = {
  life: PlayerLife;
  health: number | undefined;
  flags: number | undefined;
};

const SELF_RANGES = [
  PLAYER_FIELDS.INV_SLOT_HEAD,
  PLAYER_FIELDS.PACK_SLOT_1,
  PLAYER_FIELDS.KEYRING_SLOT_1,
  PLAYER_FIELDS.CURRENCYTOKEN_SLOT_1,
];

export function readSelfField(
  selfGuid: bigint,
  entity: Entity | undefined,
  offset: number,
): number | undefined {
  if (
    !selfGuid ||
    entity?.guid !== selfGuid ||
    entity.objectType !== ObjectType.PLAYER
  )
    return undefined;
  const visible =
    offset === UNIT_FIELDS.HEALTH.offset ||
    offset === PLAYER_FIELDS.FLAGS.offset ||
    offset === PLAYER_FIELDS.COINAGE.offset ||
    offset === PLAYER_FIELDS.XP.offset ||
    offset === PLAYER_FIELDS.NEXT_LEVEL_XP.offset ||
    offset === UNIT_FIELDS.LEVEL.offset ||
    SELF_RANGES.some(
      (range) => offset >= range.offset && offset < range.offset + range.size,
    );
  if (!visible) return undefined;
  return fieldOf(entity, offset);
}

export function readLife(
  selfGuid: bigint,
  getEntity: EntityLookup,
): PlayerLifeState {
  const entity = getEntity(selfGuid);
  const health = readSelfField(selfGuid, entity, UNIT_FIELDS.HEALTH.offset);
  const flags = readSelfField(selfGuid, entity, PLAYER_FIELDS.FLAGS.offset);
  if (flags === undefined) return { life: "unknown", health, flags };
  if (flags & 0x10) return { life: "ghost", health, flags };
  if (health === undefined) return { life: "unknown", health, flags };
  return { life: health > 0 ? "alive" : "dead", health, flags };
}
