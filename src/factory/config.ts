import { homedir } from "node:os";

export const repo = { name: "tuicraft", owner: "tvararu" } as const;
export const repoSlug = `${repo.owner}/${repo.name}`;
export const maintainer = "tvararu";
export const bot = "OpenHubris";
export const maintainerApproval = false;
export const mainCheckout = `${homedir()}/code/tuicraft`;
export const runner = `${homedir()}/.local/share/tuicraft-factory/runner`;

export const board = {
  field: "PVTSSF_lAHOABkwu84BktxOzhjdZBs",
  options: {
    backlog: "f75ad846",
    blocked: "6433a477",
    done: "98236657",
    "in-progress": "47fc9ee4",
    "in-review": "aba860b9",
    ready: "e18bf179",
    triage: "9bdaa34c",
  },
  project: "PVT_kwHOABkwu84BktxO",
} as const;

export type BoardStatus = keyof typeof board.options;

export function isBoardStatus(value: string): value is BoardStatus {
  return Object.hasOwn(board.options, value);
}

export function statusOf(optionId: string): BoardStatus | null {
  const entry = Object.entries(board.options).find(([, id]) => id === optionId);
  return entry && isBoardStatus(entry[0]) ? entry[0] : null;
}

export type Role = "worker" | "reviewer" | "merger" | "qa";

export const automationNames: Record<Role, string> = {
  merger: "merge",
  qa: "qa",
  reviewer: "review",
  worker: "work",
};

export const roleCapHours: Record<Role, number> = {
  merger: 1,
  qa: 2,
  reviewer: 1,
  worker: 3,
};

export const paceNames = ["pause", "default", "max"] as const;

export type Pace = (typeof paceNames)[number];

export type Level = Exclude<Pace, "pause">;

export type PaceLevel = {
  schedules: Record<Role, string>;
  wip: number;
  reviewing: number;
  reaperMinutes: number;
};

export const paces: Record<Level, PaceLevel> = {
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

export const pausedRoles: readonly Role[] = ["worker", "reviewer", "merger"];

export function isPace(value: string): value is Pace {
  return paceNames.some((name) => name === value);
}

export function levelOf(pace: Pace): PaceLevel {
  return paces[pace === "pause" ? "default" : pace];
}

export function paceFile(dir = factoryConfigDir()): string {
  return `${dir}/pace`;
}

export async function readPace(file = paceFile()): Promise<Pace> {
  const handle = Bun.file(file);
  if (!(await handle.exists())) return "default";
  const value = (await handle.text()).trim();
  if (!isPace(value))
    throw new Error(
      `${file}: unknown pace "${value}", expected ${paceNames.join("|")}`,
    );
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
