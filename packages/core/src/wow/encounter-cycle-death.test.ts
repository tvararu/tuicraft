import { expect, jest, test } from "bun:test";
import {
  dyingTactics,
  fakeRecovery,
} from "#test-support/cycle-recovery-fixtures";
import {
  advanceUntilSettled,
  fakeControl,
  fakeLoot,
  makeCycle,
} from "#test-support/encounter-cycle-fixtures";

function nearCorpseRun(options: { deaths?: number; lootError?: number } = {}) {
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
    life: ["alive", "dead", "ghost", "alive"],
    corpse: {
      status: "found",
      mapId: 0,
      corpseMapId: 0,
      position: { x: 5, y: 0, z: 0 },
    },
    pose: () => control.pose(),
  });
  const tactics = dyingTactics(recovery, options.deaths ?? 1);
  const loot = fakeLoot({ items: [], money: 0, openError: options.lootError });
  const open = loot.open;
  loot.open = (guid) => {
    if (options.lootError !== undefined) recovery.die();
    return open(guid);
  };
  const runtime = makeCycle({
    tactics,
    loot,
    recovery,
    control,
    now: () => 7,
  });
  const events: string[] = [];
  runtime.onEvent((event) => events.push(event.type));
  return { events, runtime, tactics };
}

test("a death on the last target is still recovered before the cycle ends", async () => {
  const { events, runtime } = nearCorpseRun();
  await runtime.start({ guids: [1n], instruction: "fight" });
  expect(runtime.snapshot()).toMatchObject({
    stopCause: "queue_exhausted",
    lastRecovery: { outcome: "reclaimed", at: 7 },
  });
  expect(runtime.snapshot().queue[0]).toMatchObject({
    status: "skipped",
    cause: "died",
  });
  expect(events).toEqual([
    "started",
    "target_done",
    "recovery",
    "recovered",
    "stopped",
  ]);
});

test("a halt during recovery resumes by finishing recovery, then fighting", async () => {
  const { events, runtime, tactics } = nearCorpseRun();
  runtime.onEvent((event) => {
    if (event.type === "recovery" && event.state.resumes === 0)
      runtime.stop("halt");
  });
  await runtime.start({ guids: [1n, 2n], instruction: "fight" });
  expect(runtime.snapshot()).toMatchObject({
    currentIndex: 1,
    lastRecovery: undefined,
    stopCause: "halt",
  });
  await runtime.resume({});
  expect(tactics.calls()).toBe(2);
  expect(runtime.snapshot()).toMatchObject({
    stopCause: "queue_exhausted",
    lastRecovery: { outcome: "reclaimed" },
  });
  expect(runtime.snapshot().queue.map((record) => record.status)).toEqual([
    "skipped",
    "done",
  ]);
  expect(events).toEqual([
    "started",
    "target_done",
    "recovery",
    "stopped",
    "resumed",
    "recovery",
    "recovered",
    "loot_done",
    "target_done",
    "stopped",
  ]);
});

test("a loot failure after a death is recorded, then recovery continues", async () => {
  const { runtime } = nearCorpseRun({ deaths: 0, lootError: 3 });
  await runtime.start({ guids: [1n], instruction: "fight" });
  const state = runtime.snapshot();
  expect(state.queue[0]).toMatchObject({
    cause: "loot_denied:3",
    status: "done",
  });
  expect(state).toMatchObject({
    lastRecovery: { outcome: "reclaimed" },
    stopCause: "queue_exhausted",
  });
});

test("resume after a failed recovery on the last target recovers, then ends", async () => {
  jest.useFakeTimers();
  try {
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
      refuseMoves: 11,
      speed: 7,
    });
    const recovery = fakeRecovery({
      life: ["alive", "dead", "ghost", "alive"],
      corpse: {
        status: "found",
        mapId: 0,
        corpseMapId: 0,
        position: { x: 100, y: 0, z: 0 },
      },
      pose: () => control.pose(),
      now: () => now,
    });
    const runtime = makeCycle({
      tactics: dyingTactics(recovery),
      loot: fakeLoot({ items: [], money: 0 }),
      recovery,
      control,
      now: () => now,
    });
    const tick = { onTick: (ms: number) => (now += ms) };
    await advanceUntilSettled(
      runtime.start({ guids: [1n], instruction: "fight" }),
      60_000,
      tick,
    );
    expect(runtime.snapshot().stopCause).toBe("corpse_unreachable");
    await advanceUntilSettled(runtime.resume({}), 60_000, tick);
    expect(runtime.snapshot()).toMatchObject({
      lastRecovery: { outcome: "reclaimed" },
      resumes: 1,
      stopCause: "queue_exhausted",
    });
    await expect(runtime.resume({})).rejects.toThrow("cycle_nothing_to_resume");
  } finally {
    jest.useRealTimers();
  }
});
