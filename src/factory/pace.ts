import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import {
  automationNames,
  factoryConfigDir,
  isPace,
  levelOf,
  type Pace,
  paceFile,
  paceNames,
  pausedRoles,
  readPace,
} from "factory/config";
import { json, must } from "factory/exec";
import {
  type Automation,
  baseBranch,
  desiredAutomations,
  existingAutomations,
  type Spec,
} from "factory/setup";

export type Detail = Automation & { setupDecision?: string };

export type Target = [Spec, Automation];

const timer = "tuicraft-factory-reaper.timer";
const dropIn = `${homedir()}/.config/systemd/user/${timer}.d/pace.conf`;
const activeSec = /OnUnitActiveUSec=(\S+)/;
const bootSec = /OnBootUSec=/;
const accuracyUSec = /^AccuracyUSec=(\S+)$/m;
const subState = /^SubState=(\S+)$/m;
const accuracy = "1s";
const scheduled = ["waiting", "running"];
const paused = pausedRoles.map((role) => automationNames[role]);

export function timerDropIn(minutes: number): string {
  const every = `${minutes}min`;
  return `[Timer]\nOnBootSec=\nOnUnitActiveSec=\nOnBootSec=${every}\nOnUnitActiveSec=${every}\nAccuracySec=${accuracy}\n`;
}

export function timerCheck(
  pace: Pace,
  props: string,
): { interval: string | null; drift: string[] } {
  const interval = props.match(activeSec)?.[1] ?? null;
  const want =
    pace === "pause" ? interval : `${levelOf(pace).reaperMinutes}min`;
  const slack = props.match(accuracyUSec)?.[1] ?? "unknown";
  const state = props.match(subState)?.[1] ?? "unknown";
  const checks: [string, boolean][] = [
    [`want ${want ?? "an interval"}`, interval === null || interval !== want],
    [
      `accuracy ${slack}, want ${accuracy}`,
      pace !== "pause" && slack !== accuracy,
    ],
    ["no boot trigger", !bootSec.test(props)],
    [`no next run (${state})`, !scheduled.includes(state)],
  ];
  const drift = checks.filter(([, bad]) => bad).map(([message]) => message);
  return { drift, interval };
}

export function targets(pace: Pace, existing: Automation[]): Target[] {
  return desiredAutomations(true, levelOf(pace)).map((spec) => {
    const live = existing.find(({ name }) => name === spec.name);
    if (!live)
      throw new Error(`${spec.name} not found; run setup automations first`);
    if (pace !== "pause") return [spec, live];
    const enable = !paused.includes(spec.name);
    return [{ ...spec, enable, rrule: live.rrule }, live];
  });
}

export function editCommand([spec, live]: Target): string[] | undefined {
  const state = spec.enable ? "--enabled" : "--disabled";
  const args = [
    ...(live.rrule === spec.rrule ? [] : ["--trigger", spec.rrule]),
    ...(live.enabled === spec.enable ? [] : [state]),
  ];
  if (args.length === 0) return undefined;
  return ["orca-ide", "automations", "edit", "--id", live.id, ...args];
}

export function problems(spec: Spec, detail: Detail): string[] {
  const checks: [string, boolean][] = [
    [
      `schedule "${detail.rrule}", want "${spec.rrule}"`,
      detail.rrule !== spec.rrule,
    ],
    [
      `setupDecision ${detail.setupDecision}, want run`,
      detail.setupDecision !== "run",
    ],
    ["precheck drifted", detail.precheck?.command !== spec.precheck],
    [`base branch ${detail.baseBranch}`, detail.baseBranch !== baseBranch],
    [
      spec.enable ? "disabled" : "enabled while paused",
      detail.enabled !== spec.enable,
    ],
  ];
  return checks.filter(([, bad]) => bad).map(([message]) => message);
}

async function timerOk(pace: Pace): Promise<boolean> {
  const props = await must([
    "systemctl",
    "--user",
    "show",
    timer,
    "-p",
    "TimersMonotonic",
    "-p",
    "AccuracyUSec",
    "-p",
    "SubState",
  ]);
  const { interval, drift: found } = timerCheck(pace, props);
  const state = found.length === 0 ? "ok" : `MISMATCH: ${found.join("; ")}`;
  console.log(`${timer} ${String(interval).padEnd(14)} ${state}`);
  return found.length === 0;
}

async function show(): Promise<number> {
  const pace = await readPace();
  console.log(`pace ${pace} (${paceFile()})`);
  let bad = 0;
  for (const [spec, { id }] of targets(pace, await existingAutomations())) {
    const cmd = ["orca-ide", "automations", "show", "--id", id, "--json"];
    const shown = await json<{ result: { automation: Detail } }>(cmd);
    const detail = shown.result.automation;
    const found = problems(spec, detail);
    bad += found.length;
    let state = spec.enable ? "ok" : "paused";
    if (found.length > 0) state = `MISMATCH: ${found.join("; ")}`;
    console.log(
      `${spec.name.padEnd(timer.length)} ${detail.rrule.padEnd(14)} ${state}`,
    );
  }
  if (!(await timerOk(pace))) bad += 1;
  return bad === 0 ? 0 : 1;
}

async function apply(pace: Pace): Promise<number> {
  await mkdir(factoryConfigDir(), { mode: 0o700, recursive: true });
  await Bun.write(paceFile(), `${pace}\n`);
  for (const target of targets(pace, await existingAutomations())) {
    const cmd = editCommand(target);
    if (cmd) await must(cmd);
  }
  if (pace === "pause") return show();
  await Bun.write(dropIn, timerDropIn(levelOf(pace).reaperMinutes));
  await must(["systemctl", "--user", "daemon-reload"]);
  await must(["systemctl", "--user", "restart", timer]);
  return show();
}

export async function runPace(args: string[]): Promise<number> {
  const [level, ...extra] = args;
  if (extra.length > 0 || (level !== undefined && !isPace(level))) {
    console.error(`usage: pace [${paceNames.join("|")}]`);
    return 2;
  }
  try {
    return level === undefined ? await show() : await apply(level);
  } catch (error) {
    console.error(
      `pace: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 2;
  }
}
