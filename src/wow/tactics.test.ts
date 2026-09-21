import { test, expect, jest } from "bun:test";
import type { JevActionResult } from "wow/jev";
import {
  TacticsLoop,
  type TacticsContext,
  type TacticsDeps,
  type TacticsEvent,
  type TacticsFrame,
} from "wow/tactics";

const context: TacticsContext = {
  targetGuid: 0xabcden,
  instruction: "Defeat the target and stay alive",
};
const frame: TacticsFrame = {
  observation: { self: { health: 100 }, targetHealth: 60, sequence: 1 },
  candidates: [
    { id: "smite", description: "Cast the learned damage spell at the target" },
  ],
};

function judgment(choice = "smite"): JevActionResult {
  return {
    choice,
    probabilities: { smite: 0.51, wait: 0.49 },
    confidence: 0.01,
    model: "jev-1.13.0",
    inputTokens: 18,
    elapsedMs: 12,
  };
}

function fixture(over: Partial<TacticsDeps> = {}) {
  const events: TacticsEvent[] = [];
  const actions: string[] = [];
  const stopped = Promise.withResolvers<void>();
  const requested = Promise.withResolvers<void>();
  let halts = 0;
  let activations = 0;
  let calls = 0;
  const tactics = new TacticsLoop({
    apiKey: "ts_test_key",
    prepare: async () => {},
    activate: () => {
      activations += 1;
    },
    observe: () => frame,
    execute: (id) => {
      actions.push(id);
    },
    halt: () => {
      halts += 1;
    },
    select: async () => {
      calls += 1;
      return judgment();
    },
    ...over,
  });
  tactics.onEvent((event) => {
    events.push(event);
    if (event.type === "stopped") stopped.resolve();
    if (event.type === "request") requested.resolve();
  });
  return {
    tactics,
    events,
    actions,
    stopped: stopped.promise,
    requested: requested.promise,
    get halts() {
      return halts;
    },
    get activations() {
      return activations;
    },
    get calls() {
      return calls;
    },
  };
}

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

test("start resolves after activation rather than waiting for encounter completion", async () => {
  const result = Promise.withResolvers<JevActionResult>();
  const f = fixture({ select: () => result.promise });
  try {
    await f.tactics.start(context);
    expect(f.tactics.snapshot().status).toBe("active");
    expect(f.activations).toBe(1);
    expect(f.actions).toEqual([]);
  } finally {
    f.tactics.dispose();
    result.resolve(judgment());
  }
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
  await f.tactics.start(context);
  await f.requested;
  const replacement = f.tactics.start({
    ...context,
    instruction: "Conserve mana",
  });
  f.tactics.stop("manual");
  await replacement;
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
  await f.tactics.start(context);
  const oldId = f.tactics.snapshot().runId;
  f.tactics.stop("halt");
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
  await f.tactics.start(context, controller.signal);
  controller.abort();
  expect(f.halts).toBe(1);
  expect(f.tactics.snapshot()).toMatchObject({
    status: "idle",
    lastStopReason: "aborted",
  });
  result.resolve(judgment());
  await Promise.resolve();
  expect(f.actions).toEqual([]);
});

test("current capability loss rejects an otherwise fresh action", async () => {
  const result = Promise.withResolvers<JevActionResult>();
  let available = true;
  const f = fixture({
    observe: () => (available ? frame : { observation: {}, candidates: [] }),
    select: () => result.promise,
  });
  const discarded = Promise.withResolvers<void>();
  f.tactics.onEvent((event) => {
    if (event.type === "discarded") discarded.resolve();
  });
  try {
    await f.tactics.start(context);
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
  f.tactics.onEvent((event) => {
    if (event.type === "applied") applied.resolve();
  });
  try {
    await f.tactics.start(context);
    sequence = 100;
    result.resolve(judgment());
    await applied.promise;
    expect(f.actions).toEqual(["smite"]);
    expect(f.tactics.snapshot().lastResult?.confidence).toBe(0.01);
  } finally {
    f.tactics.dispose();
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
  await f.tactics.start(context);
  completed = true;
  result.resolve(judgment());
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
  observation.unavailable[0]!.reason = "changed after completion";
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

test("provider failure terminates explicitly without hidden retries", async () => {
  const f = fixture({
    select: async () => {
      throw new Error("Malformed TypeSafe Choice response");
    },
  });
  await f.tactics.start(context);
  await f.stopped;
  expect(f.actions).toEqual([]);
  expect(f.events.filter((event) => event.type === "request")).toHaveLength(1);
  expect(f.tactics.snapshot()).toMatchObject({
    status: "idle",
    lastOutcome: {
      status: "failed",
      reason: "Malformed TypeSafe Choice response",
    },
  });
});

test("provider timeout halts even if the provider ignores abort", async () => {
  jest.useFakeTimers();
  const result = Promise.withResolvers<JevActionResult>();
  const f = fixture({ requestTimeoutMs: 500, select: () => result.promise });
  try {
    await f.tactics.start(context);
    jest.advanceTimersByTime(500);
    await f.stopped;
    expect(f.halts).toBe(1);
    expect(f.tactics.snapshot().lastOutcome).toEqual({
      status: "failed",
      reason: "jev_timeout",
    });
    result.resolve(judgment());
    await Promise.resolve();
    expect(f.actions).toEqual([]);
  } finally {
    f.tactics.dispose();
    jest.useRealTimers();
  }
});

test("wait-only frames skip inference until useful choices appear", async () => {
  jest.useFakeTimers();
  let useful = false;
  let observations = 0;
  const waiting = Promise.withResolvers<void>();
  const result = Promise.withResolvers<JevActionResult>();
  let calls = 0;
  const f = fixture({
    observe: () => {
      observations += 1;
      if (observations === 2) waiting.resolve();
      return useful ? frame : { observation: {}, candidates: [] };
    },
    select: () => {
      calls += 1;
      return result.promise;
    },
  });
  try {
    await f.tactics.start(context);
    jest.advanceTimersByTime(200);
    await waiting.promise;
    expect(calls).toBe(0);
    useful = true;
    jest.advanceTimersByTime(200);
    await f.requested;
    expect(calls).toBe(1);
    const request = f.tactics.snapshot().lastRequest;
    expect(request?.candidates.map((candidate) => candidate.id)).toEqual([
      "smite",
      "wait",
    ]);
  } finally {
    f.tactics.dispose();
    result.resolve(judgment());
    jest.useRealTimers();
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
  try {
    await f.tactics.start(context);
    await discarded.promise;
    expect(f.actions).toEqual([]);
    expect(f.tactics.snapshot().lastDiscardReason).toBe("stale_age");
  } finally {
    f.tactics.dispose();
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
  try {
    await f.tactics.start(context);
    await discarded.promise;
    expect(f.tactics.snapshot().lastDecision).toEqual({
      actionId: "smite",
      disposition: "discarded",
      reason: "out_of_range",
    });
  } finally {
    f.tactics.dispose();
  }
});

test("preparation failure rejects start and leaves an explicit final failure", async () => {
  const f = fixture({
    prepare: async () => {
      throw new Error("missing_spell_data");
    },
  });
  await expect(f.tactics.start(context)).rejects.toThrow("missing_spell_data");
  expect(f.activations).toBe(0);
  expect(f.tactics.snapshot().lastOutcome).toEqual({
    status: "failed",
    reason: "missing_spell_data",
  });
});

test("missing credentials cannot enter preparation", async () => {
  let prepared = false;
  const f = fixture({
    apiKey: undefined,
    prepare: async () => {
      prepared = true;
    },
  });
  await expect(f.tactics.start(context)).rejects.toThrow("missing_jev_key");
  expect(prepared).toBe(false);
  expect(f.tactics.snapshot().status).toBe("idle");
});

test("replacing preparation cannot let the old completion stop the newer mode", async () => {
  const old = Promise.withResolvers<void>();
  const result = Promise.withResolvers<JevActionResult>();
  let preparations = 0;
  const f = fixture({
    prepare: async () => {
      preparations += 1;
      if (preparations === 1) await old.promise;
    },
    select: () => result.promise,
  });
  try {
    const first = f.tactics.start(context);
    await f.tactics.start({ ...context, instruction: "Preserve mana" });
    const current = f.tactics.snapshot();
    await first;
    old.resolve();
    await Promise.resolve();
    expect(f.activations).toBe(1);
    expect(f.tactics.snapshot()).toEqual(current);
  } finally {
    f.tactics.dispose();
    old.resolve();
    result.resolve(judgment());
  }
});

test("a stop from the request event prevents provider dispatch", async () => {
  const f = fixture();
  f.tactics.onEvent((event) => {
    if (event.type === "request") f.tactics.stop("manual");
  });
  await f.tactics.start(context);
  expect(f.calls).toBe(0);
  expect(f.actions).toEqual([]);
  expect(f.tactics.snapshot().status).toBe("idle");
});

test("unknown selected action never reaches the executor", async () => {
  const discarded = Promise.withResolvers<void>();
  const f = fixture({ select: async () => judgment("invented") });
  f.tactics.onEvent((event) => {
    if (event.type === "discarded") discarded.resolve();
  });
  try {
    await f.tactics.start(context);
    await discarded.promise;
    expect(f.actions).toEqual([]);
    expect(f.tactics.snapshot().lastDiscardReason).toBe("unknown_id");
  } finally {
    f.tactics.dispose();
  }
});

test("request observations retain nested values after the world changes", async () => {
  const result = Promise.withResolvers<JevActionResult>();
  const observation = { self: { health: 100 } };
  const f = fixture({
    observe: () => ({ ...frame, observation }),
    select: () => result.promise,
  });
  try {
    await f.tactics.start(context);
    observation.self.health = 25;
    expect(f.tactics.snapshot().lastRequest?.observation).toEqual({
      self: { health: 100 },
    });
    expect(f.events.find((event) => event.type === "request")).toMatchObject({
      observation: { self: { health: 100 } },
    });
  } finally {
    f.tactics.dispose();
    result.resolve(judgment());
  }
});

test("repeated useful decisions retain real cadence without concurrent requests", async () => {
  jest.useFakeTimers();
  let now = 0;
  const first = Promise.withResolvers<JevActionResult>();
  const second = Promise.withResolvers<JevActionResult>();
  const applied = Promise.withResolvers<void>();
  const requested = Promise.withResolvers<void>();
  let calls = 0;
  const f = fixture({
    now: () => now,
    select: () => {
      calls += 1;
      return calls === 1 ? first.promise : second.promise;
    },
  });
  f.tactics.onEvent((event) => {
    if (event.type === "applied") applied.resolve();
    if (event.type === "request" && event.sentAtMs === 200) requested.resolve();
  });
  try {
    await f.tactics.start(context);
    now = 150;
    jest.advanceTimersByTime(150);
    expect(calls).toBe(1);
    first.resolve(judgment());
    await applied.promise;
    now = 199;
    jest.advanceTimersByTime(49);
    expect(calls).toBe(1);
    now = 200;
    jest.advanceTimersByTime(1);
    await requested.promise;
    expect(calls).toBe(2);
    expect(f.actions).toEqual(["smite"]);
    expect(f.tactics.snapshot().lastInterRequestMs).toBe(200);
  } finally {
    f.tactics.dispose();
    first.resolve(judgment());
    second.resolve(judgment());
    jest.useRealTimers();
  }
});

test("a replacement waits for the old provider to settle before dispatching", async () => {
  const first = Promise.withResolvers<JevActionResult>();
  const second = Promise.withResolvers<JevActionResult>();
  let calls = 0;
  const f = fixture({
    select: () => {
      calls += 1;
      return calls === 1 ? first.promise : second.promise;
    },
  });
  try {
    await f.tactics.start(context);
    const replacement = f.tactics.start({
      ...context,
      instruction: "Conserve mana",
    });
    await Promise.resolve();
    expect(calls).toBe(1);
    expect(f.tactics.snapshot().status).toBe("preparing");
    first.resolve(judgment());
    await replacement;
    expect(calls).toBe(2);
    expect(f.activations).toBe(2);
    expect(f.actions).toEqual([]);
    expect(f.tactics.snapshot()).toMatchObject({
      status: "active",
      lastResult: undefined,
      instruction: "Conserve mana",
    });
  } finally {
    f.tactics.dispose();
    first.resolve(judgment());
    second.resolve(judgment());
  }
});

test("default framing variant is none and records in request event and lastRequest", async () => {
  let capturedFraming: string | undefined;
  const f = fixture({
    select: async (req) => {
      capturedFraming = req.framing;
      return judgment();
    },
  });
  let eventFraming: string | undefined;
  f.tactics.onEvent((event) => {
    if (event.type === "request") eventFraming = event.framing;
  });
  try {
    await f.tactics.start(context);
    expect(capturedFraming).toBe("none");
    expect(eventFraming).toBe("none");
    expect(f.tactics.snapshot().lastRequest?.framing).toBe("none");
  } finally {
    f.tactics.dispose();
  }
});

test("minimal framing variant records in request event and propagates to select", async () => {
  let capturedFraming: string | undefined;
  const f = fixture({
    select: async (req) => {
      capturedFraming = req.framing;
      return judgment();
    },
  });
  let eventFraming: string | undefined;
  f.tactics.onEvent((event) => {
    if (event.type === "request") eventFraming = event.framing;
  });
  try {
    await f.tactics.start({ ...context, framing: "minimal" });
    expect(capturedFraming).toBe("minimal");
    expect(eventFraming).toBe("minimal");
    expect(f.tactics.snapshot().lastRequest?.framing).toBe("minimal");
  } finally {
    f.tactics.dispose();
  }
});

test("mechanics framing variant records in request event and propagates to select", async () => {
  let capturedFraming: string | undefined;
  const f = fixture({
    select: async (req) => {
      capturedFraming = req.framing;
      return judgment();
    },
  });
  let eventFraming: string | undefined;
  f.tactics.onEvent((event) => {
    if (event.type === "request") eventFraming = event.framing;
  });
  try {
    await f.tactics.start({ ...context, framing: "mechanics" });
    expect(capturedFraming).toBe("mechanics");
    expect(eventFraming).toBe("mechanics");
    expect(f.tactics.snapshot().lastRequest?.framing).toBe("mechanics");
  } finally {
    f.tactics.dispose();
  }
});

test("unknown framing variant rejects start with clear error", async () => {
  const f = fixture();
  try {
    await expect(
      f.tactics.start({ ...context, framing: "invalid" as any }),
    ).rejects.toThrow(
      'Unknown framing variant: "invalid". Must be one of: none, minimal, mechanics',
    );
    expect(f.tactics.snapshot().status).toBe("idle");
  } finally {
    f.tactics.dispose();
  }
});

test("fault marker propagates to state and emitted events", async () => {
  const events: TacticsEvent[] = [];
  const f = fixture({ fault: "delay:2500ms" });
  f.tactics.onEvent((e) => events.push(e));
  try {
    await f.tactics.start(context);
    expect(f.tactics.snapshot().fault).toBe("delay:2500ms");
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((e) => e.fault === "delay:2500ms")).toBe(true);
  } finally {
    f.tactics.dispose();
  }
});
