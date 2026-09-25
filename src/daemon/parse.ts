import {
  type Parsed,
  parseBare,
  parseBoundedArg,
  parseCast,
  parseCycle,
  parseFace,
  parseFight,
  parseGoto,
  parseGuidArg,
  parseMove,
  parseOptionId,
  parseQuestId,
  parseResurrect,
  parseWalkToward,
  tokenize,
} from "cli/tokens";
import { parseCommand } from "ui/commands";
import type { WalkTarget } from "wow/client";
import type { MovementDirection } from "wow/control";
import type { FramingVariant } from "wow/framing";

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
  | { type: "read_wait"; ms: number }
  | { type: "read_wait_json"; ms: number }
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
    }
  | { type: "cycling" }
  | { type: "cycling_json" }
  | { type: "goto"; x: number; y: number; z: number }
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
  | { type: "loot" }
  | { type: "loot_json" }
  | { type: "open_loot"; guid: bigint }
  | { type: "take_loot"; slot: number }
  | { type: "take_money" }
  | { type: "release_loot" }
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

export function parseIpcCommand(line: string): IpcCommand | undefined {
  if (line.startsWith("/")) {
    const parsed = parseCommand(line);
    switch (parsed.type) {
      case "say":
      case "yell":
      case "guild":
      case "party":
      case "emote":
      case "dnd":
      case "afk":
        return parsed;
      case "whisper":
        return parsed;
      case "who":
        return parsed.target
          ? { filter: parsed.target, type: "who" }
          : { type: "who" };
      case "invite":
      case "kick":
      case "leave":
      case "leader":
      case "accept":
      case "decline":
        return parsed;
      case "join-channel":
        return {
          channel: parsed.channel,
          password: parsed.password,
          type: "join_channel",
        };
      case "leave-channel":
        return { channel: parsed.channel, type: "leave_channel" };
      case "friends":
        return { type: "friends" };
      case "add-friend":
        return { target: parsed.target, type: "add_friend" };
      case "remove-friend":
        return { target: parsed.target, type: "del_friend" };
      case "ignored":
        return { type: "ignored" };
      case "add-ignore":
        return { target: parsed.target, type: "add_ignore" };
      case "remove-ignore":
        return { target: parsed.target, type: "del_ignore" };
      case "roll":
        return parsed;
      case "guild-roster":
        return { type: "guild_roster" };
      case "guild-invite":
        return { target: parsed.target, type: "guild_invite" };
      case "guild-kick":
        return { target: parsed.target, type: "guild_kick" };
      case "guild-leave":
        return { type: "guild_leave" };
      case "guild-promote":
        return { target: parsed.target, type: "guild_promote" };
      case "guild-demote":
        return { target: parsed.target, type: "guild_demote" };
      case "guild-leader":
        return { target: parsed.target, type: "guild_leader" };
      case "guild-motd":
        return { message: parsed.message, type: "guild_motd" };
      case "guild-accept":
        return { type: "guild_accept" };
      case "guild-decline":
        return { type: "guild_decline" };
      case "unimplemented":
        return parsed;
      default:
        return { message: line, type: "say" };
    }
  }

  const spaceIdx = line.indexOf(" ");
  const verb = spaceIdx === -1 ? line : line.slice(0, spaceIdx);
  const rest = spaceIdx === -1 ? "" : line.slice(spaceIdx + 1);
  return parseGameplay(verb, rest) ?? parseSocial(line, verb, rest);
}

const INSPECTIONS = new Map<string, IpcCommand>(
  (
    [
      "control",
      "combat",
      "spells",
      "tactics",
      "cycling",
      "navigation",
      "recovery",
      "quests",
      "inventory",
      "loot",
    ] as const
  ).flatMap((view): [string, IpcCommand][] => [
    [view.toUpperCase(), { type: view }],
    [`${view.toUpperCase()}_JSON`, { type: `${view}_json` }],
  ]),
);

const ACTIONS = new Map<string, IpcCommand>([
  ["HALT", { type: "halt" }],
  ["CANCEL_CAST", { type: "cancel_cast" }],
  ["STOP_ATTACK", { type: "stop_attack" }],
]);

const STRICT = new Map<string, IpcCommand>(
  (
    [
      "query_corpse",
      "release_spirit",
      "reclaim_corpse",
      "accept_quest",
      "request_reward",
      "cancel_interaction",
      "take_money",
      "release_loot",
    ] as const
  ).map((type): [string, IpcCommand] => [type.toUpperCase(), { type }]),
);

function from<T>(
  parsed: Parsed<T>,
  build: (value: T) => IpcCommand,
): IpcCommand {
  return parsed.ok
    ? build(parsed.value)
    : { reason: parsed.reason, type: "invalid" };
}

function parseSelectOption(tokens: string[], rest: string): IpcCommand {
  const optionId = parseOptionId(tokens[0]);
  if (optionId === undefined)
    return { reason: "invalid gossip option id", type: "invalid" };
  const raw = rest.trim().slice(tokens[0]!.length).trim();
  let code: unknown = null;
  try {
    if (raw) code = JSON.parse(raw);
  } catch {
    return { reason: "invalid gossip code JSON", type: "invalid" };
  }
  if (code !== null && (typeof code !== "string" || code.includes("\0")))
    return { reason: "invalid gossip code", type: "invalid" };
  return { code: code ?? undefined, optionId, type: "select_option" };
}

function parseGameplay(verb: string, rest: string): IpcCommand | undefined {
  const tokens = tokenize(rest);
  const fixed = INSPECTIONS.get(verb) ?? ACTIONS.get(verb);
  if (fixed) return fixed;
  const strict = STRICT.get(verb);
  if (strict)
    return from(
      parseBare(tokens, verb.toLowerCase().replaceAll("_", "-")),
      () => strict,
    );
  switch (verb) {
    case "MOVE":
      return from(parseMove(tokens), (v) => ({ type: "move", ...v }));
    case "FACE":
      return from(parseFace(tokens), (v) => ({ type: "face", ...v }));
    case "FACE_GUID":
      return from(parseGuidArg(tokens, true), (v) => ({
        type: "face_guid",
        ...v,
      }));
    case "WALK_TOWARD":
      return from(parseWalkToward(tokens), (v) => ({
        type: "walk_toward",
        ...v,
      }));
    case "TARGET":
      return from(parseGuidArg(tokens), (v) => ({ type: "target", ...v }));
    case "CAST":
      return from(parseCast(tokens), (v) => ({ type: "cast", ...v }));
    case "ATTACK":
      return from(parseGuidArg(tokens), (v) => ({ type: "attack", ...v }));
    case "FIGHT":
      return from(parseFight(tokens), (v) => ({ type: "fight", ...v }));
    case "CYCLE":
      return from(parseCycle(tokens), (v) => ({ type: "cycle", ...v }));
    case "GOTO":
      return from(parseGoto(tokens), (v) => ({ type: "goto", ...v }));
    case "SPIRIT_HEALER":
      return from(parseGuidArg(tokens, true), (v) => ({
        type: "spirit_healer",
        ...v,
      }));
    case "RESURRECT":
      return from(parseResurrect(tokens), (v) => ({ type: "resurrect", ...v }));
    case "TALK":
      return from(parseGuidArg(tokens, true), (v) => ({ type: "talk", ...v }));
    case "QUERY_QUEST":
      return from(parseQuestId(tokens), (v) => ({ type: "query_quest", ...v }));
    case "SELECT_QUEST":
      return from(parseQuestId(tokens), (v) => ({
        type: "select_quest",
        ...v,
      }));
    case "COMPLETE_QUEST":
      return from(parseQuestId(tokens), (v) => ({
        type: "complete_quest",
        ...v,
      }));
    case "CHOOSE_REWARD":
      return from(
        parseBoundedArg(tokens, 0, 5, "invalid reward index"),
        (index) => ({ index, type: "choose_reward" }),
      );
    case "ABANDON_QUEST":
      return from(
        parseBoundedArg(tokens, 0, 24, "invalid quest slot"),
        (slot) => ({ slot, type: "abandon_quest" }),
      );
    case "OPEN_LOOT":
      return from(parseGuidArg(tokens, true), (v) => ({
        type: "open_loot",
        ...v,
      }));
    case "SELECT_OPTION":
      return parseSelectOption(tokens, rest);
    case "TAKE_LOOT":
      return from(
        parseBoundedArg(tokens, 0, 255, "invalid loot slot"),
        (slot) => ({ slot, type: "take_loot" }),
      );
    default:
      return undefined;
  }
}

function parseSocial(
  line: string,
  verb: string,
  rest: string,
): IpcCommand | undefined {
  switch (verb) {
    case "SAY":
    case "YELL":
    case "GUILD":
    case "PARTY":
    case "EMOTE":
    case "DND":
    case "AFK":
      return {
        message: rest,
        type: verb.toLowerCase() as
          | "say"
          | "yell"
          | "guild"
          | "party"
          | "emote"
          | "dnd"
          | "afk",
      };
    case "WHISPER": {
      const targetEnd = rest.indexOf(" ");
      if (targetEnd === -1)
        return { message: "", target: rest, type: "whisper" };
      return {
        message: rest.slice(targetEnd + 1),
        target: rest.slice(0, targetEnd),
        type: "whisper",
      };
    }
    case "READ":
      return { type: "read" };
    case "READ_JSON":
      return { type: "read_json" };
    case "READ_WAIT": {
      const ms = Number.parseInt(rest, 10);
      if (!Number.isFinite(ms) || ms < 0) return undefined;
      return { ms: Math.min(ms, 60_000), type: "read_wait" };
    }
    case "READ_WAIT_JSON": {
      const ms = Number.parseInt(rest, 10);
      if (!Number.isFinite(ms) || ms < 0) return undefined;
      return { ms: Math.min(ms, 60_000), type: "read_wait_json" };
    }
    case "STOP":
      return { type: "stop" };
    case "STATUS":
      return { type: "status" };
    case "WHO":
      return rest ? { filter: rest, type: "who" } : { type: "who" };
    case "WHO_JSON":
      return rest ? { filter: rest, type: "who_json" } : { type: "who_json" };
    case "INVITE":
      return rest ? { target: rest, type: "invite" } : undefined;
    case "KICK":
      return rest ? { target: rest, type: "kick" } : undefined;
    case "LEAVE":
      if (rest) {
        const channel = rest.split(" ")[0]!;
        return { channel, type: "leave_channel" };
      }
      return { type: "leave" };
    case "LEADER":
      return rest ? { target: rest, type: "leader" } : undefined;
    case "ACCEPT":
      return { type: "accept" };
    case "DECLINE":
      return { type: "decline" };
    case "NEARBY":
      return rest.trim().toLowerCase() === "all"
        ? { all: true, type: "nearby" }
        : { type: "nearby" };
    case "NEARBY_JSON":
      return rest.trim().toLowerCase() === "all"
        ? { all: true, type: "nearby_json" }
        : { type: "nearby_json" };
    case "FRIENDS":
      return { type: "friends" };
    case "FRIENDS_JSON":
      return { type: "friends_json" };
    case "ADD_FRIEND":
      return rest ? { target: rest, type: "add_friend" } : undefined;
    case "DEL_FRIEND":
      return rest ? { target: rest, type: "del_friend" } : undefined;
    case "IGNORED":
      return { type: "ignored" };
    case "IGNORED_JSON":
      return { type: "ignored_json" };
    case "ADD_IGNORE":
      return rest ? { target: rest, type: "add_ignore" } : undefined;
    case "DEL_IGNORE":
      return rest ? { target: rest, type: "del_ignore" } : undefined;
    case "JOIN": {
      if (!rest) return undefined;
      const [channel, password] = rest.split(" ") as [string, string?];
      return { channel, password, type: "join_channel" };
    }
    case "GUILD_ROSTER":
      return { type: "guild_roster" };
    case "GUILD_ROSTER_JSON":
      return { type: "guild_roster_json" };
    case "GINVITE":
      return rest ? { target: rest, type: "guild_invite" } : undefined;
    case "GKICK":
      return rest ? { target: rest, type: "guild_kick" } : undefined;
    case "GLEAVE":
      return { type: "guild_leave" };
    case "GPROMOTE":
      return rest ? { target: rest, type: "guild_promote" } : undefined;
    case "GDEMOTE":
      return rest ? { target: rest, type: "guild_demote" } : undefined;
    case "GLEADER":
      return rest ? { target: rest, type: "guild_leader" } : undefined;
    case "GMOTD":
      return { message: rest, type: "guild_motd" };
    case "GACCEPT":
      return { type: "guild_accept" };
    case "GDECLINE":
      return { type: "guild_decline" };
    case "MAIL":
      return { feature: "Mail reading", type: "unimplemented" };
    case "ROLL": {
      const parts = rest.split(" ").filter(Boolean);
      if (parts.length >= 2)
        return {
          max: Number.parseInt(parts[1]!, 10),
          min: Number.parseInt(parts[0]!, 10),
          type: "roll",
        };
      if (parts.length === 1)
        return { max: Number.parseInt(parts[0]!, 10), min: 1, type: "roll" };
      return { max: 100, min: 1, type: "roll" };
    }
    default:
      return line ? { message: line, type: "chat" } : undefined;
  }
}
