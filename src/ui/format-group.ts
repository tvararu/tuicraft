import { type GroupEvent, PartyOperation, PartyResult } from "wow";

function partyResultLabel(result: number): string {
  switch (result) {
    case PartyResult.BAD_PLAYER_NAME:
      return "player not found";
    case PartyResult.GROUP_FULL:
      return "group is full";
    case PartyResult.ALREADY_IN_GROUP:
      return "already in a group";
    case PartyResult.NOT_LEADER:
      return "you are not the leader";
    case PartyResult.PLAYER_WRONG_FACTION:
      return "wrong faction";
    case PartyResult.IGNORING_YOU:
      return "player is ignoring you";
    default:
      return `error ${result}`;
  }
}

function partyCommandVerb(operation: number): "kick" | "leave" | "invite" {
  if (operation === PartyOperation.UNINVITE) return "kick";
  if (operation === PartyOperation.LEAVE) return "leave";
  return "invite";
}

function partyCommandLabel(
  event: Extract<GroupEvent, { type: "command_result" }>,
): string {
  const verb = partyCommandVerb(event.operation);
  if (event.result !== PartyResult.SUCCESS)
    return `Cannot ${verb}${event.target ? ` ${event.target}` : ""}: ${partyResultLabel(event.result)}`;
  if (verb === "kick") return `Removed ${event.target} from group`;
  if (verb === "leave") return "Left the group";
  return `Invited ${event.target}`;
}

function formatGroupList(
  event: Extract<GroupEvent, { type: "group_list" }>,
): string | undefined {
  const { formed, added, removed } = event.change;
  const lines: string[] = [];
  if (formed) {
    const names = event.members.map((member) => member.name).join(", ");
    lines.push(
      `[group] Joined a group led by ${event.leader || "unknown"}: ${names}`,
    );
  }
  for (const name of added) lines.push(`[group] ${name} joined the group`);
  for (const name of removed) lines.push(`[group] ${name} left the group`);
  if (!formed && event.members.length === 0 && removed.length > 0)
    lines.push("[group] You are no longer in a group");
  return lines.length > 0 ? lines.join("\n") : undefined;
}

export function formatGroupEvent(event: GroupEvent): string | undefined {
  switch (event.type) {
    case "invite_received":
      return `[group] ${event.from} invites you to a group`;
    case "command_result":
      return `[group] ${partyCommandLabel(event)}`;
    case "leader_changed":
      return `[group] ${event.name} is now the group leader`;
    case "group_destroyed":
      return "[group] Group has been disbanded";
    case "kicked":
      return "[group] You have been removed from the group";
    case "invite_declined":
      return `[group] ${event.name} has declined your invitation`;
    case "group_list":
      return formatGroupList(event);
    case "member_stats":
      return undefined;
    default:
      return;
  }
}
