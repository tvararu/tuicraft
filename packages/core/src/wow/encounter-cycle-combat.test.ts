import { expect, test } from "bun:test";
import { fakeRecovery } from "#test-support/cycle-recovery-fixtures";
import {
  fakeControl,
  fakeLoot,
  fakeTactics,
  makeCycle,
} from "#test-support/encounter-cycle-fixtures";

test("lost target records cause and advances, loop stops at end of queue", async () => {
  const tactics = fakeTactics([new Error("target_unreachable")]);
  const loot = fakeLoot({});
  const runtime = makeCycle({
    tactics,
    loot,
    recovery: fakeRecovery({ life: ["alive"] }),
    control: fakeControl(),
    now: () => 0,
  });
  const events: string[] = [];
  runtime.onEvent((e) => events.push(e.type));
  await runtime.start({ guids: [1n, 2n], instruction: "fight", maxStarts: 5 });
  const state = runtime.snapshot();
  expect(state.queue[0]).toMatchObject({
    status: "skipped",
    cause: "target_unreachable",
  });
  expect(tactics.calls()).toBe(2);
  expect(state.phase).toBe("stopped");
  expect(events).toEqual([
    "started",
    "target_done",
    "loot_done",
    "target_done",
    "stopped",
  ]);
});

test("blocked outcome skips without loot and advances", async () => {
  let starts = 0;
  const tactics = {
    start: async (
      _ctx: { targetGuid: bigint; instruction: string },
      _signal?: AbortSignal,
    ) => {
      starts++;
    },
    stop: (_reason: string) => {},
    snapshot: () => ({
      lastOutcome: { status: "blocked" as const, reason: "obstructed" },
    }),
  };
  const loot = fakeLoot({});
  const openedGuids: bigint[] = [];
  const innerOpen = loot.open;
  loot.open = (guid) => {
    openedGuids.push(guid);
    return innerOpen(guid);
  };
  const runtime = makeCycle({
    tactics,
    loot,
    recovery: fakeRecovery({ life: ["alive"] }),
    control: fakeControl(),
    now: () => 0,
  });
  const events: string[] = [];
  runtime.onEvent((event) => events.push(event.type));
  await runtime.start({ guids: [1n, 2n], instruction: "fight", maxStarts: 5 });
  const state = runtime.snapshot();
  expect(state.queue[0]).toMatchObject({
    status: "skipped",
    cause: "obstructed",
  });
  expect(state.queue[1]).toMatchObject({
    status: "skipped",
    cause: "obstructed",
  });
  expect(starts).toBe(2);
  expect(openedGuids).toEqual([]);
  expect(events).toEqual(["started", "target_done", "target_done", "stopped"]);
  expect(state.lastLoot).toBeUndefined();
  expect(state.stopCause).toBe("queue_exhausted");
});

test("stop alone ends the running fight", async () => {
  const stops: string[] = [];
  const fighting = Promise.withResolvers<void>();
  const tactics = {
    start: (
      _ctx: { targetGuid: bigint; instruction: string },
      signal?: AbortSignal,
    ) => {
      fighting.resolve();
      const ended = Promise.withResolvers<void>();
      signal?.addEventListener("abort", () => ended.resolve(), { once: true });
      return ended.promise;
    },
    stop: (reason: string) => {
      stops.push(reason);
    },
    snapshot: () => ({ lastOutcome: undefined }),
  };
  const runtime = makeCycle({
    tactics,
    loot: fakeLoot({}),
    recovery: fakeRecovery({ life: ["alive"] }),
    control: fakeControl(),
    now: () => 0,
  });
  const running = runtime.start({ guids: [1n, 2n], instruction: "fight" });
  await fighting.promise;
  runtime.stop("halt");
  await running;
  expect(stops).toEqual(["halt"]);
  expect(runtime.snapshot()).toMatchObject({
    active: false,
    stopCause: "halt",
    startsUsed: 1,
  });
});

test("a stop during loot_done emits nothing after stopped", async () => {
  const runtime = makeCycle({
    tactics: fakeTactics([]),
    loot: fakeLoot({ items: [], money: 0 }),
    recovery: fakeRecovery({ life: ["alive"] }),
    control: fakeControl(),
    now: () => 0,
  });
  const events: string[] = [];
  runtime.onEvent((event) => {
    events.push(event.type);
    if (event.type === "loot_done") runtime.stop("halt");
  });
  await runtime.start({ guids: [1n, 2n], instruction: "fight" });
  expect(events).toEqual(["started", "loot_done", "stopped"]);
  expect(runtime.snapshot()).toMatchObject({
    currentIndex: 0,
    stopCause: "halt",
  });
});

test("stops at max starts with cause", async () => {
  const tactics = fakeTactics([]);
  const loot = fakeLoot({});
  const runtime = makeCycle({
    tactics,
    loot,
    recovery: fakeRecovery({ life: ["alive"] }),
    control: fakeControl(),
    now: () => 0,
  });
  await runtime.start({
    guids: [1n, 2n, 3n],
    instruction: "fight",
    maxStarts: 2,
  });
  expect(runtime.snapshot()).toMatchObject({
    stopCause: "max_starts_reached",
    startsUsed: 2,
  });
});

test("empty queue and bad max throw", async () => {
  const tactics = fakeTactics([]);
  const loot = fakeLoot({});
  const runtime = makeCycle({
    tactics,
    loot,
    recovery: fakeRecovery({ life: ["alive"] }),
    control: fakeControl(),
    now: () => 0,
  });
  await expect(
    runtime.start({ guids: [], instruction: "fight" }),
  ).rejects.toThrow("cycle_empty_queue");
  await expect(
    runtime.start({ guids: [1n], instruction: "fight", maxStarts: 0 }),
  ).rejects.toThrow("cycle_invalid_max");
});

test("second start replaces the first", async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const tactics = {
    calls: 0,
    start: async () => {
      tactics.calls++;
      await gate;
    },
    stop: (_r: string) => {},
    snapshot: () => ({
      lastOutcome: { status: "completed" as const, reason: "killed" },
    }),
  };
  const loot = fakeLoot({});
  const runtime = makeCycle({
    tactics,
    loot,
    recovery: fakeRecovery({ life: ["alive"] }),
    control: fakeControl(),
    now: () => 0,
  });
  const first = runtime.start({ guids: [1n], instruction: "a" });
  const second = runtime.start({ guids: [2n], instruction: "b" });
  release();
  await Promise.all([first, second]);
  expect(runtime.snapshot().queue.map((r) => r.guid)).toEqual([2n]);
  expect(tactics.calls).toBe(2);
});
