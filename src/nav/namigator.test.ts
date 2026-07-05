import { test, expect, describe } from "bun:test";
import { homedir } from "node:os";
import { openNavMap } from "nav/namigator";

const libPath =
  process.env["NAMIGATOR_LIB"] ?? `${homedir()}/wow-data/libnamigator.so`;
const navData =
  process.env["NAMIGATOR_TEST_DATA"] ?? `${homedir()}/wow-data/nav-test`;

const available =
  (await Bun.file(libPath).exists()) &&
  (await Bun.file(`${navData}/development.map`).exists());

describe.skipIf(!available)("namigator ffi", () => {
  test("loads the development map and answers queries", () => {
    const map = openNavMap(libPath, navData, "development");
    try {
      const loaded = map.loadAllAdts();
      expect(loaded).toBeGreaterThan(0);

      const heights = map.findHeights(16271.025391, 16845.421875);
      expect(heights.length).toBe(2);
      expect(heights[0]).toBeCloseTo(46.301346, 3);
      expect(heights[1]).toBeCloseTo(35.611702, 3);

      const path = map.findPath(
        { x: 16303.294922, y: 16789.242188, z: 45.219631 },
        { x: 16200.13648, y: 16834.345703, z: 37.028622 },
      );
      expect(path).toBeDefined();
      expect(path!.length).toBeGreaterThanOrEqual(5);
      expect(path![0]!.x).toBeCloseTo(16303.294922, 0);
      const last = path![path!.length - 1]!;
      expect(last.x).toBeCloseTo(16200.13648, 0);
      expect(last.y).toBeCloseTo(16834.345703, 0);

      const za = map.zoneAndArea({
        x: 16271.025391,
        y: 16845.421875,
        z: 46.301346,
      });
      expect(za?.zone).toBe(22);

      const los = map.lineOfSight(
        { x: 16268.3809, y: 16812.7148, z: 36.1483 },
        { x: 16266.5781, y: 16782.623, z: 38.5035 },
      );
      expect(typeof los).toBe("boolean");
    } finally {
      map.free();
    }
  });

  test("loadAdtAt loads the tile containing a point", () => {
    const map = openNavMap(libPath, navData, "development");
    try {
      expect(map.loadAdtAt(16271, 16845)).toBe(true);
      const heights = map.findHeights(16271.025391, 16845.421875);
      expect(heights.length).toBe(2);
    } finally {
      map.free();
    }
  });

  test("findPath returns undefined for unreachable targets", () => {
    const map = openNavMap(libPath, navData, "development");
    try {
      map.loadAllAdts();
      const path = map.findPath(
        { x: 16303.294922, y: 16789.242188, z: 45.219631 },
        { x: 0, y: 0, z: 0 },
      );
      expect(path).toBeUndefined();
    } finally {
      map.free();
    }
  });

  test("throws on a missing map name", () => {
    expect(() => openNavMap(libPath, navData, "nonexistent")).toThrow();
  });
});
