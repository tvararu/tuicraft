import { expect, test } from "bun:test";
import { context, fixture, frame, judgment } from "test/tactics-fixtures";
import type { JevActionResult } from "wow/jev";

test("stop releases abort-insensitive preparation without activating later", async () => {
  const preparation = Promise.withResolvers<void>();
  const f = fixture({ prepare: () => preparation.promise });
  const started = f.tactics.start(context);
  f.tactics.stop("manual");
  await started;
  expect(f.halts).toBe(1);
  expect(f.tactics.snapshot().status).toBe("idle");
  preparation.resolve();
  await Promise.resolve();
  expect(f.activations).toBe(0);
  expect(f.actions).toEqual([]);
});

test("start resolves only after the decide loop records its outcome", async () => {
  let observations = 0;
  const f = fixture({
    minIntervalMs: 0,
    observe: () =>
      observations++ < 2
        ? frame
        : {
            ...frame,
            outcome: { status: "completed", reason: "credited kill" },
          },
  });
  let resolved = false;
  const running = f.tactics.start(context);
  void running.then(() => {
    resolved = true;
  });
  await f.requested;
  expect(resolved).toBe(false);
  expect(f.tactics.snapshot().lastOutcome).toBeUndefined();
  await running;
  expect(resolved).toBe(true);
  expect(f.tactics.snapshot()).toMatchObject({
    status: "idle",
    lastOutcome: { status: "completed", reason: "credited kill" },
  });
});

test("start blocked on the decide loop still resolves on external stop", async () => {
  const result = Promise.withResolvers<JevActionResult>();
  const f = fixture({ select: () => result.promise });
  const running = f.tactics.start(context);
  await f.requested;
  let resolved = false;
  void running.then(() => {
    resolved = true;
  });
  f.tactics.stop("manual");
  await running;
  expect(resolved).toBe(true);
  expect(f.tactics.snapshot().status).toBe("idle");
  result.resolve(judgment());
});

test("stopAndDefend ends the run through defense instead of halting", async () => {
  const result = Promise.withResolvers<JevActionResult>();
  const f = fixture({ select: () => result.promise });
  const running = f.tactics.start(context);
  await f.requested;
  expect(f.tactics.stopAndDefend("manual_override")).toBe(true);
  await running;
  expect(f).toMatchObject({ defenses: 1, halts: 0 });
  expect(f.tactics.snapshot()).toMatchObject({
    status: "idle",
    lastStopReason: "manual_override",
    defense: "auto_attack",
  });
  expect(f.tactics.stopAndDefend("manual_override")).toBe(false);
  expect(f.defenses).toBe(1);
  result.resolve(judgment());
});

test("replacement cannot overlap a pending provider call or activate after stop", async () => {
  const result = Promise.withResolvers<JevActionResult>();
  let calls = 0;
  const f = fixture({
    select: () => {
      calls += 1;
      return result.promise;
    },
  });
  const initial = f.tactics.start(context);
  await f.requested;
  const replacement = f.tactics.start({
    ...context,
    instruction: "Conserve mana",
  });
  f.tactics.stop("manual");
  await replacement;
  await initial;
  result.resolve(judgment());
  await Promise.resolve();
  await Promise.resolve();
  expect(calls).toBe(1);
  expect(f.activations).toBe(1);
  expect(f.actions).toEqual([]);
  expect(f.tactics.snapshot()).toMatchObject({
    status: "idle",
    instruction: "Conserve mana",
    lastResult: undefined,
  });
});

test("late results are discarded without overwriting a newer run's final state", async () => {
  const result = Promise.withResolvers<JevActionResult>();
  const discarded = Promise.withResolvers<void>();
  const f = fixture({ select: () => result.promise });
  const old = f.tactics.start(context);
  await f.requested;
  const oldId = f.tactics.snapshot().runId;
  f.tactics.stop("halt");
  await old;
  const next = f.tactics.start({ ...context, targetGuid: 2n });
  f.tactics.stop("manual");
  await next;
  const final = f.tactics.snapshot();
  f.tactics.onEvent((event) => {
    if (event.type === "discarded" && event.runId === oldId)
      discarded.resolve();
  });
  result.resolve(judgment());
  await discarded.promise;
  expect(f.actions).toEqual([]);
  expect(f.tactics.snapshot()).toEqual(final);
});

test("aborting the external signal synchronously halts active work", async () => {
  const result = Promise.withResolvers<JevActionResult>();
  const controller = new AbortController();
  const f = fixture({ select: () => result.promise });
  const running = f.tactics.start(context, controller.signal);
  await f.requested;
  controller.abort();
  await running;
  expect(f.halts).toBe(1);
  expect(f.tactics.snapshot()).toMatchObject({
    status: "idle",
    lastStopReason: "aborted",
  });
  result.resolve(judgment());
  await Promise.resolve();
  expect(f.actions).toEqual([]);
});
