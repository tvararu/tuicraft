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
  if (!input.startsWith("/")) return { type: "chat", message: input };

  const spaceIdx = input.indexOf(" ");
  const cmd = spaceIdx === -1 ? input : input.slice(0, spaceIdx);
  const rest = spaceIdx === -1 ? "" : input.slice(spaceIdx + 1);

  switch (cmd) {
    case "/s":
    case "/say":
      return { type: "say", message: rest };
    case "/y":
    case "/yell":
      return { type: "yell", message: rest };
    case "/g":
    case "/guild":
      return { type: "guild", message: rest };
    case "/p":
    case "/party":
      return { type: "party", message: rest };
    case "/raid":
      return { type: "raid", message: rest };
    case "/w":
    case "/whisper": {
      const targetEnd = rest.indexOf(" ");
      if (targetEnd === -1)
        return { type: "whisper", target: rest, message: "" };
      return {
        type: "whisper",
        target: rest.slice(0, targetEnd),
        message: rest.slice(targetEnd + 1),
      };
    }
    case "/r":
      return { type: "reply", message: rest };
    case "/who":
      return rest ? { type: "who", target: rest } : { type: "who" };
    case "/invite":
      return rest
        ? { type: "invite", target: rest }
        : { type: "say", message: input };
    case "/kick":
      return rest
        ? { type: "kick", target: rest }
        : { type: "say", message: input };
    case "/leave":
      if (rest) return { type: "leave-channel", channel: rest.split(" ")[0]! };
      return { type: "leave" };
    case "/leader":
      return rest
        ? { type: "leader", target: rest }
        : { type: "say", message: input };
    case "/accept":
      return { type: "accept" };
    case "/decline":
      return { type: "decline" };
    case "/quit":
      return { type: "quit" };
    case "/tuicraft": {
      const parts = rest.split(" ");
      return {
        type: "tuicraft",
        subcommand: parts[0] ?? "",
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
      if (sub === "add" && target) return { type: "add-friend", target };
      if (sub === "remove" && target) return { type: "remove-friend", target };
      return { type: "friends" };
    }
    case "/ignore":
      return rest ? { type: "add-ignore", target: rest } : { type: "ignored" };
    case "/unignore":
      return rest
        ? { type: "remove-ignore", target: rest }
        : { type: "say", message: input };
    case "/ignorelist":
      return { type: "ignored" };
    case "/join": {
      if (!rest) return { type: "say", message: input };
      const [channel, password] = rest.split(" ") as [string, string?];
      return { type: "join-channel", channel, password };
    }
    case "/groster":
      return { type: "guild-roster" };
    case "/ginvite":
      return rest
        ? { type: "guild-invite", target: rest }
        : { type: "say", message: input };
    case "/gkick":
      return rest
        ? { type: "guild-kick", target: rest }
        : { type: "say", message: input };
    case "/gleave":
      return { type: "guild-leave" };
    case "/gpromote":
      return rest
        ? { type: "guild-promote", target: rest }
        : { type: "say", message: input };
    case "/gdemote":
      return rest
        ? { type: "guild-demote", target: rest }
        : { type: "say", message: input };
    case "/gleader":
      return rest
        ? { type: "guild-leader", target: rest }
        : { type: "say", message: input };
    case "/gmotd":
      return { type: "guild-motd", message: rest };
    case "/gaccept":
      return { type: "guild-accept" };
    case "/gdecline":
      return { type: "guild-decline" };
    case "/mail":
      return { type: "unimplemented", feature: "Mail reading" };
    case "/roll": {
      const parts = rest.split(" ").filter(Boolean);
      if (parts.length >= 2)
        return {
          type: "roll",
          min: parseInt(parts[0]!, 10),
          max: parseInt(parts[1]!, 10),
        };
      if (parts.length === 1)
        return { type: "roll", min: 1, max: parseInt(parts[0]!, 10) };
      return { type: "roll", min: 1, max: 100 };
    }
    case "/dnd":
      return { type: "dnd", message: rest };
    case "/afk":
      return { type: "afk", message: rest };
    case "/e":
    case "/emote":
      return { type: "emote", message: rest };
  }

  const channelMatch = cmd.match(/^\/(\d+)$/);
  return channelMatch
    ? { type: "channel", target: channelMatch[1]!, message: rest }
    : { type: "say", message: input };
}
