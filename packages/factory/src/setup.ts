import { readlink } from "node:fs/promises";
import { homedir } from "node:os";
import {
  automationNames,
  levelOf,
  mainCheckout,
  type PaceLevel,
  type Role,
  readPace,
  runner,
} from "#factory/config";
import { json, must, type Result, run } from "#factory/exec";
import merger from "#factory/prompts/merger.md" with { type: "text" };
import qa from "#factory/prompts/qa.md" with { type: "text" };
import reviewer from "#factory/prompts/reviewer.md" with { type: "text" };
import worker from "#factory/prompts/worker.md" with { type: "text" };

export type Spec = {
  name: string;
  rrule: string;
  prompt: string;
  precheck: string;
  enable: boolean;
};

export type Automation = {
  id: string;
  name: string;
  prompt: string;
  agentId: string;
  rrule: string;
  enabled: boolean;
  precheck: { command: string; timeoutSeconds: number } | null;
  workspaceMode: string;
  baseBranch: string | null;
};

export type Step =
  | { kind: "create"; spec: Spec }
  | { kind: "edit"; id: string; spec: Spec; changes: string[] }
  | { kind: "ok"; id: string; spec: Spec };

const provider = "omp";
export const baseBranch = "origin/main";
const precheckTimeout = 60;

const roles: [Role, string][] = [
  ["worker", worker],
  ["reviewer", reviewer],
  ["merger", merger],
  ["qa", qa],
];

export function desiredAutomations(enable: boolean, level: PaceLevel): Spec[] {
  return roles.map(([role, prompt]) => ({
    enable,
    name: automationNames[role],
    precheck: `bun ${runner}/packages/factory/src/main.ts precheck ${role}`,
    prompt,
    rrule: level.schedules[role],
  }));
}

function diff(spec: Spec, current: Automation): string[] {
  const checks: [string, boolean][] = [
    ["prompt", current.prompt !== spec.prompt],
    ["provider", current.agentId !== provider],
    ["trigger", current.rrule !== spec.rrule],
    ["precheck", current.precheck?.command !== spec.precheck],
    ["precheck-timeout", current.precheck?.timeoutSeconds !== precheckTimeout],
    ["workspace-mode", current.workspaceMode !== "new_per_run"],
    ["base-branch", current.baseBranch !== baseBranch],
    ["enabled", spec.enable && !current.enabled],
  ];
  return checks.filter(([, changed]) => changed).map(([field]) => field);
}

export function plan(desired: Spec[], existing: Automation[]): Step[] {
  return desired.map((spec) => {
    const current = existing.find(({ name }) => name === spec.name);
    if (!current) return { kind: "create", spec };
    const changes = diff(spec, current);
    if (changes.length === 0) return { id: current.id, kind: "ok", spec };
    return { changes, id: current.id, kind: "edit", spec };
  });
}

function specArgs({ name, rrule, prompt, precheck }: Spec): string[] {
  return [
    "--name",
    name,
    "--trigger",
    rrule,
    "--prompt",
    prompt,
    "--provider",
    provider,
    "--repo",
    `path:${mainCheckout}`,
    "--workspace-mode",
    "new-per-run",
    "--base-branch",
    baseBranch,
    "--precheck",
    precheck,
    "--precheck-timeout",
    String(precheckTimeout),
  ];
}

export function command(step: Step): string[] | undefined {
  const { spec } = step;
  const enabled = spec.enable ? ["--enabled"] : [];
  if (step.kind === "ok") return undefined;
  if (step.kind === "edit") {
    return [
      "orca-ide",
      "automations",
      "edit",
      "--id",
      step.id,
      ...specArgs(spec),
      ...enabled,
    ];
  }
  const state = spec.enable ? "--enabled" : "--disabled";
  return ["orca-ide", "automations", "create", ...specArgs(spec), state];
}

function describe(step: Step): string {
  const { name, rrule, enable } = step.spec;
  if (step.kind === "ok") return `ok      ${name} (${step.id})`;
  if (step.kind === "edit")
    return `edit    ${name} (${step.id}): ${step.changes.join(", ")}`;
  return `create  ${name} "${rrule}" ${enable ? "enabled" : "disabled"}`;
}

export async function existingAutomations(): Promise<Automation[]> {
  const cmd = ["orca-ide", "automations", "list", "--json"];
  const listed = await json<{ result: { automations: Automation[] } }>(cmd);
  return listed.result.automations;
}

export type PromptEdit = { id: string; name: string; prompt: string };

export type Orca = {
  list: () => Promise<Automation[]>;
  run: (cmd: string[]) => Promise<Result>;
};

const liveOrca: Orca = { list: existingAutomations, run };

export function promptDrift(existing: Automation[]): PromptEdit[] {
  return roles.flatMap(([role, prompt]) => {
    const current = existing.find(({ name }) => name === automationNames[role]);
    if (!current || current.prompt === prompt) return [];
    return [{ id: current.id, name: current.name, prompt }];
  });
}

export function promptCommand({ id, prompt }: PromptEdit): string[] {
  return ["orca-ide", "automations", "edit", "--id", id, "--prompt", prompt];
}

async function syncPrompt(orca: Orca, edit: PromptEdit): Promise<string> {
  try {
    const { code, stderr } = await orca.run(promptCommand(edit));
    if (code === 0) return "synced";
    return `sync failed: exited ${code}: ${stderr.trim()}`;
  } catch (error) {
    return `sync failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}

export async function syncPrompts(
  dryRun: boolean,
  log: (line: string) => void,
  orca: Orca = liveOrca,
): Promise<void> {
  const existing = await orca.list().catch((error: unknown) => {
    log(
      `prompt sync failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return [];
  });
  for (const edit of promptDrift(existing)) {
    const outcome = dryRun ? "drifted, dry run" : await syncPrompt(orca, edit);
    log(`prompt ${edit.name} ${outcome}`);
  }
}

async function setupAutomations(
  apply: boolean,
  enable: boolean,
): Promise<number> {
  const level = levelOf(await readPace());
  const steps = plan(
    desiredAutomations(enable, level),
    await existingAutomations(),
  );
  for (const step of steps) console.log(describe(step));
  const commands = steps.map(command).filter((cmd) => cmd !== undefined);
  return execute(commands, apply);
}

async function execute(commands: string[][], apply: boolean): Promise<number> {
  if (commands.length === 0) return 0;
  if (!apply) {
    console.log(`dry run: ${commands.length} change(s), rerun with --apply`);
    return 0;
  }
  for (const cmd of commands) await must(cmd);
  return 0;
}

const wrapperLink = `${homedir()}/.local/bin/omp-factory`;
export const wrapperTarget = `${runner}/packages/factory/src/omp-factory`;

export function wrapperCommand(
  current: string | undefined,
): string[] | undefined {
  if (current === wrapperTarget) return undefined;
  return ["ln", "-sfn", wrapperTarget, wrapperLink];
}

async function setupWrapper(apply: boolean): Promise<number> {
  const current = await readlink(wrapperLink).catch(() => undefined);
  const cmd = wrapperCommand(current);
  console.log(
    cmd
      ? `link    ${wrapperLink} -> ${wrapperTarget}`
      : `ok      ${wrapperLink}`,
  );
  return execute(cmd ? [cmd] : [], apply);
}

const usage = "usage: setup <automations|wrapper> [--apply] [--enable]";

export function runSetup(args: string[]): Promise<number> {
  const [target, ...flags] = args;
  const apply = flags.includes("--apply");
  if (target === "wrapper") return setupWrapper(apply);
  if (target === "automations")
    return setupAutomations(apply, flags.includes("--enable"));
  console.error(usage);
  return Promise.resolve(2);
}
