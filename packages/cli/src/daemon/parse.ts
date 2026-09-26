import type {
  FramingVariant,
  GotoTarget,
  MovementDirection,
  RollVote,
  WalkTarget,
} from "@tuicraft/core";
import { parseGameplay } from "#daemon/parse-gameplay";
import { fromSlashCommand } from "#daemon/parse-slash";
import { parseSocial } from "#daemon/parse-social";
import { parseCommand } from "#ui/commands";

export type IpcCommand =
  | { type: "chat"; message: string }
  | { type: "say"; message: string }
  | { type: "yell"; message: string }
  | { type: "guild"; message: string }
  | { type: "party"; message: string }
  | { type: "emote"; message: string }
  | { type: "dnd"; message: string }
  | { type: "afk"; message: string }
  | { type: "whisper"; target: string; message: string }
  | { type: "read" }
  | { type: "read_json" }
  | { type: "read_wait"; ms: number; since?: number }
  | { type: "read_wait_json"; ms: number; since?: number }
  | { type: "event_mark" }
  | { type: "tail_wait"; ms: number }
  | { type: "tail_wait_json"; ms: number }
  | { type: "stop" }
  | { type: "status" }
  | { type: "who"; filter?: string }
  | { type: "who_json"; filter?: string }
  | { type: "invite"; target: string }
  | { type: "kick"; target: string }
  | { type: "leave" }
  | { type: "join_channel"; channel: string; password?: string }
  | { type: "leave_channel"; channel: string }
  | { type: "leader"; target: string }
  | { type: "accept" }
  | { type: "decline" }
  | { type: "nearby"; all?: boolean }
  | { type: "nearby_json"; all?: boolean }
  | { type: "control" }
  | { type: "control_json" }
  | { type: "move"; direction: MovementDirection; durationMs: number }
  | { type: "face"; orientation: number }
  | { type: "face_guid"; guid: bigint }
  | { type: "walk_toward"; yards: number; target: WalkTarget }
  | { type: "target"; guid: bigint }
  | { type: "halt" }
  | { type: "combat" }
  | { type: "combat_json" }
  | { type: "spells" }
  | { type: "spells_json" }
  | { type: "cast"; spellId: number; guid: bigint }
  | { type: "attack"; guid: bigint }
  | { type: "cancel_cast" }
  | { type: "stop_attack" }
  | {
      type: "fight";
      guid: bigint;
      instruction: string;
      framing?: FramingVariant;
    }
  | { type: "tactics" }
  | { type: "tactics_json" }
  | {
      type: "cycle";
      guids: bigint[];
      instruction: string;
      maxStarts?: number;
      questId?: number;
      sources?: number[];
    }
  | { type: "cycle_resume"; instruction?: string; maxStarts?: number }
  | { type: "cycling" }
  | { type: "defend"; enabled: boolean; instruction?: string }
  | { type: "defense" }
  | { type: "defense_json" }
  | { type: "cycling_json" }
  | { type: "goto"; target: GotoTarget }
  | { type: "navigation" }
  | { type: "navigation_json" }
  | { type: "recovery" }
  | { type: "recovery_json" }
  | { type: "query_corpse" }
  | { type: "release_spirit" }
  | { type: "reclaim_corpse" }
  | { type: "spirit_healer"; guid: bigint }
  | { type: "resurrect"; accept: boolean }
  | { type: "quests" }
  | { type: "quests_json" }
  | { type: "talk"; guid: bigint }
  | { type: "query_quest"; questId: number }
  | { type: "select_option"; optionId: number; code?: string }
  | { type: "select_quest"; questId: number }
  | { type: "accept_quest" }
  | { type: "complete_quest"; questId: number }
  | { type: "request_reward" }
  | { type: "choose_reward"; index: number }
  | { type: "abandon_quest"; slot: number }
  | { type: "cancel_interaction" }
  | { type: "inventory" }
  | { type: "inventory_json" }
  | { type: "experience" }
  | { type: "experience_json" }
  | { type: "loot" }
  | { type: "loot_json" }
  | { type: "group" }
  | { type: "group_json" }
  | { type: "open_loot"; guid: bigint }
  | { type: "take_loot"; slot: number }
  | { type: "take_money" }
  | { type: "release_loot" }
  | { type: "use"; bag: number; slot: number }
  | { type: "trainer" }
  | { type: "trainer_json" }
  | { type: "open_trainer"; guid: bigint }
  | { type: "train"; spellId: number }
  | { type: "vendor" }
  | { type: "vendor_json" }
  | { type: "open_vendor"; guid: bigint }
  | { type: "sell"; bag: number; slot: number; count?: number }
  | { type: "buy"; slot: number; count: number }
  | { type: "repair" }
  | { type: "loot_roll"; guid: bigint; slot: number; vote: RollVote }
  | { type: "destroy"; bag: number; slot: number; count?: number }
  | { type: "invalid"; reason: string }
  | { type: "friends" }
  | { type: "friends_json" }
  | { type: "add_friend"; target: string }
  | { type: "del_friend"; target: string }
  | { type: "ignored" }
  | { type: "ignored_json" }
  | { type: "add_ignore"; target: string }
  | { type: "del_ignore"; target: string }
  | { type: "roll"; min: number; max: number }
  | { type: "guild_roster" }
  | { type: "guild_roster_json" }
  | { type: "guild_invite"; target: string }
  | { type: "guild_kick"; target: string }
  | { type: "guild_leave" }
  | { type: "guild_promote"; target: string }
  | { type: "guild_demote"; target: string }
  | { type: "guild_leader"; target: string }
  | { type: "guild_motd"; message: string }
  | { type: "guild_accept" }
  | { type: "guild_decline" }
  | { type: "unimplemented"; feature: string };

export type TargetIpcType = Exclude<
  Extract<IpcCommand, { target: string }>,
  { message: string }
>["type"];

export function parseIpcCommand(line: string): IpcCommand | undefined {
  if (line.startsWith("/")) return fromSlashCommand(parseCommand(line), line);

  const spaceIdx = line.indexOf(" ");
  const verb = spaceIdx === -1 ? line : line.slice(0, spaceIdx);
  const rest = spaceIdx === -1 ? "" : line.slice(spaceIdx + 1);
  return parseGameplay(verb, rest) ?? parseSocial(line, verb, rest);
}
