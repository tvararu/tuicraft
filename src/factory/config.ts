import { homedir } from "node:os";

const repo = { name: "tuicraft", owner: "tvararu" } as const;
export const repoSlug = `${repo.owner}/${repo.name}`;
export const pm = "tvararu";
export const bot = "OpenHubris";
export const pmApproval = false;
export const mainCheckout = `${homedir()}/code/tuicraft`;
export const runner = `${homedir()}/.local/share/tuicraft-factory/runner`;

export const labels = {
  landing: "agent:landing",
  merging: "agent:merging",
  pm: "needs:pm",
  qa: "qa:found",
  ready: "ready",
  review: "agent:review",
  reviewing: "agent:reviewing",
  rework: "agent:rework",
  working: "agent:working",
} as const;

export type Role = "worker" | "reviewer" | "merger" | "qa";

export const roleCapHours: Record<Role, number> = {
  merger: 1,
  qa: 2,
  reviewer: 1,
  worker: 3,
};

export type Pace = "default" | "max";

export type PaceLevel = {
  schedules: Record<Role, string>;
  wip: number;
  reviewing: number;
  reaperMinutes: number;
};

export const paces: Record<Pace, PaceLevel> = {
  default: {
    reaperMinutes: 5,
    reviewing: 3,
    schedules: {
      merger: "*/10 * * * *",
      qa: "*/30 * * * *",
      reviewer: "*/3 * * * *",
      worker: "*/3 * * * *",
    },
    wip: 3,
  },
  max: {
    reaperMinutes: 5,
    reviewing: 6,
    schedules: {
      merger: "*/3 * * * *",
      qa: "*/15 * * * *",
      reviewer: "* * * * *",
      worker: "*/2 * * * *",
    },
    wip: 6,
  },
};

export function isPace(value: string): value is Pace {
  return Object.hasOwn(paces, value);
}

export function paceFile(dir = factoryConfigDir()): string {
  return `${dir}/pace`;
}

export async function readPace(file = paceFile()): Promise<Pace> {
  const handle = Bun.file(file);
  if (!(await handle.exists())) return "default";
  const value = (await handle.text()).trim();
  if (!isPace(value))
    throw new Error(`${file}: unknown pace "${value}", expected default|max`);
  return value;
}

export const idleHours = 12;

export const stalledRunQuietHours = 10 / 60;

export function factoryConfigDir(): string {
  return `${homedir()}/.config/tuicraft-factory`;
}

export function factoryStateDir(): string {
  return `${homedir()}/.local/state/tuicraft-factory`;
}
