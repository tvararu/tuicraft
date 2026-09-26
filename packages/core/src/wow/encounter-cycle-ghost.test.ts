import { expect, jest, test } from "bun:test";
import { Emitter } from "#lib/emitter";
import {
  dyingTactics,
  fakeRecovery,
} from "#test-support/cycle-recovery-fixtures";
import {
  advanceUntilSettled,
  fakeControl,
  fakeLoot,
  fakeTactics,
  makeCycle,
} from "#test-support/encounter-cycle-fixtures";
import type { EncounterCycleRuntime } from "#wow/encounter-cycle";
import type { RewardsEvent, RewardsState } from "#wow/rewards";

function ghostRun(config: {
  corpseX: number;
  refuseMoves?: number;
  stopReason?: string;
}) {
  let now = 0;
  const control = fakeControl({
    pose: {
      mapId: 0,
      x: 0,
      y: 0,
      z: 0,
      orientation: 0,
      source: "predicted",
      updatedAt: 0,
    },
    speed: 7,
    refuseMoves: config.refuseMoves,
    stopReason: config.stopReason,
  });
  const recovery = fakeRecovery({
    life: ["alive", "dead", "ghost", "alive"],
    corpse: {
      status: "found",
      mapId: 0,
      corpseMapId: 0,
      position: { x: config.corpseX, y: 0, z: 0 },
    },
    pose: () => control.pose(),
    now: () => now,
    reclaimDelaySchedule: [{ atMs: 0, delayMs: 30_000 }],
  });
  const tactics = dyingTactics(recovery);
  const runtime = makeCycle({
    tactics,
    loot: fakeLoot({ items: [], money: 0 }),
    recovery,
    control,
    now: () => now,
  });
  const run = async (totalMs: number) => {
    const started = runtime.start({ guids: [1n, 2n], instruction: "fight" });
    await advanceUntilSettled(started, totalMs, {
      onTick: (ms) => {
        now += ms;
      },
    });
  };
  return { control, runtime, run, tactics };
}

test("legs walk the ghost into range, reclaim and continue the queue", async () => {
  jest.useFakeTimers();
  try {
    const { control, runtime, run, tactics } = ghostRun({ corpseX: 200 });
    const events: string[] = [];
    runtime.onEvent((event) => events.push(event.type));
    await run(60_000);
    const state = runtime.snapshot();
    expect(state).toMatchObject({
      phase: "stopped",
      stopCause: "queue_exhausted",
      lastRecovery: { outcome: "reclaimed" },
    });
    expect(state.queue[0]).toMatchObject({ status: "skipped", cause: "died" });
    expect(state.queue[1]).toMatchObject({ status: "done" });
    expect(tactics.calls()).toBe(2);
    expect(events).toEqual([
      "started",
      "target_done",
      "recovery",
      "recovered",
      "loot_done",
      "target_done",
      "stopped",
    ]);
    const detail = state.lastRecovery?.detail as {
      range: number;
      legs: number;
    };
    expect(detail.range).toBeLessThanOrEqual(39);
    expect(detail.range).toBeGreaterThan(20);
    expect(detail.legs).toBe(control.moves().length);
    expect(detail.legs).toBeGreaterThan(1);
  } finally {
    jest.useRealTimers();
  }
});

test("a leg that does not move retries with a heading offset", async () => {
  jest.useFakeTimers();
  try {
    const { control, runtime, run } = ghostRun({
      corpseX: 100,
      refuseMoves: 1,
    });
    await run(60_000);
    expect(runtime.snapshot().lastRecovery?.outcome).toBe("reclaimed");
    const [first, second, third] = control.faced();
    expect(first).toBe(0);
    expect(second).toBeCloseTo(0.3);
    expect(third).toBeGreaterThan(Math.PI);
  } finally {
    jest.useRealTimers();
  }
});

test("a blocked stop after progress keeps the direct heading", async () => {
  jest.useFakeTimers();
  try {
    const { control, runtime, run } = ghostRun({
      corpseX: 200,
      stopReason: "height_unresolved",
    });
    await run(60_000);
    expect(runtime.snapshot().lastRecovery?.outcome).toBe("reclaimed");
    expect(control.faced().every((heading) => heading === 0)).toBe(true);
  } finally {
    jest.useRealTimers();
  }
});

test("stalled legs exhaust the offsets and stop unreachable", async () => {
  jest.useFakeTimers();
  try {
    const { control, runtime, run } = ghostRun({
      corpseX: 100,
      refuseMoves: 99,
    });
    await run(60_000);
    expect(runtime.snapshot()).toMatchObject({
      stopCause: "corpse_unreachable",
      stopDetail: { legs: 11, range: 100 },
    });
    expect(control.faced().length).toBe(11);
  } finally {
    jest.useRealTimers();
  }
});

test("the leg bound stops out of range with pose and range", async () => {
  jest.useFakeTimers();
  try {
    const { control, runtime, run } = ghostRun({ corpseX: 2000 });
    await run(200_000);
    const state = runtime.snapshot();
    expect(state).toMatchObject({
      stopCause: "corpse_out_of_range",
      stopDetail: { legs: 40 },
    });
    expect((state.stopDetail as { range: number }).range).toBeGreaterThan(39);
    expect(control.moves().length).toBe(40);
  } finally {
    jest.useRealTimers();
  }
});

test("phase resets to fighting at the start of each target", async () => {
  const seen: string[] = [];
  let runtime!: EncounterCycleRuntime;
  const tactics = {
    start: async () => {
      seen.push(runtime.snapshot().phase);
    },
    stop: (_r: string) => {},
    snapshot: () => ({
      lastOutcome: { status: "completed" as const, reason: "killed" },
    }),
  };
  runtime = makeCycle({
    tactics,
    loot: fakeLoot({ items: [], money: 0, coinageBefore: 5, coinageAfter: 5 }),
    recovery: fakeRecovery({ life: ["alive"] }),
    control: fakeControl(),
    now: () => 0,
  });
  await runtime.start({ guids: [1n, 2n], instruction: "fight" });
  expect(seen).toEqual(["fighting", "fighting"]);
  expect(runtime.snapshot()).toMatchObject({
    phase: "stopped",
    stopCause: "queue_exhausted",
  });
});

test("stale generation loot cleanup keeps the newer listener", async () => {
  jest.useFakeTimers();
  try {
    const emptyOpen = (): RewardsState => ({
      loot: {
        phase: "open",
        guid: 2n,
        lootType: 1,
        money: 0,
        items: [],
        openedAt: 0,
        invalidatedReason: undefined,
      },
      pending: undefined,
      inventory: {
        selfGuid: 1n,
        scope: "carried",
        status: "complete",
        coinage: 0,
        slots: [],
        bags: [],
        freeSlots: undefined,
        issues: [],
      },
      lastLootError: undefined,
      lastOpenFailure: undefined,
      lastInventoryError: undefined,
      lastItemPush: undefined,
      lastMoneyNotice: undefined,
      lastRelease: undefined,
      rolls: { last: undefined, pending: [] },
      disposed: false,
    });
    const listeners = new Emitter<[RewardsEvent]>();
    const closed = (): RewardsState => ({
      ...emptyOpen(),
      loot: { phase: "closed" },
    });
    const loot = {
      open: (_guid: bigint) => closed(),
      take: (_slot: number) => closed(),
      takeMoney: () => closed(),
      close() {
        queueMicrotask(() =>
          listeners.emit({
            type: "loot_release_observed",
            at: 0,
            state: {
              ...emptyOpen(),
              loot: { phase: "closed" },
              lastRelease: { guid: 2n, status: 1, observedAt: 0 },
            },
          }),
        );
        return closed();
      },
      onEvent(cb: (event: RewardsEvent) => void) {
        return listeners.subscribe(cb);
      },
      snapshot: closed,
    };
    const runtime = makeCycle({
      tactics: fakeTactics([]),
      loot,
      recovery: fakeRecovery({ life: ["alive"] }),
      control: fakeControl(),
      now: () => 0,
    });
    const flush = async (rounds: number) => {
      for (let i = 0; i < rounds; i++) await Promise.resolve();
    };
    const tick = async (ms: number, stepMs = 250) => {
      for (let elapsed = 0; elapsed < ms; elapsed += stepMs) {
        await flush(5);
        jest.advanceTimersByTime(stepMs);
      }
      await flush(20);
    };
    const first = runtime.start({ guids: [1n], instruction: "a" });
    await flush(20);
    await tick(2500);
    const second = runtime.start({ guids: [2n], instruction: "b" });
    await flush(20);
    await tick(2500);
    listeners.emit({ type: "loot_opened", at: 0, state: emptyOpen() });
    await flush(20);
    await tick(5000);
    await Promise.all([first, second]);
    expect(runtime.snapshot()).toMatchObject({
      stopCause: "queue_exhausted",
      lastLoot: { slotsTaken: [], moneyTaken: 0 },
    });
  } finally {
    jest.useRealTimers();
  }
});
