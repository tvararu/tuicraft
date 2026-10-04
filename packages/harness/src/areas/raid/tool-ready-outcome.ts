import {
  type GroupCtx,
  isAssistant,
  isLeader,
  type RaidGroup,
  type RaidState,
} from "#harness/areas/raid/tool-shared";

export type ReadyCheck = NonNullable<RaidState["readyCheck"]>;

const ONLINE_STATUS = 0x01;

function answeredNames(check: ReadyCheck, wanted: string): string[] {
  return [...check.answers]
    .filter(([, answer]) => answer === wanted)
    .map(([guid]) => check.names.get(guid) ?? "")
    .filter((name) => name !== "");
}

export function seesAnswers(
  group: RaidGroup,
  check: ReadyCheck,
  ctx: GroupCtx,
): boolean {
  const self = ctx.handle.getControlState().selfGuid;
  if (check.initiator === self) return true;
  return isLeader(group, ctx) || isAssistant(group, ctx);
}

type PeerView = {
  silent: string[];
  unknown: string[];
};

function peerView(
  group: RaidGroup,
  check: ReadyCheck,
  seen: boolean,
): PeerView {
  const silent: string[] = [];
  const unknown: string[] = [];
  if (check.silent !== undefined) {
    if (seen) silent.push(...check.silent);
    else unknown.push(...check.silent);
    return { silent, unknown };
  }
  for (const member of group.members) {
    if (member.guid === check.initiator) continue;
    if (Math.floor(member.status / ONLINE_STATUS) % 2 !== 1) continue;
    if (check.answers.has(member.guid)) continue;
    if (seen) silent.push(member.name);
    else unknown.push(member.name);
  }
  return { silent, unknown };
}

function ownAnswer(check: ReadyCheck): string | undefined {
  if (check.ownAnswer === undefined) return undefined;
  if (check.ownAnswer === "ready") return "you: ready";
  return "you: not ready";
}

export function silentNames(
  group: RaidGroup,
  check: ReadyCheck,
  seen = true,
): string[] {
  return peerView(group, check, seen).silent;
}

export function readyOutcome(
  group: RaidGroup,
  check: ReadyCheck,
  seen = true,
): string {
  const ready = answeredNames(check, "ready");
  const notReady = answeredNames(check, "not_ready");
  const offline = answeredNames(check, "offline");
  const { silent, unknown } = peerView(group, check, seen);
  const own = ownAnswer(check);
  const parts = [
    `ready: ${ready.length === 0 && unknown.length === 0 ? "none" : ready.join(", ") || "unknown"}`,
  ];
  if (notReady.length > 0) parts.push(`not ready: ${notReady.join(", ")}`);
  if (offline.length > 0) parts.push(`offline: ${offline.join(", ")}`);
  if (silent.length > 0) parts.push(`no answer: ${silent.join(", ")}`);
  if (unknown.length > 0)
    parts.push(`unknown (answers go to the leader): ${unknown.join(", ")}`);
  if (own !== undefined) parts.push(own);
  return parts.join("; ");
}

export function readyCheckLine(
  group: RaidGroup,
  check: ReadyCheck,
  seen = true,
): string {
  if (check.finishedAt !== undefined)
    return `Last ready check: ${readyOutcome(group, check, seen)}.`;
  const peers = peerView(group, check, seen);
  const waiting = [
    ...peers.silent,
    ...peers.unknown.map((name) => `${name} (unknown to you)`),
  ];
  const bits = [
    `waiting on ${waiting.length === 0 ? "no one" : waiting.join(", ")}`,
  ];
  if (seen) {
    const heard = [...check.answers]
      .map(([guid]) => check.names.get(guid) ?? "")
      .filter((name) => name !== "");
    if (heard.length > 0) bits.push(`answered: ${heard.join(", ")}`);
  }
  const own = ownAnswer(check);
  if (own !== undefined) bits.push(own);
  return `Open ready check: ${bits.join("; ")}.`;
}
