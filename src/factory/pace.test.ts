import { describe, expect, test } from "bun:test";
import { paces } from "factory/config";
import { type Detail, problems, timerInterval } from "factory/pace";
import { desiredAutomations, type Spec } from "factory/setup";

const [worker] = desiredAutomations(true, paces.max) as [Spec];

function live(over: Partial<Detail> = {}): Detail {
  return {
    agentId: "omp",
    baseBranch: "origin/main",
    enabled: true,
    id: "w",
    name: worker.name,
    precheck: { command: worker.precheck, timeoutSeconds: 60 },
    prompt: worker.prompt,
    rrule: worker.rrule,
    setupDecision: "run",
    workspaceMode: "new_per_run",
    ...over,
  };
}

describe("problems", () => {
  test("a matching automation has none", () => {
    expect(problems(worker, live())).toEqual([]);
  });

  test("flags a schedule from the other pace", () => {
    const rrule = paces.default.schedules.worker;
    expect(problems(worker, live({ rrule }))).toEqual([
      `schedule "${rrule}", want "${worker.rrule}"`,
    ]);
  });

  test("flags lost setupDecision and other invariants", () => {
    const broken = live({
      baseBranch: "main",
      enabled: false,
      precheck: null,
      setupDecision: undefined,
    });
    expect(problems(worker, broken)).toEqual([
      "setupDecision undefined, want run",
      "precheck drifted",
      "base branch main",
      "disabled",
    ]);
  });
});

describe("timerInterval", () => {
  test("reads OnUnitActiveSec from systemctl show", () => {
    const props = [
      "TimersMonotonic={ OnUnitActiveUSec=5min ; next_elapse=1d }",
      "TimersMonotonic={ OnBootUSec=5min ; next_elapse=5min }",
    ].join("\n");
    expect(timerInterval(props)).toBe("5min");
    expect(timerInterval("TimersMonotonic=")).toBeNull();
  });
});
