import { describe, expect, jest, test } from "bun:test";
import { lastMove, setup } from "test/control-fixtures";
import { must } from "test/must";
import { GameOpcode } from "wow/protocol/opcodes";

describe("ControlRuntime", () => {
  test("login verify is server pose and claims active mover", () => {
    jest.useFakeTimers();
    try {
      const { runtime, sent } = setup();
      const state = runtime.snapshot();
      expect(state.pose?.source).toBe("server");
      expect(state.pose?.mapId).toBe(530);
      expect(state.serverPose?.x).toBeCloseTo(8709.46, 2);
      expect(state.moving).toBe(false);
      expect(must(sent[0]).opcode).toBe(GameOpcode.CMSG_SET_ACTIVE_MOVER);
    } finally {
      jest.useRealTimers();
    }
  });

  test("move then halt predicts displacement and keeps server pose", () => {
    jest.useFakeTimers();
    try {
      const { runtime, sent, events, advance } = setup();
      sent.length = 0;
      runtime.move("forward", 1000);
      expect(lastMove(sent).opcode).toBe(GameOpcode.MSG_MOVE_START_FORWARD);
      expect(runtime.snapshot().pose?.source).toBe("predicted");
      expect(runtime.snapshot().owner).toBe("manual");
      advance(1000);
      expect(runtime.snapshot().moving).toBe(false);
      const pose = must(runtime.snapshot().pose);
      expect(pose.source).toBe("predicted");
      expect(pose.x).toBeCloseTo(8709.46 + Math.cos(0.5) * 7, 5);
      expect(pose.y).toBeCloseTo(-6671.76 + Math.sin(0.5) * 7, 5);
      expect(pose.z).toBeCloseTo(70.34, 5);
      expect(runtime.snapshot().serverPose?.x).toBeCloseTo(8709.46, 2);
      expect(events.some((e) => e.type === "movement_started")).toBe(true);
      expect(events.some((e) => e.type === "movement_stopped")).toBe(true);
      expect(lastMove(sent).opcode).toBe(GameOpcode.MSG_MOVE_STOP);
    } finally {
      jest.useRealTimers();
    }
  });

  test("repeating the same direction renews the lease without a second start", () => {
    jest.useFakeTimers();
    try {
      const { runtime, sent, advance } = setup();
      sent.length = 0;
      runtime.move("forward", 400);
      const starts = sent.filter(
        (p) => p.opcode === GameOpcode.MSG_MOVE_START_FORWARD,
      );
      expect(starts).toHaveLength(1);
      runtime.move("forward", 800);
      expect(
        sent.filter((p) => p.opcode === GameOpcode.MSG_MOVE_START_FORWARD),
      ).toHaveLength(1);
      advance(400);
      expect(runtime.snapshot().moving).toBe(true);
      advance(400);
      expect(runtime.snapshot().moving).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });
  test("directed walk stops at the requested distance without overshooting", async () => {
    jest.useFakeTimers();
    try {
      const { runtime, sent, advance } = setup({ isPathClear: () => true });
      const start = must(runtime.snapshot().pose);
      const walk = runtime.walkToward(
        { x: start.x + 10, y: start.y, z: start.z },
        3,
      );
      advance(500);
      const result = await walk;
      expect(result).toMatchObject({
        status: "completed",
        traveled: 3,
        pose: { source: "predicted" },
      });
      expect(result.pose.x).toBeCloseTo(start.x + 3, 4);
      expect(result.pose.y).toBeCloseTo(start.y, 4);
      expect(runtime.snapshot().moving).toBe(false);
      expect(sent.at(-1)?.opcode).toBe(GameOpcode.MSG_MOVE_STOP);
    } finally {
      jest.useRealTimers();
    }
  });
  test("directed walk stops at a nearer sampled target", async () => {
    jest.useFakeTimers();
    try {
      const { runtime, advance } = setup({ isPathClear: () => true });
      const start = must(runtime.snapshot().pose);
      const walk = runtime.walkToward(
        { x: start.x + 1, y: start.y, z: start.z },
        5,
      );
      advance(200);
      const outcome = await walk;
      expect(outcome).toMatchObject({ status: "completed", traveled: 1 });
      expect(outcome.pose.x).toBeCloseTo(start.x + 1, 4);
      expect(runtime.snapshot().moving).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });

  test("directed walk halts on abort and cannot cancel a later manual owner", async () => {
    jest.useFakeTimers();
    try {
      const { runtime, sent, advance } = setup({ isPathClear: () => true });
      const start = must(runtime.snapshot().pose);
      const abort = new AbortController();
      const walk = runtime.walkToward(
        { x: start.x + 12, y: start.y, z: start.z },
        10,
        abort.signal,
      );
      advance(200);
      abort.abort();
      expect(await walk).toMatchObject({ status: "stopped", reason: "abort" });
      expect(runtime.snapshot().moving).toBe(false);
      expect(sent.at(-1)?.opcode).toBe(GameOpcode.MSG_MOVE_STOP);
      runtime.move("forward", 500);
      abort.abort();
      expect(runtime.snapshot().moving).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  test("directed walk checks intervening ground after a delayed timer", async () => {
    jest.useFakeTimers();
    try {
      let now = 10_000;
      const startX = 8709.46;
      const { runtime, advance } = setup({
        now: () => now,
        ticks: () => now - 10_000,
        findHeight: (_map, x, _y, from) => {
          if (x > startX + 0.5 && x < startX + 1.5) return;
          return from?.z ?? 70.34;
        },
      });
      const start = must(runtime.snapshot().pose);
      const walk = runtime.walkToward(
        { x: start.x + 4, y: start.y, z: start.z },
        4,
      );
      now += 600;
      advance(100);
      const result = await walk;
      expect(result).toMatchObject({
        status: "stopped",
        reason: "obstructed",
      });
      expect(result.traveled).toBeLessThanOrEqual(0.5);
      expect(result.pose.x).toBeLessThanOrEqual(startX + 0.5);
    } finally {
      jest.useRealTimers();
    }
  });
  test("directed walk refuses a wall despite valid ground heights", async () => {
    jest.useFakeTimers();
    try {
      const { runtime, advance } = setup({
        findHeight: () => 70.34,
        isPathClear: () => false,
      });
      const start = must(runtime.snapshot().pose);
      const walk = runtime.walkToward(
        { x: start.x + 4, y: start.y, z: start.z },
        4,
      );
      advance(1000);
      const result = await walk;
      expect(result).toMatchObject({
        status: "stopped",
        reason: "obstructed",
        traveled: 0,
      });
      expect(result.pose.x).toBeCloseTo(start.x, 4);
    } finally {
      jest.useRealTimers();
    }
  });

  test("directed walk refuses ground that cannot connect back to the origin", async () => {
    jest.useFakeTimers();
    try {
      const originX = 8709.46;
      const { runtime, advance } = setup({
        findHeight: (_map, x, _y, from) =>
          from && from.x > originX && x === originX ? 71.34 : 70.34,
        isPathClear: () => true,
      });
      const start = must(runtime.snapshot().pose);
      const walk = runtime.walkToward(
        { x: start.x + 4, y: start.y, z: start.z },
        4,
      );
      advance(1000);
      const result = await walk;
      expect(result).toMatchObject({
        status: "stopped",
        traveled: 0,
      });
      expect(result.pose.x).toBeCloseTo(start.x, 4);
    } finally {
      jest.useRealTimers();
    }
  });

  test("slow but progressing directed walk outlives the safety lease", async () => {
    jest.useFakeTimers();
    try {
      const { runtime, advance } = setup({ isPathClear: () => true });
      runtime.observeSelf({ runSpeed: 1 });
      const start = must(runtime.snapshot().pose);
      const walk = runtime.walkToward(
        { x: start.x + 15, y: start.y, z: start.z },
        15,
      );
      advance(10_000);
      expect(runtime.snapshot().moving).toBe(true);
      advance(5000);
      expect(await walk).toMatchObject({ status: "completed", traveled: 15 });
    } finally {
      jest.useRealTimers();
    }
  });

  test("directed walk refuses zero speed instead of hanging under a lease", () => {
    jest.useFakeTimers();
    const { runtime, sent } = setup();
    try {
      runtime.observeSelf({ runSpeed: 0 });
      const pose = must(runtime.snapshot().pose);
      sent.length = 0;
      let failure: unknown;
      try {
        const pending = runtime.walkToward(
          { x: pose.x + 4, y: pose.y, z: pose.z },
          4,
        );
        runtime.halt();
        void pending;
      } catch (error) {
        failure = error;
      }
      expect(failure).toEqual(new Error("missing_speed"));
      expect(runtime.walkActive()).toBe(false);
      expect(sent).toHaveLength(0);
    } finally {
      runtime.halt();
      jest.useRealTimers();
    }
  });

  test("changing direction stops then starts without resetting pose", () => {
    jest.useFakeTimers();
    try {
      const { runtime, sent, advance } = setup();
      sent.length = 0;
      runtime.move("forward", 2000);
      advance(500);
      const mid = must(runtime.snapshot().pose);
      expect(mid.x).toBeCloseTo(8709.46 + Math.cos(0.5) * 7 * 0.5, 5);
      sent.length = 0;
      runtime.move("left", 2000);
      expect(sent.map((p) => p.opcode)).toEqual([
        GameOpcode.MSG_MOVE_STOP,
        GameOpcode.MSG_MOVE_START_STRAFE_LEFT,
      ]);
      expect(runtime.snapshot().moving).toBe(true);
      expect(runtime.snapshot().direction).toBe("left");
      const switched = must(runtime.snapshot().pose);
      expect(switched.x).toBeCloseTo(mid.x, 5);
      expect(switched.y).toBeCloseTo(mid.y, 5);
      advance(500);
      const leftHeading = 0.5 + Math.PI / 2;
      const after = must(runtime.snapshot().pose);
      expect(after.x).toBeCloseTo(mid.x + Math.cos(leftHeading) * 7 * 0.5, 5);
      expect(after.y).toBeCloseTo(mid.y + Math.sin(leftHeading) * 7 * 0.5, 5);
    } finally {
      jest.useRealTimers();
    }
  });
});
