import { describe, expect, jest, test } from "bun:test";
import {
  type JevActionRequest,
  type JevActionResult,
  type JevSelect,
  selectJevAction,
} from "#wow/jev";
import { JevTransportError } from "#wow/jev-failure";
import {
  createFaultSelect,
  faultMarker,
  type JevFault,
  parseJevFault,
} from "#wow/jev-fault";
import { type TacticsEvent, TacticsLoop, TRANSPORT_LIMIT } from "#wow/tactics";

const mockRequest: JevActionRequest = {
  instruction: "defeat target",
  observation: { self: { level: 10 } },
  candidates: [
    { id: "wait", description: "Wait" },
    { id: "spell:585:target", description: "Smite" },
  ],
};

const mockResult: JevActionResult = {
  choice: "spell:585:target",
  probabilities: { "spell:585:target": 1, wait: 0 },
  confidence: 0.9,
  model: "jev-1.13.0",
  inputTokens: 100,
  elapsedMs: 250,
};

describe("parseJevFault", () => {
  test("returns undefined when unset", () => {
    expect(parseJevFault(undefined)).toBeUndefined();
    expect(parseJevFault("")).toBeUndefined();
  });

  test("parses the three documented forms", () => {
    expect(parseJevFault("delay:2500")).toEqual({
      kind: "delay",
      delayMs: 2500,
    });
    expect(parseJevFault("http:503")).toEqual({ kind: "http", status: 503 });
    expect(parseJevFault("transport")).toEqual({ kind: "transport" });
  });

  test("limits a fault to one numbered request with @", () => {
    expect(parseJevFault("delay:6000@3")).toEqual({
      kind: "delay",
      delayMs: 6000,
      request: 3,
    });
    expect(faultMarker({ kind: "http", status: 503, request: 2 })).toBe(
      "http:503@2",
    );
  });

  test("rejects anything else", () => {
    for (const raw of [
      "delay",
      "delay:-1",
      "http:99",
      "http:200",
      "503",
      "network",
      "transport@0",
      "transport@",
      "transport@1@2",
      "delay:1@1.5",
    ])
      expect(() => parseJevFault(raw)).toThrow("Unknown JEV_FAULT");
  });
});

describe("faultMarker", () => {
  test("names each fault as the evidence records do", () => {
    expect(faultMarker({ kind: "delay", delayMs: 2500 })).toBe("delay:2500ms");
    expect(faultMarker({ kind: "http", status: 503 })).toBe("http:503");
    expect(faultMarker({ kind: "transport" })).toBe("transport:network");
  });
});

describe("createFaultSelect", () => {
  const options = () => ({
    apiKey: "key",
    signal: new AbortController().signal,
  });
  const base: JevSelect = async (_request, { fetch }) => {
    await fetch?.("");
    return mockResult;
  };

  test("fails through the real client's HTTP classification", async () => {
    const busy = createFaultSelect(
      { kind: "http", status: 503 },
      selectJevAction,
    );
    await expect(busy(mockRequest, options())).rejects.toBeInstanceOf(
      JevTransportError,
    );
    const unpaid = createFaultSelect(
      { kind: "http", status: 402 },
      selectJevAction,
    );
    await expect(unpaid(mockRequest, options())).rejects.toThrow(
      "jev_unavailable: HTTP 402 payment_required",
    );
  });

  test("throws transport error", async () => {
    const select = createFaultSelect({ kind: "transport" }, selectJevAction);
    await expect(select(mockRequest, options())).rejects.toThrow(
      "fetch failed",
    );
  });

  test("faults only the numbered request", async () => {
    const select = createFaultSelect({ kind: "transport", request: 2 }, base);
    expect((await select(mockRequest, options())).choice).toBe(
      "spell:585:target",
    );
    await expect(select(mockRequest, options())).rejects.toThrow(
      "fetch failed",
    );
    expect((await select(mockRequest, options())).choice).toBe(
      "spell:585:target",
    );
  });

  test("holds the real result until the delay passes, even after abort", async () => {
    jest.useFakeTimers();
    try {
      const select = createFaultSelect({ kind: "delay", delayMs: 1000 }, base);
      const controller = new AbortController();
      let settled = false;
      const pending = select(mockRequest, {
        apiKey: "key",
        signal: controller.signal,
      }).then((result) => {
        settled = true;
        return result;
      });
      await Promise.resolve();
      await Promise.resolve();
      controller.abort();
      jest.advanceTimersByTime(900);
      await Promise.resolve();
      expect(settled).toBe(false);
      jest.advanceTimersByTime(100);
      expect((await pending).choice).toBe("spell:585:target");
    } finally {
      jest.useRealTimers();
    }
  });
});

describe("TacticsLoop fault integration", () => {
  const context = { targetGuid: 1n, instruction: "kill" };
  const frame = {
    observation: {},
    candidates: [
      { id: "wait", description: "Wait" },
      { id: "spell:585:target", description: "Smite" },
    ],
  };

  function faultLoop(fault: JevFault, maxResultAgeMs?: number) {
    const base =
      fault.kind === "delay" ? async () => mockResult : selectJevAction;
    const loop = new TacticsLoop({
      apiKey: "key",
      maxResultAgeMs,
      minIntervalMs: 0,
      select: createFaultSelect(fault, base),
      fault: faultMarker(fault),
      prepare: async () => {},
      activate: () => {},
      observe: () => frame,
      execute: () => {},
      halt: () => {},
      defend: () => "none",
    });
    const events: TacticsEvent[] = [];
    const waiters: {
      predicate: (event: TacticsEvent) => boolean;
      resolve: (event: TacticsEvent) => void;
    }[] = [];
    loop.onEvent((event) => {
      events.push(event);
      for (const waiter of waiters)
        if (waiter.predicate(event)) waiter.resolve(event);
    });
    const until = (predicate: (event: TacticsEvent) => boolean) =>
      new Promise<TacticsEvent>((resolve) => {
        const seen = events.find(predicate);
        if (seen) resolve(seen);
        else waiters.push({ predicate, resolve });
      });
    return { loop, events, until };
  }

  test("delayed response past maxResultAgeMs yields stale_age discard", async () => {
    const { loop, events, until } = faultLoop(
      { kind: "delay", delayMs: 50 },
      20,
    );
    const started = loop.start(context);
    await until((e) => e.type === "discarded" && e.reason === "stale_age");
    loop.stop("done");
    await started;
    expect(events[0]).toMatchObject({ type: "started", fault: "delay:50ms" });
    expect(loop.snapshot().fault).toBe("delay:50ms");
  });

  test("delayed response with halt during delay yields aborted discard", async () => {
    const { loop, until } = faultLoop({ kind: "delay", delayMs: 50 });
    const started = loop.start(context);
    await until((e) => e.type === "request");
    loop.stop("halt");
    await started;
    const discarded = await until((e) => e.type === "discarded");
    expect(discarded).toMatchObject({
      reason: "aborted",
      actionId: "spell:585:target",
    });
    expect(loop.snapshot().lastStopReason).toBe("halt");
  });

  test("a refused key ends the run at once as jev_unavailable", async () => {
    const { loop, events } = faultLoop({ kind: "http", status: 402 });
    const reason = "jev_unavailable: HTTP 402 payment_required";
    await expect(loop.start(context)).rejects.toThrow(reason);
    const transport = events.filter((e) => e.type === "transport");
    expect(transport.map((e) => e.type === "transport" && e.error)).toEqual([
      reason,
    ]);
    expect(loop.snapshot()).toMatchObject({
      fault: "http:402",
      status: "idle",
      lastStopReason: "failed",
      lastOutcome: { status: "failed", reason },
    });
  });

  test("repeated server errors end the run as jev_unavailable", async () => {
    const { loop, events } = faultLoop({ kind: "http", status: 503 });
    await expect(loop.start(context)).rejects.toThrow(
      `jev_unavailable: transport TypeSafe HTTP 503 (${TRANSPORT_LIMIT} in a row)`,
    );
    const transport = events.filter((e) => e.type === "transport");
    expect(transport).toHaveLength(TRANSPORT_LIMIT);
    expect(transport[0]?.error).toBe("TypeSafe HTTP 503");
    expect(loop.snapshot().lastStopReason).toBe("failed");
  });

  test("repeated network failures end the run as jev_unavailable", async () => {
    const { loop, events } = faultLoop({ kind: "transport" });
    await expect(loop.start(context)).rejects.toThrow(
      "jev_unavailable: transport fetch failed",
    );
    const transport = events.filter((e) => e.type === "transport");
    expect(transport[0]?.error).toBe("fetch failed");
    expect(loop.snapshot().fault).toBe("transport:network");
    expect(loop.snapshot().lastStopReason).toBe("failed");
  });

  test("a transport failure short of the limit keeps the fight going", async () => {
    let calls = 0;
    let hit = false;
    const loop = new TacticsLoop({
      apiKey: "key",
      minIntervalMs: 0,
      select: async () => {
        calls++;
        if (calls < TRANSPORT_LIMIT)
          throw new JevTransportError("fetch failed");
        return mockResult;
      },
      prepare: async () => {},
      activate: () => {},
      observe: () => ({
        ...frame,
        outcome: hit ? { status: "completed", reason: "killed" } : undefined,
      }),
      execute: () => {
        hit = true;
      },
      halt: () => {},
      defend: () => "none",
    });
    await loop.start(context);
    expect(calls).toBe(TRANSPORT_LIMIT);
    expect(loop.snapshot().lastOutcome).toMatchObject({
      status: "completed",
      reason: "killed",
    });
  });
});
