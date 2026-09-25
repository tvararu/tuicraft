import { expect, jest, test } from "bun:test";
import { context, fixture, frame, judgment } from "test/tactics-fixtures";
import type { JevActionResult } from "wow/jev";
import type { TacticsEvent } from "wow/tactics";

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
