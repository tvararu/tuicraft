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
import { type Command, parseCommand } from "ui/commands";
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

type TargetIpcType = Exclude<
  Extract<IpcCommand, { target: string }>,
  { message: string }
>["type"];

type SlashTargetType =
  | "add-friend"
  | "remove-friend"
  | "add-ignore"
  | "remove-ignore"
  | "guild-invite"
  | "guild-kick"
  | "guild-promote"
  | "guild-demote"
  | "guild-leader";

type SlashBareType =
  | "friends"
  | "ignored"
  | "guild-roster"
  | "guild-leave"
  | "guild-accept"
  | "guild-decline";

const SLASH_TARGET_TYPES: Record<SlashTargetType, TargetIpcType> = {
  "add-friend": "add_friend",
  "add-ignore": "add_ignore",
  "guild-demote": "guild_demote",
  "guild-invite": "guild_invite",
  "guild-kick": "guild_kick",
  "guild-leader": "guild_leader",
  "guild-promote": "guild_promote",
  "remove-friend": "del_friend",
  "remove-ignore": "del_ignore",
};

const SLASH_BARE_TYPES: Record<
  SlashBareType,
  | "friends"
  | "ignored"
  | "guild_roster"
  | "guild_leave"
  | "guild_accept"
  | "guild_decline"
> = {
  friends: "friends",
  "guild-accept": "guild_accept",
  "guild-decline": "guild_decline",
  "guild-leave": "guild_leave",
  "guild-roster": "guild_roster",
  ignored: "ignored",
};

function fromSlashCommand(parsed: Command, line: string): IpcCommand {
  switch (parsed.type) {
    case "say":
    case "yell":
    case "guild":
    case "party":
    case "emote":
    case "dnd":
    case "afk":
    case "whisper":
    case "invite":
    case "kick":
    case "leave":
    case "leader":
    case "accept":
    case "decline":
    case "roll":
    case "unimplemented":
      return parsed;
    case "who":
      return parsed.target
        ? { filter: parsed.target, type: "who" }
        : { type: "who" };
    case "join-channel":
      return {
        channel: parsed.channel,
        password: parsed.password,
        type: "join_channel",
      };
    case "leave-channel":
      return { channel: parsed.channel, type: "leave_channel" };
    case "guild-motd":
      return { message: parsed.message, type: "guild_motd" };
    case "add-friend":
    case "remove-friend":
    case "add-ignore":
    case "remove-ignore":
    case "guild-invite":
    case "guild-kick":
    case "guild-promote":
    case "guild-demote":
    case "guild-leader":
      return { target: parsed.target, type: SLASH_TARGET_TYPES[parsed.type] };
    case "friends":
    case "ignored":
    case "guild-roster":
    case "guild-leave":
    case "guild-accept":
    case "guild-decline":
      return { type: SLASH_BARE_TYPES[parsed.type] };
    default:
      return { message: line, type: "say" };
  }
}

export function parseIpcCommand(line: string): IpcCommand | undefined {
  if (line.startsWith("/")) return fromSlashCommand(parseCommand(line), line);

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
  const [first] = tokens;
  const optionId = parseOptionId(first);
  if (first === undefined || optionId === undefined)
    return { reason: "invalid gossip option id", type: "invalid" };
  const raw = rest.trim().slice(first.length).trim();
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

type GuidIpcType =
  | "face_guid"
  | "target"
  | "attack"
  | "spirit_healer"
  | "talk"
  | "open_loot";

const GUID_VERBS = new Map<string, { nonzero: boolean; type: GuidIpcType }>([
  ["FACE_GUID", { nonzero: true, type: "face_guid" }],
  ["TARGET", { nonzero: false, type: "target" }],
  ["ATTACK", { nonzero: false, type: "attack" }],
  ["SPIRIT_HEALER", { nonzero: true, type: "spirit_healer" }],
  ["TALK", { nonzero: true, type: "talk" }],
  ["OPEN_LOOT", { nonzero: true, type: "open_loot" }],
]);

const QUEST_VERBS = new Map<
  string,
  Extract<IpcCommand, { questId: number }>["type"]
>([
  ["QUERY_QUEST", "query_quest"],
  ["SELECT_QUEST", "select_quest"],
  ["COMPLETE_QUEST", "complete_quest"],
]);

function parseIndexed(verb: string, tokens: string[]): IpcCommand | undefined {
  const guidVerb = GUID_VERBS.get(verb);
  if (guidVerb) {
    const { nonzero, type } = guidVerb;
    return from(parseGuidArg(tokens, nonzero), (v) => ({ type, ...v }));
  }
  const questType = QUEST_VERBS.get(verb);
  if (questType)
    return from(parseQuestId(tokens), (v) => ({ type: questType, ...v }));
  switch (verb) {
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
    case "TAKE_LOOT":
      return from(
        parseBoundedArg(tokens, 0, 255, "invalid loot slot"),
        (slot) => ({ slot, type: "take_loot" }),
      );
    default:
      return;
  }
}

function parseMotion(
  verb: string,
  tokens: string[],
  rest: string,
): IpcCommand | undefined {
  switch (verb) {
    case "MOVE":
      return from(parseMove(tokens), (v) => ({ type: "move", ...v }));
    case "FACE":
      return from(parseFace(tokens), (v) => ({ type: "face", ...v }));
    case "WALK_TOWARD":
      return from(parseWalkToward(tokens), (v) => ({
        type: "walk_toward",
        ...v,
      }));
    case "CAST":
      return from(parseCast(tokens), (v) => ({ type: "cast", ...v }));
    case "FIGHT":
      return from(parseFight(tokens), (v) => ({ type: "fight", ...v }));
    case "CYCLE":
      return from(parseCycle(tokens), (v) => ({ type: "cycle", ...v }));
    case "GOTO":
      return from(parseGoto(tokens), (v) => ({ type: "goto", ...v }));
    case "RESURRECT":
      return from(parseResurrect(tokens), (v) => ({ type: "resurrect", ...v }));
    case "SELECT_OPTION":
      return parseSelectOption(tokens, rest);
    default:
      return;
  }
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
  return parseIndexed(verb, tokens) ?? parseMotion(verb, tokens, rest);
}

const BARE_SOCIAL = new Map<string, IpcCommand>([
  ["READ", { type: "read" }],
  ["READ_JSON", { type: "read_json" }],
  ["STOP", { type: "stop" }],
  ["STATUS", { type: "status" }],
  ["ACCEPT", { type: "accept" }],
  ["DECLINE", { type: "decline" }],
  ["FRIENDS", { type: "friends" }],
  ["FRIENDS_JSON", { type: "friends_json" }],
  ["IGNORED", { type: "ignored" }],
  ["IGNORED_JSON", { type: "ignored_json" }],
  ["GUILD_ROSTER", { type: "guild_roster" }],
  ["GUILD_ROSTER_JSON", { type: "guild_roster_json" }],
  ["GLEAVE", { type: "guild_leave" }],
  ["GACCEPT", { type: "guild_accept" }],
  ["GDECLINE", { type: "guild_decline" }],
  ["MAIL", { feature: "Mail reading", type: "unimplemented" }],
]);

const TARGET_SOCIAL = new Map<string, TargetIpcType>([
  ["INVITE", "invite"],
  ["KICK", "kick"],
  ["LEADER", "leader"],
  ["ADD_FRIEND", "add_friend"],
  ["DEL_FRIEND", "del_friend"],
  ["ADD_IGNORE", "add_ignore"],
  ["DEL_IGNORE", "del_ignore"],
  ["GINVITE", "guild_invite"],
  ["GKICK", "guild_kick"],
  ["GPROMOTE", "guild_promote"],
  ["GDEMOTE", "guild_demote"],
  ["GLEADER", "guild_leader"],
]);

const MESSAGE_SOCIAL = new Map<
  string,
  Exclude<Extract<IpcCommand, { message: string }>, { target: string }>["type"]
>([
  ["SAY", "say"],
  ["YELL", "yell"],
  ["GUILD", "guild"],
  ["PARTY", "party"],
  ["EMOTE", "emote"],
  ["DND", "dnd"],
  ["AFK", "afk"],
  ["GMOTD", "guild_motd"],
]);

function parseWhisper(rest: string): IpcCommand {
  const targetEnd = rest.indexOf(" ");
  if (targetEnd === -1) return { message: "", target: rest, type: "whisper" };
  return {
    message: rest.slice(targetEnd + 1),
    target: rest.slice(0, targetEnd),
    type: "whisper",
  };
}

function parseWaitMs(rest: string): number | undefined {
  const ms = Number.parseInt(rest, 10);
  if (!Number.isFinite(ms) || ms < 0) return;
  return Math.min(ms, 60_000);
}

function parseLeave(rest: string): IpcCommand {
  if (!rest) return { type: "leave" };
  const space = rest.indexOf(" ");
  const channel = space === -1 ? rest : rest.slice(0, space);
  return { channel, type: "leave_channel" };
}

function parseJoin(rest: string): IpcCommand | undefined {
  if (!rest) return;
  const [channel, password] = rest.split(" ") as [string, string?];
  return { channel, password, type: "join_channel" };
}

function parseRoll(rest: string): IpcCommand {
  const [first, second] = rest.split(" ").filter(Boolean);
  if (first !== undefined && second !== undefined)
    return {
      max: Number.parseInt(second, 10),
      min: Number.parseInt(first, 10),
      type: "roll",
    };
  if (first !== undefined)
    return { max: Number.parseInt(first, 10), min: 1, type: "roll" };
  return { max: 100, min: 1, type: "roll" };
}

function parseSocialVerb(
  line: string,
  verb: string,
  rest: string,
): IpcCommand | undefined {
  switch (verb) {
    case "WHISPER":
      return parseWhisper(rest);
    case "READ_WAIT": {
      const ms = parseWaitMs(rest);
      return ms === undefined ? undefined : { ms, type: "read_wait" };
    }
    case "READ_WAIT_JSON": {
      const ms = parseWaitMs(rest);
      return ms === undefined ? undefined : { ms, type: "read_wait_json" };
    }
    case "WHO":
      return rest ? { filter: rest, type: "who" } : { type: "who" };
    case "WHO_JSON":
      return rest ? { filter: rest, type: "who_json" } : { type: "who_json" };
    case "LEAVE":
      return parseLeave(rest);
    case "NEARBY":
      return rest.trim().toLowerCase() === "all"
        ? { all: true, type: "nearby" }
        : { type: "nearby" };
    case "NEARBY_JSON":
      return rest.trim().toLowerCase() === "all"
        ? { all: true, type: "nearby_json" }
        : { type: "nearby_json" };
    case "JOIN":
      return parseJoin(rest);
    case "ROLL":
      return parseRoll(rest);
    default:
      return line ? { message: line, type: "chat" } : undefined;
  }
}

function parseSocial(
  line: string,
  verb: string,
  rest: string,
): IpcCommand | undefined {
  const bare = BARE_SOCIAL.get(verb);
  if (bare) return bare;
  const targetType = TARGET_SOCIAL.get(verb);
  if (targetType) return rest ? { target: rest, type: targetType } : undefined;
  const messageType = MESSAGE_SOCIAL.get(verb);
  if (messageType) return { message: rest, type: messageType };
  return parseSocialVerb(line, verb, rest);
}
