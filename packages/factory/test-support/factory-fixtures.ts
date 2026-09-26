import type { BoardStatus } from "#factory/config";
import type { Issue, Marker, Pr } from "#factory/github";

export const now = Date.parse("2026-09-26T12:00:00Z");

export function ago(minutes: number): string {
  return new Date(now - minutes * 60_000).toISOString();
}

export function issue(
  number: number,
  status: BoardStatus | null,
  extra: Partial<Issue> = {},
): Issue {
  const base = {
    author: "OpenHubris",
    blockers: [],
    markers: [],
    prs: [],
    statusAt: ago(600),
  };
  return { number, status, ...base, ...extra };
}

export function marker(body: string, minutesAgo: number, id = 1): Marker {
  return { at: ago(minutesAgo), body, id };
}

export function pr(extra: Partial<Pr> = {}): Pr {
  const statuses = [
    { name: "signoff/ci", state: "SUCCESS" },
    { name: "factory/ci", state: "SUCCESS" },
    { name: "factory/review", state: "SUCCESS" },
  ];
  const base = {
    base: "main",
    branch: "factory/1-x",
    checked: "abc",
    draft: false,
    head: "abc",
    number: 100,
    state: "OPEN",
    verdicts: [],
  };
  return { ...base, decision: "APPROVED", statuses, ...extra };
}
