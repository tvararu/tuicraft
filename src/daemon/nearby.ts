import { formatGuid } from "ui/format";
import {
  type GameObjectEntity,
  type NearbyRow,
  ObjectType,
  type RemotePose,
  type UnitEntity,
} from "wow";

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

function formatPosition({ position, positionKind }: NearbyRow): string {
  if (!position) return "";
  const predicted = positionKind === "predicted" ? " (predicted)" : "";
  return ` at ${position.x.toFixed(2)}, ${position.y.toFixed(2)}, ${position.z.toFixed(2)}${predicted}`;
}

function formatSpatial(p: NearbyRow): string {
  const distance =
    p.distance === null ? "distance=unknown" : `${p.distance.toFixed(2)} yd`;
  const xy =
    p.horizontalDistance === null
      ? "xy=unknown"
      : `xy=${p.horizontalDistance.toFixed(2)} yd`;
  const face =
    p.bearingRadians === null ? "unknown" : p.bearingRadians.toFixed(4);
  const turn = p.turnRadians === null ? "unknown" : p.turnRadians.toFixed(4);
  return ` [${distance} ${xy} face=${face} turn=${turn} origin=${p.originSource ?? "unknown"}]`;
}

export function formatNearbyLine(p: NearbyRow): string {
  const entity = p.entity;
  const guid = formatGuid(entity.guid);
  const spatial = formatSpatial(p);
  if (
    entity.objectType === ObjectType.UNIT ||
    entity.objectType === ObjectType.PLAYER
  ) {
    const unit = entity as UnitEntity;
    const name = entity.name ?? "Unknown";
    const kind = objectTypeName(entity.objectType);
    const level = unit.level > 0 ? `, level ${unit.level}` : "";
    const hp = `HP ${unit.health}/${unit.maxHealth}`;
    const pos = formatPosition(p);
    return `${name} (${kind}${level}) ${hp}${pos} ${guid}${spatial}`;
  }
  if (entity.objectType === ObjectType.GAMEOBJECT) {
    const name = entity.name ?? "Unknown";
    const pos = formatPosition(p);
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

function formatRemotePose(
  pose: RemotePose,
  now: number,
): Record<string, unknown> {
  const { position } = pose;
  return {
    ageMs: now - pose.receivedAt,
    extraFlags: pose.extraFlags ?? null,
    flags: pose.flags ?? null,
    invalid: pose.invalid ?? null,
    mapId: position.mapId,
    motion: pose.motion ?? null,
    moverTime: pose.moverTime ?? null,
    orientation: position.orientation,
    receivedAt: pose.receivedAt,
    source: pose.source,
    x: position.x,
    y: position.y,
    z: position.z,
  };
}

function formatRowPosition(p: NearbyRow): Record<string, unknown> {
  const { position, positionObservedAt } = p;
  if (!position) return {};
  return {
    mapId: position.mapId,
    orientation: position.orientation,
    positionAgeMs:
      positionObservedAt === null ? null : p.preparedAt - positionObservedAt,
    positionKind: p.positionKind,
    positionObservedAt,
    positionSource: p.positionSource,
    x: position.x,
    y: position.y,
    z: position.z,
  };
}

export function formatNearbyObj(p: NearbyRow): Record<string, unknown> {
  const {
    entity,
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
  Object.assign(obj, formatRowPosition(p));
  if (p.remotePose)
    obj["remotePose"] = formatRemotePose(p.remotePose, p.preparedAt);
  return obj;
}
