import { test, expect, describe } from "bun:test";
import { parseCommand } from "ui/commands";

describe("parseCommand", () => {
  test("bare text becomes chat", () => {
    expect(parseCommand("hello")).toEqual({ type: "chat", message: "hello" });
  });

  test("/s sends say", () => {
    expect(parseCommand("/s hello")).toEqual({ type: "say", message: "hello" });
  });

  test("/say sends say", () => {
    expect(parseCommand("/say hello there")).toEqual({
      type: "say",
      message: "hello there",
    });
  });

  test("/w sends whisper", () => {
    expect(parseCommand("/w Xiara follow me")).toEqual({
      type: "whisper",
      target: "Xiara",
      message: "follow me",
    });
  });

  test("/w with target only sends whisper with empty message", () => {
    expect(parseCommand("/w Arthas")).toEqual({
      type: "whisper",
      target: "Arthas",
      message: "",
    });
  });

  test("/whisper sends whisper", () => {
    expect(parseCommand("/whisper Xiara hi")).toEqual({
      type: "whisper",
      target: "Xiara",
      message: "hi",
    });
  });

  test("/r sends reply", () => {
    expect(parseCommand("/r hello")).toEqual({
      type: "reply",
      message: "hello",
    });
  });

  test("/g sends guild", () => {
    expect(parseCommand("/g hello guild")).toEqual({
      type: "guild",
      message: "hello guild",
    });
  });

  test("/guild sends guild", () => {
    expect(parseCommand("/guild hi")).toEqual({
      type: "guild",
      message: "hi",
    });
  });

  test("/y sends yell", () => {
    expect(parseCommand("/y HELLO")).toEqual({
      type: "yell",
      message: "HELLO",
    });
  });

  test("/p sends party", () => {
    expect(parseCommand("/p inv")).toEqual({ type: "party", message: "inv" });
  });

  test("/party sends party", () => {
    expect(parseCommand("/party inv")).toEqual({
      type: "party",
      message: "inv",
    });
  });

  test("/raid sends raid", () => {
    expect(parseCommand("/raid pull")).toEqual({
      type: "raid",
      message: "pull",
    });
  });

  test("/1 sends channel 1", () => {
    expect(parseCommand("/1 hello general")).toEqual({
      type: "channel",
      target: "1",
      message: "hello general",
    });
  });

  test("/2 sends channel 2", () => {
    expect(parseCommand("/2 lfg")).toEqual({
      type: "channel",
      target: "2",
      message: "lfg",
    });
  });

  test("/who sends who query", () => {
    expect(parseCommand("/who")).toEqual({ type: "who" });
  });

  test("/who with name filter", () => {
    expect(parseCommand("/who Xiara")).toEqual({
      type: "who",
      target: "Xiara",
    });
  });

  test("/quit sends quit", () => {
    expect(parseCommand("/quit")).toEqual({ type: "quit" });
  });

  test("empty string becomes chat with empty message", () => {
    expect(parseCommand("")).toEqual({ type: "chat", message: "" });
  });

  test("unknown slash command becomes say with full input", () => {
    expect(parseCommand("/dance hello")).toEqual({
      type: "say",
      message: "/dance hello",
    });
  });

  test("/invite", () => {
    expect(parseCommand("/invite Voidtrix")).toEqual({
      type: "invite",
      target: "Voidtrix",
    });
  });

  test("/kick", () => {
    expect(parseCommand("/kick Voidtrix")).toEqual({
      type: "kick",
      target: "Voidtrix",
    });
  });

  test("/leave with no argument leaves party", () => {
    expect(parseCommand("/leave")).toEqual({ type: "leave" });
  });

  test("/leave with argument leaves channel", () => {
    expect(parseCommand("/leave Trade")).toEqual({
      type: "leave-channel",
      channel: "Trade",
    });
  });

  test("/leader", () => {
    expect(parseCommand("/leader Voidtrix")).toEqual({
      type: "leader",
      target: "Voidtrix",
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
      type: "say",
      message: "/invite",
    });
  });

  test("/kick with no target falls back to say", () => {
    expect(parseCommand("/kick")).toEqual({
      type: "say",
      message: "/kick",
    });
  });

  test("/leader with no target falls back to say", () => {
    expect(parseCommand("/leader")).toEqual({
      type: "say",
      message: "/leader",
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
      type: "add-friend",
      target: "Arthas",
    });
  });

  test("/friend remove Arthas returns remove-friend", () => {
    expect(parseCommand("/friend remove Arthas")).toEqual({
      type: "remove-friend",
      target: "Arthas",
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
      type: "add-ignore",
      target: "Foo",
    });
  });

  test("/ignore bare returns ignored list", () => {
    expect(parseCommand("/ignore")).toEqual({ type: "ignored" });
  });

  test("/unignore with name returns remove-ignore", () => {
    expect(parseCommand("/unignore Foo")).toEqual({
      type: "remove-ignore",
      target: "Foo",
    });
  });

  test("/unignore bare falls back to say", () => {
    expect(parseCommand("/unignore")).toEqual({
      type: "say",
      message: "/unignore",
    });
  });

  test("/ignorelist returns ignored list", () => {
    expect(parseCommand("/ignorelist")).toEqual({ type: "ignored" });
  });

  test("/join parses channel name", () => {
    expect(parseCommand("/join Trade")).toEqual({
      type: "join-channel",
      channel: "Trade",
    });
  });

  test("/join parses channel name with password", () => {
    expect(parseCommand("/join Secret hunter2")).toEqual({
      type: "join-channel",
      channel: "Secret",
      password: "hunter2",
    });
  });

  test("/join with no argument sends say", () => {
    expect(parseCommand("/join")).toEqual({ type: "say", message: "/join" });
  });

  test("/ginvite parses target", () => {
    expect(parseCommand("/ginvite Thrall")).toEqual({
      type: "guild-invite",
      target: "Thrall",
    });
  });

  test("/ginvite without target becomes say", () => {
    expect(parseCommand("/ginvite")).toEqual({
      type: "say",
      message: "/ginvite",
    });
  });

  test("/gkick parses target", () => {
    expect(parseCommand("/gkick Garrosh")).toEqual({
      type: "guild-kick",
      target: "Garrosh",
    });
  });

  test("/gkick without target becomes say", () => {
    expect(parseCommand("/gkick")).toEqual({
      type: "say",
      message: "/gkick",
    });
  });

  test("/gleave parses", () => {
    expect(parseCommand("/gleave")).toEqual({ type: "guild-leave" });
  });

  test("/gpromote parses target", () => {
    expect(parseCommand("/gpromote Jaina")).toEqual({
      type: "guild-promote",
      target: "Jaina",
    });
  });

  test("/gpromote without target becomes say", () => {
    expect(parseCommand("/gpromote")).toEqual({
      type: "say",
      message: "/gpromote",
    });
  });

  test("/gdemote parses target", () => {
    expect(parseCommand("/gdemote Arthas")).toEqual({
      type: "guild-demote",
      target: "Arthas",
    });
  });

  test("/gdemote without target becomes say", () => {
    expect(parseCommand("/gdemote")).toEqual({
      type: "say",
      message: "/gdemote",
    });
  });

  test("/gleader parses target", () => {
    expect(parseCommand("/gleader Sylvanas")).toEqual({
      type: "guild-leader",
      target: "Sylvanas",
    });
  });

  test("/gleader without target becomes say", () => {
    expect(parseCommand("/gleader")).toEqual({
      type: "say",
      message: "/gleader",
    });
  });

  test("/gmotd parses message", () => {
    expect(parseCommand("/gmotd Raid tonight at 8pm")).toEqual({
      type: "guild-motd",
      message: "Raid tonight at 8pm",
    });
  });

  test("/gmotd with empty message clears motd", () => {
    expect(parseCommand("/gmotd")).toEqual({
      type: "guild-motd",
      message: "",
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
        type: "unimplemented",
        feature: "Mail reading",
      });
    });
    test("/roll defaults to 1-100", () => {
      expect(parseCommand("/roll")).toEqual({
        type: "roll",
        min: 1,
        max: 100,
      });
    });
    test("/roll N sets 1-N", () => {
      expect(parseCommand("/roll 50")).toEqual({
        type: "roll",
        min: 1,
        max: 50,
      });
    });
    test("/roll N M sets N-M", () => {
      expect(parseCommand("/roll 10 20")).toEqual({
        type: "roll",
        min: 10,
        max: 20,
      });
    });
    test("/dnd sends dnd with message", () => {
      expect(parseCommand("/dnd busy right now")).toEqual({
        type: "dnd",
        message: "busy right now",
      });
    });
    test("/dnd sends dnd with empty message", () => {
      expect(parseCommand("/dnd")).toEqual({
        type: "dnd",
        message: "",
      });
    });
    test("/afk sends afk with message", () => {
      expect(parseCommand("/afk grabbing coffee")).toEqual({
        type: "afk",
        message: "grabbing coffee",
      });
    });
    test("/afk sends afk with empty message", () => {
      expect(parseCommand("/afk")).toEqual({
        type: "afk",
        message: "",
      });
    });
    test("/e sends emote", () => {
      expect(parseCommand("/e waves")).toEqual({
        type: "emote",
        message: "waves",
      });
    });
    test("/emote sends emote", () => {
      expect(parseCommand("/emote waves")).toEqual({
        type: "emote",
        message: "waves",
      });
    });
  });
});

describe("tuicraft parseCommand", () => {
  test("parseCommand handles /tuicraft entities on", () => {
    const cmd = parseCommand("/tuicraft entities on");
    expect(cmd).toEqual({
      type: "tuicraft",
      subcommand: "entities",
      value: "on",
    });
  });

  test("parseCommand handles /tuicraft entities off", () => {
    const cmd = parseCommand("/tuicraft entities off");
    expect(cmd).toEqual({
      type: "tuicraft",
      subcommand: "entities",
      value: "off",
    });
  });

  test("parseCommand handles /tuicraft with unknown subcommand", () => {
    const cmd = parseCommand("/tuicraft foo");
    expect(cmd).toEqual({ type: "tuicraft", subcommand: "foo", value: "" });
  });
});
