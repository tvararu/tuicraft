import { roleCapHours } from "factory/config";
import type { Issue } from "factory/github";

export type Landing = { issue: number; id: number; run: string; at: string };

const claimMarker = /^<!-- factory:claim (\S+)(?: ([0-9a-f]{40}))? -->/;
const landingMarker = /^<!-- factory:landing (\S+) -->/;
const hour = 3_600_000;

function within(at: string, hours: number, now: number): boolean {
  return now - Date.parse(at) < hours * hour;
}

export function liveLandings(issues: Issue[], now: number): Landing[] {
  return issues
    .filter((issue) => issue.status === "in-review")
    .flatMap((issue) =>
      issue.markers.flatMap((m) => {
        const run = landingMarker.exec(m.body)?.[1];
        if (run === undefined || !within(m.at, roleCapHours.merger, now))
          return [];
        return [{ at: m.at, id: m.id, issue: issue.number, run }];
      }),
    )
    .toSorted((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.id - b.id);
}

export function workerClaimed(issue: Issue, now: number): boolean {
  const since = Date.parse(issue.statusAt) || 0;
  return issue.markers.some(
    (m) =>
      claimMarker.test(m.body) &&
      Date.parse(m.at) > since &&
      within(m.at, roleCapHours.worker, now),
  );
}

export function reviewerClaimed(
  issue: Issue,
  head: string,
  now: number,
): boolean {
  return issue.markers.some(
    (m) =>
      claimMarker.exec(m.body)?.[2] === head &&
      within(m.at, roleCapHours.reviewer, now),
  );
}
