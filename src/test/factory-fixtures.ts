import type { Issue, LabelEvent, Pr } from "factory/github";

export const theo: LabelEvent = {
  actor: "tvararu",
  at: "2026-09-25T10:00:00Z",
  label: "ready",
};

export function issue(
  number: number,
  labels: string[],
  extra: Partial<Issue> = {},
): Issue {
  const base = {
    author: "OpenHubris",
    blockers: [],
    events: [theo],
    prs: [],
    title: `issue ${number}`,
  };
  return { labels, number, ...base, ...extra };
}

export function pr(extra: Partial<Pr> = {}): Pr {
  const statuses = [
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
  };
  return { ...base, decision: "APPROVED", statuses, ...extra };
}
