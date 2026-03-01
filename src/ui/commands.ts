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
  | { type: "leader"; target: string }
  | { type: "accept" }
  | { type: "decline" }
  | { type: "quit" }
  | { type: "tuicraft"; subcommand: string; value: string }
  | { type: "friends" }
  | { type: "add-friend"; target: string }
  | { type: "remove-friend"; target: string }
  | { type: "roll"; min: number; max: number }
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
      return { type: "unimplemented", feature: "Ignore list" };
    case "/join":
      return { type: "unimplemented", feature: "Channel join/leave" };
    case "/ginvite":
    case "/gkick":
    case "/gleave":
    case "/gpromote":
      return { type: "unimplemented", feature: "Guild management" };
    case "/mail":
      return { type: "unimplemented", feature: "Mail" };
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
    default: {
      const channelMatch = cmd.match(/^\/(\d+)$/);
      if (channelMatch) {
        return { type: "channel", target: channelMatch[1]!, message: rest };
      }
      return { type: "say", message: input };
    }
  }
}
