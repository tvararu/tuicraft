import { bearing, distance2d } from "#wow/geometry";
import {
  checkCollision,
  GROUND_ERROR,
  MESH_HEIGHT,
  WALKABLE_CLIMB,
} from "#wow/navigation-collision";
import {
  groundError,
  isGroundError,
  type NativeMap,
  openNativeMap,
  validateNativePoint,
  validateNativeXY,
} from "#wow/navigation-native";

export type NavPoint = { x: number; y: number; z: number };
export type GroundSample = NavPoint & { orientation: number };
export type NavDestination = { x: number; y: number; z?: number };
export type NavigationOptions = { dataPath: string; libraryPath: string };
export type Navigation = {
  plan: (mapId: number, from: NavPoint, to: NavPoint) => GroundRoute;
  planGround: (
    mapId: number,
    from: NavPoint,
    to: { x: number; y: number },
  ) => GroundRoute;
  height: (mapId: number, x: number, y: number, from?: NavPoint) => number;
  stepHeight: (mapId: number, x: number, y: number, from: NavPoint) => number;
  clear: (mapId: number, from: NavPoint, to: NavPoint) => boolean;
  close: () => void;
};

const EXPANSION01 = 530;
const ADT_STEP = 64;
const GROUND_STEP = 0.5;
const FLOOR_MERGE = 0.01;
const CELL_HEIGHT = 0.25;
const CORNER_RISE = WALKABLE_CLIMB + CELL_HEIGHT;
const WALKABLE_SLOPE = Math.tan((50 * Math.PI) / 180);
const SAFE_DROP = 13;
const ROUTE_AMBIGUITY = "ambiguous ground column at route";
const START_EXIT_AMBIGUITY = "ambiguous ground column leaving start";

type GroundWalk = { points: NavPoint[]; leavingStart: boolean; climb: number };
type GroundStep = { point: NavPoint; heights: number[] };
type StepRules = { climb: number; ambiguity: string };

export type NavigationRefusal =
  | "wait"
  | "pick_destination"
  | "unreachable"
  | "stop";

const UNREACHABLE = [
  "pathfind_find_path failed (UNKNOWN_PATH)",
  "end snapped off the requested ground position",
  "native path omits destination",
];

export function classifyNavigationRefusal(reason: string): NavigationRefusal {
  if (reason.includes("position disagrees with ground height")) return "wait";
  if (
    reason.includes("ambiguous ground column at destination") ||
    reason.includes("destination is not on a ground floor")
  )
    return "pick_destination";
  if (UNREACHABLE.some((cause) => reason.includes(cause))) return "unreachable";
  return "stop";
}

export function refusalFloors(error: unknown): number[] | undefined {
  if (!(error instanceof Error && "floors" in error)) return undefined;
  return Array.isArray(error.floors) ? [...error.floors] : undefined;
}

export class GroundRoute {
  readonly points: readonly NavPoint[];
  readonly length: number;
  private readonly map: NativeMap;
  private readonly climb: number;
  private readonly distances: number[];

  constructor(points: readonly NavPoint[], map: NativeMap, climb = 0) {
    if (points.length === 0) throw new Error("ground route has no points");
    this.map = map;
    this.climb = climb;
    this.points = Object.freeze(
      groundPath(map, points, climb).map((point) => Object.freeze(point)),
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
    const at = {
      x: start.x + (end.x - start.x) * ratio,
      y: start.y + (end.y - start.y) * ratio,
    };
    const { point } = groundPoint(this.map, start, at, {
      climb: this.climb,
      ambiguity: ROUTE_AMBIGUITY,
    });
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
  let openedMap: NativeMap | undefined;
  let closed = false;
  function open(mapId: number, ...points: NavPoint[]): NativeMap {
    if (closed) throw new Error("navigation is closed");
    if (mapId !== EXPANSION01)
      throw new Error(
        `unsupported map ${mapId} (only Expansion01/${EXPANSION01})`,
      );
    for (const point of points) validateNativePoint(point);
    openedMap ??= openMap(dataPath, libraryPath, "Expansion01");
    return openedMap;
  }
  return {
    plan(mapId, from, to) {
      return planRoute(open(mapId, from, to), from, to);
    },
    planGround(mapId, from, to) {
      validateNativeXY(to.x, to.y);
      const map = open(mapId, from);
      map.loadAdtAt(from.x, from.y);
      checkStart(map, from);
      map.loadAdtAt(to.x, to.y);
      const z = destinationFloor(map, to.x, to.y);
      return planRoute(map, from, { x: to.x, y: to.y, z });
    },
    height(mapId, x, y, from) {
      validateNativeXY(x, y);
      const map = open(mapId, ...(from ? [from] : []));
      if (from) map.loadAdtAt(from.x, from.y);
      map.loadAdtAt(x, y);
      return from ? connectedHeight(map, x, y, from) : uniqueHeight(map, x, y);
    },
    stepHeight(mapId, x, y, from) {
      validateNativeXY(x, y);
      const map = open(mapId, from);
      map.loadAdtAt(from.x, from.y);
      map.loadAdtAt(x, y);
      return stepHeight(map, x, y, from);
    },
    clear(mapId, from, to) {
      const map = open(mapId, from, to);
      map.loadAdtAt(to.x, to.y);
      return map.lineOfSight(from, to);
    },
    close() {
      closed = true;
      openedMap?.close();
      openedMap = undefined;
    },
  };
}

function planRoute(map: NativeMap, from: NavPoint, to: NavPoint): GroundRoute {
  loadCorridor(map, from, to);
  checkStart(map, from);
  checkDestination(map, to);
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
  return new GroundRoute(corridor, map, WALKABLE_CLIMB);
}

function groundPath(
  map: NativeMap,
  corners: readonly NavPoint[],
  climb: number,
): NavPoint[] {
  const first = corners[0];
  if (first === undefined) throw new Error("ground route has no points");
  validateNativePoint(first);
  map.loadAdtAt(first.x, first.y);
  const leavingStart = groundFloors(checkStart(map, first)).length > 1;
  const ambiguity = leavingStart ? START_EXIT_AMBIGUITY : ROUTE_AMBIGUITY;
  const initial = groundPoint(map, first, first, { climb, ambiguity }).point;
  if (Math.abs(initial.z - first.z) > GROUND_ERROR)
    throw groundError("start is not on connected ground");
  const walk: GroundWalk = { points: [{ ...first }], leavingStart, climb };
  for (let i = 1; i < corners.length; i++) {
    const from = corners[i - 1];
    const to = corners[i];
    if (from === undefined || to === undefined)
      throw new Error("ground route corner missing");
    const corner = stepCorner(map, walk, from, to);
    const agrees =
      i < corners.length - 1
        ? meshCornerOnGround(map, corner, to.z)
        : Math.abs(corner.z - to.z) <= GROUND_ERROR;
    if (!agrees)
      throw groundError("path corner disagrees with connected ground");
  }
  return walk.points;
}

function stepCorner(
  map: NativeMap,
  walk: GroundWalk,
  from: NavPoint,
  to: NavPoint,
): NavPoint {
  validateNativePoint(to);
  const span = distance2d(from, to);
  if (span === 0 && Math.abs(to.z - from.z) > GROUND_ERROR)
    throw groundError("unsupported vertical ground route");
  const count = Math.ceil(span / GROUND_STEP);
  for (let step = 1; step <= count; step++) {
    const ratio = step / count;
    const tail = walk.points.at(-1);
    if (tail === undefined) throw new Error("ground route point missing");
    const at = {
      x: from.x + (to.x - from.x) * ratio,
      y: from.y + (to.y - from.y) * ratio,
    };
    const { point, heights } = groundPoint(map, tail, at, {
      climb: walk.climb,
      ambiguity: walk.leavingStart ? START_EXIT_AMBIGUITY : ROUTE_AMBIGUITY,
    });
    walk.points.push(point);
    walk.leavingStart &&= groundFloors(heights).length > 1;
  }
  const corner = walk.points.at(-1);
  if (corner === undefined) throw new Error("ground route point missing");
  return corner;
}

function meshCornerOnGround(
  map: NativeMap,
  ground: NavPoint,
  meshZ: number,
): boolean {
  const rise = meshZ - ground.z;
  if (rise < -GROUND_ERROR || rise > CORNER_RISE) return false;
  return map
    .findHeights(ground.x, ground.y)
    .every(
      (height) =>
        Math.abs(height - ground.z) <= GROUND_ERROR ||
        Math.abs(height - meshZ) > Math.abs(rise),
    );
}

function groundPoint(
  map: NativeMap,
  from: NavPoint,
  { x, y }: { x: number; y: number },
  { climb, ambiguity }: StepRules,
): GroundStep {
  map.loadAdtAt(x, y);
  const point = { x, y, z: map.findHeight(from, x, y) };
  const heights = checkRouteGround(map, point, from, ambiguity);
  const back = map.findHeight(point, from.x, from.y);
  if (!Number.isFinite(back) || Math.abs(back - from.z) > GROUND_ERROR)
    throw groundError("ground corridor changes surface");
  checkCollision(map, from, point, climb);
  return { point, heights };
}

function checkRouteGround(
  map: NativeMap,
  point: NavPoint,
  from: NavPoint,
  ambiguity: string,
): number[] {
  validateNativePoint(point);
  const heights = columnHeights(map, point.x, point.y);
  const others = heights.filter(
    (height) => Math.abs(height - point.z) > GROUND_ERROR,
  );
  if (others.length === heights.length)
    throw groundError("position disagrees with ground height");
  if (others.length === 0) return heights;
  if (
    !clearAbove(heights, point.z) ||
    Math.abs(point.z - from.z) > WALKABLE_CLIMB
  )
    throw groundError(ambiguity);
  return heights;
}

function checkStart(map: NativeMap, point: NavPoint): number[] {
  validateNativePoint(point);
  const heights = columnHeights(map, point.x, point.y);
  if (heights.every((height) => Math.abs(height - point.z) > GROUND_ERROR))
    throw groundError("position disagrees with ground height");
  if (!clearAbove(heights, point.z))
    throw groundError("ambiguous ground column at start");
  return heights;
}

function checkDestination(map: NativeMap, point: NavPoint): void {
  validateNativePoint(point);
  const heights = columnHeights(map, point.x, point.y);
  const onSurface = heights.some(
    (height) => Math.abs(height - point.z) <= GROUND_ERROR,
  );
  if (onSurface && clearAbove(heights, point.z)) return;
  throw floorError("destination is not on a ground floor", heights);
}

function destinationFloor(map: NativeMap, x: number, y: number): number {
  const heights = columnHeights(map, x, y);
  const floors = groundFloors(heights);
  const floor = floors[0];
  if (floor === undefined) throw groundError("ground height unavailable");
  if (floors.length > 1)
    throw floorError("ambiguous ground column at destination", heights);
  return floor;
}

function groundFloors(heights: readonly number[]): number[] {
  const floors: number[] = [];
  for (const height of heights)
    if (
      clearAbove(heights, height) &&
      !floors.some((floor) => Math.abs(floor - height) <= FLOOR_MERGE)
    )
      floors.push(height);
  return floors.sort((a, b) => b - a);
}

function clearAbove(heights: readonly number[], z: number): boolean {
  return !heights.some(
    (height) => height - z > GROUND_ERROR && height - z <= MESH_HEIGHT,
  );
}

function floorError(message: string, heights: readonly number[]): Error {
  const floors = groundFloors(heights);
  const listed = floors.map((floor) => floor.toFixed(2)).join(", ");
  return Object.assign(groundError(`${message} (floors ${listed})`), {
    floors,
  });
}

function columnHeights(map: NativeMap, x: number, y: number): number[] {
  const heights = map.findHeights(x, y);
  if (heights.length === 0 || !heights.every(Number.isFinite))
    throw groundError("ground height unavailable");
  return heights;
}

function connectedHeight(
  map: NativeMap,
  x: number,
  y: number,
  from: NavPoint,
): number {
  const h = probeHeight(map, x, y, from);
  if (Number.isFinite(h)) return h;
  return continuousHeight(map, x, y, from.z) ?? uniqueHeight(map, x, y);
}

function stepHeight(
  map: NativeMap,
  x: number,
  y: number,
  from: NavPoint,
): number {
  const reachable = reachableHeight(map, x, y, from);
  if (reachable !== undefined) return reachable;
  const h = probeHeight(map, x, y, from);
  if (Number.isFinite(h)) return h;
  return uniqueHeight(map, x, y);
}

function probeHeight(
  map: NativeMap,
  x: number,
  y: number,
  from: NavPoint,
): number {
  try {
    return map.findHeight(from, x, y);
  } catch {
    return Number.NaN;
  }
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
  return matches.length === 1 ? matches[0] : undefined;
}

export function withinStep(from: NavPoint, to: NavPoint): boolean {
  const reach = CELL_HEIGHT + distance2d(from, to) * WALKABLE_SLOPE;
  const rise = to.z - from.z;
  return rise <= reach && rise >= -Math.max(reach, SAFE_DROP);
}

function reachableHeight(
  map: NativeMap,
  x: number,
  y: number,
  from: NavPoint,
): number | undefined {
  let best: number | undefined;
  for (const z of map.findHeights(x, y)) {
    if (!withinStep(from, { x, y, z })) continue;
    if (best === undefined || z > best) best = z;
  }
  return best;
}

function groundHeights(map: NativeMap, x: number, y: number): number[] {
  const heights = columnHeights(map, x, y);
  const first = heights[0];
  if (first === undefined) throw groundError("ground height unavailable");
  if (heights.some((height) => Math.abs(height - first) > FLOOR_MERGE))
    throw groundError("ambiguous ground column");
  return heights;
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
