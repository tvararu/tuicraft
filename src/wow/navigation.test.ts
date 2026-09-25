import { describe, expect, test } from "bun:test";
import {
  classifyNavigationRefusal,
  collisionFree,
  createNavigation,
  GroundRoute,
  type NavPoint,
} from "wow/navigation";
import { groundError, type NativeMap } from "wow/navigation-native";

function native(over: Partial<NativeMap> = {}): NativeMap {
  return {
    loadAdtAt: () => {},
    findHeights: () => [0],
    findHeight: () => 0,
    findPath: (from, to) => [{ ...from }, { ...to }],
    lineOfSight: () => true,
    close: () => {},
    ...over,
  };
}

function navigation(map: NativeMap) {
  return createNavigation(
    { dataPath: "fixture", libraryPath: "fixture" },
    () => map,
  );
}

const start: NavPoint = { x: 0, y: 0, z: 0 };
const end: NavPoint = { x: 10, y: 0, z: 0 };

describe("grounded navigation", () => {
  test("samples an interior terrain ridge absent from funnel corners", () => {
    const height = (x: number) => Math.sin((x * Math.PI) / 10) * 2;
    const map = native({
      findHeight: (_from, x) => height(x),
      findHeights: (x) => [height(x)],
    });
    const route = navigation(map).plan(530, start, end);
    expect(route.length).toBeCloseTo(10);
    expect(route.sample(5).z).toBeCloseTo(2);
    expect(route.sample(4.125).z).toBeCloseTo(height(4.125));
    expect(route.sample(4.125).z).not.toBeCloseTo(0);
  });

  test("samples actual terrain rather than interpolating dense anchor heights", () => {
    const height = (x: number) => 0.1 * Math.cos(x * Math.PI * 4);
    const map = native({
      findHeight: (_from, x) => height(x),
      findHeights: (x) => [height(x)],
    });
    const from = { ...start, z: height(0) };
    const to = { ...end, z: height(10) };
    const route = navigation(map).plan(530, from, to);
    expect(route.sample(0.25).z).toBeCloseTo(-0.1);
  });

  test("does not replace an observed high pose with a distant floor", () => {
    const nav = navigation(native());
    expect(() => nav.plan(530, { ...start, z: 100 }, end)).toThrow(/ground/);
    expect(() => nav.plan(530, start, { ...end, z: 100 })).toThrow(/ground/);
  });

  test("rejects distinguishable stacked surfaces rather than selecting a nearby floor", () => {
    const nav = navigation(native({ findHeights: () => [0, 10] }));
    expect(() => nav.plan(530, start, end)).toThrow(/ambiguous/);
  });

  test("rejects a connected-height result on a different surface", () => {
    const map = native({ findHeight: (_from, x) => (x >= 5 ? -10 : 0) });
    expect(() => navigation(map).plan(530, start, end)).toThrow(/ground/);
  });

  test("rejects an interior disconnected corridor despite valid funnel endpoints", () => {
    const map = native({
      findHeight: (from, x) => {
        if (from.x < 5 && x >= 5) throw new Error("UNKNOWN_HEIGHT");
        return 0;
      },
    });
    expect(() => navigation(map).plan(530, start, end)).toThrow(
      /UNKNOWN_HEIGHT/,
    );
  });

  test("rejects collision between grounded points", () => {
    const map = native({
      lineOfSight: (from, to) => !(from.x < 5 && to.x >= 5),
    });
    expect(() => navigation(map).plan(530, start, end)).toThrow(/collision/);
  });

  test("rejects unsafe native endpoint clamping even inside the old eight-yard limit", () => {
    for (const clampStart of [true, false]) {
      const map = native({
        findPath: (from, to) =>
          clampStart
            ? [{ ...from, x: from.x + 1 }, to]
            : [from, { ...to, x: to.x - 1 }],
      });
      expect(() => navigation(map).plan(530, start, end)).toThrow(/snap/);
    }
  });

  test("preserves the original start pose despite native numeric rounding", () => {
    const from = { x: 8709.460_001, y: -6671.760_001, z: 70.340_001 };
    const to = { ...from, x: from.x + 2 };
    const map = native({
      findHeight: () => 70.34,
      findHeights: () => [70.34],
      findPath: (a, b) => [
        { x: Math.fround(a.x), y: Math.fround(a.y), z: Math.fround(a.z) },
        { x: Math.fround(b.x), y: Math.fround(b.y), z: Math.fround(b.z) },
      ],
    });
    const route = navigation(map).plan(530, from, to);
    expect(route.points[0]).toEqual(from);
    expect(route.sample(0)).toMatchObject(from);
    expect(route.sample(-1)).toMatchObject(from);
    expect(route.sample(100)).toMatchObject({ x: to.x, y: to.y });
  });

  test("does not silently fall back when a later sample loses ground evidence", () => {
    let available = true;
    const map = native({
      findHeight: () => {
        if (!available) throw new Error("UNKNOWN_HEIGHT");
        return 0;
      },
    });
    const route = navigation(map).plan(530, start, end);
    available = false;
    expect(() => route.sample(0.25)).toThrow(/UNKNOWN_HEIGHT/);
  });

  test("follows turns with horizontal distance and clamps at the endpoint", () => {
    const to = { x: 10, y: 10, z: 0 };
    const map = native({
      findPath: (from, target) => [from, end, target],
      findHeight: (_from, x, y) => {
        if (y > 0 && x < 10) throw groundError("blocked direct corridor");
        return 0;
      },
    });
    const route = navigation(map).plan(530, start, to);
    expect(route.length).toBeCloseTo(20);
    expect(route.sample(15)).toEqual({
      x: 10,
      y: 5,
      z: 0,
      orientation: Math.PI / 2,
    });
    expect(route.sample(100)).toMatchObject(to);
  });

  test("requires return connectivity to the same anchored surface", () => {
    const map = native({ findHeight: (from, x) => (x < from.x ? 3 : 0) });
    expect(() => navigation(map).plan(530, start, end)).toThrow(/ground/);
  });

  test("empty and vertical-only routes do not manufacture traversable ground", () => {
    const map = native();
    expect(() => new GroundRoute([], map)).toThrow(/no points/);
    expect(() => new GroundRoute([start, { ...start, z: 5 }], map)).toThrow(
      /ground|vertical/,
    );
  });
});

describe("navigation lifecycle", () => {
  test("rejects unsupported maps before native construction", () => {
    let opened = false;
    const nav = createNavigation(
      { dataPath: "fixture", libraryPath: "fixture" },
      () => {
        opened = true;
        return native();
      },
    );
    expect(() => nav.plan(0, start, end)).toThrow(/unsupported map/);
    expect(opened).toBe(false);
    nav.close();
  });

  test("closed navigation and routes cannot query freed native state", () => {
    let closed = false;
    const map = native({
      findHeight: () => {
        if (closed) throw new Error("navigation map is closed");
        return 0;
      },
      close: () => {
        closed = true;
      },
    });
    const nav = navigation(map);
    const route = nav.plan(530, start, end);
    nav.close();
    expect(() => nav.plan(530, start, end)).toThrow(/closed/);
    expect(() => route.sample(0.25)).toThrow(/closed/);
  });

  test("missing native library is explicit rather than flat-ground fallback", () => {
    const nav = createNavigation({
      dataPath: "/does-not-exist-nav-data",
      libraryPath: "/does-not-exist-libnamigator.so",
    });
    expect(() => nav.plan(530, start, end)).toThrow(/library not found/);
    nav.close();
  });
});

test("out-of-domain coordinates are rejected before map creation or native calls", () => {
  let opened = false;
  const nav = createNavigation(
    { dataPath: "fixture", libraryPath: "fixture" },
    () => {
      opened = true;
      throw new Error("native must not be entered");
    },
  );
  const mid = 32 * (533 + 1 / 3);
  for (const point of [
    { x: 1e6, y: 0, z: 0 },
    { x: 0, y: -1e6, z: 0 },
    { x: -mid, y: 0, z: 0 },
    { x: 0, y: mid + 1, z: 0 },
    { x: 0, y: 0, z: 1e100 },
  ]) {
    expect(() => nav.plan(530, point, end)).toThrow(/native coordinate/);
    expect(() => nav.plan(530, start, point)).toThrow(/native coordinate/);
  }
  expect(opened).toBe(false);
});

describe("validated direct corridor selection", () => {
  test("uses fully grounded direct travel instead of an ungroundable funnel corner", () => {
    const map = native({
      findPath: (from, to) => [from, { x: 5, y: 5, z: 0 }, to],
      findHeight: (_from, x, y) => {
        if (x === 5 && y === 5) throw groundError("UNKNOWN_HEIGHT");
        return 0;
      },
    });
    const route = navigation(map).plan(530, start, end);
    expect(route.length).toBe(10);
    expect(route.sample(5)).toEqual({ x: 5, y: 0, z: 0, orientation: 0 });
    expect(route.sample(route.length)).toMatchObject(end);
  });

  test("a rejected ambiguous direct column can be avoided by a validated detour", () => {
    const map = native({
      findPath: (from, to) => [
        from,
        { x: 0, y: 2, z: 0 },
        { x: 10, y: 2, z: 0 },
        to,
      ],
      findHeights: (x, y) => (x >= 4 && x <= 6 && y === 0 ? [0, 10] : [0]),
    });
    const route = navigation(map).plan(530, start, end);
    expect(route.length).toBe(14);
    expect(route.sample(7)).toMatchObject({ x: 5, y: 2, z: 0 });
    expect(route.sample(route.length)).toMatchObject(end);
  });

  test("rejects when direct and funnel corridors both collide", () => {
    const map = native({
      findPath: (from, to) => [
        from,
        { x: 0, y: 2, z: 0 },
        { x: 10, y: 2, z: 0 },
        to,
      ],
      lineOfSight: (from, to) => !(from.x < 5 && to.x >= 5),
    });
    expect(() => navigation(map).plan(530, start, end)).toThrow(/collision/);
  });

  test("does not swallow native lifecycle failures to attempt another corridor", () => {
    const map = native({
      findPath: (from, to) => [
        from,
        { x: 0, y: 2, z: 0 },
        { x: 10, y: 2, z: 0 },
        to,
      ],
      findHeight: (_from, x, y) => {
        if (x >= 4 && x <= 6 && y === 0)
          throw new Error("navigation map is closed");
        return 0;
      },
    });
    expect(() => navigation(map).plan(530, start, end)).toThrow(
      "navigation map is closed",
    );
  });

  test("does not bypass native path acceptance even when direct ground is available", () => {
    const map = native({
      findPath: () => {
        throw groundError("UNKNOWN_PATH");
      },
    });
    expect(() => navigation(map).plan(530, start, end)).toThrow("UNKNOWN_PATH");
  });
});

test("a direct candidate cannot hide malformed native corridor coordinates", () => {
  const map = native({
    findPath: (from, to) => [
      from,
      { x: Number.POSITIVE_INFINITY, y: 0, z: 0 },
      to,
    ],
  });
  expect(() => navigation(map).plan(530, start, end)).toThrow(
    /native coordinate/,
  );
});

describe("ground destinations", () => {
  test("derives destination height without substituting the origin altitude", () => {
    const height = (x: number) => x / 2;
    const map = native({
      findHeight: (_from, x) => height(x),
      findHeights: (x) => [height(x)],
    });
    const route = navigation(map).planGround(530, start, { x: 10, y: 0 });
    expect(route.sample(route.length)).toMatchObject({ x: 10, y: 0, z: 5 });
    expect(route.sample(0)).toMatchObject(start);
  });

  test("refuses an ambiguous destination even when one floor matches the origin", () => {
    const nav = navigation(
      native({ findHeights: (x) => (x === 10 ? [0, 5] : [0]) }),
    );
    expect(() => nav.planGround(530, start, end)).toThrow(/ambiguous/);
  });

  test("does not replace invalid original ground or bypass native acceptance", () => {
    expect(() =>
      navigation(native()).planGround(530, { ...start, z: 20 }, end),
    ).toThrow(/ground/);
    const nav = navigation(
      native({
        findPath: () => {
          throw new Error("UNKNOWN_PATH");
        },
      }),
    );
    expect(() => nav.planGround(530, start, end)).toThrow(/UNKNOWN_PATH/);
  });

  test("rejects missing and nonfinite destination columns", () => {
    for (const heights of [[], [Number.NaN], [Number.POSITIVE_INFINITY]]) {
      const nav = navigation(
        native({ findHeights: (x) => (x === 10 ? heights : [0]) }),
      );
      expect(() => nav.planGround(530, start, end)).toThrow(/height/);
    }
  });

  test("retains lifecycle, domain and map gates", () => {
    const nav = navigation(native());
    expect(() => nav.planGround(0, start, end)).toThrow(/unsupported map/);
    expect(() => nav.planGround(530, start, { x: 1e6, y: 0 })).toThrow(
      /coordinate/,
    );
    nav.close();
    expect(() => nav.planGround(530, start, end)).toThrow(/closed/);
  });

  test("queries unambiguous ground height", () => {
    const map = native({
      findHeight: (_from, x) => (x === 10 ? 64.17 : 0),
      findHeights: (x) => (x === 10 ? [64.17] : [0]),
    });
    const nav = navigation(map);
    expect(nav.height(530, 10, 0)).toBeCloseTo(64.17);
    expect(nav.height(530, 10, 0, { x: 0, y: 0, z: 0 })).toBeCloseTo(64.17);
  });

  test("resolves height ahead by matching the known current surface in a multi-floor column", () => {
    const map = native({
      findHeight: () => {
        throw groundError("pathfind_find_height failed (UNKNOWN_HEIGHT)");
      },
      findHeights: () => [93.42, 67.88, 70.34],
    });
    const nav = navigation(map);
    expect(nav.height(530, 10, 0, { x: 0, y: 0, z: 70.336 })).toBeCloseTo(
      70.34,
    );
  });

  test("still refuses when two column entries both sit near the current surface", () => {
    const map = native({
      findHeight: () => {
        throw groundError("pathfind_find_height failed (UNKNOWN_HEIGHT)");
      },
      findHeights: () => [93.42, 70.23, 70.34],
    });
    const nav = navigation(map);
    expect(() => nav.height(530, 10, 0, { x: 0, y: 0, z: 70.336 })).toThrow(
      /ambiguous ground column/,
    );
  });
  test("primes the origin tile before the connected height query", () => {
    const loaded: [number, number][] = [];
    const map = native({
      loadAdtAt: (x, y) => {
        loaded.push([x, y]);
      },
      findHeight: () => {
        throw groundError("pathfind_find_height failed (UNKNOWN_HEIGHT)");
      },
      findHeights: () => [70.34],
    });
    const nav = navigation(map);
    expect(nav.height(530, 10, 0, { x: 0, y: 0, z: 70.336 })).toBeCloseTo(
      70.34,
    );
    expect(loaded).toEqual([
      [0, 0],
      [10, 0],
    ]);
  });

  test("reports whether a straight path is clear via a real line-of-sight query", () => {
    const map = native({
      lineOfSight: (from, to) => !(from.x < 5 && to.x >= 5),
    });
    const nav = navigation(map);
    expect(nav.clear(530, { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 })).toBe(
      true,
    );
    expect(nav.clear(530, { x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 })).toBe(
      false,
    );
    expect(() => nav.clear(0, start, end)).toThrow(/unsupported map/);
  });
});

describe("classifyNavigationRefusal", () => {
  test("maps ground refusals to a next step", () => {
    expect(
      classifyNavigationRefusal("position disagrees with ground height"),
    ).toBe("wait");
    expect(classifyNavigationRefusal("ambiguous ground column")).toBe(
      "pick_destination",
    );
    expect(classifyNavigationRefusal("ground corridor collision")).toBe("stop");
  });
});

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
});
