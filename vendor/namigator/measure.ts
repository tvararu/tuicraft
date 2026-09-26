import { createNavigation } from "../../packages/core/src/wow/navigation";

const [libraryPath, originArg, ...rest] = process.argv.slice(2);
const dataPath = process.env["NAV_DATA"];
if (!libraryPath || !originArg || !dataPath) {
  console.error(
    "usage: NAV_DATA=<nav dir> measure.ts <libnamigator.so> <x,y,z> (grid <radius> <step> | <x,y>...)",
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
const nav = createNavigation({
  dataPath,
  libraryPath,
});
const results = destinations.map(({ x, y }) => {
  try {
    const route = nav.planGround(530, origin, { x, y });
    const hash = Bun.hash(JSON.stringify(route.points)).toString(16);
    return { x, y, result: "OK", points: route.points.length, hash };
  } catch (error) {
    return { x, y, result: error instanceof Error ? error.message : "error" };
  }
});
nav.close();
console.log(JSON.stringify(results));
