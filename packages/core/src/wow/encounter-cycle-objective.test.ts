import { expect, test } from "bun:test";
import { fakeRecovery } from "#test-support/cycle-recovery-fixtures";
import {
  fakeControl,
  fakeLoot,
  fakeTactics,
  makeCycle,
} from "#test-support/encounter-cycle-fixtures";
import { cycleStop } from "#wow/cycle-stop";
import type { CycleObjective } from "#wow/encounter-cycle";
import type { ObjectivePick, ObjectiveProgress } from "#wow/quest-objective";

function progress(current: number): ObjectiveProgress {
  return {
    complete: current >= 2,
    items: [],
    kills: [{ current, entry: 15_274, index: 0, required: 2 }],
    questId: 8325,
    slot: 0,
  };
}

function objective(picks: ObjectivePick[]) {
  const tried: bigint[][] = [];
  let kills = 0;
  const source: CycleObjective = {
    pick: (seen) => {
      tried.push([...seen]);
      const next = picks.shift();
      if (next === undefined) throw new Error("unexpected pick");
      return next;
    },
    progress: () => progress(kills++),
  };
  return { source, tried };
}

function cycle(outcomes: (string | Error)[], openError?: number) {
  const tactics = fakeTactics(outcomes);
  const runtime = makeCycle({
    control: fakeControl(),
    loot: fakeLoot({ openError }),
    now: () => 0,
    recovery: fakeRecovery({ life: ["alive"] }),
    tactics,
  });
  return { runtime, tactics };
}

const target = (guid: bigint): ObjectivePick => ({
  distance: 5,
  entry: 15_274,
  guid,
  kind: "target",
});

test("an objective run fights picked targets until the server log is complete", async () => {
  const { runtime, tactics } = cycle(["ok", "ok"]);
  const { source, tried } = objective([
    target(1n),
    target(2n),
    { kind: "complete", progress: progress(2) },
  ]);
  await runtime.start({
    guids: [],
    instruction: "fight",
    maxStarts: 5,
    objective: source,
  });
  const state = runtime.snapshot();
  expect(tactics.calls()).toBe(2);
  expect(tried).toEqual([[], [1n], [1n, 2n]]);
  expect(state.queue.map((record) => record.guid)).toEqual([1n, 2n]);
  expect(state.stopCause).toBe("objective_complete");
  expect(state.objective?.kills[0]?.current).toBe(2);
});

test("a refused target is skipped and never picked again", async () => {
  const { runtime } = cycle([new Error("target_friendly"), "ok"]);
  const { source, tried } = objective([
    target(1n),
    target(2n),
    cycleStop("objective_targets_absent", { entries: [15_274] }),
  ]);
  await runtime.start({
    guids: [],
    instruction: "fight",
    maxStarts: 5,
    objective: source,
  });
  const state = runtime.snapshot();
  expect(state.queue[0]).toMatchObject({
    cause: "target_friendly",
    status: "skipped",
  });
  expect(tried.at(-1)).toEqual([1n, 2n]);
  expect(state.stopCause).toBe("objective_targets_absent");
  expect(state.stopDetail).toEqual({ entries: [15_274] });
});

test("the start budget stops an objective run before another fight", async () => {
  const { runtime, tactics } = cycle(["ok"]);
  const { source } = objective([target(1n), target(2n)]);
  await runtime.start({
    guids: [],
    instruction: "fight",
    maxStarts: 1,
    objective: source,
  });
  expect(tactics.calls()).toBe(1);
  expect(runtime.snapshot().stopCause).toBe("max_starts_reached");
});

test("resuming an objective run continues picking without retrying old targets", async () => {
  const { runtime, tactics } = cycle(["ok", "ok"]);
  const { source, tried } = objective([
    target(1n),
    cycleStop("objective_targets_out_of_reach", { distance: 60 }),
    target(2n),
    { kind: "complete", progress: progress(2) },
  ]);
  await runtime.start({
    guids: [],
    instruction: "fight",
    maxStarts: 5,
    objective: source,
  });
  expect(runtime.snapshot().stopCause).toBe("objective_targets_out_of_reach");
  await runtime.resume({});
  expect(tactics.calls()).toBe(2);
  expect(tried.at(-1)).toEqual([1n, 2n]);
  expect(runtime.snapshot().stopCause).toBe("objective_complete");
});

test("a loot stop still reports the server progress of the last kill", async () => {
  const { runtime } = cycle(["ok"], 4);
  const { source } = objective([target(2n)]);
  await runtime.start({
    guids: [],
    instruction: "fight",
    maxStarts: 5,
    objective: source,
  });
  const state = runtime.snapshot();
  expect(state.stopCause).toBe("loot_denied:4");
  expect(state.objective?.kills[0]?.current).toBe(1);
});
