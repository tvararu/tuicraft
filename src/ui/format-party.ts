import { formatGuid } from "ui/format";
import type { PartyMember, PartyState } from "wow";

function vitals(member: PartyMember, now: number): string {
  if (member.statsAt === null) return "health unknown, level unknown";
  const health =
    member.health === null
      ? "unknown"
      : `${member.health}/${member.maxHealth ?? "unknown"}`;
  const level = `level ${member.level ?? "unknown"}`;
  if (member.source === "unit") return `health ${health}, ${level}, in view`;
  const age = Math.max(0, Math.round((now - member.statsAt) / 1000));
  return `health ${health}, ${level}, ${age}s ago`;
}

export function formatPartyState(
  state: PartyState,
  now = Date.now(),
): string[] {
  if (!state.inGroup) return ["Group: none"];
  const lines = [
    `Group: ${state.members.length + 1} members`,
    `Leader: ${state.leader ?? "unknown"}`,
  ];
  const { loot } = state;
  lines.push(
    loot
      ? `Loot: ${loot.method}, threshold ${loot.threshold}${loot.masterLooter === null ? "" : `, master looter ${formatGuid(loot.masterLooter)}`}`
      : "Loot: unknown",
  );
  for (const member of state.members)
    lines.push(
      `Member ${member.name} (${formatGuid(member.guid)}): ${member.online ? "online" : "offline"}, ${vitals(member, now)}`,
    );
  return lines;
}
