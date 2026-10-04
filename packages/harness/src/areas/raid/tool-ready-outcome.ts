import type { RaidGroup, RaidState } from "#harness/areas/raid/tool-shared";

export type ReadyCheck = NonNullable<RaidState["readyCheck"]>;

const ONLINE_STATUS = 0x01;

function answeredNames(check: ReadyCheck, wanted: string): string[] {
  return [...check.answers]
    .filter(([, answer]) => answer === wanted)
    .map(([guid]) => check.names.get(guid) ?? "")
    .filter((name) => name !== "");
}

export function silentNames(group: RaidGroup, check: ReadyCheck): string[] {
  if (check.silent !== undefined) return [...check.silent];
  return group.members
    .filter(
      (member) =>
        member.guid !== check.initiator &&
        Math.floor(member.status / ONLINE_STATUS) % 2 === 1 &&
        !check.answers.has(member.guid),
    )
    .map((member) => member.name);
}

export function readyOutcome(group: RaidGroup, check: ReadyCheck): string {
  const ready = answeredNames(check, "ready");
  const notReady = answeredNames(check, "not_ready");
  const offline = answeredNames(check, "offline");
  const silent = silentNames(group, check);
  const parts = [`ready: ${ready.length === 0 ? "none" : ready.join(", ")}`];
  if (notReady.length > 0) parts.push(`not ready: ${notReady.join(", ")}`);
  if (offline.length > 0) parts.push(`offline: ${offline.join(", ")}`);
  if (silent.length > 0) parts.push(`no answer: ${silent.join(", ")}`);
  return parts.join("; ");
}

export function readyCheckLine(group: RaidGroup, check: ReadyCheck): string {
  if (check.finishedAt !== undefined)
    return `Last ready check: ${readyOutcome(group, check)}.`;
  const pending = silentNames(group, check);
  const answered = [...check.answers]
    .map(([guid]) => check.names.get(guid) ?? "")
    .filter((name) => name !== "");
  const bits = [
    `waiting on ${pending.length === 0 ? "no one" : pending.join(", ")}`,
  ];
  if (answered.length > 0) bits.push(`answered: ${answered.join(", ")}`);
  return `Open ready check: ${bits.join("; ")}.`;
}
