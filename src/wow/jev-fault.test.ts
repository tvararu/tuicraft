import { test, expect, describe } from "bun:test";
import {
  parseJevFault,
  readJevFaultFromEnv,
  createFaultSelect,
} from "wow/jev-fault";
import { TacticsLoop, type TacticsEvent } from "wow/tactics";
import type { JevActionRequest, JevActionResult } from "wow/jev";

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
  test("returns empty when unset", () => {
    expect(parseJevFault(undefined, undefined, undefined)).toEqual({});
  });

  test("parses delay with milliseconds", () => {
    expect(parseJevFault("delay:2500")).toEqual({
      fault: { kind: "delay", delayMs: 2500 },
      marker: "delay:2500ms",
    });
  });

  test("parses bare delay with separate delayMs argument", () => {
    expect(parseJevFault("delay", "1800")).toEqual({
      fault: { kind: "delay", delayMs: 1800 },
      marker: "delay:1800ms",
    });
  });

  test("parses bare delay with default milliseconds", () => {
    expect(parseJevFault("delay")).toEqual({
      fault: { kind: "delay", delayMs: 2500 },
      marker: "delay:2500ms",
    });
  });

  test("parses delayMs alone without fault name", () => {
    expect(parseJevFault(undefined, "3000")).toEqual({
      fault: { kind: "delay", delayMs: 3000 },
      marker: "delay:3000ms",
    });
  });

  test("parses http status codes", () => {
    expect(parseJevFault("http:503")).toEqual({
      fault: { kind: "http", status: 503 },
      marker: "http:503",
    });
    expect(parseJevFault("status:500")).toEqual({
      fault: { kind: "http", status: 500 },
      marker: "http:500",
    });
    expect(parseJevFault("503")).toEqual({
      fault: { kind: "http", status: 503 },
      marker: "http:503",
    });
  });

  test("parses transport network failure", () => {
    expect(parseJevFault("transport")).toEqual({
      fault: { kind: "transport", error: "fetch failed" },
      marker: "transport:network",
    });
    expect(parseJevFault("network")).toEqual({
      fault: { kind: "transport", error: "fetch failed" },
      marker: "transport:network",
    });
    expect(parseJevFault("error")).toEqual({
      fault: { kind: "transport", error: "fetch failed" },
      marker: "transport:network",
    });
  });

  test("records endpoint marker when endpoint is provided alone", () => {
    expect(
      parseJevFault(undefined, undefined, "http://localhost:8080"),
    ).toEqual({
      marker: "endpoint:http://localhost:8080",
    });
  });

  test("reads environment variables", () => {
    const res = readJevFaultFromEnv({
      JEV_FAULT: "delay:2200",
    });
    expect(res).toEqual({
      fault: { kind: "delay", delayMs: 2200 },
      marker: "delay:2200ms",
    });
  });
});

describe("createFaultSelect", () => {
  test("throws HTTP status error", async () => {
    const select = createFaultSelect({ kind: "http", status: 503 });
    await expect(
      select(mockRequest, {
        apiKey: "key",
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow("TypeSafe HTTP 503");
  });

  test("throws transport error", async () => {
    const select = createFaultSelect({
      kind: "transport",
      error: "fetch failed",
    });
    await expect(
      select(mockRequest, {
        apiKey: "key",
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow("fetch failed");
  });

  test("delays response returning choice", async () => {
    const base = async () => mockResult;
    const select = createFaultSelect({ kind: "delay", delayMs: 50 }, base);
    const start = performance.now();
    const result = await select(mockRequest, {
      apiKey: "key",
      signal: new AbortController().signal,
    });
    const elapsed = performance.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(40);
    expect(result.choice).toBe("spell:585:target");
  });

  test("resolves early on abort signal during delay", async () => {
    const base = async () => mockResult;
    const select = createFaultSelect({ kind: "delay", delayMs: 1000 }, base);
    const controller = new AbortController();
    const pending = select(mockRequest, {
      apiKey: "key",
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 20);
    const start = performance.now();
    const result = await pending;
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(500);
    expect(result.choice).toBe("spell:585:target");
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

  test("delayed response past maxResultAgeMs yields stale_age discard", async () => {
    const events: TacticsEvent[] = [];
    const select = createFaultSelect(
      { kind: "delay", delayMs: 50 },
      async () => mockResult,
    );
    const loop = new TacticsLoop({
      apiKey: "key",
      maxResultAgeMs: 20,
      select,
      fault: "delay:50ms",
      prepare: async () => {},
      activate: () => {},
      observe: () => frame,
      execute: () => {},
      halt: () => {},
    });
    loop.onEvent((e) => events.push(e));
    const started = loop.start(context);
    await new Promise((r) => setTimeout(r, 80));
    loop.stop("done");
    await started;

    const discarded = events.filter((e) => e.type === "discarded");
    expect(
      discarded.some((e) => e.type === "discarded" && e.reason === "stale_age"),
    ).toBe(true);
    expect(events.every((e) => e.fault === "delay:50ms")).toBe(true);
    expect(loop.snapshot().fault).toBe("delay:50ms");
  });

  test("delayed response with halt during delay yields aborted discard", async () => {
    const events: TacticsEvent[] = [];
    const select = createFaultSelect(
      { kind: "delay", delayMs: 200 },
      async () => mockResult,
    );
    const loop = new TacticsLoop({
      apiKey: "key",
      select,
      fault: "delay:200ms",
      prepare: async () => {},
      activate: () => {},
      observe: () => frame,
      execute: () => {},
      halt: () => {},
    });
    loop.onEvent((e) => events.push(e));
    const started = loop.start(context);
    await new Promise((r) => setTimeout(r, 30));
    loop.stop("halt");
    await started;
    await new Promise((r) => setTimeout(r, 50));

    const discarded = events.filter((e) => e.type === "discarded");
    expect(
      discarded.some((e) => e.type === "discarded" && e.reason === "aborted"),
    ).toBe(true);
    expect(loop.snapshot().lastStopReason).toBe("halt");
  });

  test("HTTP status failure yields transport error", async () => {
    const events: TacticsEvent[] = [];
    const select = createFaultSelect({ kind: "http", status: 503 });
    const loop = new TacticsLoop({
      apiKey: "key",
      select,
      fault: "http:503",
      prepare: async () => {},
      activate: () => {},
      observe: () => frame,
      execute: () => {},
      halt: () => {},
    });
    loop.onEvent((e) => events.push(e));
    await loop.start(context);
    await new Promise((r) => setTimeout(r, 20));

    const transport = events.filter((e) => e.type === "transport");
    expect(transport).toHaveLength(1);
    expect(transport[0]?.error).toBe("TypeSafe HTTP 503");
    expect(transport[0]?.fault).toBe("http:503");
    expect(loop.snapshot().status).toBe("idle");
    expect(loop.snapshot().lastStopReason).toBe("failed");
  });

  test("transport network failure yields transport error", async () => {
    const events: TacticsEvent[] = [];
    const select = createFaultSelect({
      kind: "transport",
      error: "fetch failed",
    });
    const loop = new TacticsLoop({
      apiKey: "key",
      select,
      fault: "transport:network",
      prepare: async () => {},
      activate: () => {},
      observe: () => frame,
      execute: () => {},
      halt: () => {},
    });
    loop.onEvent((e) => events.push(e));
    await loop.start(context);
    await new Promise((r) => setTimeout(r, 20));

    const transport = events.filter((e) => e.type === "transport");
    expect(transport).toHaveLength(1);
    expect(transport[0]?.error).toBe("fetch failed");
    expect(transport[0]?.fault).toBe("transport:network");
    expect(loop.snapshot().status).toBe("idle");
    expect(loop.snapshot().lastStopReason).toBe("failed");
  });
});
