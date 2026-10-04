import { readdir, writeFile } from "node:fs/promises";
import { messageOf } from "@peon/core/lib/errors";
import type { Clock } from "#harness/contract/services";
import {
  type AccountNames,
  deleteAccounts,
  quarantine,
  removeSessionFiles,
  sessionFiles,
} from "#harness/grader/accounts";
import { writeConcurrent } from "#harness/grader/concurrent";
import { conditionsOf } from "#harness/grader/conditions";
import { readConsole } from "#harness/grader/console-read";
import { observedChecks } from "#harness/grader/draft-fill";
import { parseGameLog } from "#harness/grader/draft-gamelog";
import { efficiency, readSessionUsage } from "#harness/grader/efficiency";
import type { Exec } from "#harness/grader/exec";
import { recordItemFlags } from "#harness/grader/item-flags";
import type { Pane } from "#harness/grader/pane";
import type { Partner } from "#harness/grader/partner";
import {
  type EvalEvidence,
  type EvalIntervention,
  type EvalResult,
  type FrictionItem,
  validateResult,
} from "#harness/grader/result";
import { partnerTruthFile, stopPartner } from "#harness/grader/run-partners";
import type { Scenario } from "#harness/grader/scenarios";
import { finalTruth, leakCheck } from "#harness/grader/truth";
import type { Watcher } from "#harness/grader/watch";

export const EXIT_WAIT_MS = 20_000;
export const DRAFT_REASON =
  "draft: the grader decides the checks, friction and verdict";

const NOTES_MAX = 1500;

export type RunState = {
  exec: Exec;
  clock: Clock;
  scenario: Scenario;
  round: number;
  replica: number;
  runDir: string;
  tab: string;
  sha: string;
  truthWaitMs: number;
  agent: AccountNames | undefined;
  partners: Partner[];
  pane: Pane | undefined;
  watcher: Watcher | undefined;
  taskMs: number | undefined;
  answerMs: number | undefined;
  endMs: number | undefined;
  exitMs: number | undefined;
  firstToolAt: number | undefined;
  end: EvalResult["end"];
  abort: EvalResult["abort"];
  interventions: EvalIntervention[];
  finalSavedAt: string | undefined;
  cleanupFailed: string[];
  leaks: string[];
  notes: string[];
  blockedBy: string[];
  steersFired: number;
  log: (line: string) => void;
};

export type RunStateInit = Pick<
  RunState,
  "exec" | "clock" | "scenario" | "round" | "replica" | "runDir" | "tab" | "sha"
> & { truthWaitMs?: number; log: (line: string) => void };

export function newRunState({
  truthWaitMs = 10_000,
  log,
  ...init
}: RunStateInit): RunState {
  return {
    ...init,
    abort: undefined,
    agent: undefined,
    answerMs: undefined,
    blockedBy: [],
    cleanupFailed: [],
    end: undefined,
    endMs: undefined,
    exitMs: undefined,
    finalSavedAt: undefined,
    firstToolAt: undefined,
    interventions: [],
    leaks: [],
    log,
    notes: [],
    pane: undefined,
    partners: [],
    steersFired: 0,
    taskMs: undefined,
    truthWaitMs,
    watcher: undefined,
  };
}

export async function writeJson(file: string, value: unknown): Promise<void> {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

export function accountsOf(st: RunState): string[] {
  return [
    ...(st.agent === undefined ? [] : [st.agent.account]),
    ...st.partners.map(({ names }) => names.account),
  ];
}

async function attempt(
  st: RunState,
  what: string,
  job: () => Promise<unknown>,
): Promise<void> {
  try {
    await job();
    st.log(`cleanup ${what} done`);
  } catch (err) {
    st.notes.push(`${what}: ${messageOf(err)}`);
    st.log(`cleanup ${what} failed: ${messageOf(err)}`);
  }
}

async function quitPane(st: RunState, pane: Pane): Promise<void> {
  await pane.quit();
  if (!(await pane.waitExit(EXIT_WAIT_MS)))
    st.notes.push(
      `quit: the harness did not exit within ${EXIT_WAIT_MS / 1000} s`,
    );
}

async function verifyFinal(st: RunState, account: string): Promise<void> {
  const final = await finalTruth({
    account,
    clock: st.clock,
    exec: st.exec,
    exitMs: st.exitMs ?? st.clock.now(),
    waitMs: st.truthWaitMs,
  });
  if (!final.ok) {
    st.abort ??= { cause: final.cause, evidence: final.detail };
    return;
  }
  await writeJson(`${st.runDir}/final.json`, final.truth);
  st.finalSavedAt = final.truth.savedAt;
}

async function quitAgent(st: RunState, pane: Pane): Promise<void> {
  await attempt(st, "quit", () => quitPane(st, pane));
  st.exitMs = st.clock.now();
}

async function stopOne(st: RunState, partner: Partner): Promise<number> {
  const stopMs = st.clock.now();
  await attempt(st, `${partner.role} stop`, () =>
    stopPartner(st.exec, partner),
  );
  return stopMs;
}

async function partnerFinal(
  st: RunState,
  partner: Partner,
  exitMs: number,
): Promise<void> {
  if (
    !(await Bun.file(partnerTruthFile(st.runDir, partner, "baseline")).exists())
  )
    return;
  const final = await finalTruth({
    account: partner.names.account,
    clock: st.clock,
    exec: st.exec,
    exitMs,
    waitMs: st.truthWaitMs,
  });
  if (final.ok)
    await writeJson(partnerTruthFile(st.runDir, partner, "final"), final.truth);
  else
    st.notes.push(
      `${partner.role} final truth: ${final.cause} ${final.detail}`,
    );
}

export async function stopHarness(st: RunState): Promise<void> {
  const { agent, pane, partners, watcher } = st;
  if (watcher !== undefined) await attempt(st, "watcher", () => watcher.stop());
  const [, ...stops] = await Promise.all([
    pane === undefined ? undefined : quitAgent(st, pane),
    ...partners.map((partner) => stopOne(st, partner)),
  ]);
  if (pane !== undefined && agent !== undefined)
    await attempt(st, "final truth", () => verifyFinal(st, agent.account));
  for (const [index, partner] of partners.entries())
    await attempt(st, `${partner.role} final truth`, () =>
      partnerFinal(st, partner, stops[index] ?? st.clock.now()),
    );
  if (agent !== undefined)
    await attempt(st, "item flags", () =>
      recordItemFlags({
        account: agent.account,
        exec: st.exec,
        runDir: st.runDir,
      }),
    );
  await attempt(st, "console reads", () =>
    readConsole({
      agent: agent?.account,
      checks: st.scenario.checks,
      exec: st.exec,
      partners,
      runDir: st.runDir,
    }),
  );
}

async function deleteAll(st: RunState, accounts: string[]): Promise<void> {
  if (accounts.length === 0) return;
  try {
    st.cleanupFailed = await deleteAccounts({ accounts, exec: st.exec });
    st.log(`cleanup delete done (${st.cleanupFailed.length} failed)`);
  } catch (err) {
    st.log(`cleanup delete failed: ${messageOf(err)}`);
    st.cleanupFailed = [...accounts];
    st.notes.push(`delete: ${messageOf(err)}`);
  }
}

async function checkLeaks(st: RunState): Promise<void> {
  const secretFiles = sessionFiles(st.runDir);
  st.leaks = await leakCheck({ exec: st.exec, runDir: st.runDir, secretFiles });
  await quarantine({ files: st.leaks, runDir: st.runDir });
}

export async function cleanup(st: RunState): Promise<void> {
  const { pane } = st;
  if (pane !== undefined) await attempt(st, "close", () => pane.close());
  await deleteAll(st, accountsOf(st));
  await attempt(st, "leak check", () => checkLeaks(st));
  await attempt(st, "concurrent", () =>
    writeConcurrent(st.runDir, new Date(st.clock.now()).toISOString()),
  );
  await attempt(st, "session files", () => removeSessionFiles(st.runDir));
  if (st.cleanupFailed.length > 0)
    await writeFile(
      `${st.runDir}/cleanup-failed`,
      `${st.cleanupFailed.join("\n")}\n`,
    );
}

export function summaryLine(
  result: Pick<DraftResult, "checks" | "efficiency" | "replica" | "scenario">,
  label: string,
): string {
  const met = result.checks.filter((check) => check.met).length;
  const { toolCalls, wallSec } = result.efficiency;
  return `${result.scenario}-${result.replica} ${label} ${met}/${result.checks.length} tools=${toolCalls} wall=${Math.round(wallSec)}`;
}

function leakFriction(file: string): FrictionItem {
  const quote = `a password was found in ${file}; the file is in quarantine/`;
  return {
    area: "tool",
    category: "credential-leak",
    quote,
    ref: `quarantine/${file.replaceAll("/", "_")}`,
    severity: "blocker",
  };
}

async function evidenceOf(st: RunState): Promise<EvalEvidence> {
  const frames = await readdir(`${st.runDir}/frames`).then(
    (names) => names.length,
    () => 0,
  );
  const present = async (file: string): Promise<string | undefined> =>
    (await Bun.file(`${st.runDir}/${file}`).exists()) ? file : undefined;
  return {
    baseline: await present("baseline.json"),
    final: st.finalSavedAt === undefined ? undefined : "final.json",
    finalSavedAt: st.finalSavedAt,
    frames,
    gameLog: await present("gamelog.jsonl"),
    runDir: st.runDir,
    session: await present("session.jsonl"),
  };
}

export type DraftResult = Omit<EvalResult, "verdict"> & {
  verdict: EvalResult["verdict"] | null;
};

type Verdict = Pick<DraftResult, "blockedBy" | "verdict" | "verdictReason">;

function unfiredTrigger(st: RunState): string | undefined {
  const next = st.scenario.steers[st.steersFired];
  return next?.at.kind === "trigger" ? next.at.trigger : undefined;
}

function verdictOf(st: RunState): Verdict {
  if (st.abort !== undefined)
    return { verdict: "aborted", verdictReason: st.abort.cause };
  if (st.blockedBy.length > 0)
    return {
      blockedBy: st.blockedBy,
      verdict: "blocked",
      verdictReason: `preflight: ${st.blockedBy.join(", ")} is still missing`,
    };
  const trigger = st.end === undefined ? undefined : unfiredTrigger(st);
  if (trigger === undefined)
    return { verdict: null, verdictReason: DRAFT_REASON };
  return {
    blockedBy: [`no_${trigger}`],
    verdict: "blocked",
    verdictReason: `no_${trigger}: the ${trigger} steer never fired; ${DRAFT_REASON}`,
  };
}

const REPLY_EVENTS = new Set(["tool/result", "chat/out"]);

const hasLaterInput = ({ partnerActions, steers }: Scenario): boolean =>
  steers.length > 0 || (partnerActions?.length ?? 0) > 0;

async function lastReplyAt(st: RunState, until: number): Promise<number> {
  const handle = Bun.file(`${st.runDir}/gamelog.jsonl`);
  if (!(await handle.exists())) return 0;
  const replies = parseGameLog(await handle.text()).flatMap(({ event, ts }) =>
    REPLY_EVENTS.has(event) && typeof ts === "number" && ts <= until
      ? [ts]
      : [],
  );
  return Math.max(0, ...replies);
}

async function wallEnd(st: RunState, now: number): Promise<number> {
  const endMs = st.endMs ?? st.exitMs ?? now;
  if (st.end !== "done" || st.answerMs === undefined) return endMs;
  if (!hasLaterInput(st.scenario)) return st.answerMs;
  return Math.max(st.answerMs, await lastReplyAt(st, endMs));
}

function withGaps(
  st: RunState,
  keys: readonly string[] = [],
): string[] | undefined {
  const gaps = st.scenario.checks.flatMap((check) =>
    check.blockedBy === undefined ? [] : [check.blockedBy],
  );
  const all = [...new Set([...keys, ...gaps])];
  return all.length > 0 ? all : undefined;
}

async function draftResult(st: RunState): Promise<DraftResult> {
  const now = st.clock.now();
  const taskMs = st.taskMs ?? now;
  const usage = await readSessionUsage(`${st.runDir}/session.jsonl`);
  const firstActionMs =
    st.firstToolAt === undefined ? undefined : st.firstToolAt - taskMs;
  const aborted = st.abort !== undefined;
  const verdict = verdictOf(st);
  return {
    ...verdict,
    abort: st.abort,
    accounts: accountsOf(st),
    blockedBy: withGaps(st, verdict.blockedBy),
    checks: await observedChecks(
      st.runDir,
      st.scenario.checks,
      st.scenario.steers.map((steer) => steer.text),
    ),
    conditions: await conditionsOf(st.runDir, st.scenario),
    efficiency: efficiency({
      budget: st.scenario.budget,
      exitMs: (st.exitMs ?? now) - taskMs,
      firstActionMs,
      usage,
      wallMs: (await wallEnd(st, now)) - taskMs,
    }),
    end: st.end ?? (aborted ? "abort" : undefined),
    evidence: await evidenceOf(st),
    friction: st.leaks.map(leakFriction),
    interventions: st.interventions,
    notes:
      st.notes.length > 0 ? st.notes.join("\n").slice(0, NOTES_MAX) : undefined,
    replica: st.replica,
    round: st.round,
    scenario: st.scenario.id,
    sha: st.sha,
    tab: st.tab,
  };
}

export async function writeOutcome(st: RunState): Promise<string> {
  const result = await draftResult(st);
  const errors = validateResult(JSON.parse(JSON.stringify(result))).filter(
    (error) => result.verdict !== null || !error.startsWith("$.verdict:"),
  );
  if (errors.length > 0)
    throw new Error(`the draft result breaks the schema: ${errors.join("; ")}`);
  const final = result.verdict === "aborted" || st.blockedBy.length > 0;
  await writeJson(
    final ? `${st.runDir}/result.json` : `${st.runDir}/grader/draft.json`,
    result,
  );
  st.log(final ? "result written" : "draft written");
  return summaryLine(result, final ? (result.verdict ?? "draft") : "draft");
}
