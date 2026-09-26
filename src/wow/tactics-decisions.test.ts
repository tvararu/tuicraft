import { expect, test } from "bun:test";
import { must } from "test/must";
import { context, fixture, frame, judgment } from "test/tactics-fixtures";
import type { JevActionResult } from "wow/jev";

test("current capability loss rejects an otherwise fresh action", async () => {
  const result = Promise.withResolvers<JevActionResult>();
  let available = true;
  const f = fixture({
    observe: () => (available ? frame : { observation: {}, candidates: [] }),
    select: () => result.promise,
  });
  const discarded = Promise.withResolvers<void>();
  const requested = Promise.withResolvers<void>();
  f.tactics.onEvent((event) => {
    if (event.type === "discarded") discarded.resolve();
    if (event.type === "request") requested.resolve();
  });
  const running = f.tactics.start(context);
  try {
    await requested.promise;
    available = false;
    result.resolve(judgment());
    await discarded.promise;
    expect(f.actions).toEqual([]);
    expect(f.tactics.snapshot().lastDecision).toMatchObject({
      disposition: "discarded",
      reason: "unavailable",
    });
  } finally {
    f.tactics.dispose();
    await running;
  }
});

test("unrelated world updates and low confidence do not starve legal decisions", async () => {
  const result = Promise.withResolvers<JevActionResult>();
  let sequence = 1;
  const applied = Promise.withResolvers<void>();
  const f = fixture({
    observe: () => ({ ...frame, observation: { sequence } }),
    select: () => result.promise,
  });
  const requestSeen = Promise.withResolvers<void>();
  f.tactics.onEvent((event) => {
    if (event.type === "applied") applied.resolve();
    if (event.type === "request") requestSeen.resolve();
  });
  const running = f.tactics.start(context);
  try {
    await requestSeen.promise;
    sequence = 100;
    result.resolve(judgment());
    await applied.promise;
    expect(f.actions).toEqual(["smite"]);
    expect(f.tactics.snapshot().lastResult?.confidence).toBe(0.01);
  } finally {
    f.tactics.dispose();
    await running;
  }
});

test("outcome observed before execution prevents a late cast and preserves final state", async () => {
  const result = Promise.withResolvers<JevActionResult>();
  let completed = false;
  const f = fixture({
    select: () => result.promise,
    observe: () =>
      completed
        ? {
            ...frame,
            observation: { ...frame.observation, targetHealth: 0 },
            outcome: { status: "completed", reason: "credited kill" },
          }
        : frame,
  });
  const running = f.tactics.start(context);
  await f.requested;
  completed = true;
  result.resolve(judgment());
  await running;
  await f.stopped;
  expect(f.actions).toEqual([]);
  expect(f.tactics.snapshot()).toMatchObject({
    status: "idle",
    lastOutcome: {
      status: "completed",
      reason: "credited kill",
      observation: { ...frame.observation, targetHealth: 0 },
    },
  });
});

test("a pre-request block retains isolated terminal observations without fake inference", async () => {
  const observation = {
    unavailable: [{ id: "spell:17", reason: "unobserved_shapeshift_form" }],
  };
  const f = fixture({
    observe: () => ({
      observation,
      candidates: [],
      outcome: { status: "blocked", reason: "no_supported_combat_actions" },
    }),
  });
  await f.tactics.start(context);
  await f.stopped;
  must(observation.unavailable[0]).reason = "changed after completion";
  const expected = {
    unavailable: [{ id: "spell:17", reason: "unobserved_shapeshift_form" }],
  };
  expect(f.tactics.snapshot().lastOutcome).toMatchObject({
    observation: expected,
  });
  expect(f.events.find((event) => event.type === "outcome")).toMatchObject({
    observation: expected,
  });
  expect(f.tactics.snapshot().lastRequest).toBeUndefined();
  expect(f.events.some((event) => event.type === "request")).toBe(false);
  expect(f.calls).toBe(0);
});

test("a server rejection stop defends, other blocks halt", async () => {
  const stop = async (reason: string) => {
    const f = fixture({
      observe: () => ({ ...frame, outcome: { status: "blocked", reason } }),
    });
    await f.tactics.start(context);
    await f.stopped;
    return {
      defenses: f.defenses,
      halts: f.halts,
      state: f.tactics.snapshot(),
    };
  };
  const rejected = await stop("server_action_rejected:bad_facing");
  expect(rejected).toMatchObject({ defenses: 1, halts: 0 });
  expect(rejected.state.defense).toBe("auto_attack");
  const blocked = await stop("no_supported_combat_actions");
  expect(blocked).toMatchObject({ defenses: 0, halts: 1 });
  expect(blocked.state.defense).toBeUndefined();
});

test("provider failure terminates explicitly without hidden retries", async () => {
  const f = fixture({
    select: async () => {
      throw new Error("Malformed TypeSafe Choice response");
    },
  });
  await f.tactics.start(context);
  await f.stopped;
  expect(f.actions).toEqual([]);
  expect(f.defenses).toBe(1);
  expect(f.halts).toBe(0);
  expect(f.events.filter((event) => event.type === "request")).toHaveLength(1);
  expect(f.tactics.snapshot()).toMatchObject({
    status: "idle",
    lastOutcome: {
      status: "failed",
      reason: "Malformed TypeSafe Choice response",
    },
  });
});

test("wait-only frames skip inference until useful choices appear", async () => {
  let useful = false;
  let calls = 0;
  const f = fixture({
    minIntervalMs: 0,
    observe: () => (useful ? frame : { observation: {}, candidates: [] }),
    select: () => {
      calls += 1;
      return Promise.resolve(judgment());
    },
  });
  const running = f.tactics.start(context);
  try {
    await Promise.resolve();
    expect(calls).toBe(0);
    useful = true;
    await f.requested;
    expect(calls).toBe(1);
    const request = f.tactics.snapshot().lastRequest;
    expect(request?.candidates.map((candidate) => candidate.id)).toEqual([
      "smite",
      "wait",
    ]);
  } finally {
    f.tactics.dispose();
    await running;
  }
});

test("stale replies cannot execute", async () => {
  let now = 0;
  const discarded = Promise.withResolvers<void>();
  const f = fixture({
    now: () => now,
    maxResultAgeMs: 50,
    select: async () => {
      now = 100;
      return judgment();
    },
  });
  f.tactics.onEvent((event) => {
    if (event.type === "discarded") discarded.resolve();
  });
  const running = f.tactics.start(context);
  try {
    await discarded.promise;
    expect(f.actions).toEqual([]);
    expect(f.tactics.snapshot().lastDiscardReason).toBe("stale_age");
  } finally {
    f.tactics.dispose();
    await running;
  }
});

test("current-world execution rejection is retained rather than reported as applied", async () => {
  const discarded = Promise.withResolvers<void>();
  const f = fixture({
    execute: () => {
      throw new Error("out_of_range");
    },
  });
  f.tactics.onEvent((event) => {
    if (event.type === "discarded") discarded.resolve();
  });
  const running = f.tactics.start(context);
  try {
    await discarded.promise;
    expect(f.tactics.snapshot().lastDecision).toEqual({
      actionId: "smite",
      disposition: "discarded",
      reason: "out_of_range",
    });
  } finally {
    f.tactics.dispose();
    await running;
  }
});
