import { expect, jest, test } from "bun:test";
import { must } from "test/must";
import type { JevActionResult } from "wow/jev";
import {
  type TacticsContext,
  type TacticsDeps,
  type TacticsEvent,
  type TacticsFrame,
  TacticsLoop,
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
    const running = f.tactics.start(context);
    await f.requested;
    jest.advanceTimersByTime(500);
    await running;
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
  const first = f.tactics.start(context);
  const second = f.tactics.start({ ...context, instruction: "Preserve mana" });
  try {
    const settled = await Promise.race([
      first.then(() => "first" as const),
      second.then(
        () => "second" as const,
        () => "second" as const,
      ),
    ]);
    expect(settled).toBe("first");
    const current = f.tactics.snapshot();
    old.resolve();
    await Promise.resolve();
    expect(f.activations).toBe(1);
    expect(f.tactics.snapshot()).toEqual(current);
  } finally {
    old.resolve();
    result.resolve(judgment());
    await first;
    f.tactics.dispose();
    await second;
  }
});

test("a stop from the request event prevents provider dispatch", async () => {
  const f = fixture();
  f.tactics.onEvent((event) => {
    if (event.type === "request") f.tactics.stop("manual");
  });
  const running = f.tactics.start(context);
  await running;
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
  const running = f.tactics.start(context);
  try {
    await discarded.promise;
    expect(f.actions).toEqual([]);
    expect(f.tactics.snapshot().lastDiscardReason).toBe("unknown_id");
  } finally {
    f.tactics.dispose();
    await running;
  }
});

test("request observations retain nested values after the world changes", async () => {
  const result = Promise.withResolvers<JevActionResult>();
  const observation = { self: { health: 100 } };
  const f = fixture({
    observe: () => ({ ...frame, observation }),
    select: () => result.promise,
  });
  const running = f.tactics.start(context);
  try {
    await f.requested;
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
    await running;
  }
});

test("repeated useful decisions retain real cadence without concurrent requests", async () => {
  jest.useFakeTimers();
  let now = 0;
  const first = Promise.withResolvers<JevActionResult>();
  const second = Promise.withResolvers<JevActionResult>();
  const applied = Promise.withResolvers<void>();
  const firstRequested = Promise.withResolvers<void>();
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
    if (event.type === "request") {
      firstRequested.resolve();
      if (event.sentAtMs === 200) requested.resolve();
    }
  });
  const running = f.tactics.start(context);
  try {
    await firstRequested.promise;
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
  } finally {
    f.tactics.dispose();
    first.resolve(judgment());
    second.resolve(judgment());
    await running;
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
  const initial = f.tactics.start(context);
  let replacement: Promise<void> | undefined;
  try {
    await f.requested;
    replacement = f.tactics.start({
      ...context,
      instruction: "Conserve mana",
    });
    expect(f.tactics.snapshot().status).toBe("preparing");
    const replaced = initial.then(
      () => true,
      () => true,
    );
    first.resolve(judgment());
    await replaced;
    for (let i = 0; i < 50 && calls < 2; i++) await Promise.resolve();
    expect(calls).toBe(2);
    expect(f.activations).toBe(2);
    expect(f.actions).toEqual([]);
    expect(f.tactics.snapshot()).toMatchObject({
      lastResult: undefined,
      instruction: "Conserve mana",
    });
  } finally {
    f.tactics.dispose();
    first.resolve(judgment());
    second.resolve(judgment());
    await initial;
    await replacement;
  }
});

for (const [given, sent] of [
  [undefined, "none"],
  ["minimal", "minimal"],
  ["mechanics", "mechanics"],
] as const) {
  test(`framing ${sent} reaches select, the request event and lastRequest`, async () => {
    let capturedFraming: string | undefined;
    const f = fixture({
      select: async (req) => {
        capturedFraming = req.framing;
        return judgment();
      },
    });
    let eventFraming: string | undefined;
    const requested = Promise.withResolvers<void>();
    f.tactics.onEvent((event) => {
      if (event.type === "request") {
        eventFraming = event.framing;
        requested.resolve();
      }
    });
    const running = f.tactics.start({ ...context, framing: given });
    try {
      await requested.promise;
      expect(capturedFraming).toBe(sent);
      expect(eventFraming).toBe(sent);
      expect(f.tactics.snapshot().lastRequest?.framing).toBe(sent);
    } finally {
      f.tactics.dispose();
      await running;
    }
  });
}

test("the character class reaches select with each request", async () => {
  const sent = Promise.withResolvers<string | undefined>();
  const f = fixture({
    characterClass: () => "Warrior",
    select: async (req) => {
      sent.resolve(req.characterClass);
      return judgment();
    },
  });
  const running = f.tactics.start({ ...context, framing: "minimal" });
  try {
    expect(await sent.promise).toBe("Warrior");
    expect(f.tactics.snapshot().lastRequest?.characterClass).toBe("Warrior");
  } finally {
    f.tactics.dispose();
    await running;
  }
});

test("fault marker is recorded once, on started and in state", async () => {
  const f = fixture({ fault: "delay:2500ms" });
  const started = Promise.withResolvers<TacticsEvent>();
  f.tactics.onEvent((e) => {
    if (e.type === "started") started.resolve(e);
  });
  const running = f.tactics.start(context);
  try {
    expect(await started.promise).toMatchObject({ fault: "delay:2500ms" });
    expect(f.tactics.snapshot().fault).toBe("delay:2500ms");
  } finally {
    f.tactics.dispose();
    await running;
  }
});
