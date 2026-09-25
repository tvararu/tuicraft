import { describe, expect, test } from "bun:test";
import { parseCommand } from "ui/commands";

describe("parseCommand", () => {
  test("bare text becomes chat", () => {
    expect(parseCommand("hello")).toEqual({ message: "hello", type: "chat" });
  });

  test("/s sends say", () => {
    expect(parseCommand("/s hello")).toEqual({ message: "hello", type: "say" });
  });

  test("/say sends say", () => {
    expect(parseCommand("/say hello there")).toEqual({
      message: "hello there",
      type: "say",
    });
  });

  test("/w sends whisper", () => {
    expect(parseCommand("/w Xiara follow me")).toEqual({
      message: "follow me",
      target: "Xiara",
      type: "whisper",
    });
  });

  test("/w with target only sends whisper with empty message", () => {
    expect(parseCommand("/w Arthas")).toEqual({
      message: "",
      target: "Arthas",
      type: "whisper",
    });
  });

  test("/whisper sends whisper", () => {
    expect(parseCommand("/whisper Xiara hi")).toEqual({
      message: "hi",
      target: "Xiara",
      type: "whisper",
    });
  });

  test("/r sends reply", () => {
    expect(parseCommand("/r hello")).toEqual({
      message: "hello",
      type: "reply",
    });
  });

  test("/g sends guild", () => {
    expect(parseCommand("/g hello guild")).toEqual({
      message: "hello guild",
      type: "guild",
    });
  });

  test("/guild sends guild", () => {
    expect(parseCommand("/guild hi")).toEqual({
      message: "hi",
      type: "guild",
    });
  });

  test("/y sends yell", () => {
    expect(parseCommand("/y HELLO")).toEqual({
      message: "HELLO",
      type: "yell",
    });
  });

  test("/p sends party", () => {
    expect(parseCommand("/p inv")).toEqual({ message: "inv", type: "party" });
  });

  test("/party sends party", () => {
    expect(parseCommand("/party inv")).toEqual({
      message: "inv",
      type: "party",
    });
  });

  test("/raid sends raid", () => {
    expect(parseCommand("/raid pull")).toEqual({
      message: "pull",
      type: "raid",
    });
  });

  test("/1 sends channel 1", () => {
    expect(parseCommand("/1 hello general")).toEqual({
      message: "hello general",
      target: "1",
      type: "channel",
    });
  });

  test("/2 sends channel 2", () => {
    expect(parseCommand("/2 lfg")).toEqual({
      message: "lfg",
      target: "2",
      type: "channel",
    });
  });

  test("/who sends who query", () => {
    expect(parseCommand("/who")).toEqual({ type: "who" });
  });

  test("/who with name filter", () => {
    expect(parseCommand("/who Xiara")).toEqual({
      target: "Xiara",
      type: "who",
    });
  });

  test("/quit sends quit", () => {
    expect(parseCommand("/quit")).toEqual({ type: "quit" });
  });

  test("empty string becomes chat with empty message", () => {
    expect(parseCommand("")).toEqual({ message: "", type: "chat" });
  });

  test("unknown slash command becomes say with full input", () => {
    expect(parseCommand("/dance hello")).toEqual({
      message: "/dance hello",
      type: "say",
    });
  });

  test("/invite", () => {
    expect(parseCommand("/invite Voidtrix")).toEqual({
      target: "Voidtrix",
      type: "invite",
    });
  });

  test("/kick", () => {
    expect(parseCommand("/kick Voidtrix")).toEqual({
      target: "Voidtrix",
      type: "kick",
    });
  });

  test("/leave with no argument leaves party", () => {
    expect(parseCommand("/leave")).toEqual({ type: "leave" });
  });

  test("/leave with argument leaves channel", () => {
    expect(parseCommand("/leave Trade")).toEqual({
      channel: "Trade",
      type: "leave-channel",
    });
  });

  test("/leader", () => {
    expect(parseCommand("/leader Voidtrix")).toEqual({
      target: "Voidtrix",
      type: "leader",
    });
  });

  test("/accept", () => {
    expect(parseCommand("/accept")).toEqual({ type: "accept" });
  });

  test("/decline", () => {
    expect(parseCommand("/decline")).toEqual({ type: "decline" });
  });

  test("/invite with no target falls back to say", () => {
    expect(parseCommand("/invite")).toEqual({
      message: "/invite",
      type: "say",
    });
  });

  test("/kick with no target falls back to say", () => {
    expect(parseCommand("/kick")).toEqual({
      message: "/kick",
      type: "say",
    });
  });

  test("/leader with no target falls back to say", () => {
    expect(parseCommand("/leader")).toEqual({
      message: "/leader",
      type: "say",
    });
  });

  test("/friends returns friends", () => {
    expect(parseCommand("/friends")).toEqual({ type: "friends" });
  });

  test("/f returns friends", () => {
    expect(parseCommand("/f")).toEqual({ type: "friends" });
  });

  test("/friend add Arthas returns add-friend", () => {
    expect(parseCommand("/friend add Arthas")).toEqual({
      target: "Arthas",
      type: "add-friend",
    });
  });

  test("/friend remove Arthas returns remove-friend", () => {
    expect(parseCommand("/friend remove Arthas")).toEqual({
      target: "Arthas",
      type: "remove-friend",
    });
  });

  test("/friend bare returns friends", () => {
    expect(parseCommand("/friend")).toEqual({ type: "friends" });
  });

  test("/friend add without target returns friends", () => {
    expect(parseCommand("/friend add")).toEqual({ type: "friends" });
  });

  test("/friend remove without target returns friends", () => {
    expect(parseCommand("/friend remove")).toEqual({ type: "friends" });
  });

  test("/ignore with name returns add-ignore", () => {
    expect(parseCommand("/ignore Foo")).toEqual({
      target: "Foo",
      type: "add-ignore",
    });
  });

  test("/ignore bare returns ignored list", () => {
    expect(parseCommand("/ignore")).toEqual({ type: "ignored" });
  });

  test("/unignore with name returns remove-ignore", () => {
    expect(parseCommand("/unignore Foo")).toEqual({
      target: "Foo",
      type: "remove-ignore",
    });
  });

  test("/unignore bare falls back to say", () => {
    expect(parseCommand("/unignore")).toEqual({
      message: "/unignore",
      type: "say",
    });
  });

  test("/ignorelist returns ignored list", () => {
    expect(parseCommand("/ignorelist")).toEqual({ type: "ignored" });
  });

  test("/join parses channel name", () => {
    expect(parseCommand("/join Trade")).toEqual({
      channel: "Trade",
      type: "join-channel",
    });
  });

  test("/join parses channel name with password", () => {
    expect(parseCommand("/join Secret hunter2")).toEqual({
      channel: "Secret",
      password: "hunter2",
      type: "join-channel",
    });
  });

  test("/join with no argument sends say", () => {
    expect(parseCommand("/join")).toEqual({ message: "/join", type: "say" });
  });

  test("/ginvite parses target", () => {
    expect(parseCommand("/ginvite Thrall")).toEqual({
      target: "Thrall",
      type: "guild-invite",
    });
  });

  test("/ginvite without target becomes say", () => {
    expect(parseCommand("/ginvite")).toEqual({
      message: "/ginvite",
      type: "say",
    });
  });

  test("/gkick parses target", () => {
    expect(parseCommand("/gkick Garrosh")).toEqual({
      target: "Garrosh",
      type: "guild-kick",
    });
  });

  test("/gkick without target becomes say", () => {
    expect(parseCommand("/gkick")).toEqual({
      message: "/gkick",
      type: "say",
    });
  });

  test("/gleave parses", () => {
    expect(parseCommand("/gleave")).toEqual({ type: "guild-leave" });
  });

  test("/gpromote parses target", () => {
    expect(parseCommand("/gpromote Jaina")).toEqual({
      target: "Jaina",
      type: "guild-promote",
    });
  });

  test("/gpromote without target becomes say", () => {
    expect(parseCommand("/gpromote")).toEqual({
      message: "/gpromote",
      type: "say",
    });
  });

  test("/gdemote parses target", () => {
    expect(parseCommand("/gdemote Arthas")).toEqual({
      target: "Arthas",
      type: "guild-demote",
    });
  });

  test("/gdemote without target becomes say", () => {
    expect(parseCommand("/gdemote")).toEqual({
      message: "/gdemote",
      type: "say",
    });
  });

  test("/gleader parses target", () => {
    expect(parseCommand("/gleader Sylvanas")).toEqual({
      target: "Sylvanas",
      type: "guild-leader",
    });
  });

  test("/gleader without target becomes say", () => {
    expect(parseCommand("/gleader")).toEqual({
      message: "/gleader",
      type: "say",
    });
  });

  test("/gmotd parses message", () => {
    expect(parseCommand("/gmotd Raid tonight at 8pm")).toEqual({
      message: "Raid tonight at 8pm",
      type: "guild-motd",
    });
  });

  test("/gmotd with empty message clears motd", () => {
    expect(parseCommand("/gmotd")).toEqual({
      message: "",
      type: "guild-motd",
    });
  });

  test("/gaccept parses", () => {
    expect(parseCommand("/gaccept")).toEqual({ type: "guild-accept" });
  });

  test("/gdecline parses", () => {
    expect(parseCommand("/gdecline")).toEqual({ type: "guild-decline" });
  });

  describe("unimplemented commands", () => {
    test("/mail returns unimplemented", () => {
      expect(parseCommand("/mail")).toEqual({
        feature: "Mail reading",
        type: "unimplemented",
      });
    });
    test("/roll defaults to 1-100", () => {
      expect(parseCommand("/roll")).toEqual({
        max: 100,
        min: 1,
        type: "roll",
      });
    });
    test("/roll N sets 1-N", () => {
      expect(parseCommand("/roll 50")).toEqual({
        max: 50,
        min: 1,
        type: "roll",
      });
    });
    test("/roll N M sets N-M", () => {
      expect(parseCommand("/roll 10 20")).toEqual({
        max: 20,
        min: 10,
        type: "roll",
      });
    });
    test("/dnd sends dnd with message", () => {
      expect(parseCommand("/dnd busy right now")).toEqual({
        message: "busy right now",
        type: "dnd",
      });
    });
    test("/dnd sends dnd with empty message", () => {
      expect(parseCommand("/dnd")).toEqual({
        message: "",
        type: "dnd",
      });
    });
    test("/afk sends afk with message", () => {
      expect(parseCommand("/afk grabbing coffee")).toEqual({
        message: "grabbing coffee",
        type: "afk",
      });
    });
    test("/afk sends afk with empty message", () => {
      expect(parseCommand("/afk")).toEqual({
        message: "",
        type: "afk",
      });
    });
    test("/e sends emote", () => {
      expect(parseCommand("/e waves")).toEqual({
        message: "waves",
        type: "emote",
      });
    });
    test("/emote sends emote", () => {
      expect(parseCommand("/emote waves")).toEqual({
        message: "waves",
        type: "emote",
      });
    });
  });
});

describe("tuicraft parseCommand", () => {
  test("parseCommand handles /tuicraft entities on", () => {
    const cmd = parseCommand("/tuicraft entities on");
    expect(cmd).toEqual({
      subcommand: "entities",
      type: "tuicraft",
      value: "on",
    });
  });

  test("parseCommand handles /tuicraft entities off", () => {
    const cmd = parseCommand("/tuicraft entities off");
    expect(cmd).toEqual({
      subcommand: "entities",
      type: "tuicraft",
      value: "off",
    });
  });

  test("parseCommand handles /tuicraft with unknown subcommand", () => {
    const cmd = parseCommand("/tuicraft foo");
    expect(cmd).toEqual({ subcommand: "foo", type: "tuicraft", value: "" });
  });
});
