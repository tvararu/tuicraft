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

export function parseCommand(input: string): Command {
  if (!input.startsWith("/")) return { message: input, type: "chat" };

  const spaceIdx = input.indexOf(" ");
  const cmd = spaceIdx === -1 ? input : input.slice(0, spaceIdx);
  const rest = spaceIdx === -1 ? "" : input.slice(spaceIdx + 1);

  switch (cmd) {
    case "/s":
    case "/say":
      return { message: rest, type: "say" };
    case "/y":
    case "/yell":
      return { message: rest, type: "yell" };
    case "/g":
    case "/guild":
      return { message: rest, type: "guild" };
    case "/p":
    case "/party":
      return { message: rest, type: "party" };
    case "/raid":
      return { message: rest, type: "raid" };
    case "/w":
    case "/whisper": {
      const targetEnd = rest.indexOf(" ");
      if (targetEnd === -1)
        return { message: "", target: rest, type: "whisper" };
      return {
        message: rest.slice(targetEnd + 1),
        target: rest.slice(0, targetEnd),
        type: "whisper",
      };
    }
    case "/r":
      return { message: rest, type: "reply" };
    case "/who":
      return rest ? { target: rest, type: "who" } : { type: "who" };
    case "/invite":
      return rest
        ? { target: rest, type: "invite" }
        : { message: input, type: "say" };
    case "/kick":
      return rest
        ? { target: rest, type: "kick" }
        : { message: input, type: "say" };
    case "/leave":
      if (rest) return { channel: rest.split(" ")[0]!, type: "leave-channel" };
      return { type: "leave" };
    case "/leader":
      return rest
        ? { target: rest, type: "leader" }
        : { message: input, type: "say" };
    case "/accept":
      return { type: "accept" };
    case "/decline":
      return { type: "decline" };
    case "/quit":
      return { type: "quit" };
    case "/tuicraft": {
      const parts = rest.split(" ");
      return {
        subcommand: parts[0] ?? "",
        type: "tuicraft",
        value: parts[1] ?? "",
      };
    }
    case "/friends":
      return { type: "friends" };
    case "/f":
      return { type: "friends" };
    case "/friend": {
      const parts = rest.split(" ");
      const sub = parts[0] ?? "";
      const target = parts.slice(1).join(" ");
      if (sub === "add" && target) return { target, type: "add-friend" };
      if (sub === "remove" && target) return { target, type: "remove-friend" };
      return { type: "friends" };
    }
    case "/ignore":
      return rest ? { target: rest, type: "add-ignore" } : { type: "ignored" };
    case "/unignore":
      return rest
        ? { target: rest, type: "remove-ignore" }
        : { message: input, type: "say" };
    case "/ignorelist":
      return { type: "ignored" };
    case "/join": {
      if (!rest) return { message: input, type: "say" };
      const [channel, password] = rest.split(" ") as [string, string?];
      return { channel, password, type: "join-channel" };
    }
    case "/groster":
      return { type: "guild-roster" };
    case "/ginvite":
      return rest
        ? { target: rest, type: "guild-invite" }
        : { message: input, type: "say" };
    case "/gkick":
      return rest
        ? { target: rest, type: "guild-kick" }
        : { message: input, type: "say" };
    case "/gleave":
      return { type: "guild-leave" };
    case "/gpromote":
      return rest
        ? { target: rest, type: "guild-promote" }
        : { message: input, type: "say" };
    case "/gdemote":
      return rest
        ? { target: rest, type: "guild-demote" }
        : { message: input, type: "say" };
    case "/gleader":
      return rest
        ? { target: rest, type: "guild-leader" }
        : { message: input, type: "say" };
    case "/gmotd":
      return { message: rest, type: "guild-motd" };
    case "/gaccept":
      return { type: "guild-accept" };
    case "/gdecline":
      return { type: "guild-decline" };
    case "/mail":
      return { feature: "Mail reading", type: "unimplemented" };
    case "/roll": {
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
    case "/dnd":
      return { message: rest, type: "dnd" };
    case "/afk":
      return { message: rest, type: "afk" };
    case "/e":
    case "/emote":
      return { message: rest, type: "emote" };
  }

  const channelMatch = cmd.match(/^\/(\d+)$/);
  return channelMatch
    ? { message: rest, target: channelMatch[1]!, type: "channel" }
    : { message: input, type: "say" };
}
