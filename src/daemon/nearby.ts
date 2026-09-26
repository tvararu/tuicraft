import { formatGuid } from "ui/format";
import type { WorldHandle } from "wow/client";
import type { ControlPose } from "wow/control";
import type {
  Entity,
  GameObjectEntity,
  Position,
  UnitEntity,
} from "wow/entity-store";
import { bearing, distance2d, normalizeAngle } from "wow/geometry";
import { ObjectType } from "wow/protocol/entity-fields";
import type { RemotePose } from "wow/remote-motion";

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

function formatPosition(position: Entity["position"]): string {
  return position
    ? ` at ${position.x.toFixed(2)}, ${position.y.toFixed(2)}, ${position.z.toFixed(2)}`
    : "";
}

function formatSpatial(p: PreparedNearbyEntity): string {
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

export function formatNearbyLine(p: PreparedNearbyEntity): string {
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
    const pos = formatPosition(p.position);
    return `${name} (${kind}${level}) ${hp}${pos} ${guid}${spatial}`;
  }
  if (entity.objectType === ObjectType.GAMEOBJECT) {
    const name = entity.name ?? "Unknown";
    const pos = formatPosition(p.position);
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
  remotePose: RemotePose | undefined;
  preparedAt: number;
};

type Origin = ControlPose | Position;

type Measurement = Pick<
  PreparedNearbyEntity,
  "distance" | "horizontalDistance" | "bearingRadians" | "turnRadians"
>;

function measure(
  entity: Entity,
  isSelf: boolean,
  selfPos: Origin | undefined,
): Measurement {
  const measurement: Measurement = {
    bearingRadians: null,
    distance: null,
    horizontalDistance: null,
    turnRadians: null,
  };
  if (isSelf) {
    measurement.distance = 0;
    if (selfPos) measurement.horizontalDistance = 0;
    return measurement;
  }
  if (!(selfPos && entity.position && selfPos.mapId === entity.position.mapId))
    return measurement;
  const horizontalDistance = distance2d(entity.position, selfPos);
  measurement.horizontalDistance = horizontalDistance;
  measurement.distance = Math.hypot(
    horizontalDistance,
    entity.position.z - selfPos.z,
  );
  if (horizontalDistance > 0) {
    const angle = bearing(selfPos, entity.position);
    const bearingRadians = angle < 0 ? angle + Math.PI * 2 : angle;
    measurement.bearingRadians = bearingRadians;
    const turn = bearingRadians - selfPos.orientation;
    measurement.turnRadians = normalizeAngle(turn + Math.PI) - Math.PI;
  }
  return measurement;
}

function compareGuid(a: Entity, b: Entity): number {
  if (a.guid < b.guid) return -1;
  if (a.guid > b.guid) return 1;
  return 0;
}

function compareNearby(a: PreparedNearbyEntity, b: PreparedNearbyEntity) {
  if (a.self && !b.self) return -1;
  if (!a.self && b.self) return 1;
  if (a.distance !== null && b.distance !== null) {
    if (a.distance !== b.distance) return a.distance - b.distance;
    return compareGuid(a.entity, b.entity);
  }
  if (a.distance !== null) return -1;
  if (b.distance !== null) return 1;
  return compareGuid(a.entity, b.entity);
}

function withinDefaultRange(p: PreparedNearbyEntity, mapId: number): boolean {
  if (p.self) return true;
  if (p.distance !== null) return p.distance <= NEARBY_DEFAULT_RANGE;
  return !p.entity.position || p.entity.position.mapId === mapId;
}

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
  const poses = new Map(handle.getRemotePoses().map((p) => [p.guid, p]));
  const preparedAt = Date.now();

  const prepared: PreparedNearbyEntity[] = entities.map((entity) => {
    const isSelf = entity.guid === selfGuid;
    const { bearingRadians, distance, horizontalDistance, turnRadians } =
      measure(entity, isSelf, selfPos);
    return {
      bearingRadians,
      distance,
      entity,
      horizontalDistance,
      originSource,
      originUpdatedAt,
      position: isSelf ? selfPos : entity.position,
      preparedAt,
      remotePose: poses.get(entity.guid),
      self: isSelf,
      turnRadians,
    };
  });

  prepared.sort(compareNearby);

  if (!all && selfPos) {
    return prepared.filter((p) => withinDefaultRange(p, selfPos.mapId));
  }

  return prepared;
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
  if (p.remotePose)
    obj["remotePose"] = formatRemotePose(p.remotePose, p.preparedAt);
  return obj;
}
