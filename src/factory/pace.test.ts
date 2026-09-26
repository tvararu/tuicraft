import { describe, expect, test } from "bun:test";
import { type Pace, paces } from "factory/config";
import {
  type Detail,
  editCommand,
  problems,
  targets,
  timerCheck,
  timerDropIn,
} from "factory/pace";
import { desiredAutomations, type Spec } from "factory/setup";

const [worker] = desiredAutomations(true, paces.max) as [Spec];
const trio = ["work", "review", "merge"];

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

function atMax(disabled: string[] = []): Detail[] {
  return desiredAutomations(true, paces.max).map((spec) =>
    live({
      enabled: !disabled.includes(spec.name),
      id: spec.name,
      name: spec.name,
      precheck: { command: spec.precheck, timeoutSeconds: 60 },
      rrule: spec.rrule,
    }),
  );
}

function edits(pace: Pace, existing: Detail[]) {
  return targets(pace, existing).map(editCommand);
}

function report(pace: Pace, existing: Detail[]): string[][] {
  return targets(pace, existing).map(([spec, found]) =>
    problems(spec, found as Detail),
  );
}

const edit = (id: string, ...args: string[]) => [
  "orca-ide",
  "automations",
  "edit",
  "--id",
  id,
  ...args,
];

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

  test("a disabled automation is drift at a level", () => {
    expect(report("max", atMax(trio))).toEqual([
      ["disabled"],
      ["disabled"],
      ["disabled"],
      [],
    ]);
  });

  test("pause accepts the three disabled at any schedule", () => {
    const hourly = atMax(trio).map((a) => ({ ...a, rrule: "0 * * * *" }));
    expect(report("pause", hourly)).toEqual([[], [], [], []]);
  });

  test("pause flags a running work and a stopped qa", () => {
    expect(report("pause", atMax(["review", "merge", "qa"]))).toEqual([
      ["enabled while paused"],
      [],
      [],
      ["disabled"],
    ]);
  });
});

describe("editCommand", () => {
  test("pause disables work, review and merge and nothing else", () => {
    expect(edits("pause", atMax())).toEqual([
      edit("work", "--disabled"),
      edit("review", "--disabled"),
      edit("merge", "--disabled"),
      undefined,
    ]);
  });

  test("a level ends a pause and sets its schedules in one edit", () => {
    const { schedules } = paces.default;
    expect(edits("default", atMax(trio))).toEqual([
      edit("work", "--trigger", schedules.worker, "--enabled"),
      edit("review", "--trigger", schedules.reviewer, "--enabled"),
      edit("merge", "--trigger", schedules.merger, "--enabled"),
      edit("qa", "--trigger", schedules.qa),
    ]);
  });

  test("reapplying the current state edits nothing", () => {
    const none = [undefined, undefined, undefined, undefined];
    expect(edits("pause", atMax(trio))).toEqual(none);
    expect(edits("max", atMax())).toEqual(none);
  });
});

describe("timerDropIn", () => {
  test("keeps a boot trigger alongside the pace interval", () => {
    expect(timerDropIn(7)).toBe(
      [
        "[Timer]",
        "OnBootSec=",
        "OnUnitActiveSec=",
        "OnBootSec=7min",
        "OnUnitActiveSec=7min",
        "",
      ].join("\n"),
    );
  });
});

describe("timerCheck", () => {
  const boot = "OnBootUSec=10min";
  const every = "OnUnitActiveUSec=5min";

  function shown(state: string, ...timers: string[]): string {
    return [
      `SubState=${state}`,
      ...timers.map((t) => `TimersMonotonic={ ${t} ; next_elapse=5min }`),
    ].join("\n");
  }

  test("reads the interval from OnUnitActiveSec, not the boot trigger", () => {
    expect(timerCheck("default", shown("waiting", boot, every))).toEqual({
      drift: [],
      interval: "5min",
    });
  });

  test("a run in progress still counts as scheduled", () => {
    const { drift } = timerCheck("max", shown("running", every, boot));
    expect(drift).toEqual([]);
  });

  test("a timer with no next run is drift", () => {
    const afterReboot = shown("elapsed", every);
    expect(timerCheck("default", afterReboot).drift).toEqual([
      "no boot trigger",
      "no next run (elapsed)",
    ]);
    expect(timerCheck("pause", shown("dead", boot, every)).drift).toEqual([
      "no next run (dead)",
    ]);
  });

  test("the interval must match the pace unless paused", () => {
    const slow = shown("waiting", boot, "OnUnitActiveUSec=10min");
    expect(timerCheck("default", slow).drift).toEqual(["want 5min"]);
    expect(timerCheck("pause", slow).drift).toEqual([]);
    expect(timerCheck("pause", shown("waiting", boot)).drift).toEqual([
      "want an interval",
    ]);
  });
});
