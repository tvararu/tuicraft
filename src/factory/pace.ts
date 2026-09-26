import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import {
  factoryConfigDir,
  isPace,
  type Pace,
  paceFile,
  paces,
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

const timer = "tuicraft-factory-reaper.timer";
const dropIn = `${homedir()}/.config/systemd/user/${timer}.d/pace.conf`;
const activeSec = /OnUnitActiveUSec=(\S+)/;

export function timerDropIn(minutes: number): string {
  return `[Timer]\nOnUnitActiveSec=\nOnUnitActiveSec=${minutes}min\n`;
}

export function timerInterval(props: string): string | null {
  return props.match(activeSec)?.[1] ?? null;
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
    ["disabled", !detail.enabled],
  ];
  return checks.filter(([, bad]) => bad).map(([message]) => message);
}

async function located(specs: Spec[]): Promise<[Spec, Automation][]> {
  const existing = await existingAutomations();
  return specs.map((spec) => {
    const current = existing.find(({ name }) => name === spec.name);
    if (!current)
      throw new Error(`${spec.name} not found; run setup automations first`);
    return [spec, current];
  });
}

async function show(): Promise<number> {
  const pace = await readPace();
  const level = paces[pace];
  console.log(`pace ${pace} (${paceFile()})`);
  let bad = 0;
  for (const [spec, { id }] of await located(desiredAutomations(true, level))) {
    const cmd = ["orca-ide", "automations", "show", "--id", id, "--json"];
    const shown = await json<{ result: { automation: Detail } }>(cmd);
    const detail = shown.result.automation;
    const found = problems(spec, detail);
    bad += found.length;
    const state = found.length > 0 ? `MISMATCH: ${found.join("; ")}` : "ok";
    console.log(
      `${spec.name.padEnd(timer.length)} ${detail.rrule.padEnd(14)} ${state}`,
    );
  }
  const props = await must([
    "systemctl",
    "--user",
    "show",
    timer,
    "-p",
    "TimersMonotonic",
  ]);
  const interval = timerInterval(props);
  const want = `${level.reaperMinutes}min`;
  const timerOk = interval === want;
  if (!timerOk) bad += 1;
  const timerState = timerOk ? "ok" : `MISMATCH: want ${want}`;
  console.log(`${timer} ${String(interval).padEnd(14)} ${timerState}`);
  return bad === 0 ? 0 : 1;
}

async function apply(pace: Pace): Promise<number> {
  const level = paces[pace];
  await mkdir(factoryConfigDir(), { mode: 0o700, recursive: true });
  await Bun.write(paceFile(), `${pace}\n`);
  for (const [spec, { id, rrule }] of await located(
    desiredAutomations(true, level),
  )) {
    if (rrule === spec.rrule) continue;
    await must([
      "orca-ide",
      "automations",
      "edit",
      "--id",
      id,
      "--trigger",
      spec.rrule,
    ]);
  }
  await Bun.write(dropIn, timerDropIn(level.reaperMinutes));
  await must(["systemctl", "--user", "daemon-reload"]);
  await must(["systemctl", "--user", "restart", timer]);
  return show();
}

export async function runPace(args: string[]): Promise<number> {
  const [level, ...extra] = args;
  if (extra.length > 0 || (level !== undefined && !isPace(level))) {
    console.error(`usage: pace [${Object.keys(paces).join("|")}]`);
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
