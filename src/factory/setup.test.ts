import { describe, expect, test } from "bun:test";
import { paces } from "factory/config";
import type { Result } from "factory/exec";
import {
  type Automation,
  command,
  desiredAutomations,
  type Orca,
  plan,
  promptDrift,
  type Spec,
  syncPrompts,
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

describe("promptDrift", () => {
  const [worker, reviewer, , qa] = desiredAutomations(true, paces.max) as [
    Spec,
    Spec,
    Spec,
    Spec,
  ];

  test("edits drifted prompts only, whatever the schedule or state", () => {
    const existing = [
      recorded(worker, { enabled: false, prompt: "old", rrule: "0 * * * *" }),
      recorded(reviewer, { rrule: "0 * * * *" }),
      recorded({ ...qa, name: "nightly" }, { prompt: "old" }),
    ];
    expect(promptDrift(existing)).toEqual([
      { id: "id-work", name: "work", prompt: worker.prompt },
    ]);
  });
});

describe("syncPrompts", () => {
  const [worker, reviewer, merger, qa] = desiredAutomations(
    true,
    paces.default,
  ) as [Spec, Spec, Spec, Spec];
  const drifted = [worker, reviewer, merger, qa].map((spec) =>
    recorded(spec, { prompt: "old" }),
  );

  function fakeOrca(
    list: () => Promise<Automation[]>,
    outcomes: Record<string, Result | Error> = {},
  ): Orca & { runs: string[][] } {
    const runs: string[][] = [];
    const run = (cmd: string[]) => {
      runs.push(cmd);
      const outcome = outcomes[cmd[4] ?? ""] ?? {
        code: 0,
        stderr: "",
        stdout: "",
      };
      return outcome instanceof Error
        ? Promise.reject(outcome)
        : Promise.resolve(outcome);
    };
    return { list, run, runs };
  }

  test("edits only the prompt of each drifted automation", async () => {
    const orca = fakeOrca(() => Promise.resolve(drifted.slice(0, 2)));
    const log: string[] = [];
    await syncPrompts(false, (line) => log.push(line), orca);
    const edit = ["orca-ide", "automations", "edit", "--id"];
    expect(orca.runs).toEqual([
      [...edit, "id-work", "--prompt", worker.prompt],
      [...edit, "id-review", "--prompt", reviewer.prompt],
    ]);
    expect(log).toEqual(["prompt work synced", "prompt review synced"]);
  });

  test("logs a failed edit and still syncs the rest", async () => {
    const orca = fakeOrca(() => Promise.resolve(drifted), {
      "id-review": { code: 1, stderr: "owner fence\n", stdout: "" },
      "id-work": new Error("spawn orca-ide ENOENT"),
    });
    const log: string[] = [];
    await syncPrompts(false, (line) => log.push(line), orca);
    expect(orca.runs).toHaveLength(4);
    expect(log).toEqual([
      "prompt work sync failed: spawn orca-ide ENOENT",
      "prompt review sync failed: exited 1: owner fence",
      "prompt merge synced",
      "prompt qa synced",
    ]);
  });

  test("logs a failed listing without throwing", async () => {
    const orca = fakeOrca(() => Promise.reject(new Error("Orca not running")));
    const log: string[] = [];
    await syncPrompts(false, (line) => log.push(line), orca);
    expect(orca.runs).toEqual([]);
    expect(log).toEqual(["prompt sync failed: Orca not running"]);
  });

  test("a dry run reports drift without editing", async () => {
    const orca = fakeOrca(() => Promise.resolve(drifted.slice(3)));
    const log: string[] = [];
    await syncPrompts(true, (line) => log.push(line), orca);
    expect(orca.runs).toEqual([]);
    expect(log).toEqual(["prompt qa drifted, dry run"]);
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
