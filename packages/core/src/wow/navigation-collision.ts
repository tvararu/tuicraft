import {
  groundError,
  type NativeMap,
  type NativePoint,
} from "#wow/navigation-native";

export const GROUND_ERROR = 0.25;
export const MESH_HEIGHT = 1.6;
export const WALKABLE_CLIMB = 1;

type Ray = (from: NativePoint, to: NativePoint) => boolean;

export function collisionFree(
  ray: Ray,
  from: NativePoint,
  to: NativePoint,
  climb = 0,
): boolean {
  const lowFrom = { ...from, z: from.z + GROUND_ERROR };
  const lowTo = { ...to, z: to.z + GROUND_ERROR };
  const highFrom = { ...from, z: from.z + MESH_HEIGHT };
  const highTo = { ...to, z: to.z + MESH_HEIGHT };
  return (
    (ray(lowFrom, lowTo) || stepClear(ray, lowFrom, lowTo, climb)) &&
    ray(highFrom, highTo) &&
    ray(lowTo, highTo)
  );
}

function stepClear(
  ray: Ray,
  lowFrom: NativePoint,
  lowTo: NativePoint,
  climb: number,
): boolean {
  const rise = lowTo.z - lowFrom.z;
  if (rise === 0 || Math.abs(rise) > climb) return false;
  if (rise < 0) return ray(lowFrom, { ...lowTo, z: lowFrom.z });
  const riser = { ...lowFrom, z: lowTo.z };
  return ray(lowFrom, riser) && ray(riser, lowTo);
}

export function checkCollision(
  map: NativeMap,
  from: NativePoint,
  to: NativePoint,
  climb: number,
): void {
  const ray = (a: NativePoint, b: NativePoint) =>
    (a.x === b.x && a.y === b.y && a.z === b.z) || map.lineOfSight(a, b);
  if (!collisionFree(ray, from, to, climb))
    throw groundError("ground corridor collision");
}
