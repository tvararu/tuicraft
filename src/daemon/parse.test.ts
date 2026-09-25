import { describe, expect, test } from "bun:test";
import { parseIpcCommand } from "daemon/parse";

describe("parseIpcCommand", () => {
  test("SAY", () => {
    expect(parseIpcCommand("SAY hello world")).toEqual({
      message: "hello world",
      type: "say",
    });
  });

  test("YELL", () => {
    expect(parseIpcCommand("YELL hey everyone")).toEqual({
      message: "hey everyone",
      type: "yell",
    });
  });

  test("GUILD", () => {
    expect(parseIpcCommand("GUILD inv pls")).toEqual({
      message: "inv pls",
      type: "guild",
    });
  });

  test("PARTY", () => {
    expect(parseIpcCommand("PARTY pull now")).toEqual({
      message: "pull now",
      type: "party",
    });
  });

  test("EMOTE", () => {
    expect(parseIpcCommand("EMOTE waves hello")).toEqual({
      message: "waves hello",
      type: "emote",
    });
  });

  test("DND", () => {
    expect(parseIpcCommand("DND busy right now")).toEqual({
      message: "busy right now",
      type: "dnd",
    });
  });

  test("DND without message", () => {
    expect(parseIpcCommand("DND")).toEqual({
      message: "",
      type: "dnd",
    });
  });

  test("AFK", () => {
    expect(parseIpcCommand("AFK grabbing coffee")).toEqual({
      message: "grabbing coffee",
      type: "afk",
    });
  });

  test("AFK without message", () => {
    expect(parseIpcCommand("AFK")).toEqual({
      message: "",
      type: "afk",
    });
  });

  test("ROLL defaults to 1-100", () => {
    expect(parseIpcCommand("ROLL")).toEqual({
      max: 100,
      min: 1,
      type: "roll",
    });
  });

  test("ROLL with max", () => {
    expect(parseIpcCommand("ROLL 50")).toEqual({
      max: 50,
      min: 1,
      type: "roll",
    });
  });

  test("ROLL with min and max", () => {
    expect(parseIpcCommand("ROLL 10 20")).toEqual({
      max: 20,
      min: 10,
      type: "roll",
    });
  });

  test("/roll via slash style", () => {
    expect(parseIpcCommand("/roll 50")).toEqual({
      max: 50,
      min: 1,
      type: "roll",
    });
  });

  test("WHISPER", () => {
    expect(parseIpcCommand("WHISPER Xiara follow me")).toEqual({
      message: "follow me",
      target: "Xiara",
      type: "whisper",
    });
  });

  test("WHISPER without message", () => {
    expect(parseIpcCommand("WHISPER Xiara")).toEqual({
      message: "",
      target: "Xiara",
      type: "whisper",
    });
  });

  test("READ", () => {
    expect(parseIpcCommand("READ")).toEqual({ type: "read" });
  });

  test("READ_WAIT", () => {
    expect(parseIpcCommand("READ_WAIT 3000")).toEqual({
      ms: 3000,
      type: "read_wait",
    });
  });

  test("STOP", () => {
    expect(parseIpcCommand("STOP")).toEqual({ type: "stop" });
  });

  test("STATUS", () => {
    expect(parseIpcCommand("STATUS")).toEqual({ type: "status" });
  });

  test("WHO without filter", () => {
    expect(parseIpcCommand("WHO")).toEqual({ type: "who" });
  });

  test("WHO with filter", () => {
    expect(parseIpcCommand("WHO mage")).toEqual({
      filter: "mage",
      type: "who",
    });
  });

  test("READ_JSON", () => {
    expect(parseIpcCommand("READ_JSON")).toEqual({ type: "read_json" });
  });

  test("READ_WAIT_JSON", () => {
    expect(parseIpcCommand("READ_WAIT_JSON 2000")).toEqual({
      ms: 2000,
      type: "read_wait_json",
    });
  });

  test("WHO_JSON without filter", () => {
    expect(parseIpcCommand("WHO_JSON")).toEqual({ type: "who_json" });
  });

  test("WHO_JSON with filter", () => {
    expect(parseIpcCommand("WHO_JSON mage")).toEqual({
      filter: "mage",
      type: "who_json",
    });
  });

  test("INVITE", () => {
    expect(parseIpcCommand("INVITE Voidtrix")).toEqual({
      target: "Voidtrix",
      type: "invite",
    });
  });

  test("KICK", () => {
    expect(parseIpcCommand("KICK Voidtrix")).toEqual({
      target: "Voidtrix",
      type: "kick",
    });
  });

  test("LEAVE", () => {
    expect(parseIpcCommand("LEAVE")).toEqual({ type: "leave" });
  });

  test("LEADER", () => {
    expect(parseIpcCommand("LEADER Voidtrix")).toEqual({
      target: "Voidtrix",
      type: "leader",
    });
  });

  test("ACCEPT", () => {
    expect(parseIpcCommand("ACCEPT")).toEqual({ type: "accept" });
  });

  test("DECLINE", () => {
    expect(parseIpcCommand("DECLINE")).toEqual({ type: "decline" });
  });

  test("NEARBY", () => {
    expect(parseIpcCommand("NEARBY")).toEqual({ type: "nearby" });
  });

  test("NEARBY_JSON", () => {
    expect(parseIpcCommand("NEARBY_JSON")).toEqual({ type: "nearby_json" });
  });

  test("NEARBY all and NEARBY_JSON all", () => {
    expect(parseIpcCommand("NEARBY all")).toEqual({
      all: true,
      type: "nearby",
    });
    expect(parseIpcCommand("NEARBY_JSON all")).toEqual({
      all: true,
      type: "nearby_json",
    });
  });

  test("CONTROL and CONTROL_JSON", () => {
    expect(parseIpcCommand("CONTROL")).toEqual({ type: "control" });
    expect(parseIpcCommand("CONTROL_JSON")).toEqual({ type: "control_json" });
  });

  test("MOVE defaults to 1000ms", () => {
    expect(parseIpcCommand("MOVE forward")).toEqual({
      direction: "forward",
      durationMs: 1000,
      type: "move",
    });
  });

  test("MOVE accepts duration bounds", () => {
    expect(parseIpcCommand("MOVE backward 1")).toEqual({
      direction: "backward",
      durationMs: 1,
      type: "move",
    });
    expect(parseIpcCommand("MOVE left 10000")).toEqual({
      direction: "left",
      durationMs: 10_000,
      type: "move",
    });
  });

  test("MOVE rejects malformed and out-of-range args", () => {
    expect(parseIpcCommand("MOVE")).toEqual({
      reason: "invalid move",
      type: "invalid",
    });
    expect(parseIpcCommand("MOVE up")).toEqual({
      reason: "invalid direction",
      type: "invalid",
    });
    expect(parseIpcCommand("MOVE forward 0")).toEqual({
      reason: "invalid duration",
      type: "invalid",
    });
    expect(parseIpcCommand("MOVE forward 10001")).toEqual({
      reason: "invalid duration",
      type: "invalid",
    });
    expect(parseIpcCommand("MOVE forward 1.5")).toEqual({
      reason: "invalid duration",
      type: "invalid",
    });
    expect(parseIpcCommand("MOVE forward Infinity")).toEqual({
      reason: "invalid duration",
      type: "invalid",
    });
  });

  test("FACE accepts finite radians", () => {
    expect(parseIpcCommand("FACE 1.57")).toEqual({
      orientation: 1.57,
      type: "face",
    });
    expect(parseIpcCommand("FACE 0")).toEqual({
      orientation: 0,
      type: "face",
    });
  });

  test("FACE rejects nonfinite and missing", () => {
    expect(parseIpcCommand("FACE")?.type).toBe("invalid");
    expect(parseIpcCommand("FACE NaN")?.type).toBe("invalid");
    expect(parseIpcCommand("FACE Infinity")?.type).toBe("invalid");
    expect(parseIpcCommand("FACE 1 2")?.type).toBe("invalid");
  });

  test("FACE_GUID and WALK_TOWARD preserve typed destinations", () => {
    expect(parseIpcCommand("FACE_GUID 0x42")).toEqual({
      guid: 0x42n,
      type: "face_guid",
    });
    expect(parseIpcCommand("WALK_TOWARD 3 0x42")).toEqual({
      target: { guid: 0x42n, kind: "guid" },
      type: "walk_toward",
      yards: 3,
    });
    expect(parseIpcCommand("WALK_TOWARD 2.5 1 -2 3")).toEqual({
      target: { kind: "point", x: 1, y: -2, z: 3 },
      type: "walk_toward",
      yards: 2.5,
    });
    expect(parseIpcCommand("WALK_TOWARD 21 0x42")?.type).toBe("invalid");
    expect(parseIpcCommand("WALK_TOWARD 2 NaN 0 0")?.type).toBe("invalid");
  });

  test("TARGET accepts hex and decimal uint64", () => {
    expect(parseIpcCommand("TARGET 0x1")).toEqual({ guid: 1n, type: "target" });
    expect(parseIpcCommand("TARGET 0")).toEqual({ guid: 0n, type: "target" });
    expect(parseIpcCommand("TARGET 18446744073709551615")).toEqual({
      guid: 0xffff_ffff_ffff_ffffn,
      type: "target",
    });
  });

  test("TARGET rejects malformed guid", () => {
    expect(parseIpcCommand("TARGET")?.type).toBe("invalid");
    expect(parseIpcCommand("TARGET -1")?.type).toBe("invalid");
    expect(parseIpcCommand("TARGET 0x")?.type).toBe("invalid");
    expect(parseIpcCommand("TARGET 18446744073709551616")?.type).toBe(
      "invalid",
    );
  });

  test("HALT", () => {
    expect(parseIpcCommand("HALT")).toEqual({ type: "halt" });
  });

  test("CAST ATTACK FIGHT GOTO parse exact arity", () => {
    expect(parseIpcCommand("CAST 585 0xa")).toEqual({
      guid: 0xan,
      spellId: 585,
      type: "cast",
    });
    expect(parseIpcCommand("ATTACK 0xa")).toEqual({
      guid: 0xan,
      type: "attack",
    });
    expect(parseIpcCommand("FIGHT 0xa")).toEqual({
      guid: 0xan,
      instruction:
        "defeat the selected target while keeping the character alive",
      type: "fight",
    });
    expect(parseIpcCommand("FIGHT 0xa hold threat")).toEqual({
      guid: 0xan,
      instruction: "hold threat",
      type: "fight",
    });
    expect(parseIpcCommand("FIGHT --framing minimal 0xa")).toEqual({
      framing: "minimal",
      guid: 0xan,
      instruction:
        "defeat the selected target while keeping the character alive",
      type: "fight",
    });
    expect(
      parseIpcCommand("FIGHT --framing=mechanics 0xa conserve mana"),
    ).toEqual({
      framing: "mechanics",
      guid: 0xan,
      instruction: "conserve mana",
      type: "fight",
    });
    expect(parseIpcCommand("FIGHT --framing invalid 0xa")?.type).toBe(
      "invalid",
    );
    expect(parseIpcCommand("FIGHT --framing")?.type).toBe("invalid");
    expect(parseIpcCommand("CYCLE 0xa 0xb")).toEqual({
      guids: [0xan, 0xbn],
      instruction:
        "defeat the selected target while keeping the character alive",
      type: "cycle",
    });
    expect(parseIpcCommand("CYCLE 0xa --max 3")).toEqual({
      guids: [0xan],
      instruction:
        "defeat the selected target while keeping the character alive",
      maxStarts: 3,
      type: "cycle",
    });
    expect(
      parseIpcCommand("CYCLE 0xa 0xb --instruction hold aggro --max 5"),
    ).toEqual({
      guids: [0xan, 0xbn],
      instruction: "hold aggro",
      maxStarts: 5,
      type: "cycle",
    });
    expect(parseIpcCommand("CYCLE")?.type).toBe("invalid");
    expect(parseIpcCommand("CYCLE 0")?.type).toBe("invalid");
    expect(parseIpcCommand("CYCLE 0xa --max 0")?.type).toBe("invalid");
    expect(parseIpcCommand("CYCLING")).toEqual({ type: "cycling" });
    expect(parseIpcCommand("CYCLING_JSON")).toEqual({
      type: "cycling_json",
    });
    expect(parseIpcCommand("GOTO 1 2 3")).toEqual({
      type: "goto",
      x: 1,
      y: 2,
      z: 3,
    });
    expect(parseIpcCommand("CAST")?.type).toBe("invalid");
    expect(parseIpcCommand("CAST 0 0x1")?.type).toBe("invalid");
    expect(parseIpcCommand("GOTO 1 2")?.type).toBe("invalid");
    expect(parseIpcCommand("GOTO 1 2 Infinity")?.type).toBe("invalid");
    expect(parseIpcCommand("COMBAT")).toEqual({ type: "combat" });
    expect(parseIpcCommand("SPELLS_JSON")).toEqual({ type: "spells_json" });
  });

  test("slash /accept maps to accept", () => {
    expect(parseIpcCommand("/accept")).toEqual({ type: "accept" });
  });

  test("slash /say maps to say", () => {
    expect(parseIpcCommand("/say hello")).toEqual({
      message: "hello",
      type: "say",
    });
  });

  test("slash /whisper maps to whisper", () => {
    expect(parseIpcCommand("/whisper Xiara hi")).toEqual({
      message: "hi",
      target: "Xiara",
      type: "whisper",
    });
  });

  test("slash /emote maps to emote", () => {
    expect(parseIpcCommand("/emote waves")).toEqual({
      message: "waves",
      type: "emote",
    });
  });

  test("slash /dnd maps to dnd", () => {
    expect(parseIpcCommand("/dnd busy")).toEqual({
      message: "busy",
      type: "dnd",
    });
  });

  test("slash /afk maps to afk", () => {
    expect(parseIpcCommand("/afk brb")).toEqual({
      message: "brb",
      type: "afk",
    });
  });

  test("slash /who maps to who with filter", () => {
    expect(parseIpcCommand("/who mage")).toEqual({
      filter: "mage",
      type: "who",
    });
  });

  test("slash /who maps to who without filter", () => {
    expect(parseIpcCommand("/who")).toEqual({ type: "who" });
  });

  test("slash /invite maps to invite", () => {
    expect(parseIpcCommand("/invite Voidtrix")).toEqual({
      target: "Voidtrix",
      type: "invite",
    });
  });

  test("slash /kick maps to kick", () => {
    expect(parseIpcCommand("/kick Voidtrix")).toEqual({
      target: "Voidtrix",
      type: "kick",
    });
  });

  test("slash /leave maps to leave", () => {
    expect(parseIpcCommand("/leave")).toEqual({ type: "leave" });
  });

  test("slash /friends maps to friends", () => {
    expect(parseIpcCommand("/friends")).toEqual({ type: "friends" });
  });

  test("slash /ignore maps to add_ignore", () => {
    expect(parseIpcCommand("/ignore someone")).toEqual({
      target: "someone",
      type: "add_ignore",
    });
  });

  test("slash /ignore bare maps to ignored", () => {
    expect(parseIpcCommand("/ignore")).toEqual({ type: "ignored" });
  });

  test("slash /ignorelist maps to ignored", () => {
    expect(parseIpcCommand("/ignorelist")).toEqual({ type: "ignored" });
  });

  test("slash /unignore maps to del_ignore", () => {
    expect(parseIpcCommand("/unignore someone")).toEqual({
      target: "someone",
      type: "del_ignore",
    });
  });

  test("slash /join maps to join_channel", () => {
    expect(parseIpcCommand("/join Trade")).toEqual({
      channel: "Trade",
      type: "join_channel",
    });
  });

  test("slash /leave channel maps to leave_channel", () => {
    expect(parseIpcCommand("/leave Trade")).toEqual({
      channel: "Trade",
      type: "leave_channel",
    });
  });

  test("unknown slash command maps to say with full input", () => {
    expect(parseIpcCommand("/dance hello")).toEqual({
      message: "/dance hello",
      type: "say",
    });
  });

  test("slash command unsupported by daemon falls back to say", () => {
    expect(parseIpcCommand("/r hello")).toEqual({
      message: "/r hello",
      type: "say",
    });
  });

  test("INVITE with no target returns undefined", () => {
    expect(parseIpcCommand("INVITE")).toBeUndefined();
  });

  test("KICK with no target returns undefined", () => {
    expect(parseIpcCommand("KICK")).toBeUndefined();
  });

  test("LEADER with no target returns undefined", () => {
    expect(parseIpcCommand("LEADER")).toBeUndefined();
  });

  test("JOIN parses channel", () => {
    expect(parseIpcCommand("JOIN Trade")).toEqual({
      channel: "Trade",
      type: "join_channel",
    });
  });

  test("JOIN parses channel with password", () => {
    expect(parseIpcCommand("JOIN Secret hunter2")).toEqual({
      channel: "Secret",
      password: "hunter2",
      type: "join_channel",
    });
  });

  test("JOIN with no channel returns undefined", () => {
    expect(parseIpcCommand("JOIN")).toBeUndefined();
  });

  test("LEAVE with channel parses leave_channel", () => {
    expect(parseIpcCommand("LEAVE Trade")).toEqual({
      channel: "Trade",
      type: "leave_channel",
    });
  });

  test("LEAVE without channel parses leave", () => {
    expect(parseIpcCommand("LEAVE")).toEqual({ type: "leave" });
  });

  describe("unimplemented IPC commands", () => {
    const cases = [["MAIL", "Mail reading"]] as const;

    for (const [input, feature] of cases) {
      test(`${input.split(" ")[0]} returns unimplemented`, () => {
        expect(parseIpcCommand(input)).toEqual({
          feature,
          type: "unimplemented",
        });
      });
    }

    test("/mail slash path returns unimplemented", () => {
      expect(parseIpcCommand("/mail")).toEqual({
        feature: "Mail reading",
        type: "unimplemented",
      });
    });
  });

  test("unrecognized verb becomes chat", () => {
    expect(parseIpcCommand("DANCE")).toEqual({
      message: "DANCE",
      type: "chat",
    });
  });

  test("unrecognized text becomes chat command", () => {
    expect(parseIpcCommand("hello world")).toEqual({
      message: "hello world",
      type: "chat",
    });
  });

  test("single word becomes chat command", () => {
    expect(parseIpcCommand("hello")).toEqual({
      message: "hello",
      type: "chat",
    });
  });

  test("empty string returns undefined", () => {
    expect(parseIpcCommand("")).toBeUndefined();
  });

  test("READ_WAIT with empty argument returns undefined", () => {
    expect(parseIpcCommand("READ_WAIT")).toBeUndefined();
  });

  test("READ_WAIT with non-numeric argument returns undefined", () => {
    expect(parseIpcCommand("READ_WAIT abc")).toBeUndefined();
  });

  test("READ_WAIT with negative value returns undefined", () => {
    expect(parseIpcCommand("READ_WAIT -100")).toBeUndefined();
  });

  test("READ_WAIT clamps to 60000ms", () => {
    expect(parseIpcCommand("READ_WAIT 120000")).toEqual({
      ms: 60_000,
      type: "read_wait",
    });
  });

  test("READ_WAIT_JSON with empty argument returns undefined", () => {
    expect(parseIpcCommand("READ_WAIT_JSON")).toBeUndefined();
  });

  test("READ_WAIT_JSON clamps to 60000ms", () => {
    expect(parseIpcCommand("READ_WAIT_JSON 999999")).toEqual({
      ms: 60_000,
      type: "read_wait_json",
    });
  });

  test("FRIENDS", () => {
    expect(parseIpcCommand("FRIENDS")).toEqual({ type: "friends" });
  });

  test("FRIENDS_JSON", () => {
    expect(parseIpcCommand("FRIENDS_JSON")).toEqual({ type: "friends_json" });
  });

  test("ADD_FRIEND", () => {
    expect(parseIpcCommand("ADD_FRIEND Arthas")).toEqual({
      target: "Arthas",
      type: "add_friend",
    });
  });

  test("ADD_FRIEND with no target returns undefined", () => {
    expect(parseIpcCommand("ADD_FRIEND")).toBeUndefined();
  });

  test("DEL_FRIEND", () => {
    expect(parseIpcCommand("DEL_FRIEND Arthas")).toEqual({
      target: "Arthas",
      type: "del_friend",
    });
  });

  test("DEL_FRIEND with no target returns undefined", () => {
    expect(parseIpcCommand("DEL_FRIEND")).toBeUndefined();
  });

  test("slash /friend add maps to add_friend", () => {
    expect(parseIpcCommand("/friend add Arthas")).toEqual({
      target: "Arthas",
      type: "add_friend",
    });
  });

  test("slash /friend remove maps to del_friend", () => {
    expect(parseIpcCommand("/friend remove Arthas")).toEqual({
      target: "Arthas",
      type: "del_friend",
    });
  });

  test("IGNORED", () => {
    expect(parseIpcCommand("IGNORED")).toEqual({ type: "ignored" });
  });

  test("IGNORED_JSON", () => {
    expect(parseIpcCommand("IGNORED_JSON")).toEqual({ type: "ignored_json" });
  });

  test("ADD_IGNORE", () => {
    expect(parseIpcCommand("ADD_IGNORE Spammer")).toEqual({
      target: "Spammer",
      type: "add_ignore",
    });
  });

  test("ADD_IGNORE with no target returns undefined", () => {
    expect(parseIpcCommand("ADD_IGNORE")).toBeUndefined();
  });

  test("DEL_IGNORE", () => {
    expect(parseIpcCommand("DEL_IGNORE Spammer")).toEqual({
      target: "Spammer",
      type: "del_ignore",
    });
  });

  test("DEL_IGNORE with no target returns undefined", () => {
    expect(parseIpcCommand("DEL_IGNORE")).toBeUndefined();
  });

  test("GUILD_ROSTER", () => {
    expect(parseIpcCommand("GUILD_ROSTER")).toEqual({ type: "guild_roster" });
  });

  test("GUILD_ROSTER_JSON", () => {
    expect(parseIpcCommand("GUILD_ROSTER_JSON")).toEqual({
      type: "guild_roster_json",
    });
  });

  test("/groster", () => {
    expect(parseIpcCommand("/groster")).toEqual({ type: "guild_roster" });
  });

  test("GINVITE parses guild invite", () => {
    expect(parseIpcCommand("GINVITE Thrall")).toEqual({
      target: "Thrall",
      type: "guild_invite",
    });
  });

  test("GINVITE without target returns undefined", () => {
    expect(parseIpcCommand("GINVITE")).toBeUndefined();
  });

  test("GKICK parses guild kick", () => {
    expect(parseIpcCommand("GKICK Garrosh")).toEqual({
      target: "Garrosh",
      type: "guild_kick",
    });
  });

  test("GLEAVE parses guild leave", () => {
    expect(parseIpcCommand("GLEAVE")).toEqual({ type: "guild_leave" });
  });

  test("GPROMOTE parses guild promote", () => {
    expect(parseIpcCommand("GPROMOTE Jaina")).toEqual({
      target: "Jaina",
      type: "guild_promote",
    });
  });

  test("GDEMOTE parses guild demote", () => {
    expect(parseIpcCommand("GDEMOTE Arthas")).toEqual({
      target: "Arthas",
      type: "guild_demote",
    });
  });

  test("GLEADER parses guild leader", () => {
    expect(parseIpcCommand("GLEADER Sylvanas")).toEqual({
      target: "Sylvanas",
      type: "guild_leader",
    });
  });

  test("GMOTD parses guild motd", () => {
    expect(parseIpcCommand("GMOTD Raid tonight")).toEqual({
      message: "Raid tonight",
      type: "guild_motd",
    });
  });

  test("GMOTD with empty message clears motd", () => {
    expect(parseIpcCommand("GMOTD")).toEqual({
      message: "",
      type: "guild_motd",
    });
  });

  test("GACCEPT parses guild accept", () => {
    expect(parseIpcCommand("GACCEPT")).toEqual({ type: "guild_accept" });
  });

  test("GDECLINE parses guild decline", () => {
    expect(parseIpcCommand("GDECLINE")).toEqual({ type: "guild_decline" });
  });

  test("/ginvite via slash parses guild invite", () => {
    expect(parseIpcCommand("/ginvite Thrall")).toEqual({
      target: "Thrall",
      type: "guild_invite",
    });
  });

  test("/gaccept via slash parses guild accept", () => {
    expect(parseIpcCommand("/gaccept")).toEqual({ type: "guild_accept" });
  });

  test("/gdecline via slash parses guild decline", () => {
    expect(parseIpcCommand("/gdecline")).toEqual({ type: "guild_decline" });
  });

  test("/gkick via slash parses guild kick", () => {
    expect(parseIpcCommand("/gkick Garrosh")).toEqual({
      target: "Garrosh",
      type: "guild_kick",
    });
  });

  test("/gleave via slash parses guild leave", () => {
    expect(parseIpcCommand("/gleave")).toEqual({ type: "guild_leave" });
  });

  test("/gpromote via slash parses guild promote", () => {
    expect(parseIpcCommand("/gpromote Jaina")).toEqual({
      target: "Jaina",
      type: "guild_promote",
    });
  });

  test("/gdemote via slash parses guild demote", () => {
    expect(parseIpcCommand("/gdemote Arthas")).toEqual({
      target: "Arthas",
      type: "guild_demote",
    });
  });

  test("/gleader via slash parses guild leader", () => {
    expect(parseIpcCommand("/gleader Sylvanas")).toEqual({
      target: "Sylvanas",
      type: "guild_leader",
    });
  });

  test("/gmotd via slash parses guild motd", () => {
    expect(parseIpcCommand("/gmotd Raid tonight")).toEqual({
      message: "Raid tonight",
      type: "guild_motd",
    });
  });
});
