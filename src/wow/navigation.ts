import { bearing, distance2d } from "wow/geometry";
import {
  groundError,
  isGroundError,
  type NativeMap,
  openNativeMap,
  validateNativePoint,
  validateNativeXY,
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
export const GROUND_ERROR = 0.25;
const FLOOR_MERGE = 0.01;
const MESH_HEIGHT = 1.6;

export type NavigationRefusal = "wait" | "pick_destination" | "stop";

export function classifyNavigationRefusal(reason: string): NavigationRefusal {
  if (reason.includes("position disagrees with ground height")) return "wait";
  if (reason.includes("ambiguous ground column")) return "pick_destination";
  return "stop";
}

export function collisionFree(
  ray: (from: NavPoint, to: NavPoint) => boolean,
  from: NavPoint,
  to: NavPoint,
): boolean {
  const lowFrom = { ...from, z: from.z + GROUND_ERROR };
  const lowTo = { ...to, z: to.z + GROUND_ERROR };
  const highFrom = { ...from, z: from.z + MESH_HEIGHT };
  const highTo = { ...to, z: to.z + MESH_HEIGHT };
  return ray(lowFrom, lowTo) && ray(highFrom, highTo) && ray(lowTo, highTo);
}

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
      const previous = this.points[i - 1];
      const current = this.points[i];
      if (previous === undefined || current === undefined)
        throw new Error("ground route point missing");
      length += distance2d(previous, current);
      this.distances.push(length);
    }
    this.length = length;
  }

  sample(distance: number): GroundSample {
    if (!Number.isFinite(distance)) throw new Error("invalid route distance");
    const travel = Math.min(this.length, Math.max(0, distance));
    const index = this.segment(travel);
    const start = this.points[index];
    if (start === undefined) throw new Error("ground route point missing");
    const end = this.points[index + 1] ?? start;
    const span = distance2d(start, end);
    const base = this.distances[index];
    if (base === undefined) throw new Error("ground route distance missing");
    const ratio =
      span === 0 ? 0 : Math.min(1, Math.max(0, (travel - base) / span));
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
      const mark = this.distances[mid];
      if (mark === undefined) throw new Error("ground route distance missing");
      if (mark < distance) low = mid;
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
  function open(mapId: number, ...points: NavPoint[]): NativeMap {
    if (closed) throw new Error("navigation is closed");
    if (mapId !== EXPANSION01)
      throw new Error(
        `unsupported map ${mapId} (only Expansion01/${EXPANSION01})`,
      );
    for (const point of points) validateNativePoint(point);
    map ??= openMap(dataPath, libraryPath, "Expansion01");
    return map;
  }
  return {
    plan(mapId, from, to) {
      return planRoute(open(mapId, from, to), from, to);
    },
    planGround(mapId, from, to) {
      validateNativeXY(to.x, to.y);
      const map = open(mapId, from);
      map.loadAdtAt(from.x, from.y);
      checkGround(map, from);
      map.loadAdtAt(to.x, to.y);
      const z = uniqueHeight(map, to.x, to.y);
      return planRoute(map, from, { x: to.x, y: to.y, z });
    },
    height(mapId, x, y, from) {
      validateNativeXY(x, y);
      const map = open(mapId, ...(from ? [from] : []));
      if (from) map.loadAdtAt(from.x, from.y);
      map.loadAdtAt(x, y);
      return from ? connectedHeight(map, x, y, from) : uniqueHeight(map, x, y);
    },
    clear(mapId, from, to) {
      const map = open(mapId, from, to);
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
  const firstNative = points[0];
  const lastNative = points.at(-1);
  if (firstNative === undefined || lastNative === undefined)
    throw new Error("native path is empty");
  rejectSnap("start", from, firstNative);
  rejectSnap("end", to, lastNative);
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
  const first = corners[0];
  if (first === undefined) throw new Error("ground route has no points");
  validateNativePoint(first);
  map.loadAdtAt(first.x, first.y);
  checkGround(map, first);
  const initial = groundPoint(map, first, first.x, first.y);
  if (Math.abs(initial.z - first.z) > GROUND_ERROR)
    throw groundError("start is not on connected ground");
  const points = [{ ...first }];
  for (let i = 1; i < corners.length; i++) {
    const from = corners[i - 1];
    const to = corners[i];
    if (from === undefined || to === undefined)
      throw new Error("ground route corner missing");
    stepCorner(map, points, from, to);
  }
  return points;
}

function stepCorner(
  map: NativeMap,
  points: NavPoint[],
  from: NavPoint,
  to: NavPoint,
): void {
  validateNativePoint(to);
  const span = distance2d(from, to);
  if (span === 0 && Math.abs(to.z - from.z) > GROUND_ERROR)
    throw groundError("unsupported vertical ground route");
  const count = Math.ceil(span / GROUND_STEP);
  for (let step = 1; step <= count; step++) {
    const ratio = step / count;
    const tail = points.at(-1);
    if (tail === undefined) throw new Error("ground route point missing");
    points.push(
      groundPoint(
        map,
        tail,
        from.x + (to.x - from.x) * ratio,
        from.y + (to.y - from.y) * ratio,
      ),
    );
  }
  const corner = points.at(-1);
  if (corner === undefined) throw new Error("ground route point missing");
  if (Math.abs(corner.z - to.z) > GROUND_ERROR)
    throw groundError("path corner disagrees with connected ground");
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

function connectedHeight(
  map: NativeMap,
  x: number,
  y: number,
  from: NavPoint,
): number {
  try {
    const h = map.findHeight(from, x, y);
    if (Number.isFinite(h)) return h;
  } catch {}
  return continuousHeight(map, x, y, from.z) ?? uniqueHeight(map, x, y);
}

function uniqueHeight(map: NativeMap, x: number, y: number): number {
  const first = groundHeights(map, x, y)[0];
  if (first === undefined) throw groundError("ground height unavailable");
  return first;
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
  if (matches.length !== 1) return undefined;
  const match = matches[0];
  if (match === undefined) return undefined;
  return match;
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
  if (!collisionFree((a, b) => clearRay(map, a, b), from, to))
    throw groundError("ground corridor collision");
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
