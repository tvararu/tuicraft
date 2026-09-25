import {
  labels,
  mainCheckout,
  type Role,
  repoSlug,
  runner,
} from "factory/config";
import { json, must } from "factory/exec";
import merger from "factory/prompts/merger.md" with { type: "text" };
import qa from "factory/prompts/qa.md" with { type: "text" };
import reviewer from "factory/prompts/reviewer.md" with { type: "text" };
import worker from "factory/prompts/worker.md" with { type: "text" };

export type Label = { name: string; color: string; description: string };

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
const baseBranch = "main";
const precheckTimeout = 60;

export const desiredLabels: Label[] = [
  {
    color: "0E8A16",
    description: "Theo wants this worked on",
    name: labels.ready,
  },
  {
    color: "FBCA04",
    description: "A factory worker owns the issue",
    name: labels.working,
  },
  {
    color: "1D76DB",
    description: "PR waits for factory review",
    name: labels.review,
  },
  {
    color: "0052CC",
    description: "A factory reviewer has the PR",
    name: labels.reviewing,
  },
  {
    color: "D93F0B",
    description: "Reviewer or merger wants changes",
    name: labels.rework,
  },
  {
    color: "5319E7",
    description: "Reviewed, waiting for the merger",
    name: labels.merging,
  },
  {
    color: "6F42C1",
    description: "The merger is landing this issue",
    name: labels.landing,
  },
  {
    color: "B60205",
    description: "Theo must decide something",
    name: labels.pm,
  },
  { color: "C5DEF5", description: "Filed by factory QA", name: labels.qa },
];

const roles: [Role, string, string][] = [
  ["worker", "*/5 * * * *", worker],
  ["reviewer", "*/10 * * * *", reviewer],
  ["merger", "0 * * * *", merger],
  ["qa", "*/30 * * * *", qa],
];

export function desiredAutomations(enable: boolean): Spec[] {
  return roles.map(([role, rrule, prompt]) => ({
    enable,
    name: `factory-${role}`,
    precheck: `bun ${runner}/src/factory/main.ts precheck ${role}`,
    prompt,
    rrule,
  }));
}

export function missingLabels(desired: Label[], existing: string[]): Label[] {
  const have = new Set(existing);
  return desired.filter((label) => !have.has(label.name));
}

export function diff(spec: Spec, current: Automation): string[] {
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

async function existingLabels(): Promise<string[]> {
  const cmd = [
    "gh",
    "label",
    "list",
    "-R",
    repoSlug,
    "--json",
    "name",
    "--limit",
    "500",
  ];
  const listed = await json<{ name: string }[]>(cmd);
  return listed.map(({ name }) => name);
}

async function existingAutomations(): Promise<Automation[]> {
  const cmd = ["orca-ide", "automations", "list", "--json"];
  const listed = await json<{ result: { automations: Automation[] } }>(cmd);
  return listed.result.automations;
}

async function setupLabels(apply: boolean): Promise<number> {
  const missing = missingLabels(desiredLabels, await existingLabels());
  for (const { name, color, description } of desiredLabels) {
    const create = missing.some((label) => label.name === name);
    console.log(
      create ? `create  ${name} #${color} "${description}"` : `ok      ${name}`,
    );
  }
  const commands = missing.map(({ name, color, description }) => [
    ...["gh", "label", "create", name, "-R", repoSlug],
    ...["--color", color, "--description", description],
  ]);
  return execute(commands, apply);
}

async function setupAutomations(
  apply: boolean,
  enable: boolean,
): Promise<number> {
  const steps = plan(desiredAutomations(enable), await existingAutomations());
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

const usage = "usage: setup <labels|automations> [--apply] [--enable]";

export function runSetup(args: string[]): Promise<number> {
  const [target, ...flags] = args;
  const apply = flags.includes("--apply");
  if (target === "labels") return setupLabels(apply);
  if (target === "automations")
    return setupAutomations(apply, flags.includes("--enable"));
  console.error(usage);
  return Promise.resolve(2);
}
