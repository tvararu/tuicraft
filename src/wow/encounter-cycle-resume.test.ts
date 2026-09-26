import { expect, test } from "bun:test";
import { fakeRecovery } from "test/cycle-recovery-fixtures";
import {
  fakeControl,
  fakeLoot,
  makeCycle,
} from "test/encounter-cycle-fixtures";
import type { CycleDeps, CycleEvent } from "wow/encounter-cycle";

type Fought = { guid: bigint; instruction: string };
type HaltableTactics = CycleDeps["tactics"] & {
  fought: Fought[];
  holdNext: () => Promise<void>;
};

function haltableTactics(): HaltableTactics {
  const fought: Fought[] = [];
  let hold = false;
  let entered = Promise.withResolvers<void>();
  return {
    fought,
    holdNext: () => {
      hold = true;
      entered = Promise.withResolvers<void>();
      return entered.promise;
    },
    start: (
      ctx: { targetGuid: bigint; instruction: string },
      signal?: AbortSignal,
    ) => {
      fought.push({ guid: ctx.targetGuid, instruction: ctx.instruction });
      if (!hold) return Promise.resolve();
      hold = false;
      entered.resolve();
      const ended = Promise.withResolvers<void>();
      signal?.addEventListener("abort", () => ended.resolve(), { once: true });
      return ended.promise;
    },
    stop: (_reason: string) => {},
    snapshot: () => ({
      lastOutcome: { reason: "killed", status: "completed" as const },
    }),
  };
}

function cycleWith(tactics: HaltableTactics) {
  return makeCycle({
    tactics,
    loot: fakeLoot({ items: [], money: 0 }),
    recovery: fakeRecovery({ life: ["alive"] }),
    control: fakeControl(),
    now: () => 0,
  });
}

test("resume after a mid-fight halt refights the halted target and finishes", async () => {
  const tactics = haltableTactics();
  const runtime = cycleWith(tactics);
  const events: CycleEvent[] = [];
  runtime.onEvent((event) => events.push(event));
  const fighting = tactics.holdNext();
  const running = runtime.start({ guids: [1n, 2n], instruction: "fight" });
  await fighting;
  runtime.stop("halt");
  await running;
  expect(runtime.snapshot()).toMatchObject({ active: false, currentIndex: 0 });
  expect(runtime.snapshot().queue[0]?.status).toBe("queued");
  await runtime.resume({});
  expect(tactics.fought.map((f) => f.guid)).toEqual([1n, 1n, 2n]);
  expect(runtime.snapshot()).toMatchObject({
    resumes: 1,
    stopCause: "queue_exhausted",
    instruction: "fight",
  });
  expect(runtime.snapshot().queue.map((r) => r.status)).toEqual([
    "done",
    "done",
  ]);
  expect(events.map((e) => e.type)).toEqual([
    "started",
    "stopped",
    "resumed",
    "loot_done",
    "target_done",
    "loot_done",
    "target_done",
    "stopped",
  ]);
});

test("resume after a halt during loot does not refight the done target", async () => {
  const tactics = haltableTactics();
  const runtime = cycleWith(tactics);
  runtime.onEvent((event) => {
    if (event.type === "loot_done" && event.state.resumes === 0)
      runtime.stop("halt");
  });
  await runtime.start({ guids: [1n, 2n], instruction: "fight" });
  expect(runtime.snapshot().queue[0]?.status).toBe("done");
  await runtime.resume({});
  expect(tactics.fought.map((f) => f.guid)).toEqual([1n, 2n]);
  expect(runtime.snapshot().stopCause).toBe("queue_exhausted");
});

test("resume with an instruction changes it for the remaining fights", async () => {
  const tactics = haltableTactics();
  const runtime = cycleWith(tactics);
  const fighting = tactics.holdNext();
  const running = runtime.start({ guids: [1n, 2n], instruction: "fight" });
  await fighting;
  runtime.stop("halt");
  await running;
  const resumed: CycleEvent[] = [];
  runtime.onEvent((event) => {
    if (event.type === "resumed") resumed.push(event);
  });
  await runtime.resume({ instruction: "kite", maxStarts: 5 });
  expect(tactics.fought.map((f) => f.instruction)).toEqual([
    "fight",
    "kite",
    "kite",
  ]);
  expect(resumed[0]?.state).toMatchObject({
    instruction: "kite",
    maxStarts: 5,
    startsUsed: 0,
    resumes: 1,
  });
});

test("resume gives a fresh start budget after max starts", async () => {
  const tactics = haltableTactics();
  const runtime = cycleWith(tactics);
  await runtime.start({ guids: [1n, 2n], instruction: "fight", maxStarts: 1 });
  expect(runtime.snapshot().stopCause).toBe("max_starts_reached");
  await runtime.resume({});
  expect(tactics.fought.map((f) => f.guid)).toEqual([1n, 2n]);
  expect(runtime.snapshot()).toMatchObject({
    startsUsed: 1,
    stopCause: "queue_exhausted",
  });
});

test("resume is refused while active, with nothing queued, or a bad max", async () => {
  const tactics = haltableTactics();
  const runtime = cycleWith(tactics);
  await expect(runtime.resume({})).rejects.toThrow("cycle_nothing_to_resume");
  const fighting = tactics.holdNext();
  const running = runtime.start({ guids: [1n], instruction: "fight" });
  await fighting;
  await expect(runtime.resume({})).rejects.toThrow("cycle_active");
  runtime.stop("halt");
  await running;
  await expect(runtime.resume({ maxStarts: 0 })).rejects.toThrow(
    "cycle_invalid_max",
  );
  await runtime.resume({});
  await expect(runtime.resume({})).rejects.toThrow("cycle_nothing_to_resume");
});
