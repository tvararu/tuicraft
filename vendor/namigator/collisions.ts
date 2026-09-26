import { createNavigation } from "wow/navigation";
import {
  type NativeMap,
  type NativePoint,
  openNativeMap,
} from "wow/navigation-native";

const LOW = 0.25;
const HIGH = 1.6;
const CLIMB = 1;

type Step = { from: NativePoint; to: NativePoint };

const [libraryPath, originArg, ...rest] = process.argv.slice(2);
const dataPath = process.env["NAV_DATA"];
if (!libraryPath || !originArg || !dataPath) {
  console.error(
    "usage: NAV_DATA=<nav dir> collisions.ts <libnamigator.so> <x,y,z> (grid <radius> <step> | <x,y>...)",
  );
  process.exit(2);
}
const [ox = 0, oy = 0, oz = 0] = originArg.split(",").map(Number);
const origin = { x: ox, y: oy, z: oz };
const destinations: { x: number; y: number }[] = [];
if (rest[0] === "grid") {
  const radius = Number(rest[1]);
  const step = Number(rest[2]);
  for (let dx = -radius; dx <= radius; dx += step)
    for (let dy = -radius; dy <= radius; dy += step)
      destinations.push({ x: ox + dx, y: oy + dy });
} else {
  for (const arg of rest) {
    const [x = 0, y = 0] = arg.split(",").map(Number);
    destinations.push({ x, y });
  }
}

let steps: Step[] = [];
let native: NativeMap | undefined;
const nav = createNavigation({ dataPath, libraryPath }, (...args) => {
  const map = openNativeMap(...args);
  native = map;
  return {
    loadAdtAt: (x, y) => map.loadAdtAt(x, y),
    findHeights: (x, y) => map.findHeights(x, y),
    findPath: (from, to) => map.findPath(from, to),
    lineOfSight: (from, to) => map.lineOfSight(from, to),
    close: () => map.close(),
    findHeight(from, x, y) {
      const z = map.findHeight(from, x, y);
      steps.push({ from: { ...from }, to: { x, y, z } });
      return z;
    },
  };
});

function at(z: number, point: NativePoint): NativePoint {
  return { x: point.x, y: point.y, z };
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function classify(map: NativeMap, { from, to }: Step) {
  const clear = (a: NativePoint, b: NativePoint) => map.lineOfSight(a, b);
  const drop = from.z - to.z;
  const upper = Math.max(from.z, to.z) + LOW;
  const low = clear(at(from.z + LOW, from), at(to.z + LOW, to));
  const high = clear(at(from.z + HIGH, from), at(to.z + HIGH, to));
  const vertical = clear(at(to.z + LOW, to), at(to.z + HIGH, to));
  const stepped =
    drop >= 0
      ? clear(at(from.z + LOW, from), at(upper, to))
      : clear(at(from.z + LOW, from), at(upper, from)) &&
        clear(at(upper, from), at(to.z + LOW, to));
  const columns = [0, 0.25, 0.5, 0.75, 1].map((t) =>
    map
      .findHeights(from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t)
      .map(round),
  );
  const step = !low && Math.abs(drop) <= CLIMB && stepped && high && vertical;
  const direction = drop >= 0 ? "step down" : "step up";
  return {
    verdict: step ? direction : "obstruction",
    rays: { low, high, vertical, stepped },
    drop: round(drop),
    columns,
  };
}

const refusals = [];
for (const destination of destinations) {
  steps = [];
  try {
    nav.planGround(530, origin, destination);
    continue;
  } catch (error) {
    if (
      !(error instanceof Error) ||
      error.message !== "ground corridor collision"
    )
      continue;
  }
  const step = steps.at(-2);
  if (step === undefined || native === undefined) {
    refusals.push({ destination, verdict: "unknown" });
    continue;
  }
  refusals.push({
    destination,
    from: { x: round(step.from.x), y: round(step.from.y), z: round(step.from.z) },
    to: { x: round(step.to.x), y: round(step.to.y), z: round(step.to.z) },
    ...classify(native, step),
  });
}
nav.close();
console.log(JSON.stringify(refusals));
