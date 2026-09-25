export type Command =
  | { type: "chat"; message: string }
  | { type: "say"; message: string }
  | { type: "yell"; message: string }
  | { type: "guild"; message: string }
  | { type: "party"; message: string }
  | { type: "raid"; message: string }
  | { type: "emote"; message: string }
  | { type: "dnd"; message: string }
  | { type: "afk"; message: string }
  | { type: "whisper"; target: string; message: string }
  | { type: "reply"; message: string }
  | { type: "channel"; target: string; message: string }
  | { type: "who"; target?: string }
  | { type: "invite"; target: string }
  | { type: "kick"; target: string }
  | { type: "leave" }
  | { type: "join-channel"; channel: string; password?: string }
  | { type: "leave-channel"; channel: string }
  | { type: "leader"; target: string }
  | { type: "accept" }
  | { type: "decline" }
  | { type: "quit" }
  | { type: "tuicraft"; subcommand: string; value: string }
  | { type: "friends" }
  | { type: "add-friend"; target: string }
  | { type: "remove-friend"; target: string }
  | { type: "roll"; min: number; max: number }
  | { type: "ignored" }
  | { type: "add-ignore"; target: string }
  | { type: "remove-ignore"; target: string }
  | { type: "guild-roster" }
  | { type: "guild-invite"; target: string }
  | { type: "guild-kick"; target: string }
  | { type: "guild-leave" }
  | { type: "guild-promote"; target: string }
  | { type: "guild-demote"; target: string }
  | { type: "guild-leader"; target: string }
  | { type: "guild-motd"; message: string }
  | { type: "guild-accept" }
  | { type: "guild-decline" }
  | { type: "unimplemented"; feature: string };

type MessageCommand = Exclude<
  Extract<Command, { message: string }>,
  { target: string }
>["type"];
type TargetCommand = Exclude<
  Extract<Command, { target: string }>,
  { message: string }
>["type"];
type BareCommand = Extract<
  Command,
  | { type: "accept" }
  | { type: "decline" }
  | { type: "quit" }
  | { type: "friends" }
  | { type: "ignored" }
  | { type: "guild-roster" }
  | { type: "guild-leave" }
  | { type: "guild-accept" }
  | { type: "guild-decline" }
>["type"];

const MESSAGE_COMMANDS: Record<string, MessageCommand> = {
  "/afk": "afk",
  "/dnd": "dnd",
  "/e": "emote",
  "/emote": "emote",
  "/g": "guild",
  "/gmotd": "guild-motd",
  "/guild": "guild",
  "/p": "party",
  "/party": "party",
  "/r": "reply",
  "/raid": "raid",
  "/s": "say",
  "/say": "say",
  "/y": "yell",
  "/yell": "yell",
};

const TARGET_COMMANDS: Record<string, TargetCommand> = {
  "/gdemote": "guild-demote",
  "/ginvite": "guild-invite",
  "/gkick": "guild-kick",
  "/gleader": "guild-leader",
  "/gpromote": "guild-promote",
  "/invite": "invite",
  "/kick": "kick",
  "/leader": "leader",
  "/unignore": "remove-ignore",
};

const BARE_COMMANDS: Record<string, BareCommand> = {
  "/accept": "accept",
  "/decline": "decline",
  "/f": "friends",
  "/friends": "friends",
  "/gaccept": "guild-accept",
  "/gdecline": "guild-decline",
  "/gleave": "guild-leave",
  "/groster": "guild-roster",
  "/ignorelist": "ignored",
  "/quit": "quit",
};

const CHANNEL_NUMBER = /^\/(\d+)$/;

function parseWhisper(rest: string): Command {
  const targetEnd = rest.indexOf(" ");
  if (targetEnd === -1) return { message: "", target: rest, type: "whisper" };
  return {
    message: rest.slice(targetEnd + 1),
    target: rest.slice(0, targetEnd),
    type: "whisper",
  };
}

function parseLeave(rest: string): Command {
  if (!rest) return { type: "leave" };
  const space = rest.indexOf(" ");
  const channel = space === -1 ? rest : rest.slice(0, space);
  return { channel, type: "leave-channel" };
}

function parseTuicraft(rest: string): Command {
  const parts = rest.split(" ");
  return {
    subcommand: parts[0] ?? "",
    type: "tuicraft",
    value: parts[1] ?? "",
  };
}

function parseFriend(rest: string): Command {
  const parts = rest.split(" ");
  const sub = parts[0] ?? "";
  const target = parts.slice(1).join(" ");
  if (sub === "add" && target) return { target, type: "add-friend" };
  if (sub === "remove" && target) return { target, type: "remove-friend" };
  return { type: "friends" };
}

function parseJoin(rest: string, input: string): Command {
  if (!rest) return { message: input, type: "say" };
  const [channel, password] = rest.split(" ") as [string, string?];
  return { channel, password, type: "join-channel" };
}

function parseRoll(rest: string): Command {
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

function parseSpecial(
  cmd: string,
  rest: string,
  input: string,
): Command | undefined {
  switch (cmd) {
    case "/w":
    case "/whisper":
      return parseWhisper(rest);
    case "/who":
      return rest ? { target: rest, type: "who" } : { type: "who" };
    case "/leave":
      return parseLeave(rest);
    case "/tuicraft":
      return parseTuicraft(rest);
    case "/friend":
      return parseFriend(rest);
    case "/ignore":
      return rest ? { target: rest, type: "add-ignore" } : { type: "ignored" };
    case "/join":
      return parseJoin(rest, input);
    case "/mail":
      return { feature: "Mail reading", type: "unimplemented" };
    case "/roll":
      return parseRoll(rest);
    default:
      return;
  }
}

function parseTabled(
  cmd: string,
  rest: string,
  input: string,
): Command | undefined {
  const messageType = MESSAGE_COMMANDS[cmd];
  if (messageType !== undefined) return { message: rest, type: messageType };
  const targetType = TARGET_COMMANDS[cmd];
  if (targetType !== undefined)
    return rest
      ? { target: rest, type: targetType }
      : { message: input, type: "say" };
  const bareType = BARE_COMMANDS[cmd];
  if (bareType !== undefined) return { type: bareType };
  return;
}

export function parseCommand(input: string): Command {
  if (!input.startsWith("/")) return { message: input, type: "chat" };

  const spaceIdx = input.indexOf(" ");
  const cmd = spaceIdx === -1 ? input : input.slice(0, spaceIdx);
  const rest = spaceIdx === -1 ? "" : input.slice(spaceIdx + 1);

  const parsed =
    parseTabled(cmd, rest, input) ?? parseSpecial(cmd, rest, input);
  if (parsed) return parsed;

  const channel = CHANNEL_NUMBER.exec(cmd)?.[1];
  return channel === undefined
    ? { message: input, type: "say" }
    : { message: rest, target: channel, type: "channel" };
}
