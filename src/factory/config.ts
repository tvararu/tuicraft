import { homedir } from "node:os";

export const repo = { name: "tuicraft", owner: "tvararu" } as const;
export const repoSlug = `${repo.owner}/${repo.name}`;
export const pm = "tvararu";
export const bot = "OpenHubris";
export const wip = 2;
export const maxAttempts = 3;
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

export const idleHours = 12;

export function factoryConfigDir(): string {
  return `${homedir()}/.config/tuicraft-factory`;
}

export function factoryStateDir(): string {
  return `${homedir()}/.local/state/tuicraft-factory`;
}
