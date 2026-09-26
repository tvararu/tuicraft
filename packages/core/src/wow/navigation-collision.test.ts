import { describe, expect, test } from "bun:test";
import { native, navigation } from "#test-support/navigation-fixtures";
import { GroundRoute, type NavPoint } from "#wow/navigation";
import { collisionFree } from "#wow/navigation-collision";

type Box = { minX: number; maxX: number; top: number };

function solid(...boxes: Box[]) {
  return (a: NavPoint, b: NavPoint) => {
    for (let i = 0; i <= 100; i++) {
      const t = i / 100;
      const x = a.x + (b.x - a.x) * t;
      const z = a.z + (b.z - a.z) * t;
      if (boxes.some((box) => x > box.minX && x < box.maxX && z < box.top))
        return false;
    }
    return true;
  };
}

const platform = (top: number): Box => ({ minX: -10, maxX: 0.4, top });

describe("collisionFree", () => {
  test("probes low, head-height and vertical rays", () => {
    const rays: [number, number][] = [];
    const from = { x: 0, y: 0, z: 0 };
    const to = { x: 1, y: 0, z: 0 };
    const ray = (a: NavPoint, b: NavPoint) => {
      rays.push([a.z, b.z]);
      return true;
    };
    expect(collisionFree(ray, from, to)).toBe(true);
    expect(rays).toEqual([
      [0.25, 0.25],
      [1.6, 1.6],
      [0.25, 1.6],
    ]);
    expect(collisionFree(() => false, from, to)).toBe(false);
  });

  test("follows the higher floor across a platform edge within the climb", () => {
    const ray = solid(platform(0.6));
    const upper = { x: 0, y: 0, z: 0.6 };
    const lower = { x: 0.5, y: 0, z: 0 };
    expect(collisionFree(ray, upper, lower)).toBe(false);
    expect(collisionFree(ray, lower, upper)).toBe(false);
    expect(collisionFree(ray, upper, lower, 1)).toBe(true);
    expect(collisionFree(ray, lower, upper, 1)).toBe(true);
  });

  test("refuses an edge taller than the climb", () => {
    const ray = solid(platform(1.2));
    const upper = { x: 0, y: 0, z: 1.2 };
    const lower = { x: 0.5, y: 0, z: 0 };
    expect(collisionFree(ray, upper, lower, 1)).toBe(false);
    expect(collisionFree(ray, lower, upper, 1)).toBe(false);
  });

  test("refuses an obstacle on the higher floor or level ground", () => {
    const post = { minX: 0.1, maxX: 0.2, top: 1 };
    const ray = solid(platform(0.6), post);
    const upper = { x: 0, y: 0, z: 0.6 };
    const lower = { x: 0.5, y: 0, z: 0 };
    expect(collisionFree(ray, upper, lower, 1)).toBe(false);
    expect(collisionFree(ray, lower, upper, 1)).toBe(false);
    const wall = solid({ minX: 0.2, maxX: 0.3, top: 0.5 });
    const level = { x: 0.5, y: 0, z: 0 };
    expect(collisionFree(wall, { x: 0, y: 0, z: 0 }, level, 1)).toBe(false);
  });
});

describe("step edges on a route", () => {
  test("the native corridor steps off a platform the direct line refuses", () => {
    const height = (x: number) => (x < 0.4 ? 0.6 : 0);
    const map = native({
      findHeight: (_from, x) => height(x),
      findHeights: (x) => [height(x)],
      lineOfSight: solid(platform(0.6)),
    });
    const from = { x: 0, y: 0, z: 0.6 };
    const to = { x: 2, y: 0, z: 0 };
    expect(() => new GroundRoute([from, to], map)).toThrow(/collision/);
    const route = navigation(map).plan(530, from, to);
    expect(route.points.map((point) => point.z)).toEqual([0.6, 0, 0, 0, 0]);
    expect(route.sample(0.45).z).toBe(0);
  });
});
