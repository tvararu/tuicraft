import { describe, expect, test } from "bun:test";
import { paces } from "factory/config";
import {
  type Automation,
  command,
  desiredAutomations,
  desiredLabels,
  missingLabels,
  plan,
  type Spec,
  wrapperCommand,
  wrapperTarget,
} from "factory/setup";

function recorded(spec: Spec, over: Partial<Automation> = {}): Automation {
  return {
    agentId: "omp",
    baseBranch: "origin/main",
    enabled: false,
    id: `id-${spec.name}`,
    name: spec.name,
    precheck: { command: spec.precheck, timeoutSeconds: 60 },
    prompt: spec.prompt,
    rrule: spec.rrule,
    workspaceMode: "new_per_run",
    ...over,
  };
}

describe("missingLabels", () => {
  test("keeps only absent labels in desired order", () => {
    const existing = ["bug", "agent:review", "ready"];
    const names = missingLabels(desiredLabels, existing).map((l) => l.name);
    expect(names).toEqual([
      "agent:working",
      "agent:reviewing",
      "agent:rework",
      "agent:merging",
      "agent:landing",
      "needs:pm",
      "qa:found",
    ]);
  });
});

describe("desiredAutomations", () => {
  test("every prompt starts with its role marker for omp-factory", () => {
    const specs = desiredAutomations(false, paces.default);
    expect(specs.map((s) => s.name)).toEqual(["work", "review", "merge", "qa"]);
    for (const spec of specs) {
      const role = spec.precheck.split(" ").at(-1);
      expect(spec.prompt.split("\n")[0]).toBe(`[factory:${role}]`);
    }
  });
});

describe("plan", () => {
  const [worker, reviewer, merger, qa] = desiredAutomations(
    false,
    paces.default,
  ) as [Spec, Spec, Spec, Spec];

  test("creates missing, keeps identical, edits drifted fields", () => {
    const existing = [
      recorded(worker),
      recorded(reviewer, { prompt: "old", rrule: "0 * * * *" }),
      recorded(merger, { precheck: null }),
    ];
    const steps = plan([worker, reviewer, merger, qa], existing);
    expect(steps.map((s) => s.kind)).toEqual(["ok", "edit", "edit", "create"]);
    expect(steps[1]).toMatchObject({ changes: ["prompt", "trigger"] });
    expect(steps[2]).toMatchObject({
      changes: ["precheck", "precheck-timeout"],
    });
  });

  test("ignores automations that are not the factory's", () => {
    const other = recorded({ ...worker, name: "nightly" });
    expect(plan([worker], [other])[0]?.kind).toBe("create");
  });

  test("enables a disabled automation only when asked", () => {
    const [enabledWorker] = desiredAutomations(true, paces.default) as [Spec];
    const current = recorded(worker);
    expect(plan([worker], [current])[0]?.kind).toBe("ok");
    expect(plan([enabledWorker], [current])[0]).toMatchObject({
      changes: ["enabled"],
      kind: "edit",
    });
  });

  test("never disables an automation the maintainer switched on", () => {
    const current = recorded(worker, { enabled: true });
    expect(plan([worker], [current])[0]?.kind).toBe("ok");
  });
});

describe("command", () => {
  const [worker] = desiredAutomations(false, paces.default) as [Spec];

  test("creates disabled by default and enabled with --enable", () => {
    const create = command({ kind: "create", spec: worker });
    const enabled = command({
      kind: "create",
      spec: { ...worker, enable: true },
    });
    expect(create?.slice(0, 3)).toEqual(["orca-ide", "automations", "create"]);
    expect(create?.at(-1)).toBe("--disabled");
    expect(enabled?.at(-1)).toBe("--enabled");
  });

  test("edits by id and leaves enabled state alone unless enabling", () => {
    const step = {
      changes: [],
      id: "abc",
      kind: "edit",
      spec: worker,
    } as const;
    const edit = command({ ...step, changes: ["prompt"] });
    expect(edit?.slice(0, 5)).toEqual([
      "orca-ide",
      "automations",
      "edit",
      "--id",
      "abc",
    ]);
    expect(edit).not.toContain("--enabled");
    expect(edit).not.toContain("--disabled");
    expect(command({ id: "abc", kind: "ok", spec: worker })).toBeUndefined();
  });
});

describe("wrapperCommand", () => {
  test("leaves a link that already points at the runner wrapper", () => {
    expect(wrapperCommand(wrapperTarget)).toBeUndefined();
  });

  test("replaces a copy, a stale link, or nothing with the runner link", () => {
    for (const current of [undefined, "/elsewhere/omp-factory"]) {
      const cmd = wrapperCommand(current);
      expect(cmd?.slice(0, 3)).toEqual(["ln", "-sfn", wrapperTarget]);
      expect(cmd?.[3]).toEndWith("/.local/bin/omp-factory");
    }
  });
});
