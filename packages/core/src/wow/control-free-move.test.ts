import { expect, jest, test } from "bun:test";
import { lastMove, setup } from "#test-support/control-fixtures";
import { must } from "#test-support/must";
import type { ControlDeps } from "#wow/control";
import { GameOpcode } from "#wow/protocol/opcodes";

const START_X = 8709.46;
const FORWARD_X = Math.cos(0.5);

function onlyUpTo(limitX: number): ControlDeps["findHeight"] {
  return (_mapId, x, _y, from) =>
    x <= limitX + 1e-6 ? (from?.z ?? 70.34) : undefined;
}

function faked(run: () => void): void {
  jest.useFakeTimers();
  try {
    run();
  } finally {
    jest.useRealTimers();
  }
}

test("a move whose first step has no ground is refused with its reason and sends nothing", () => {
  faked(() => {
    const cases: [Partial<ControlDeps>, string][] = [
      [{ findHeight: () => undefined }, "ground_height_unavailable"],
      [
        { findHeight: onlyUpTo(START_X), isPathClear: () => false },
        "obstructed",
      ],
      [
        { findHeight: onlyUpTo(START_X), isPathClear: () => true },
        "height_unresolved",
      ],
      [{ findHeight: (_mapId, x) => 70.34 + (x - START_X) * 3 }, "too_steep"],
      [{ findHeight: (_mapId, x) => 70.34 - (x - START_X) * 40 }, "too_steep"],
    ];
    for (const [ground, reason] of cases) {
      const { runtime, sent } = setup(ground);
      const before = must(runtime.snapshot().pose);
      sent.length = 0;
      expect(() => runtime.move("forward", 1000)).toThrow(reason);
      expect(sent).toEqual([]);
      expect(runtime.snapshot()).toMatchObject({
        moving: false,
        blockedReason: reason,
        pose: before,
      });
    }
  });
});

test("a leg stops at its last reachable half-yard step and keeps the reason", () => {
  faked(() => {
    const { runtime, sent, advance } = setup({
      findHeight: onlyUpTo(START_X + 1.2),
      isPathClear: () => false,
    });
    runtime.move("forward", 1000);
    advance(500);
    expect(runtime.snapshot()).toMatchObject({
      moving: false,
      blockedReason: "obstructed",
    });
    expect(must(runtime.snapshot().pose).x).toBeCloseTo(START_X + FORWARD_X, 4);
    expect(lastMove(sent).opcode).toBe(GameOpcode.MSG_MOVE_STOP);
  });
});

test("a leg follows sloped ground a half yard at a time", () => {
  faked(() => {
    const slope = (x: number) => 70.34 + (x - START_X) * 0.5;
    const { runtime, advance } = setup({
      findHeight: (_mapId, x) => slope(x),
    });
    runtime.move("forward", 1000);
    advance(500);
    const pose = must(runtime.snapshot().pose);
    expect(pose.x - START_X).toBeCloseTo(3.5 * FORWARD_X, 4);
    expect(pose.z).toBeCloseTo(slope(pose.x), 4);
    expect(runtime.snapshot().moving).toBe(true);
  });
});

test("backing away or halting clears a refused start", () => {
  faked(() => {
    const { runtime, advance } = setup({ findHeight: onlyUpTo(START_X) });
    expect(() => runtime.move("forward", 1000)).toThrow("obstructed");
    runtime.halt();
    expect(runtime.snapshot().blockedReason).toBeUndefined();
    expect(() => runtime.move("forward", 1000)).toThrow("obstructed");
    runtime.move("backward", 1000);
    expect(runtime.snapshot().blockedReason).toBeUndefined();
    advance(500);
    expect(must(runtime.snapshot().pose).x).toBeLessThan(START_X);
  });
});
