import { describe, expect, test } from "bun:test";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { scratchDir } from "@peon/core/test-support/scratch";
import { bunExec, type Exec } from "#harness/grader/exec";
import { type EvalResult, validateResult } from "#harness/grader/result";
import {
  cleanup,
  newRunState,
  type RunState,
  stopHarness,
  writeOutcome,
} from "#harness/grader/run-finish";
import { loadScenario } from "#harness/grader/scenarios";
import { failed, ok } from "#test-support/fake-exec";
import { fakePane } from "#test-support/fake-pane";

const ACC = "FAC0123456789";
const PARTNER = "FAC0000000002";
const PASSWORD = "pw-secret-123";
const NOW = Date.parse("2026-09-26T21:00:00.000Z");
const AGENT = {
  account: ACC,
  character: "Fevala",
  preset: "eversong10",
  wrapper: `/wt/tmp/puppet-${ACC}`,
};

function truth(savedAt: string): string {
  return JSON.stringify({
    account: ACC,
    alive: true,
    class: 5,
    deathState: "alive",
    guid: 1,
    health: 100,
    inventory: [],
    level: 10,
    money: 50_000,
    name: "Fevala",
    ok: true,
    online: false,
    position: { map: 530, o: 0, x: 8735, y: -6685, z: 70.5, zone: 3430 },
    quests: [],
    race: 10,
    rewardedQuests: [],
    savedAt,
    spells: [],
    xp: 0,
  });
}

type Router = { calls: string[][]; exec: Exec };

function router(opts: { savedAt?: string; listed?: string[] } = {}): Router {
  const calls: string[][] = [];
  const exec: Exec = async (argv, execOpts) => {
    calls.push([...argv]);
    if (argv[0] === "rg") return bunExec(argv, execOpts);
    if (argv[0] === "bun" && argv[1] === "packages/devtools/src/probe.ts")
      return ok(JSON.stringify({ flows: [{ result: { flags: {} } }] }));
    if (argv[3] === "truth")
      return ok(truth(opts.savedAt ?? new Date(NOW).toISOString()));
    if (argv[3] === "gm")
      return ok(
        JSON.stringify({
          account: argv[4],
          command: "group list Fevala",
          ok: true,
          text: "Group type: Party and consists of 2 players.",
          verb: "read",
        }),
      );
    if (argv[3] === "list")
      return ok(
        JSON.stringify((opts.listed ?? []).map((account) => ({ account }))),
      );
    return ok();
  };
  return { calls, exec };
}

async function state(
  exec: Exec,
  overrides: Partial<RunState> = {},
): Promise<RunState> {
  const runDir = `${scratchDir("finish")}/run`;
  await mkdir(runDir);
  await mkdir(`${runDir}/grader`);
  await mkdir(`${runDir}/frames`);
  const base = newRunState({
    clock: { now: () => NOW },
    exec,
    log: () => undefined,
    replica: 1,
    round: 1,
    runDir,
    scenario: loadScenario("t0-self-state"),
    sha: "3af5aa3",
    tab: "eval-1-t0-self-state-1",
    truthWaitMs: 1,
  });
  return { ...base, agent: AGENT, ...overrides };
}

describe("stopHarness", () => {
  test("stops the watcher before the quit and keeps a fresh final truth", async () => {
    const order: string[] = [];
    const { exec } = router();
    const pane = {
      ...fakePane(["x"]),
      quit: async () => {
        order.push("quit");
      },
    };
    const st = await state(exec, {
      pane,
      watcher: {
        stop: async () => {
          order.push("watcher");
        },
      },
    });
    await stopHarness(st);
    expect(order).toEqual(["watcher", "quit"]);
    expect(st.exitMs).toBe(NOW);
    expect(st.finalSavedAt).toBe("2026-09-26T21:00:00.000Z");
    expect(st.abort).toBeUndefined();
    expect((await Bun.file(`${st.runDir}/final.json`).json()).level).toBe(10);
  });

  test("a stale final truth aborts the run as stale_truth", async () => {
    const { calls, exec } = router({ savedAt: "2026-09-25T10:00:00.000Z" });
    const st = await state(exec, { pane: fakePane(["x"]) });
    await stopHarness(st);
    expect(st.abort?.cause).toBe("stale_truth");
    expect(calls.filter((call) => call[3] === "truth")).toHaveLength(1);
  });

  test("keeps an earlier abort cause", async () => {
    const { exec } = router({ savedAt: "2026-09-25T10:00:00.000Z" });
    const st = await state(exec, {
      abort: { cause: "wrong_character", evidence: "Xiara" },
      pane: fakePane(["x"]),
    });
    await stopHarness(st);
    expect(st.abort?.cause).toBe("wrong_character");
  });

  test("without a pane it only stops the partner", async () => {
    const { calls, exec } = router();
    const names = {
      ...AGENT,
      account: PARTNER,
      wrapper: `/wt/tmp/puppet-${PARTNER}`,
    };
    const partners = [
      { kind: "partner" as const, names, role: "partner" as const },
    ];
    const st = await state(exec, { partners });
    await stopHarness(st);
    expect(calls).toEqual([[`/wt/tmp/puppet-${PARTNER}`, "stop"]]);
  });

  test("reads a partner's final truth after its stop when it has a baseline", async () => {
    const { calls, exec } = router();
    const names = { ...AGENT, account: PARTNER, wrapper: `/wt/${PARTNER}` };
    const partners = [
      { kind: "partner" as const, names, role: "partner" as const },
    ];
    const st = await state(exec, { partners });
    await writeFile(`${st.runDir}/partner-baseline.json`, truth("x"));
    await stopHarness(st);
    expect(calls).toEqual([
      [`/wt/${PARTNER}`, "stop"],
      ["bun", "packages/factory/src/main.ts", "soap", "truth", PARTNER],
    ]);
    const final = await Bun.file(`${st.runDir}/partner-final.json`).json();
    expect(final.savedAt).toBe(new Date(NOW).toISOString());
  });

  test("a stale partner final truth is a note, not an abort", async () => {
    const { exec } = router({ savedAt: "2026-09-25T10:00:00.000Z" });
    const names = { ...AGENT, account: PARTNER, wrapper: `/wt/${PARTNER}` };
    const partners = [
      { kind: "witness" as const, names, role: "partner2" as const },
    ];
    const st = await state(exec, { partners });
    await writeFile(`${st.runDir}/partner2-baseline.json`, truth("x"));
    await stopHarness(st);
    expect(st.abort).toBeUndefined();
    expect(st.notes).toEqual([
      expect.stringContaining("partner2 final truth: stale_truth"),
    ]);
    expect(await Bun.file(`${st.runDir}/partner2-final.json`).exists()).toBe(
      false,
    );
  });

  test("reads a console check after the final truth", async () => {
    const { calls, exec } = router();
    const scenario = {
      ...loadScenario("t0-self-state"),
      checks: [
        {
          evidence: { console: { match: "Party", read: "group" as const } },
          expect: "in a party",
          id: "in-party",
          source: "console" as const,
        },
      ],
    };
    const st = await state(exec, { pane: fakePane(["x"]), scenario });
    await stopHarness(st);
    expect(calls.map((call) => call.slice(3))).toEqual([
      ["truth", ACC],
      ["gm", ACC, "read", "group"],
    ]);
    const row = await Bun.file(`${st.runDir}/console.jsonl`).json();
    expect(row).toMatchObject({ code: 0, id: "in-party", verb: "group" });
  });

  test("stops the partner while the agent is still logging out", async () => {
    const order: string[] = [];
    const partnerStopped = Promise.withResolvers<void>();
    const { exec: base } = router();
    const exec: Exec = (argv, execOpts) => {
      if (argv[1] === "stop") {
        order.push("partner stop");
        partnerStopped.resolve();
      }
      return base(argv, execOpts);
    };
    const pane = {
      ...fakePane(["x"]),
      quit: async () => {
        order.push("quit start");
        await partnerStopped.promise;
        order.push("quit end");
      },
    };
    const names = {
      ...AGENT,
      account: PARTNER,
      wrapper: `/wt/tmp/puppet-${PARTNER}`,
    };
    const partners = [
      { kind: "partner" as const, names, role: "partner" as const },
    ];
    const st = await state(exec, { pane, partners });
    await stopHarness(st);
    expect(order).toEqual(["quit start", "partner stop", "quit end"]);
    expect(st.exitMs).toBe(NOW);
    expect(st.abort).toBeUndefined();
  });
});

describe("cleanup", () => {
  test("deletes the accounts, quarantines leaks and removes the session files", async () => {
    const { calls, exec } = router();
    const st = await state(exec, { pane: fakePane(["x"]) });
    await writeFile(
      `${st.runDir}/account.json`,
      JSON.stringify({ account: ACC, password: PASSWORD }),
      { mode: 0o600 },
    );
    await writeFile(`${st.runDir}/frames/00000-1.txt`, `echo ${PASSWORD}`);
    await cleanup(st);
    expect(calls.filter((call) => call[3] === "delete")).toEqual([
      ["bun", "packages/factory/src/main.ts", "soap", "delete", ACC],
    ]);
    expect(st.leaks).toEqual(["frames/00000-1.txt"]);
    expect(await readdir(`${st.runDir}/quarantine`)).toEqual([
      "frames_00000-1.txt",
    ]);
    expect(await Bun.file(`${st.runDir}/account.json`).exists()).toBe(false);
    expect(await Bun.file(`${st.runDir}/cleanup-failed`).exists()).toBe(false);
  });

  test("writes cleanup-failed when an account is still listed", async () => {
    const { exec } = router({ listed: [ACC] });
    const st = await state(exec);
    await cleanup(st);
    expect(await Bun.file(`${st.runDir}/cleanup-failed`).text()).toBe(
      `${ACC}\n`,
    );
  });

  test("a failed close still deletes the accounts", async () => {
    const { calls, exec } = router();
    const pane = {
      ...fakePane(["x"]),
      close: () => Promise.reject(new Error("no runtime")),
    };
    const st = await state(exec, { pane });
    await cleanup(st);
    expect(calls.some((call) => call[3] === "delete")).toBe(true);
    expect(st.notes).toContain("close: no runtime");
  });

  test("a failed soap list marks every account as not cleaned", async () => {
    const exec: Exec = async (argv) =>
      argv[3] === "list" ? failed(1, "service down") : ok();
    const st = await state(exec);
    await cleanup(st);
    expect(await Bun.file(`${st.runDir}/cleanup-failed`).text()).toBe(
      `${ACC}\n`,
    );
  });
});

describe("writeOutcome", () => {
  test("writes a schema-valid draft for a finished run", async () => {
    const { exec } = router();
    const st = await state(exec, {
      end: "done",
      exitMs: NOW,
      finalSavedAt: "2026-09-26T21:00:00.000Z",
      taskMs: NOW - 72_000,
    });
    expect(await writeOutcome(st)).toBe(
      "t0-self-state-1 draft 0/5 tools=0 wall=72",
    );
    const draft = (await Bun.file(
      `${st.runDir}/grader/draft.json`,
    ).json()) as EvalResult;
    expect(draft.verdict).toBeNull();
    expect(validateResult(draft)).toEqual([
      "$.verdict: expected one of pass|fail|blocked|aborted",
    ]);
    expect(draft.checks.map((check) => check.id)).toEqual([
      "level",
      "money",
      "free-slots",
      "main-hand",
      "vitals",
    ]);
    expect(draft.checks[0]).toEqual({
      expected: "the stated level equals T baseline level",
      id: "level",
      met: false,
      observed: null,
      source: "truth",
    });
    expect(draft.accounts).toEqual([ACC]);
    expect(await Bun.file(`${st.runDir}/result.json`).exists()).toBe(false);
  });

  test("a check blocked by a named gap carries it into the draft", async () => {
    const { exec } = router();
    const ghostlands = loadScenario("t3-ghostlands-kill");
    const st = await state(exec, {
      end: "done",
      exitMs: NOW,
      scenario: {
        ...ghostlands,
        checks: ghostlands.checks.map((check) =>
          check.id === "two-kills" ? { ...check, blockedBy: "P9:gap" } : check,
        ),
      },
      taskMs: NOW - 72_000,
    });
    await writeOutcome(st);
    const draft = (await Bun.file(
      `${st.runDir}/grader/draft.json`,
    ).json()) as EvalResult;
    expect(draft.blockedBy).toEqual(["P9:gap"]);
    expect(
      draft.checks.find((check) => check.id === "two-kills"),
    ).toMatchObject({
      blockedBy: "P9:gap",
      met: false,
    });
    expect(
      draft.checks.find((check) => check.id === "total-xp")?.blockedBy,
    ).toBeUndefined();
    expect(validateResult({ ...draft, verdict: "blocked" })).toEqual([]);
    expect(
      validateResult({
        ...draft,
        checks: [{ ...draft.checks[0], blockedBy: 3 }],
        verdict: "blocked",
      }),
    ).toContain("$.checks[0].blockedBy: expected string");
  });

  test("measures wall time to the accepted answer and keeps the exit time", async () => {
    const { exec } = router();
    const st = await state(exec, {
      answerMs: NOW - 69_000,
      end: "done",
      endMs: NOW - 39_000,
      exitMs: NOW,
      taskMs: NOW - 72_000,
    });
    expect(await writeOutcome(st)).toBe(
      "t0-self-state-1 draft 0/5 tools=0 wall=3",
    );
    const draft = (await Bun.file(
      `${st.runDir}/grader/draft.json`,
    ).json()) as EvalResult;
    expect(draft.efficiency.wallSec).toBe(3);
    expect(draft.efficiency.exitSec).toBe(72);
  });

  test("a run that did not end done measures wall time to its end", async () => {
    const { exec } = router();
    const st = await state(exec, {
      answerMs: undefined,
      end: "budget",
      endMs: NOW - 10_000,
      exitMs: NOW,
      taskMs: NOW - 190_000,
    });
    await writeOutcome(st);
    const draft = (await Bun.file(
      `${st.runDir}/grader/draft.json`,
    ).json()) as EvalResult;
    expect(draft.efficiency.wallSec).toBe(180);
    expect(draft.efficiency.exitSec).toBe(190);
  });

  test("a partner scenario measures wall time to the whisper reply after the first answer", async () => {
    const { exec } = router();
    const taskMs = NOW - 120_000;
    const st = await state(exec, {
      answerMs: taskMs + 7134,
      end: "done",
      endMs: taskMs + 90_000,
      exitMs: NOW,
      scenario: loadScenario("t2-whisper-reply"),
      taskMs,
    });
    const gl = (event: string, ts: number) =>
      JSON.stringify({ data: {}, event, seq: ts, text: event, ts });
    await Bun.write(
      `${st.runDir}/gamelog.jsonl`,
      `${[
        gl("agent/message", taskMs + 7134),
        gl("chat/in", taskMs + 60_500),
        gl("tool/result", taskMs + 62_000),
        gl("chat/out", taskMs + 62_800),
        gl("tool/result", taskMs + 95_000),
      ].join("\n")}\n`,
    );
    await writeOutcome(st);
    const draft = (await Bun.file(
      `${st.runDir}/grader/draft.json`,
    ).json()) as EvalResult;
    expect(draft.efficiency.wallSec).toBe(62.8);
  });

  test("a scenario with no steers or partner actions keeps the answer as wall end", async () => {
    const { exec } = router();
    const taskMs = NOW - 72_000;
    const st = await state(exec, {
      answerMs: taskMs + 3000,
      end: "done",
      endMs: taskMs + 33_000,
      exitMs: NOW,
      taskMs,
    });
    await Bun.write(
      `${st.runDir}/gamelog.jsonl`,
      `${JSON.stringify({ data: {}, event: "tool/result", seq: 1, text: "", ts: taskMs + 9000 })}\n`,
    );
    await writeOutcome(st);
    const draft = (await Bun.file(
      `${st.runDir}/grader/draft.json`,
    ).json()) as EvalResult;
    expect(draft.efficiency.wallSec).toBe(3);
  });

  test("writes result.json for an aborted run with a leak friction item", async () => {
    const { exec } = router();
    const st = await state(exec, {
      abort: { cause: "launch_failed", evidence: "orca runtime not reachable" },
      end: "abort",
      leaks: ["frames/00000-1.txt"],
    });
    expect(await writeOutcome(st)).toStartWith("t0-self-state-1 aborted 0/5 ");
    const result = (await Bun.file(
      `${st.runDir}/result.json`,
    ).json()) as EvalResult;
    expect(validateResult(result)).toEqual([]);
    expect(result.verdict).toBe("aborted");
    expect(result.verdictReason).toBe("launch_failed");
    expect(result.friction[0]).toEqual({
      area: "tool",
      category: "credential-leak",
      quote:
        "a password was found in frames/00000-1.txt; the file is in quarantine/",
      ref: "quarantine/frames_00000-1.txt",
      severity: "blocker",
    });
  });
});
