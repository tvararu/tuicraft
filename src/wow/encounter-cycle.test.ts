import { test, expect } from "bun:test";
import { EncounterCycleRuntime } from "wow/encounter-cycle";

function fakeTactics(outcomes: (string | Error)[]) {
  let calls = 0;
  return {
    calls: () => calls,
    start: async (
      _ctx: { targetGuid: bigint; instruction: string },
      _s: AbortSignal,
    ) => {
      const next = outcomes[calls++];
      if (next instanceof Error) throw next;
    },
    stop: (_r: string) => {},
    lastOutcome: () => undefined,
    selfDead: () => false,
  };
}

test("lost target records cause and advances, loop stops at end of queue", async () => {
  const tactics = fakeTactics([new Error("target_unreachable")]);
  const runtime = new EncounterCycleRuntime({ tactics, now: () => 0 });
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
  expect(events).toEqual(["started", "target_done", "target_done", "stopped"]);
});

test("stops at max starts with cause", async () => {
  const tactics = fakeTactics([]);
  const runtime = new EncounterCycleRuntime({ tactics, now: () => 0 });
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
  const runtime = new EncounterCycleRuntime({ tactics, now: () => 0 });
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
    lastOutcome: () => undefined,
    selfDead: () => false,
  };
  const runtime = new EncounterCycleRuntime({ tactics, now: () => 0 });
  const first = runtime.start({ guids: [1n], instruction: "a" });
  await Bun.sleep(0);
  const second = runtime.start({ guids: [2n], instruction: "b" });
  release();
  await Promise.all([first, second]);
  expect(runtime.snapshot().queue.map((r) => r.guid)).toEqual([2n]);
});
