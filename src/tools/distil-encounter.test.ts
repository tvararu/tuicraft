import { test, expect, describe } from "bun:test";
import { parseLog, runIds, distil } from "tools/distil-encounter";

function line(at: number, event: Record<string, unknown>): string {
  return JSON.stringify({ type: "TACTICS", data: event, timestamp: at });
}

const log = [
  line(1000, {
    type: "started",
    runId: "r1",
    targetGuid: "0xf13",
    instruction: "kill it",
  }),
  line(1100, {
    type: "request",
    runId: "r1",
    instruction: "kill it",
    candidates: [{ id: "wait" }, { id: "spell:585:target" }],
    observation: {
      self: { level: 10, maxPower: 547, maxHealth: 187 },
      target: {
        guid: "0xf13",
        name: "Springpaw Stalker",
        level: 6,
        maxHealth: 120,
      },
    },
    sentAtMs: 1100,
  }),
  line(1360, {
    type: "result",
    runId: "r1",
    choice: "spell:585:target",
    probabilities: { wait: 0.1, "spell:585:target": 0.9 },
    confidence: 0.8,
    model: "jev-1.13.0",
    inputTokens: 100,
    elapsedMs: 258,
  }),
  line(1370, {
    type: "applied",
    runId: "r1",
    actionId: "spell:585:target",
    ageMs: 10,
  }),
  line(1500, {
    type: "discarded",
    runId: "r1",
    reason: "stale",
    actionId: "wait",
  }),
  line(2000, {
    type: "outcome",
    runId: "r1",
    status: "completed",
    reason: "target died",
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
    const text = [log, line(3000, { type: "started", runId: "r2" })].join("\n");
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
    expect(rec.discarded).toEqual([{ reason: "stale", actionId: "wait" }]);
    expect(rec.outcome.status).toBe("completed");
  });

  test("throws rather than inventing a record for an unknown run", () => {
    expect(() => distil(parseLog(log), "nope", "v")).toThrow(
      "No tactics events",
    );
  });

  test("extracts framing from request event into promptVariant", () => {
    const customLog = [
      line(1000, { type: "started", runId: "r2", targetGuid: "0xf13" }),
      line(1100, {
        type: "request",
        runId: "r2",
        instruction: "kill it",
        framing: "mechanics",
        candidates: [{ id: "wait" }],
        observation: { self: { level: 10 } },
      }),
    ].join("\n");
    const rec = distil(parseLog(customLog), "r2", "unrecorded");
    expect(rec.promptVariant).toBe("mechanics");
  });

  test("extracts fault marker from events into encounter record", () => {
    const faultLog = [
      line(1000, {
        type: "started",
        runId: "r3",
        targetGuid: "0xf13",
        fault: "delay:2500ms",
      }),
      line(1100, {
        type: "request",
        runId: "r3",
        instruction: "kill it",
        candidates: [{ id: "wait" }],
        observation: { self: { level: 10 } },
        fault: "delay:2500ms",
      }),
    ].join("\n");
    const rec = distil(parseLog(faultLog), "r3", "unrecorded");
    expect(rec.fault).toBe("delay:2500ms");
  });
});
