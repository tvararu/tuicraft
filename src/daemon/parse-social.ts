import type { IpcCommand, TargetIpcType } from "daemon/parse";

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

const WAIT_SOCIAL = new Map<
  string,
  Extract<IpcCommand, { ms: number }>["type"]
>([
  ["READ_WAIT", "read_wait"],
  ["READ_WAIT_JSON", "read_wait_json"],
  ["TAIL_WAIT", "tail_wait"],
  ["TAIL_WAIT_JSON", "tail_wait_json"],
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

export function parseSocial(
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
  const waitType = WAIT_SOCIAL.get(verb);
  if (waitType) {
    const ms = parseWaitMs(rest);
    return ms === undefined ? undefined : { ms, type: waitType };
  }
  return parseSocialVerb(line, verb, rest);
}
