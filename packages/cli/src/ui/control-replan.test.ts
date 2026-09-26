import { afterEach, beforeEach, describe, expect, jest, test } from "bun:test";
import { setup } from "@tuicraft/core/test-support/control-fixtures";
import {
  GameOpcode,
  GroundRoute,
  groundError,
  type NativeMap,
  type NavPoint,
  observeNavigation,
  REPLAN_LIMITS,
  RouteSession,
} from "@tuicraft/core/test-support/internals";
import { must } from "@tuicraft/core/test-support/must";
import {
  formatControlEventObj,
  formatControlStateObj,
} from "#ui/format-control";

const UNKNOWN = "pathfind_find_height failed (UNKNOWN_HEIGHT)";

function scene() {
  const f = setup();
  const start = must(f.runtime.snapshot().pose);
  const destination = { x: start.x + 20, y: start.y, z: start.z };
  const ground = { failing: true };
  const map: NativeMap = {
    loadAdtAt() {},
    findHeights: () => [start.z],
    findHeight: (_from, x) => {
      const along = x - start.x;
      if (ground.failing && along > 3.05 && along < 3.2)
        throw groundError(UNKNOWN);
      return start.z;
    },
    lineOfSight: () => true,
    findPath: () => [],
    close() {},
  };
  const origins: NavPoint[] = [];
  const route = (from: NavPoint) => new GroundRoute([from, destination], map);
  const origin = { x: start.x, y: start.y, z: start.z };
  return { ...f, start, destination, ground, origins, route, origin };
}

function stops(events: { type: string; reason?: string }[]): string[] {
  return events
    .filter((event) => event.type === "movement_stopped")
    .map((event) => event.reason ?? "");
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe("bounded replanning", () => {
  test("a mid-walk ground refusal stops, then replans from the stopped pose and arrives", () => {
    const s = scene();
    s.runtime.navigate(s.route(s.origin), s.destination, (from) => {
      s.origins.push(from);
      s.ground.failing = false;
      return s.route(from);
    });
    s.advance(300);
    s.advance(140);
    const stopped = must(s.runtime.snapshot().pose);
    expect(stopped.x - s.start.x).toBeCloseTo(2.1, 5);
    expect(s.runtime.snapshot().moving).toBe(false);
    expect(s.sent.at(-1)?.opcode).toBe(GameOpcode.MSG_MOVE_STOP);
    expect(s.runtime.navigationState()).toMatchObject({
      active: false,
      blockedReason: UNKNOWN,
      replan: { plans: 1, pending: true, interruptions: [UNKNOWN] },
    });
    s.advance(REPLAN_LIMITS.delayMs);
    expect(s.origins).toEqual([{ x: stopped.x, y: stopped.y, z: stopped.z }]);
    expect(s.runtime.navigationState()).toMatchObject({
      active: true,
      blockedReason: undefined,
      replan: { plans: 2, pending: false },
    });
    s.advance(4000);
    const done = s.runtime.navigationState();
    expect(done).toMatchObject({
      active: false,
      remaining: 0,
      blockedReason: undefined,
      replan: { plans: 2, interruptions: [UNKNOWN] },
    });
    expect(must(done.replan).traveled).toBeCloseTo(20, 5);
    expect(s.runtime.snapshot().pose).toMatchObject({
      x: s.destination.x,
      y: s.destination.y,
    });
    expect(stops(s.events)).toEqual([UNKNOWN, "arrived"]);
    expect(
      s.events.some(
        (event) =>
          event.type === "control_changed" && event.reason === "replanned",
      ),
    ).toBe(true);
  });

  test("a mid-walk ground refusal awaiting its replan gives no manual advice", () => {
    const s = scene();
    s.runtime.navigate(s.route(s.origin), s.destination, (from) => {
      s.ground.failing = false;
      return s.route(from);
    });
    s.advance(300);
    s.advance(140);
    const control = [
      formatControlStateObj(s.runtime.snapshot()),
      ...s.events.map(formatControlEventObj),
    ];
    expect(control.map(({ blockedReason }) => blockedReason)).toContain(
      UNKNOWN,
    );
    expect(control.map(({ nextStep }) => nextStep)).toEqual(
      control.map(() => null),
    );
    const navigation = observeNavigation(s.runtime.navigationState());
    expect(navigation).toMatchObject({
      blockedReason: UNKNOWN,
      replan: { pending: true },
    });
    expect(navigation.nextStep).toContain("Wait for navigation");
    s.advance(REPLAN_LIMITS.delayMs);
    expect(s.runtime.navigationState().active).toBe(true);
  });

  test("a refused replan is a terminal stop with its reason and counts", () => {
    const s = scene();
    let calls = 0;
    s.runtime.navigate(s.route(s.origin), s.destination, () => {
      calls++;
      throw groundError(UNKNOWN);
    });
    s.advance(300);
    s.advance(140);
    s.advance(REPLAN_LIMITS.delayMs);
    const state = s.runtime.navigationState();
    expect(state).toMatchObject({
      active: false,
      blockedReason: `replan_refused: ${UNKNOWN}`,
      refusal: "stop",
      replan: { plans: 1, pending: false, interruptions: [UNKNOWN] },
    });
    expect(s.events.at(-1)).toMatchObject({
      reason: `replan_refused: ${UNKNOWN}`,
      type: "control_error",
    });
    const count = s.sent.length;
    s.advance(60_000);
    expect(calls).toBe(1);
    expect(s.sent.length).toBe(count);
    expect(s.runtime.navigationState()).toEqual(state);
  });

  test("a refusal before meaningful displacement stops without replanning", () => {
    const s = scene();
    const replan = jest.fn((from: NavPoint) => s.route(from));
    s.runtime.navigate(s.route(s.origin), s.destination, replan);
    s.advance(440);
    s.advance(REPLAN_LIMITS.delayMs);
    expect(replan).not.toHaveBeenCalled();
    expect(s.runtime.navigationState()).toMatchObject({
      active: false,
      blockedReason: "replan_no_progress",
      replan: { plans: 1, interruptions: [UNKNOWN] },
    });
  });

  test("HALT during the replan delay cancels it", () => {
    const s = scene();
    const replan = jest.fn((from: NavPoint) => s.route(from));
    s.runtime.navigate(s.route(s.origin), s.destination, replan);
    s.advance(300);
    s.advance(140);
    s.runtime.halt();
    s.advance(10_000);
    expect(replan).not.toHaveBeenCalled();
    expect(s.runtime.snapshot().moving).toBe(false);
    expect(s.runtime.navigationState()).toMatchObject({
      active: false,
      blockedReason: "halt",
      replan: { plans: 1, pending: false },
    });
  });

  test("a server correction replans from the observed server pose", () => {
    const s = scene();
    s.ground.failing = false;
    const replan = jest.fn((from: NavPoint) => s.route(from));
    s.runtime.navigate(s.route(s.origin), s.destination, replan);
    s.advance(500);
    const corrected = { ...s.origin, x: s.start.x + 3, orientation: 0 };
    s.runtime.observeSelf({ position: { mapId: 530, ...corrected } });
    expect(s.runtime.navigationState()).toMatchObject({
      blockedReason: "server_correction",
      replan: { pending: true },
    });
    s.advance(REPLAN_LIMITS.delayMs);
    expect(replan).toHaveBeenCalledWith({
      x: corrected.x,
      y: corrected.y,
      z: corrected.z,
    });
    expect(s.runtime.navigationState().active).toBe(true);
  });

  test("other stops never replan", () => {
    const s = scene();
    s.ground.failing = false;
    const replan = jest.fn((from: NavPoint) => s.route(from));
    s.runtime.navigate(s.route(s.origin), s.destination, replan);
    s.advance(500);
    s.runtime.forceRoot(1);
    s.advance(10_000);
    expect(replan).not.toHaveBeenCalled();
    expect(s.runtime.navigationState()).toMatchObject({
      blockedReason: "root",
      replan: { plans: 1, pending: false },
    });
  });

  test("target loss cancels a pending replan and ends a replanned route", () => {
    const pending = scene();
    const unused = jest.fn((from: NavPoint) => pending.route(from));
    pending.runtime.navigate(
      pending.route(pending.origin),
      pending.destination,
      unused,
      0x99n,
    );
    pending.advance(300);
    pending.advance(140);
    pending.runtime.observeDisappear(0x98n);
    expect(pending.runtime.navigationState().replan?.pending).toBe(true);
    pending.runtime.observeDisappear(0x99n);
    pending.advance(10_000);
    expect(unused).not.toHaveBeenCalled();
    expect(pending.runtime.navigationState()).toMatchObject({
      active: false,
      blockedReason: "target_lost",
      replan: { plans: 1, pending: false },
      target: 0x99n,
    });

    const s = scene();
    s.runtime.navigate(
      s.route(s.origin),
      s.destination,
      (from) => {
        s.ground.failing = false;
        return s.route(from);
      },
      0x99n,
    );
    s.advance(300);
    s.advance(140);
    s.advance(REPLAN_LIMITS.delayMs);
    expect(s.runtime.navigationState()).toMatchObject({
      active: true,
      replan: { plans: 2 },
      target: 0x99n,
    });
    s.runtime.observeDisappear(0x99n);
    expect(s.runtime.navigationState()).toMatchObject({
      active: false,
      blockedReason: "target_lost",
    });
    expect(stops(s.events)).toEqual([UNKNOWN, "target_lost"]);
  });
});

describe("RouteSession limits", () => {
  const map: NativeMap = {
    loadAdtAt() {},
    findHeights: () => [0],
    findHeight: () => 0,
    lineOfSight: () => true,
    findPath: () => [],
    close() {},
  };
  const leg = (x: number) =>
    new GroundRoute(
      [
        { x, y: 0, z: 0 },
        { x: x + 10, y: 0, z: 0 },
      ],
      map,
    );
  const session = () => new RouteSession(() => leg(0), leg(0), 1000);

  test("requires displacement from the previous plan origin", () => {
    const s = session();
    expect(s.limitReached({ x: 1.9, y: 0, z: 0 })).toBe("replan_no_progress");
    expect(s.limitReached({ x: 2, y: 0, z: 0 })).toBeUndefined();
    s.planned(leg(5));
    expect(s.limitReached({ x: 6, y: 0, z: 0 })).toBe("replan_no_progress");
  });

  test("caps plans, elapsed time and distance walked", () => {
    const plans = session();
    for (let i = 1; i < REPLAN_LIMITS.plans; i++) plans.planned(leg(i * 3));
    expect(plans.limitReached({ x: 50, y: 0, z: 0 })).toBe("replan_plan_limit");

    const time = session();
    time.settle(1000 + REPLAN_LIMITS.elapsedMs + 1);
    expect(time.limitReached({ x: 5, y: 0, z: 0 })).toBe("replan_time_limit");

    const distance = session();
    distance.walked(REPLAN_LIMITS.traveledFloor, 2000);
    expect(distance.limitReached({ x: 5, y: 0, z: 0 })).toBe(
      "replan_distance_limit",
    );
    expect(distance.snapshot().limits.traveled).toBe(
      REPLAN_LIMITS.traveledFloor,
    );
  });
});
