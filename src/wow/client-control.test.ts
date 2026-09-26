import { describe, expect, jest, test } from "bun:test";
import { setup } from "test/control-fixtures";
import { must } from "test/must";
import { controlMethods } from "wow/client-control";
import { createNavigation, type NavPoint } from "wow/navigation";
import type { NativeMap } from "wow/navigation-native";
import { GameOpcode } from "wow/protocol/opcodes";
import type { Runtimes } from "wow/runtime";
import type { WorldConn } from "wow/world-conn";

const MOTION = new Set<number>([
  GameOpcode.MSG_MOVE_START_FORWARD,
  GameOpcode.MSG_MOVE_SET_FACING,
]);

function ground(columns: (x: number, y: number) => number[]): NativeMap {
  return {
    loadAdtAt() {},
    findHeights: columns,
    findHeight: (from, x, y) =>
      columns(x, y).find((z) => Math.abs(z - from.z) <= 2) ?? Number.NaN,
    lineOfSight: () => true,
    findPath: (from: NavPoint, to: NavPoint) => [from, to],
    close() {},
  };
}

function fixture(columns: (x: number, y: number) => number[]) {
  const control = setup();
  const navigation = createNavigation(
    { dataPath: "data", libraryPath: "lib" },
    () => ground(columns),
  );
  const override = jest.fn((reason?: string) => control.runtime.halt(reason));
  const rt = {
    control: control.runtime,
    navigation: () => navigation,
    override,
  } as unknown as Runtimes;
  const handle = controlMethods({} as WorldConn, rt);
  return { ...control, handle, override };
}

describe("goTo without Z", () => {
  test("derives destination height from a unique column and walks there", () => {
    jest.useFakeTimers();
    try {
      const f = fixture((x) => [70.34 + (x - 8709.46) / 10]);
      const start = must(f.runtime.snapshot().pose);
      f.handle.goTo(start.x + 10, start.y);
      expect(f.override).toHaveBeenCalled();
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

  test("refuses an ambiguous column at pick_destination before any motion", () => {
    const f = fixture((x) =>
      x > 8715 ? [70.34, 80.34] : [70.34 + (x - 8709.46) / 100],
    );
    const start = must(f.runtime.snapshot().pose);
    expect(() => f.handle.goTo(start.x + 10, start.y)).toThrow(
      "pick_destination: ambiguous ground column",
    );
    expect(f.runtime.navigationState()).toMatchObject({
      active: false,
      destination: { x: start.x + 10, y: start.y },
      refusal: "pick_destination",
    });
    expect(f.runtime.navigationState().destination).not.toHaveProperty("z");
    expect(f.sent.filter((packet) => MOTION.has(packet.opcode))).toEqual([]);
    expect(f.runtime.snapshot().moving).toBe(false);
  });

  test("keeps an explicit Z on the grounded-point plan", () => {
    const f = fixture(() => [70.34]);
    const start = must(f.runtime.snapshot().pose);
    expect(() => f.handle.goTo(start.x + 5, start.y, 90)).toThrow(
      "wait: position disagrees with ground height",
    );
    expect(f.runtime.navigationState().destination).toEqual({
      x: start.x + 5,
      y: start.y,
      z: 90,
    });
    f.handle.goTo(start.x + 5, start.y, 70.34);
    expect(f.runtime.navigationState().active).toBe(true);
  });
});

describe("goTo redirect", () => {
  test("replacing an active route stops it with navigation_replaced and plans from the stopped pose", () => {
    jest.useFakeTimers();
    try {
      const f = fixture(() => [70.34]);
      const start = must(f.runtime.snapshot().pose);
      f.handle.goTo(start.x + 20, start.y);
      f.advance(1000);
      const midway = must(f.runtime.snapshot().pose);
      expect(midway.x).toBeGreaterThan(start.x + 6);
      f.events.length = 0;
      f.handle.goTo(midway.x, start.y + 10);
      expect(f.override).toHaveBeenLastCalledWith("navigation_replaced");
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
    f.handle.goTo(start.x + 5, start.y);
    expect(f.override).toHaveBeenLastCalledWith(undefined);
    expect(
      f.events.some((event) => event.reason === "navigation_replaced"),
    ).toBe(false);
  });
});
