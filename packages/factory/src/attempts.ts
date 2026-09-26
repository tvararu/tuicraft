import { latestVerdict } from "#factory/bounce";
import type { Pr } from "#factory/github";

export type RunReason = "fresh" | "review" | "rebase" | "recovery";

export function runReason(pr: Pr | undefined): RunReason {
  if (!pr) return "fresh";
  const latest = latestVerdict(pr);
  if (latest?.state === "SUCCESS") return "rebase";
  return latest?.oid === pr.head ? "review" : "recovery";
}
