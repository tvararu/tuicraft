import { describe, expect, jest, test } from "bun:test";
import { setup } from "test/control-fixtures";
import { must } from "test/must";
import type { GotoTarget } from "wow/client";
import { controlMethods } from "wow/client-control";
import { createNavigation, type NavPoint } from "wow/navigation";
import type { NativeMap } from "wow/navigation-native";
import { GameOpcode } from "wow/protocol/opcodes";
import type { Runtimes } from "wow/runtime";
import type { WorldConn } from "wow/world-conn";

function point(x: number, y: number, z?: number): GotoTarget {
  return z === undefined ? { kind: "point", x, y } : { kind: "point", x, y, z };
}

const MOTION = new Set<number>([
  GameOpcode.MSG_MOVE_START_FORWARD,
  GameOpcode.MSG_MOVE_SET_FACING,
]);

function ground(
  columns: (x: number, y: number) => number[],
  over: Partial<NativeMap> = {},
): NativeMap {
  return {
    loadAdtAt() {},
    findHeights: columns,
    findHeight: (from, x, y) =>
      columns(x, y).find((z) => Math.abs(z - from.z) <= 2) ?? Number.NaN,
    lineOfSight: () => true,
    findPath: (from: NavPoint, to: NavPoint) => [from, to],
    close() {},
    ...over,
  };
}

function fixture(
  columns: (x: number, y: number) => number[],
  over: Partial<NativeMap> = {},
  targets = new Map<bigint, NavPoint>(),
) {
  const control = setup();
  const navigation = createNavigation(
    { dataPath: "data", libraryPath: "lib" },
    () => ground(columns, over),
  );
  const steer = jest.fn((reason?: string) => control.runtime.halt(reason));
  const rt = {
    control: control.runtime,
    navigation: () => navigation,
    observedTarget: (guid: bigint) => {
      const target = targets.get(guid);
      if (!target) throw new Error("target_not_observed");
      return target;
    },
    steer,
  } as unknown as Runtimes;
  const handle = controlMethods({} as WorldConn, rt);
  return { ...control, handle, steer };
}

describe("goTo without Z", () => {
  test("derives destination height from a unique column and walks there", () => {
    jest.useFakeTimers();
    try {
      const f = fixture((x) => [70.34 + (x - 8709.46) / 10]);
      const start = must(f.runtime.snapshot().pose);
      f.handle.goTo(point(start.x + 10, start.y));
      expect(f.steer).toHaveBeenCalled();
      const destination = must(f.runtime.navigationState().destination);
      expect(destination.x).toBe(start.x + 10);
      expect(destination.z).toBeCloseTo(71.34, 4);
      expect(f.runtime.navigationState()).toMatchObject({
        active: true,
        refusal: undefined,
      });
      f.advance(3000);
      expect(f.runtime.navigationState()).toMatchObject({
        active: false,
        remaining: 0,
        blockedReason: undefined,
      });
      expect(f.runtime.snapshot().pose?.z).toBeCloseTo(71.34, 4);
    } finally {
      jest.useRealTimers();
    }
  });

  test("refuses an ambiguous column at pick_destination with its floors, then walks to a chosen floor", () => {
    const f = fixture((x) =>
      x > 8715 ? [70.34, 80.34] : [70.34 + (x - 8709.46) / 100],
    );
    const start = must(f.runtime.snapshot().pose);
    expect(() => f.handle.goTo(point(start.x + 10, start.y))).toThrow(
      "pick_destination: ambiguous ground column at destination (floors 80.34, 70.34)",
    );
    expect(f.runtime.navigationState()).toMatchObject({
      active: false,
      destination: { x: start.x + 10, y: start.y },
      refusal: "pick_destination",
      floors: [80.34, 70.34],
    });
    expect(f.runtime.navigationState().destination).not.toHaveProperty("z");
    expect(f.sent.filter((packet) => MOTION.has(packet.opcode))).toEqual([]);
    expect(f.runtime.snapshot().moving).toBe(false);
    f.handle.goTo(point(start.x + 10, start.y, 70.34));
    expect(f.runtime.navigationState()).toMatchObject({
      active: true,
      destination: { x: start.x + 10, y: start.y, z: 70.34 },
    });
    expect(f.runtime.navigationState()).not.toHaveProperty("floors");
  });

  test("refuses a guessed Z at pick_destination with the floors instead of replacing it", () => {
    const f = fixture(() => [70.34]);
    const start = must(f.runtime.snapshot().pose);
    expect(() => f.handle.goTo(point(start.x + 5, start.y, 90))).toThrow(
      "pick_destination: destination is not on a ground floor (floors 70.34)",
    );
    expect(f.runtime.navigationState()).toMatchObject({
      destination: { x: start.x + 5, y: start.y, z: 90 },
      refusal: "pick_destination",
      floors: [70.34],
    });
    f.handle.goTo(point(start.x + 5, start.y, 70.34));
    expect(f.runtime.navigationState().active).toBe(true);
  });
});

describe("goTo redirect", () => {
  test("replacing an active route stops it with navigation_replaced and plans from the stopped pose", () => {
    jest.useFakeTimers();
    try {
      const f = fixture(() => [70.34]);
      const start = must(f.runtime.snapshot().pose);
      f.handle.goTo(point(start.x + 20, start.y));
      f.advance(1000);
      const midway = must(f.runtime.snapshot().pose);
      expect(midway.x).toBeGreaterThan(start.x + 6);
      f.events.length = 0;
      f.handle.goTo(point(midway.x, start.y + 10));
      expect(f.steer).toHaveBeenLastCalledWith("navigation_replaced");
      expect(
        f.events.map((event) => [event.type, event.reason ?? null]),
      ).toContainEqual(["movement_stopped", "navigation_replaced"]);
      expect(f.events.at(-2)?.type).toBe("movement_started");
      expect(f.runtime.navigationState()).toMatchObject({
        active: true,
        destination: { x: midway.x, y: start.y + 10 },
      });
      expect(must(f.runtime.navigationState().remaining)).toBeCloseTo(
        Math.hypot(midway.y - (start.y + 10), 0),
        1,
      );
      f.advance(3000);
      expect(f.runtime.navigationState()).toMatchObject({
        active: false,
        remaining: 0,
      });
      expect(f.runtime.snapshot().pose).toMatchObject({
        x: midway.x,
        y: start.y + 10,
      });
    } finally {
      jest.useRealTimers();
    }
  });

  test("an idle goto halts with the ordinary reason", () => {
    const f = fixture(() => [70.34]);
    const start = must(f.runtime.snapshot().pose);
    f.handle.goTo(point(start.x + 5, start.y));
    expect(f.steer).toHaveBeenLastCalledWith(undefined);
    expect(
      f.events.some((event) => event.reason === "navigation_replaced"),
    ).toBe(false);
  });
});

describe("goTo unreachable and lost destinations", () => {
  test("a mesh that cannot reach the destination refuses as unreachable with no motion", () => {
    const cases: Partial<NativeMap>[] = [
      {
        findPath: () => {
          throw new Error("pathfind_find_path failed (UNKNOWN_PATH)");
        },
      },
      { findPath: (from, to) => [from, { ...to, x: to.x - 3 }] },
      { findPath: (from) => [from] },
    ];
    for (const over of cases) {
      const f = fixture(() => [70.34], over);
      const start = must(f.runtime.snapshot().pose);
      expect(() => f.handle.goTo(point(start.x + 10, start.y))).toThrow(
        /^unreachable: /,
      );
      expect(f.runtime.navigationState()).toMatchObject({
        active: false,
        refusal: "unreachable",
      });
      expect(f.sent.filter((packet) => MOTION.has(packet.opcode))).toEqual([]);
    }
  });

  test("a creature destination stops as target_lost when it disappears, without replanning", () => {
    jest.useFakeTimers();
    try {
      const targets = new Map<bigint, NavPoint>();
      const f = fixture(() => [70.34], {}, targets);
      const start = must(f.runtime.snapshot().pose);
      targets.set(0x99n, { x: start.x + 30, y: start.y, z: 75 });
      f.handle.goTo({ guid: 0x99n, kind: "guid" });
      expect(f.runtime.navigationState()).toMatchObject({
        active: true,
        destination: { x: start.x + 30, y: start.y, z: 70.34 },
        target: 0x99n,
      });
      f.advance(1000);
      f.runtime.observeDisappear(0x98n);
      expect(f.runtime.navigationState().active).toBe(true);
      f.runtime.observeDisappear(0x99n);
      const lost = f.runtime.navigationState();
      expect(lost).toMatchObject({
        active: false,
        blockedReason: "target_lost",
        refusal: "stop",
        target: 0x99n,
      });
      expect(f.runtime.snapshot().moving).toBe(false);
      expect(f.events.at(-2)).toMatchObject({
        reason: "target_lost",
        type: "movement_stopped",
      });
      const stopped = f.runtime.snapshot().pose;
      const count = f.sent.length;
      f.advance(10_000);
      expect(f.sent.length).toBe(count);
      expect(f.runtime.snapshot().pose).toEqual(stopped);
      expect(f.runtime.navigationState()).toEqual(lost);
    } finally {
      jest.useRealTimers();
    }
  });

  test("an unobserved creature refuses before any motion", () => {
    const f = fixture(() => [70.34]);
    expect(() => f.handle.goTo({ guid: 0x99n, kind: "guid" })).toThrow(
      "stop: target_not_observed",
    );
    expect(f.runtime.navigationState()).toMatchObject({
      active: false,
      destination: undefined,
      target: 0x99n,
    });
    expect(f.sent.filter((packet) => MOTION.has(packet.opcode))).toEqual([]);
  });
});
