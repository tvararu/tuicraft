import { describe, expect, test } from "bun:test";
import { sessionRecord } from "tools/session-record";

type Target = { guid: string; status: string; cause?: string; reason?: string };

function line(at: number, type: string, data: object): string {
  return JSON.stringify({ data, timestamp: at, type });
}

function cycle(at: number, type: string, state: object): string {
  return line(at, "CYCLE", { at, state, type });
}

function queue(targets: Target[]): object[] {
  return targets.map(({ guid, status, cause, reason }) => ({
    guid,
    status,
    ...(cause ? { cause } : {}),
    ...(reason ? { outcome: { reason, status: "completed" } } : {}),
  }));
}

function tactics(at: number, runId: string, type: string, extra = {}): string {
  return line(at, "TACTICS", { runId, type, ...extra });
}

function life(at: number, value: string): string {
  return line(at, "RECOVERY", {
    at,
    state: { life: value },
    type: "life_observed",
  });
}

const a = { guid: "0xa", status: "queued" };
const b = { guid: "0xb", status: "queued" };

const halted = [
  cycle(1000, "started", { instruction: "fight", queue: queue([a, b]) }),
  tactics(1000, "r1", "started"),
  tactics(1100, "r1", "request", {
    candidates: [
      { id: "wait" },
      { id: "spell:585:target" },
      { id: "move_forward" },
    ],
  }),
  tactics(1300, "r1", "result", { elapsedMs: 200 }),
  tactics(1300, "r1", "applied", { actionId: "spell:585:target" }),
  tactics(1400, "r1", "discarded", { reason: "stale_age" }),
  tactics(2000, "r1", "stopped", { reason: "halt" }),
  cycle(2000, "stopped", {
    instruction: "fight",
    queue: queue([a, b]),
    stopCause: "halt",
  }),
];

const resumed = [
  cycle(3000, "resumed", { instruction: "kite", queue: queue([a, b]) }),
  tactics(3000, "r2", "started"),
  tactics(3100, "r2", "request", {
    candidates: [{ id: "wait" }, { id: "cancel" }],
  }),
  tactics(3150, "r2", "applied", { actionId: "cancel" }),
  tactics(3200, "r2", "request", { candidates: [{ id: "wait" }] }),
  tactics(3500, "r2", "result", { elapsedMs: 400 }),
  tactics(3500, "r2", "applied", { actionId: "wait" }),
  tactics(4000, "r2", "outcome", {
    reason: "server_kill_credit",
    status: "completed",
  }),
  tactics(4000, "r2", "stopped", { reason: "completed" }),
  life(4500, "dead"),
  life(4600, "dead"),
  life(4700, "ghost"),
  life(5000, "alive"),
  cycle(5000, "recovered", {
    instruction: "kite",
    lastRecovery: { at: 5000, detail: { legs: 3 }, outcome: "reclaimed" },
    queue: queue([
      { guid: "0xa", reason: "server_kill_credit", status: "done" },
      b,
    ]),
  }),
  cycle(6000, "stopped", {
    instruction: "kite",
    queue: queue([
      { guid: "0xa", reason: "server_kill_credit", status: "done" },
      { cause: "died", guid: "0xb", status: "skipped" },
    ]),
    stopCause: "corpse_unreachable",
    stopDetail: { range: 90 },
  }),
];

describe("sessionRecord", () => {
  const record = sessionRecord([...halted, ...resumed].join("\n"));

  test("lists each run and counts a target once across a resume", () => {
    expect(record.cycles.map((run) => [run.kind, run.stopCause])).toEqual([
      ["started", "halt"],
      ["resumed", "corpse_unreachable"],
    ]);
    expect(record.completions).toEqual({
      serverKillCredit: 1,
      targetsDone: 1,
    });
    expect(record.blocked).toMatchObject({
      skipsByCause: { died: 1 },
      targetsSkipped: 1,
    });
  });

  test("records halt, resume and the instruction change as interventions", () => {
    expect(record.interventions).toEqual([
      { at: 2000, kind: "halt", scope: "cycle" },
      { at: 3000, kind: "resume", scope: "cycle" },
      { at: 3000, detail: "kite", kind: "instruction_change", scope: "cycle" },
    ]);
  });

  test("counts one death per life transition and the recovery", () => {
    expect(record.recoveries).toEqual({
      byOutcome: { reclaimed: 1 },
      deaths: 1,
      recovered: 1,
    });
    expect(record.cycles[1]?.recoveries).toEqual([
      { at: 5000, detail: { legs: 3 }, outcome: "reclaimed" },
    ]);
  });

  test("a blocking stop is listed with its detail; a halt is not", () => {
    expect(record.blocked.cycleStops).toEqual([
      { at: 6000, cause: "corpse_unreachable", detail: { range: 90 } },
    ]);
  });

  test("counts discards by reason", () => {
    expect(record.staleActions).toEqual({
      byReason: { stale_age: 1 },
      discarded: 1,
    });
  });

  test("decision rate counts requests offering more than wait or cancel", () => {
    expect(record.latency).toEqual({
      activeMs: 2000,
      appliedDecisions: 2,
      appliedWaits: 1,
      decisionRatePerSec: 0.5,
      decisionRequests: 1,
      loopRatePerSec: 1.5,
      meanRequestMs: 300,
      p95RequestMs: 400,
      requests: 3,
    });
  });

  test("since drops earlier entries, and a halted lone fight is an intervention", () => {
    const fight = [
      tactics(7000, "r3", "started"),
      tactics(7500, "r3", "stopped", { reason: "halt" }),
    ];
    const later = sessionRecord([...halted, ...fight].join("\n"), 7000);
    expect(later.cycles).toEqual([]);
    expect(later.window).toEqual({ durationMs: 500, from: 7000, to: 7500 });
    expect(later.interventions).toEqual([
      { at: 7500, kind: "halt", scope: "fight" },
    ]);
  });

  test("a cycle halt logged before its tactics stop is one intervention", () => {
    const reordered = [
      halted[0],
      tactics(1000, "r1", "started"),
      cycle(2000, "stopped", {
        instruction: "fight",
        queue: queue([a, b]),
        stopCause: "halt",
      }),
      tactics(2001, "r1", "stopped", { reason: "halt" }),
    ];
    expect(sessionRecord(reordered.join("\n")).interventions).toEqual([
      { at: 2000, kind: "halt", scope: "cycle" },
    ]);
  });
});
