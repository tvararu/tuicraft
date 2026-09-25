import { describe, expect, test } from "bun:test";
import { distil, parseLog, runIds } from "tools/distil-encounter";

function line(at: number, event: Record<string, unknown>): string {
  return JSON.stringify({ data: event, timestamp: at, type: "TACTICS" });
}

const log = [
  line(1000, {
    instruction: "kill it",
    runId: "r1",
    targetGuid: "0xf13",
    type: "started",
  }),
  line(1100, {
    candidates: [{ id: "wait" }, { id: "spell:585:target" }],
    instruction: "kill it",
    observation: {
      self: { level: 10, maxHealth: 187, maxPower: 547 },
      target: {
        guid: "0xf13",
        level: 6,
        maxHealth: 120,
        name: "Springpaw Stalker",
      },
    },
    runId: "r1",
    sentAtMs: 1100,
    type: "request",
  }),
  line(1360, {
    choice: "spell:585:target",
    confidence: 0.8,
    elapsedMs: 258,
    inputTokens: 100,
    model: "jev-1.13.0",
    probabilities: { "spell:585:target": 0.9, wait: 0.1 },
    runId: "r1",
    type: "result",
  }),
  line(1370, {
    actionId: "spell:585:target",
    ageMs: 10,
    runId: "r1",
    type: "applied",
  }),
  line(1500, {
    actionId: "wait",
    reason: "stale",
    runId: "r1",
    type: "discarded",
  }),
  line(2000, {
    reason: "target died",
    runId: "r1",
    status: "completed",
    type: "outcome",
  }),
].join("\n");

describe("distil-encounter", () => {
  test("ignores non-tactics and malformed lines", () => {
    const text = [
      '{"type":"CHAT","sender":"x","message":"hi","timestamp":1}',
      "not json at all",
      "",
      log,
    ].join("\n");
    expect(parseLog(text)).toHaveLength(6);
  });

  test("lists run ids in first-seen order", () => {
    const text = [log, line(3000, { runId: "r2", type: "started" })].join("\n");
    expect(runIds(parseLog(text))).toEqual(["r1", "r2"]);
  });

  test("records the decision, its offered set and whether it was applied", () => {
    const rec = distil(parseLog(log), "r1", "minimal-framing");
    expect(rec.decisions).toHaveLength(1);
    expect(rec.decisions[0]?.offered).toEqual(["wait", "spell:585:target"]);
    expect(rec.decisions[0]?.choice).toBe("spell:585:target");
    expect(rec.decisions[0]?.applied).toBe(true);
    expect(rec.decisions[0]?.appliedAgeMs).toBe(10);
  });

  test("captures both character and creature level for comparability", () => {
    const rec = distil(parseLog(log), "r1", "minimal-framing");
    expect(rec.character.level).toBe(10);
    expect(rec.target.level).toBe(6);
    expect(rec.target.name).toBe("Springpaw Stalker");
  });

  test("cadence measures decisions over wall clock, not request latency", () => {
    const rec = distil(parseLog(log), "r1", "minimal-framing");
    expect(rec.cadence.elapsedMs).toBe(1000);
    expect(rec.cadence.decisions).toBe(1);
    expect(rec.cadence.perSecond).toBe(1);
    expect(rec.decisions[0]?.latencyMs).toBe(258);
  });

  test("retains discarded decisions and the outcome", () => {
    const rec = distil(parseLog(log), "r1", "minimal-framing");
    expect(rec.discarded).toEqual([{ actionId: "wait", reason: "stale" }]);
    expect(rec.outcome.status).toBe("completed");
  });

  test("throws rather than inventing a record for an unknown run", () => {
    expect(() => distil(parseLog(log), "nope", "v")).toThrow(
      "No tactics events",
    );
  });

  test("extracts framing from request event into promptVariant", () => {
    const customLog = [
      line(1000, { runId: "r2", targetGuid: "0xf13", type: "started" }),
      line(1100, {
        candidates: [{ id: "wait" }],
        framing: "mechanics",
        instruction: "kill it",
        observation: { self: { level: 10 } },
        runId: "r2",
        type: "request",
      }),
    ].join("\n");
    const rec = distil(parseLog(customLog), "r2", "unrecorded");
    expect(rec.promptVariant).toBe("mechanics");
  });

  test("extracts fault marker from events into encounter record", () => {
    const faultLog = [
      line(1000, {
        fault: "delay:2500ms",
        runId: "r3",
        targetGuid: "0xf13",
        type: "started",
      }),
      line(1100, {
        candidates: [{ id: "wait" }],
        fault: "delay:2500ms",
        instruction: "kill it",
        observation: { self: { level: 10 } },
        runId: "r3",
        type: "request",
      }),
    ].join("\n");
    const rec = distil(parseLog(faultLog), "r3", "unrecorded");
    expect(rec.fault).toBe("delay:2500ms");
  });
});
