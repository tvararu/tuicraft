import { bearing, distance2d } from "wow/geometry";
import {
  groundError,
  isGroundError,
  openNativeMap,
  validateNativePoint,
  validateNativeXY,
  type NativeMap,
} from "wow/navigation-native";

export type NavPoint = { x: number; y: number; z: number };
export type GroundSample = NavPoint & { orientation: number };
export type NavigationOptions = { dataPath: string; libraryPath: string };
export type Navigation = {
  plan(mapId: number, from: NavPoint, to: NavPoint): GroundRoute;
  planGround(
    mapId: number,
    from: NavPoint,
    to: { x: number; y: number },
  ): GroundRoute;
  height(mapId: number, x: number, y: number, from?: NavPoint): number;
  clear(mapId: number, from: NavPoint, to: NavPoint): boolean;
  close(): void;
};

const EXPANSION01 = 530;
const ADT_STEP = 64;
const GROUND_STEP = 0.5;
const GROUND_ERROR = 0.25;
const FLOOR_MERGE = 0.01;
const MESH_HEIGHT = 1.6;

export class GroundRoute {
  readonly points: readonly NavPoint[];
  readonly length: number;
  private readonly map: NativeMap;
  private readonly distances: number[];

  constructor(points: readonly NavPoint[], map: NativeMap) {
    if (points.length === 0) throw new Error("ground route has no points");
    this.map = map;
    this.points = Object.freeze(
      groundPath(map, points).map((point) => Object.freeze(point)),
    );
    this.distances = [0];
    let length = 0;
    for (let i = 1; i < this.points.length; i++) {
      length += distance2d(this.points[i - 1]!, this.points[i]!);
      this.distances.push(length);
    }
    this.length = length;
  }

  sample(distance: number): GroundSample {
    if (!Number.isFinite(distance)) throw new Error("invalid route distance");
    const travel = Math.min(this.length, Math.max(0, distance));
    const index = this.segment(travel);
    const start = this.points[index]!;
    const end = this.points[index + 1] ?? start;
    const span = distance2d(start, end);
    const ratio =
      span === 0
        ? 0
        : Math.min(1, Math.max(0, (travel - this.distances[index]!) / span));
    const x = start.x + (end.x - start.x) * ratio;
    const y = start.y + (end.y - start.y) * ratio;
    const point = groundPoint(this.map, start, x, y);
    if (travel === 0) Object.assign(point, this.points[0]);
    return {
      ...point,
      orientation: bearing(start, end),
    };
  }

  private segment(distance: number): number {
    let low = 0;
    let high = this.points.length - 1;
    while (low + 1 < high) {
      const mid = (low + high) >>> 1;
      if (this.distances[mid]! < distance) low = mid;
      else high = mid;
    }
    return low;
  }
}

export function createNavigation(
  options: NavigationOptions,
  openMap = openNativeMap,
): Navigation {
  const { dataPath, libraryPath } = options;
  if (dataPath.length === 0) throw new Error("navigation dataPath is required");
  if (libraryPath.length === 0)
    throw new Error("navigation libraryPath is required");
  let map: NativeMap | undefined;
  let closed = false;
  function requireMap(mapId: number): void {
    if (closed) throw new Error("navigation is closed");
    if (mapId !== EXPANSION01)
      throw new Error(
        `unsupported map ${mapId} (only Expansion01/${EXPANSION01})`,
      );
  }
  return {
    plan(mapId, from, to) {
      requireMap(mapId);
      validateNativePoint(from);
      validateNativePoint(to);
      map ??= openMap(dataPath, libraryPath, "Expansion01");
      return planRoute(map, from, to);
    },
    planGround(mapId, from, to) {
      requireMap(mapId);
      validateNativePoint(from);
      validateNativeXY(to.x, to.y);
      map ??= openMap(dataPath, libraryPath, "Expansion01");
      map.loadAdtAt(from.x, from.y);
      checkGround(map, from);
      map.loadAdtAt(to.x, to.y);
      const destination = {
        x: to.x,
        y: to.y,
        z: uniqueHeight(map, to.x, to.y),
      };
      return planRoute(map, from, destination);
    },
    height(mapId, x, y, from) {
      requireMap(mapId);
      validateNativeXY(x, y);
      map ??= openMap(dataPath, libraryPath, "Expansion01");
      if (from) {
        validateNativePoint(from);
        map.loadAdtAt(from.x, from.y);
      }
      map.loadAdtAt(x, y);
      if (from) {
        try {
          const h = map.findHeight(from, x, y);
          if (Number.isFinite(h)) return h;
        } catch {}
        const continuous = continuousHeight(map, x, y, from.z);
        if (continuous !== undefined) return continuous;
      }
      return uniqueHeight(map, x, y);
    },
    clear(mapId, from, to) {
      requireMap(mapId);
      validateNativePoint(from);
      validateNativePoint(to);
      map ??= openMap(dataPath, libraryPath, "Expansion01");
      map.loadAdtAt(to.x, to.y);
      return map.lineOfSight(from, to);
    },
    close() {
      closed = true;
      map?.close();
      map = undefined;
    },
  };
}

function planRoute(map: NativeMap, from: NavPoint, to: NavPoint): GroundRoute {
  loadCorridor(map, from, to);
  checkGround(map, from);
  checkGround(map, to);
  const points = map.findPath(from, to);
  if (points.length === 0) throw new Error("native path is empty");
  for (const point of points) validateNativePoint(point);
  rejectSnap("start", from, points[0]!);
  rejectSnap("end", to, points[points.length - 1]!);
  if (points.length === 1 && distance2d(from, to) > 0)
    throw new Error("native path omits destination");
  try {
    return new GroundRoute([from, to], map);
  } catch (error) {
    if (!isGroundError(error)) throw error;
  }
  const corridor = points.map((point) => ({ ...point }));
  corridor[0] = { ...from };
  if (corridor.length > 1) corridor[corridor.length - 1] = { ...to };
  return new GroundRoute(corridor, map);
}

function groundPath(map: NativeMap, corners: readonly NavPoint[]): NavPoint[] {
  const first = corners[0]!;
  validateNativePoint(first);
  map.loadAdtAt(first.x, first.y);
  checkGround(map, first);
  const initial = groundPoint(map, first, first.x, first.y);
  if (Math.abs(initial.z - first.z) > GROUND_ERROR)
    throw groundError("start is not on connected ground");
  const points = [{ ...first }];
  for (let i = 1; i < corners.length; i++) {
    const from = corners[i - 1]!;
    const to = corners[i]!;
    validateNativePoint(to);
    const span = distance2d(from, to);
    if (span === 0 && Math.abs(to.z - from.z) > GROUND_ERROR)
      throw groundError("unsupported vertical ground route");
    const count = Math.ceil(span / GROUND_STEP);
    for (let step = 1; step <= count; step++) {
      const ratio = step / count;
      const point = groundPoint(
        map,
        points[points.length - 1]!,
        from.x + (to.x - from.x) * ratio,
        from.y + (to.y - from.y) * ratio,
      );
      points.push(point);
    }
    if (Math.abs(points[points.length - 1]!.z - to.z) > GROUND_ERROR)
      throw groundError("path corner disagrees with connected ground");
  }
  return points;
}

function groundPoint(
  map: NativeMap,
  from: NavPoint,
  x: number,
  y: number,
): NavPoint {
  map.loadAdtAt(x, y);
  const point = { x, y, z: map.findHeight(from, x, y) };
  checkGround(map, point);
  const back = map.findHeight(point, from.x, from.y);
  if (!Number.isFinite(back) || Math.abs(back - from.z) > GROUND_ERROR)
    throw groundError("ground corridor changes surface");
  checkCollision(map, from, point);
  return point;
}

function checkGround(map: NativeMap, point: NavPoint): void {
  validateNativePoint(point);
  const heights = groundHeights(map, point.x, point.y);
  if (heights.some((height) => Math.abs(height - point.z) > GROUND_ERROR))
    throw groundError("position disagrees with ground height");
}

function uniqueHeight(map: NativeMap, x: number, y: number): number {
  return groundHeights(map, x, y)[0]!;
}

function continuousHeight(
  map: NativeMap,
  x: number,
  y: number,
  referenceZ: number,
): number | undefined {
  const matches = map
    .findHeights(x, y)
    .filter(
      (height) =>
        Number.isFinite(height) &&
        Math.abs(height - referenceZ) <= GROUND_ERROR,
    );
  return matches.length === 1 ? matches[0]! : undefined;
}

function groundHeights(map: NativeMap, x: number, y: number): number[] {
  const heights = map.findHeights(x, y);
  const first = heights[0];
  if (first === undefined || !heights.every(Number.isFinite))
    throw groundError("ground height unavailable");
  if (heights.some((height) => Math.abs(height - first) > FLOOR_MERGE))
    throw groundError("ambiguous ground column");
  return heights;
}

function checkCollision(map: NativeMap, from: NavPoint, to: NavPoint): void {
  const lowFrom = { ...from, z: from.z + GROUND_ERROR };
  const lowTo = { ...to, z: to.z + GROUND_ERROR };
  const highFrom = { ...from, z: from.z + MESH_HEIGHT };
  const highTo = { ...to, z: to.z + MESH_HEIGHT };
  if (
    !clearRay(map, lowFrom, lowTo) ||
    !clearRay(map, highFrom, highTo) ||
    !clearRay(map, lowTo, highTo)
  ) {
    throw groundError("ground corridor collision");
  }
}

function clearRay(map: NativeMap, from: NavPoint, to: NavPoint): boolean {
  if (from.x === to.x && from.y === to.y && from.z === to.z) return true;
  return map.lineOfSight(from, to);
}

function loadCorridor(map: NativeMap, from: NavPoint, to: NavPoint): void {
  const steps = Math.max(1, Math.ceil(distance2d(from, to) / ADT_STEP));
  for (let i = 0; i <= steps; i++) {
    const ratio = i / steps;
    map.loadAdtAt(
      from.x + (to.x - from.x) * ratio,
      from.y + (to.y - from.y) * ratio,
    );
  }
}

function rejectSnap(
  label: string,
  requested: NavPoint,
  actual: NavPoint,
): void {
  validateNativePoint(actual);
  const dx = Math.abs(actual.x - requested.x);
  const dy = Math.abs(actual.y - requested.y);
  const roundX = Math.abs(Math.fround(requested.x) - requested.x) + 1e-6;
  const roundY = Math.abs(Math.fround(requested.y) - requested.y) + 1e-6;
  if (
    dx > roundX ||
    dy > roundY ||
    Math.abs(actual.z - requested.z) > GROUND_ERROR
  ) {
    throw new Error(`${label} snapped off the requested ground position`);
  }
}
