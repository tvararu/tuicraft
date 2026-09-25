import { formatGuid } from "ui/format";
import type { WorldHandle } from "wow/client";
import type { Entity, GameObjectEntity, UnitEntity } from "wow/entity-store";
import { bearing, distance2d, normalizeAngle } from "wow/geometry";
import { ObjectType } from "wow/protocol/entity-fields";

function objectTypeName(type: ObjectType): string {
  switch (type) {
    case ObjectType.UNIT:
      return "NPC";
    case ObjectType.PLAYER:
      return "Player";
    default:
      return `type ${type}`;
  }
}

export function formatNearbyLine(p: PreparedNearbyEntity): string {
  const entity = p.entity;
  const guid = formatGuid(entity.guid);
  const distance =
    p.distance === null ? "distance=unknown" : `${p.distance.toFixed(2)} yd`;
  const xy =
    p.horizontalDistance === null
      ? "xy=unknown"
      : `xy=${p.horizontalDistance.toFixed(2)} yd`;
  const face =
    p.bearingRadians === null ? "unknown" : p.bearingRadians.toFixed(4);
  const turn = p.turnRadians === null ? "unknown" : p.turnRadians.toFixed(4);
  const spatial = ` [${distance} ${xy} face=${face} turn=${turn} origin=${p.originSource ?? "unknown"}]`;
  if (
    entity.objectType === ObjectType.UNIT ||
    entity.objectType === ObjectType.PLAYER
  ) {
    const unit = entity as UnitEntity;
    const name = entity.name ?? "Unknown";
    const kind = objectTypeName(entity.objectType);
    const level = unit.level > 0 ? `, level ${unit.level}` : "";
    const hp = `HP ${unit.health}/${unit.maxHealth}`;
    const pos = p.position
      ? ` at ${p.position.x.toFixed(2)}, ${p.position.y.toFixed(2)}, ${p.position.z.toFixed(2)}`
      : "";
    return `${name} (${kind}${level}) ${hp}${pos} ${guid}${spatial}`;
  }
  if (entity.objectType === ObjectType.GAMEOBJECT) {
    const name = entity.name ?? "Unknown";
    const pos = p.position
      ? ` at ${p.position.x.toFixed(2)}, ${p.position.y.toFixed(2)}, ${p.position.z.toFixed(2)}`
      : "";
    return `${name} (GameObject)${pos} ${guid}${spatial}`;
  }
  return `Entity ${guid} (${objectTypeName(entity.objectType)})${spatial}`;
}

function objectTypeString(type: ObjectType): string {
  switch (type) {
    case ObjectType.UNIT:
      return "unit";
    case ObjectType.PLAYER:
      return "player";
    case ObjectType.GAMEOBJECT:
      return "gameobject";
    default:
      return "object";
  }
}

const NEARBY_DEFAULT_RANGE = 100;

type PreparedNearbyEntity = {
  entity: Entity;
  position: Entity["position"];
  distance: number | null;
  horizontalDistance: number | null;
  bearingRadians: number | null;
  turnRadians: number | null;
  originSource: "predicted" | "server" | "self_entity" | null;
  originUpdatedAt: number | null;
  self: boolean;
};

export function prepareNearbyEntities(
  handle: WorldHandle,
  all = false,
): PreparedNearbyEntity[] {
  const controlState = handle.getControlState();
  const selfGuid = controlState.selfGuid;
  const entities = handle.getNearbyEntities();
  const selfEntity = entities.find((e) => e.guid === selfGuid);
  const selfPose = controlState.pose;
  const selfPos = selfPose ?? selfEntity?.position;
  const originSource = selfPose?.source ?? (selfPos ? "self_entity" : null);
  const originUpdatedAt = selfPose?.updatedAt ?? null;

  const prepared: PreparedNearbyEntity[] = entities.map((entity) => {
    const isSelf = entity.guid === selfGuid;
    let distance: number | null = null;
    let horizontalDistance: number | null = null;
    let bearingRadians: number | null = null;
    let turnRadians: number | null = null;
    if (isSelf) {
      distance = 0;
      if (selfPos) horizontalDistance = 0;
    } else if (
      selfPos &&
      entity.position &&
      selfPos.mapId === entity.position.mapId
    ) {
      horizontalDistance = distance2d(entity.position, selfPos);
      distance = Math.hypot(horizontalDistance, entity.position.z - selfPos.z);
      if (horizontalDistance > 0) {
        const angle = bearing(selfPos, entity.position);
        bearingRadians = angle < 0 ? angle + Math.PI * 2 : angle;
        const turn = bearingRadians - selfPos.orientation;
        turnRadians = normalizeAngle(turn + Math.PI) - Math.PI;
      }
    }
    return {
      bearingRadians,
      distance,
      entity,
      horizontalDistance,
      originSource,
      originUpdatedAt,
      position: isSelf ? selfPos : entity.position,
      self: isSelf,
      turnRadians,
    };
  });

  prepared.sort((a, b) => {
    if (a.self && !b.self) return -1;
    if (!a.self && b.self) return 1;
    if (a.distance !== null && b.distance !== null) {
      if (a.distance !== b.distance) return a.distance - b.distance;
      return a.entity.guid < b.entity.guid
        ? -1
        : a.entity.guid > b.entity.guid
          ? 1
          : 0;
    }
    if (a.distance !== null && b.distance === null) return -1;
    if (a.distance === null && b.distance !== null) return 1;
    return a.entity.guid < b.entity.guid
      ? -1
      : a.entity.guid > b.entity.guid
        ? 1
        : 0;
  });

  if (!all && selfPos) {
    return prepared.filter((p) => {
      if (p.self) return true;
      if (p.distance !== null) return p.distance <= NEARBY_DEFAULT_RANGE;
      if (p.entity.position && p.entity.position.mapId !== selfPos.mapId)
        return false;
      return true;
    });
  }

  return prepared;
}

export function formatNearbyObj(
  p: PreparedNearbyEntity,
): Record<string, unknown> {
  const {
    entity,
    position,
    self,
    distance,
    horizontalDistance,
    bearingRadians,
    turnRadians,
    originSource,
    originUpdatedAt,
  } = p;
  const obj: Record<string, unknown> = {
    bearingRadians,
    distance: distance === null ? null : Math.round(distance * 100) / 100,
    entry: entity.entry,
    guid: formatGuid(entity.guid),
    horizontalDistance:
      horizontalDistance === null
        ? null
        : Math.round(horizontalDistance * 100) / 100,
    name: entity.name,
    originSource,
    originUpdatedAt,
    self,
    turnRadians,
    type: objectTypeString(entity.objectType),
  };
  if (
    entity.objectType === ObjectType.UNIT ||
    entity.objectType === ObjectType.PLAYER
  ) {
    const unit = entity as UnitEntity;
    obj["level"] = unit.level;
    obj["health"] = unit.health;
    obj["maxHealth"] = unit.maxHealth;
    obj["target"] = formatGuid(unit.target);
    obj["unitFlags"] = unit.unitFlags;
    obj["npcFlags"] = unit.npcFlags;
    obj["factionTemplate"] = unit.factionTemplate;
  }
  if (entity.objectType === ObjectType.GAMEOBJECT) {
    obj["gameObjectType"] = (entity as GameObjectEntity).gameObjectType;
  }
  if (position) {
    obj["x"] = position.x;
    obj["y"] = position.y;
    obj["z"] = position.z;
    obj["mapId"] = position.mapId;
    obj["orientation"] = position.orientation;
  }
  return obj;
}
