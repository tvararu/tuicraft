import { expect, jest, test } from "bun:test";
import { fakeRecovery } from "#test-support/cycle-recovery-fixtures";
import {
  advanceUntilSettled,
  fakeControl,
  fakeLoot,
  fakeTactics,
  makeCycle,
} from "#test-support/encounter-cycle-fixtures";

test("a cycle started dead waits out the reclaim delay, then fights", async () => {
  jest.useFakeTimers();
  try {
    let now = 0;
    const advance = (ms: number) => {
      now += ms;
    };
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
    });
    const recovery = fakeRecovery({
      life: ["dead", "ghost", "alive"],
      corpse: {
        status: "found",
        mapId: 0,
        corpseMapId: 0,
        position: { x: 5, y: 0, z: 0 },
      },
      pose: () => control.pose(),
      now: () => now,
      reclaimDelaySchedule: [
        { atMs: 0, delayMs: 5000 },
        { atMs: 6000, delayMs: 6000 },
      ],
    });
    const runtime = makeCycle({
      tactics: fakeTactics([]),
      loot: fakeLoot({ items: [], money: 0 }),
      recovery,
      control,
      now: () => now,
    });
    const started = runtime.start({ guids: [1n], instruction: "fight" });
    await advanceUntilSettled(started, 16_000, { onTick: advance });
    const state = runtime.snapshot();
    expect(state).toMatchObject({
      phase: "stopped",
      stopCause: "queue_exhausted",
      lastRecovery: { outcome: "reclaimed" },
    });
    expect(state.queue[0]?.status).toBe("done");
  } finally {
    jest.useRealTimers();
  }
});

test("cross-map corpse stops with pose and range", async () => {
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
  });
  const recovery = fakeRecovery({
    life: ["dead", "ghost"],
    corpse: {
      status: "found",
      mapId: 1,
      corpseMapId: 1,
      position: { x: 5, y: 0, z: 0 },
    },
    pose: () => control.pose(),
  });
  const runtime = makeCycle({
    tactics: fakeTactics([]),
    loot: fakeLoot({ items: [], money: 0 }),
    recovery,
    control,
    now: () => 0,
  });
  await runtime.start({ guids: [1n], instruction: "fight" });
  const state = runtime.snapshot();
  expect(state.stopCause).toBe("corpse_out_of_range");
  expect(state.stopDetail).toMatchObject({
    pose: { mapId: 0, x: 0, y: 0, z: 0 },
  });
  expect(control.moves()).toEqual([]);
});

test("a refused corpse-run move stops with its reason", async () => {
  jest.useFakeTimers();
  try {
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
      moveError: "movement_blocked",
    });
    const recovery = fakeRecovery({
      life: ["dead", "ghost"],
      corpse: {
        status: "found",
        mapId: 0,
        corpseMapId: 0,
        position: { x: 100, y: 0, z: 0 },
      },
      pose: () => control.pose(),
    });
    const runtime = makeCycle({
      tactics: fakeTactics([]),
      loot: fakeLoot({ items: [], money: 0 }),
      recovery,
      control,
      now: () => 0,
    });
    const started = runtime.start({ guids: [1n], instruction: "fight" });
    await advanceUntilSettled(started, 8000);
    expect(runtime.snapshot()).toMatchObject({
      stopCause: "corpse_unreachable",
      stopDetail: { error: "movement_blocked" },
    });
    expect(control.moves().length).toBe(1);
  } finally {
    jest.useRealTimers();
  }
});
