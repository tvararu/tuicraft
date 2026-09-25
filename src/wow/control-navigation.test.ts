import { expect, jest, test } from "bun:test";
import { lastMove, setup } from "test/control-fixtures";
import { must } from "test/must";
import { GroundRoute } from "wow/navigation";
import type { NativeMap } from "wow/navigation-native";
import { GameOpcode } from "wow/protocol/opcodes";

test("ground-route movement samples mesh height and HALT prevents lease renewal", () => {
  jest.useFakeTimers();
  try {
    const { runtime, advance, sent } = setup();
    const start = must(runtime.snapshot().pose);
    const destination = { x: start.x + 21, y: start.y, z: start.z + 3 };
    const height = (x: number): number =>
      start.z +
      Math.min(2, ((x - start.x) * 2) / 7) +
      Math.max(0, x - start.x - 7) / 14;
    const ground: NativeMap = {
      loadAdtAt() {},
      findHeights: (x) => [height(x)],
      findHeight: (_from, x) => height(x),
      lineOfSight: () => true,
      findPath: () => [],
      close() {},
    };
    const route = new GroundRoute(
      [
        { x: start.x, y: start.y, z: start.z },
        { x: start.x + 7, y: start.y, z: start.z + 2 },
        destination,
      ],
      ground,
    );
    runtime.navigate(route, destination);
    advance(1000);
    expect(runtime.snapshot().pose?.z).toBeCloseTo(start.z + 2);
    expect(runtime.snapshot().serverPose?.z).toBe(start.z);
    runtime.halt();
    const stopped = runtime.snapshot().pose;
    const count = sent.length;
    advance(10_000);
    expect(runtime.snapshot().pose).toEqual(stopped);
    expect(runtime.navigationState().active).toBe(false);
    expect(sent.length).toBe(count);
  } finally {
    jest.useRealTimers();
  }
});

test("tactical authority survives stationary waits but root stops navigation", () => {
  jest.useFakeTimers();
  try {
    const { runtime } = setup();
    runtime.setMode("jev");
    expect(runtime.snapshot().owner).toBe("jev");
    const start = must(runtime.snapshot().pose);
    const destination = { x: start.x + 20, y: start.y, z: start.z };
    const ground: NativeMap = {
      loadAdtAt() {},
      findHeights: () => [start.z],
      findHeight: () => start.z,
      lineOfSight: () => true,
      findPath: () => [],
      close() {},
    };
    runtime.navigate(
      new GroundRoute([start, destination], ground),
      destination,
    );
    runtime.forceRoot(1);
    expect(runtime.navigationState().active).toBe(false);
    expect(runtime.navigationState().blockedReason).toBe("root");
    runtime.setMode("none");
    expect(runtime.snapshot().owner).toBe("none");
  } finally {
    jest.useRealTimers();
  }
});

test("an old-origin route cannot reset a moving predicted pose", () => {
  jest.useFakeTimers();
  try {
    const { runtime, advance } = setup();
    const start = must(runtime.snapshot().pose);
    const destination = { x: start.x + 20, y: start.y, z: start.z };
    const ground: NativeMap = {
      loadAdtAt() {},
      findHeights: () => [start.z],
      findHeight: () => start.z,
      lineOfSight: () => true,
      findPath: () => [],
      close() {},
    };
    const route = new GroundRoute([start, destination], ground);
    runtime.navigate(route, destination);
    advance(300);
    const moving = must(runtime.snapshot().pose);
    expect(() => runtime.navigate(route, destination)).toThrow(/origin/);
    expect(must(runtime.snapshot().pose).x).toBeCloseTo(moving.x);
    expect(runtime.snapshot().moving).toBe(false);
  } finally {
    jest.useRealTimers();
  }
});

test("free movement integrates real ground height from findHeight query", () => {
  jest.useFakeTimers();
  try {
    const { runtime, advance } = setup({
      findHeight: (_mapId, _x, _y, from) => (from ? from.z - 2 : 68.34),
    });
    runtime.move("forward", 1000);
    advance(500);
    expect(runtime.snapshot().pose?.z).toBeCloseTo(68.34);
    advance(500);
    expect(runtime.snapshot().pose?.z).toBeCloseTo(66.34);
  } finally {
    jest.useRealTimers();
  }
});

test("free movement aborts and stops when ground height is unavailable", () => {
  jest.useFakeTimers();
  try {
    const { runtime, sent, events, advance } = setup({
      findHeight: () => undefined,
    });
    sent.length = 0;
    runtime.move("forward", 1000);
    expect(lastMove(sent).opcode).toBe(GameOpcode.MSG_MOVE_START_FORWARD);
    advance(500);
    expect(runtime.snapshot().moving).toBe(false);
    expect(lastMove(sent).opcode).toBe(GameOpcode.MSG_MOVE_STOP);
    expect(
      events.some(
        (e) =>
          e.type === "control_error" &&
          e.reason === "ground_height_unavailable",
      ),
    ).toBe(true);
  } finally {
    jest.useRealTimers();
  }
});

test("free movement stops with obstructed when an obstacle blocks forward path but ground is valid", () => {
  jest.useFakeTimers();
  try {
    const { runtime, sent, events, advance } = setup({
      findHeight: (_mapId, x, _y, from) => {
        if (Math.abs(x - 8709.46) < 0.1) return from?.z ?? 70.34;
      },
    });
    sent.length = 0;
    runtime.move("forward", 1000);
    expect(lastMove(sent).opcode).toBe(GameOpcode.MSG_MOVE_START_FORWARD);
    advance(500);
    expect(runtime.snapshot().moving).toBe(false);
    expect(runtime.snapshot().movementAllowed).toBe(true);
    expect(runtime.snapshot().blockedReason).toBe("obstructed");
    expect(runtime.snapshot().pose?.x).toBeCloseTo(8709.46);
    expect(lastMove(sent).opcode).toBe(GameOpcode.MSG_MOVE_STOP);
    expect(
      events.some(
        (e) => e.type === "movement_stopped" && e.reason === "obstructed",
      ),
    ).toBe(true);
    expect(events.some((e) => e.type === "control_error")).toBe(false);
  } finally {
    jest.useRealTimers();
  }
});

test("free movement stops with height_unresolved when the path ahead is clear but ambiguous", () => {
  jest.useFakeTimers();
  try {
    const { runtime, sent, events, advance } = setup({
      findHeight: (_mapId, x, _y, from) => {
        if (Math.abs(x - 8709.46) < 0.1) return from?.z ?? 70.34;
      },
      isPathClear: () => true,
    });
    sent.length = 0;
    runtime.move("forward", 1000);
    advance(500);
    expect(runtime.snapshot().moving).toBe(false);
    expect(runtime.snapshot().blockedReason).toBe("height_unresolved");
    expect(lastMove(sent).opcode).toBe(GameOpcode.MSG_MOVE_STOP);
    expect(
      events.some(
        (e) =>
          e.type === "movement_stopped" && e.reason === "height_unresolved",
      ),
    ).toBe(true);
  } finally {
    jest.useRealTimers();
  }
});

test("free movement stops with obstructed when the path ahead is not clear", () => {
  jest.useFakeTimers();
  try {
    const { runtime, sent, events, advance } = setup({
      findHeight: (_mapId, x, _y, from) => {
        if (Math.abs(x - 8709.46) < 0.1) return from?.z ?? 70.34;
      },
      isPathClear: () => false,
    });
    sent.length = 0;
    runtime.move("forward", 1000);
    advance(500);
    expect(runtime.snapshot().moving).toBe(false);
    expect(runtime.snapshot().blockedReason).toBe("obstructed");
    expect(
      events.some(
        (e) => e.type === "movement_stopped" && e.reason === "obstructed",
      ),
    ).toBe(true);
  } finally {
    jest.useRealTimers();
  }
});

test("movement away from an obstruction clears blockedReason and succeeds", () => {
  jest.useFakeTimers();
  try {
    const { runtime, sent, events, advance } = setup({
      findHeight: (_mapId, x, _y, from) => {
        if (x <= 8709.46) return from?.z ?? 70.34;
      },
    });
    runtime.move("forward", 1000);
    advance(500);
    expect(runtime.snapshot().blockedReason).toBe("obstructed");
    expect(runtime.snapshot().pose?.x).toBeCloseTo(8709.46);

    sent.length = 0;
    events.length = 0;
    runtime.move("backward", 1000);
    expect(runtime.snapshot().blockedReason).toBeUndefined();
    expect(lastMove(sent).opcode).toBe(GameOpcode.MSG_MOVE_START_BACKWARD);
    advance(500);
    expect(runtime.snapshot().pose?.x).toBeLessThan(8709.46);
    advance(500);
    expect(runtime.snapshot().moving).toBe(false);
    expect(runtime.snapshot().blockedReason).toBeUndefined();
    expect(events.some((e) => e.type === "control_error")).toBe(false);
  } finally {
    jest.useRealTimers();
  }
});

test("consecutive moves into an obstruction remain non-fatal and leave pose unchanged", () => {
  jest.useFakeTimers();
  try {
    const { runtime, events, advance } = setup({
      findHeight: (_mapId, x, _y, from) => {
        if (Math.abs(x - 8709.46) < 0.1) return from?.z ?? 70.34;
      },
    });
    for (let i = 0; i < 20; i++) {
      runtime.move("forward", 1000);
      advance(500);
      expect(runtime.snapshot().moving).toBe(false);
      expect(runtime.snapshot().blockedReason).toBe("obstructed");
      expect(runtime.snapshot().pose?.x).toBeCloseTo(8709.46);
    }
    expect(events.some((e) => e.type === "control_error")).toBe(false);
  } finally {
    jest.useRealTimers();
  }
});

test("explicit halt clears stale obstruction while obstruction halt preserves it", () => {
  jest.useFakeTimers();
  try {
    const { runtime, advance } = setup({
      findHeight: (_mapId, x, _y, from) => {
        if (Math.abs(x - 8709.46) < 0.1) return from?.z ?? 70.34;
      },
    });
    runtime.move("forward", 1000);
    advance(500);
    expect(runtime.snapshot().moving).toBe(false);
    expect(runtime.snapshot().blockedReason).toBe("obstructed");
    runtime.halt();
    expect(runtime.snapshot().moving).toBe(false);
    expect(runtime.snapshot().blockedReason).toBeUndefined();
    runtime.move("forward", 1000);
    advance(500);
    expect(runtime.snapshot().moving).toBe(false);
    expect(runtime.snapshot().blockedReason).toBe("obstructed");
  } finally {
    jest.useRealTimers();
  }
});

test("navigationError stores refusal and navigate clears refusal", () => {
  const { runtime } = setup();
  const dest = { x: 8730, y: -6600, z: 70 };
  runtime.navigationError(dest, "position disagrees with ground height");
  expect(runtime.navigationState()).toEqual({
    active: false,
    destination: dest,
    remaining: undefined,
    owner: "none",
    blockedReason: "position disagrees with ground height",
    refusal: "wait",
  });

  runtime.navigationError(dest, "ambiguous ground column");
  expect(runtime.navigationState().refusal).toBe("pick_destination");

  runtime.navigationError(dest, "pathfind_find_height failed (UNKNOWN_HEIGHT)");
  expect(runtime.navigationState().refusal).toBe("stop");

  const start = must(runtime.snapshot().pose);
  const destMatching = { ...dest, z: start.z };
  const ground: NativeMap = {
    loadAdtAt() {},
    findHeights: () => [start.z],
    findHeight: () => start.z,
    lineOfSight: () => true,
    findPath: () => [],
    close() {},
  };
  runtime.navigate(
    new GroundRoute([start, destMatching], ground),
    destMatching,
  );
  expect(runtime.navigationState().refusal).toBeUndefined();
  expect(runtime.navigationState().blockedReason).toBeUndefined();
});
