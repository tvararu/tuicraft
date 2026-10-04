import type { PartyMember } from "@peon/core";
import { readyCheckLine } from "#harness/areas/raid/tool-ready-outcome";
import {
  ASSISTANT_FLAG,
  DEAD_STATUS,
  emptyGroup,
  findMember,
  GHOST_STATUS,
  type GroupAfter,
  type GroupArgs,
  type GroupCtx,
  type GroupDo,
  isAssistant,
  isLeader,
  leaderName,
  MAIN_ASSIST_FLAG,
  MAIN_TANK_FLAG,
  type RaidGroup,
  type RaidState,
  SELF_NAME,
  STALE_MS,
  sameName,
} from "#harness/areas/raid/tool-shared";
import type { ToolResult } from "#harness/contract/result";
import { Refusal } from "#harness/ops/refusal";
import { result } from "#harness/tools/define";

const POWER_KINDS: Record<number, string> = {
  0: "mana",
  1: "rage",
  2: "focus",
  3: "energy",
  6: "runic power",
};

function powerName(type: number | null): string {
  if (type === null) return "power";
  return POWER_KINDS[type] ?? "power";
}

function vitalsText(member: PartyMember): string | undefined {
  const hp =
    member.health !== null && member.maxHealth !== null
      ? `HP ${member.health}/${member.maxHealth}`
      : undefined;
  const power =
    member.power !== null && member.maxPower !== null
      ? `${powerName(member.powerType)} ${member.power}/${member.maxPower}`
      : undefined;
  const parts = [hp, power].filter((part) => part !== undefined);
  return parts.length > 0 ? parts.join(", ") : undefined;
}

type StaleState = { stats: RaidState["stats"]; now: number };

function staleText(member: PartyMember, state: StaleState): string | undefined {
  if (member.source === "unit") return undefined;
  if (member.statsAt === null) return undefined;
  const ageMs = state.now - member.statsAt;
  if (ageMs < STALE_MS) return undefined;
  return `last seen ${Math.floor(ageMs / 1000)} s ago`;
}

type MemberVitals = { dead: boolean; ghost: boolean };

function lifeText(
  member: PartyMember,
  stats: MemberVitals | undefined,
): string {
  if (!member.online) return "offline";
  if (stats) {
    if (stats.ghost) return "ghost";
    if (stats.dead) return "dead";
    return "alive";
  }
  if (!member.online) return "offline";
  if (Math.floor(member.status / GHOST_STATUS) % 2 === 1) return "ghost";
  if (Math.floor(member.status / DEAD_STATUS) % 2 === 1) return "dead";
  return "alive";
}

export function memberRow(member: PartyMember, state: StaleState): string {
  const parts = [member.name, `group ${member.subgroup + 1}`];
  if (Math.floor(member.flags / ASSISTANT_FLAG) % 2 === 1)
    parts.push("assistant");
  if (Math.floor(member.flags / MAIN_TANK_FLAG) % 2 === 1)
    parts.push("main tank");
  if (Math.floor(member.flags / MAIN_ASSIST_FLAG) % 2 === 1)
    parts.push("main assist");
  const vitals = vitalsText(member);
  if (vitals) parts.push(vitals);
  parts.push(lifeText(member, state.stats.get(member.guid)));
  const stale = staleText(member, state);
  if (stale) parts.push(stale);
  return `- ${parts.join(", ")}.`;
}

export function selectedNames(
  partyMembers: readonly PartyMember[],
  raidMembers: RaidGroup["members"],
  to: string | undefined,
): Set<string> {
  const names = new Set(partyMembers.map((member) => member.name));
  for (const member of raidMembers) names.add(member.name);
  const filter = to?.trim();
  if (!filter) return names;
  const partyHit = findMember(partyMembers, filter);
  if (partyHit) return new Set([partyHit.name]);
  const raidHit = raidMembers.find((member) => sameName(member.name, filter));
  if (!raidHit) {
    throw new Refusal({
      detail: `${filter} is not in your group. Members: ${[...names].join(", ")}.`,
      next: "end your turn.",
      reason: "not_a_member",
    });
  }
  return new Set([raidHit.name]);
}

export function leadText(
  group: RaidGroup,
  size: number,
  ctx: GroupCtx,
): string {
  if (group.leader === 0n) return "No one leads the group.";
  if (isLeader(group, ctx)) return `You lead the ${group.kind} of ${size}.`;
  const peer = leaderName(group) ?? SELF_NAME;
  const assist = isAssistant(group, ctx) ? "; you assist" : "";
  return `${peer} leads the ${group.kind} of ${size}${assist}.`;
}

export function statusTool(
  args: GroupArgs,
  ctx: GroupCtx,
): Promise<ToolResult<GroupAfter>> {
  const party = ctx.handle.getPartyState();
  const raid = ctx.handle.raid.state();
  const group = raid.group;
  if (!(party.inGroup && group)) {
    return Promise.resolve(
      result("DONE", {
        after: { ...emptyGroup(), do: "status" as GroupDo },
        detail: "You are not in a group.",
      }),
    );
  }
  const names = selectedNames(party.members, group.members, args.to);
  const now = ctx.rt.clock.now();
  const snapshots: RaidState["stats"] = new Map(raid.stats);
  const rows = party.members
    .filter((member) => names.has(member.name))
    .map((member) => memberRow(member, { now, stats: snapshots }));
  const check = raid.readyCheck;
  if (check && args.to === undefined)
    rows.unshift(readyCheckLine(group, check));
  return Promise.resolve(
    result("DONE", {
      after: { ...emptyGroup(), do: "status" as GroupDo },
      body: rows,
      detail: leadText(group, party.members.length + 1, ctx),
    }),
  );
}
