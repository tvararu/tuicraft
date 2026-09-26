import type { ControlPose, ControlState } from "wow/control";
import type { Entity, Position } from "wow/entity-store";
import { bearing, distance2d, normalizeAngle } from "wow/geometry";
import type { RemotePose } from "wow/remote-motion";

export const NEARBY_DEFAULT_RANGE = 100;

export type NearbyOriginSource = ControlPose["source"] | "self_entity";

export type NearbyRow = {
  entity: Entity;
  position: Position | undefined;
  distance: number | null;
  horizontalDistance: number | null;
  bearingRadians: number | null;
  turnRadians: number | null;
  originSource: NearbyOriginSource | null;
  originUpdatedAt: number | null;
  self: boolean;
  remotePose: RemotePose | undefined;
  preparedAt: number;
};

export type NearbySources = {
  control: Pick<ControlState, "selfGuid" | "pose">;
  entities: readonly Entity[];
  remotePoses: readonly RemotePose[];
  now: number;
};

export type NearbyQuery = { all?: boolean };

type Origin = ControlPose | Position;

type Measurement = Pick<
  NearbyRow,
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

function compareNearby(a: NearbyRow, b: NearbyRow): number {
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

function withinDefaultRange(row: NearbyRow, mapId: number): boolean {
  if (row.self) return true;
  if (row.distance !== null) return row.distance <= NEARBY_DEFAULT_RANGE;
  return !row.entity.position || row.entity.position.mapId === mapId;
}

export function queryNearby(
  sources: NearbySources,
  query: NearbyQuery = {},
): NearbyRow[] {
  const { control, entities, now } = sources;
  const { selfGuid, pose } = control;
  const selfEntity = entities.find((e) => e.guid === selfGuid);
  const selfPos = pose ?? selfEntity?.position;
  const originSource = pose?.source ?? (selfPos ? "self_entity" : null);
  const originUpdatedAt = pose?.updatedAt ?? null;
  const poses = new Map(sources.remotePoses.map((p) => [p.guid, p]));

  const rows: NearbyRow[] = entities.map((entity) => {
    const isSelf = entity.guid === selfGuid;
    return {
      entity,
      position: isSelf ? selfPos : entity.position,
      ...measure(entity, isSelf, selfPos),
      originSource,
      originUpdatedAt,
      preparedAt: now,
      remotePose: poses.get(entity.guid),
      self: isSelf,
    };
  });

  rows.sort(compareNearby);
  if (query.all || !selfPos) return rows;
  return rows.filter((row) => withinDefaultRange(row, selfPos.mapId));
}
