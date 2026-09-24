import { test, expect, describe } from "bun:test";
import { parseIpcCommand } from "daemon/parse";

describe("parseIpcCommand", () => {
  test("SAY", () => {
    expect(parseIpcCommand("SAY hello world")).toEqual({
      type: "say",
      message: "hello world",
    });
  });

  test("YELL", () => {
    expect(parseIpcCommand("YELL hey everyone")).toEqual({
      type: "yell",
      message: "hey everyone",
    });
  });

  test("GUILD", () => {
    expect(parseIpcCommand("GUILD inv pls")).toEqual({
      type: "guild",
      message: "inv pls",
    });
  });

  test("PARTY", () => {
    expect(parseIpcCommand("PARTY pull now")).toEqual({
      type: "party",
      message: "pull now",
    });
  });

  test("EMOTE", () => {
    expect(parseIpcCommand("EMOTE waves hello")).toEqual({
      type: "emote",
      message: "waves hello",
    });
  });

  test("DND", () => {
    expect(parseIpcCommand("DND busy right now")).toEqual({
      type: "dnd",
      message: "busy right now",
    });
  });

  test("DND without message", () => {
    expect(parseIpcCommand("DND")).toEqual({
      type: "dnd",
      message: "",
    });
  });

  test("AFK", () => {
    expect(parseIpcCommand("AFK grabbing coffee")).toEqual({
      type: "afk",
      message: "grabbing coffee",
    });
  });

  test("AFK without message", () => {
    expect(parseIpcCommand("AFK")).toEqual({
      type: "afk",
      message: "",
    });
  });

  test("ROLL defaults to 1-100", () => {
    expect(parseIpcCommand("ROLL")).toEqual({
      type: "roll",
      min: 1,
      max: 100,
    });
  });

  test("ROLL with max", () => {
    expect(parseIpcCommand("ROLL 50")).toEqual({
      type: "roll",
      min: 1,
      max: 50,
    });
  });

  test("ROLL with min and max", () => {
    expect(parseIpcCommand("ROLL 10 20")).toEqual({
      type: "roll",
      min: 10,
      max: 20,
    });
  });

  test("/roll via slash style", () => {
    expect(parseIpcCommand("/roll 50")).toEqual({
      type: "roll",
      min: 1,
      max: 50,
    });
  });

  test("WHISPER", () => {
    expect(parseIpcCommand("WHISPER Xiara follow me")).toEqual({
      type: "whisper",
      target: "Xiara",
      message: "follow me",
    });
  });

  test("WHISPER without message", () => {
    expect(parseIpcCommand("WHISPER Xiara")).toEqual({
      type: "whisper",
      target: "Xiara",
      message: "",
    });
  });

  test("READ", () => {
    expect(parseIpcCommand("READ")).toEqual({ type: "read" });
  });

  test("READ_WAIT", () => {
    expect(parseIpcCommand("READ_WAIT 3000")).toEqual({
      type: "read_wait",
      ms: 3000,
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
      type: "who",
      filter: "mage",
    });
  });

  test("READ_JSON", () => {
    expect(parseIpcCommand("READ_JSON")).toEqual({ type: "read_json" });
  });

  test("READ_WAIT_JSON", () => {
    expect(parseIpcCommand("READ_WAIT_JSON 2000")).toEqual({
      type: "read_wait_json",
      ms: 2000,
    });
  });

  test("WHO_JSON without filter", () => {
    expect(parseIpcCommand("WHO_JSON")).toEqual({ type: "who_json" });
  });

  test("WHO_JSON with filter", () => {
    expect(parseIpcCommand("WHO_JSON mage")).toEqual({
      type: "who_json",
      filter: "mage",
    });
  });

  test("INVITE", () => {
    expect(parseIpcCommand("INVITE Voidtrix")).toEqual({
      type: "invite",
      target: "Voidtrix",
    });
  });

  test("KICK", () => {
    expect(parseIpcCommand("KICK Voidtrix")).toEqual({
      type: "kick",
      target: "Voidtrix",
    });
  });

  test("LEAVE", () => {
    expect(parseIpcCommand("LEAVE")).toEqual({ type: "leave" });
  });

  test("LEADER", () => {
    expect(parseIpcCommand("LEADER Voidtrix")).toEqual({
      type: "leader",
      target: "Voidtrix",
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
      type: "nearby",
      all: true,
    });
    expect(parseIpcCommand("NEARBY_JSON all")).toEqual({
      type: "nearby_json",
      all: true,
    });
  });

  test("CONTROL and CONTROL_JSON", () => {
    expect(parseIpcCommand("CONTROL")).toEqual({ type: "control" });
    expect(parseIpcCommand("CONTROL_JSON")).toEqual({ type: "control_json" });
  });

  test("MOVE defaults to 1000ms", () => {
    expect(parseIpcCommand("MOVE forward")).toEqual({
      type: "move",
      direction: "forward",
      durationMs: 1000,
    });
  });

  test("MOVE accepts duration bounds", () => {
    expect(parseIpcCommand("MOVE backward 1")).toEqual({
      type: "move",
      direction: "backward",
      durationMs: 1,
    });
    expect(parseIpcCommand("MOVE left 10000")).toEqual({
      type: "move",
      direction: "left",
      durationMs: 10000,
    });
  });

  test("MOVE rejects malformed and out-of-range args", () => {
    expect(parseIpcCommand("MOVE")).toEqual({
      type: "invalid",
      reason: "invalid move",
    });
    expect(parseIpcCommand("MOVE up")).toEqual({
      type: "invalid",
      reason: "invalid direction",
    });
    expect(parseIpcCommand("MOVE forward 0")).toEqual({
      type: "invalid",
      reason: "invalid duration",
    });
    expect(parseIpcCommand("MOVE forward 10001")).toEqual({
      type: "invalid",
      reason: "invalid duration",
    });
    expect(parseIpcCommand("MOVE forward 1.5")).toEqual({
      type: "invalid",
      reason: "invalid duration",
    });
    expect(parseIpcCommand("MOVE forward Infinity")).toEqual({
      type: "invalid",
      reason: "invalid duration",
    });
  });

  test("FACE accepts finite radians", () => {
    expect(parseIpcCommand("FACE 1.57")).toEqual({
      type: "face",
      orientation: 1.57,
    });
    expect(parseIpcCommand("FACE 0")).toEqual({
      type: "face",
      orientation: 0,
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
      type: "face_guid",
      guid: 0x42n,
    });
    expect(parseIpcCommand("WALK_TOWARD 3 0x42")).toEqual({
      type: "walk_toward",
      yards: 3,
      target: { kind: "guid", guid: 0x42n },
    });
    expect(parseIpcCommand("WALK_TOWARD 2.5 1 -2 3")).toEqual({
      type: "walk_toward",
      yards: 2.5,
      target: { kind: "point", x: 1, y: -2, z: 3 },
    });
    expect(parseIpcCommand("WALK_TOWARD 21 0x42")?.type).toBe("invalid");
    expect(parseIpcCommand("WALK_TOWARD 2 NaN 0 0")?.type).toBe("invalid");
  });

  test("TARGET accepts hex and decimal uint64", () => {
    expect(parseIpcCommand("TARGET 0x1")).toEqual({ type: "target", guid: 1n });
    expect(parseIpcCommand("TARGET 0")).toEqual({ type: "target", guid: 0n });
    expect(parseIpcCommand("TARGET 18446744073709551615")).toEqual({
      type: "target",
      guid: 0xffff_ffff_ffff_ffffn,
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
      type: "cast",
      spellId: 585,
      guid: 0xan,
    });
    expect(parseIpcCommand("ATTACK 0xa")).toEqual({
      type: "attack",
      guid: 0xan,
    });
    expect(parseIpcCommand("FIGHT 0xa")).toEqual({
      type: "fight",
      guid: 0xan,
      instruction:
        "defeat the selected target while keeping the character alive",
    });
    expect(parseIpcCommand("FIGHT 0xa hold threat")).toEqual({
      type: "fight",
      guid: 0xan,
      instruction: "hold threat",
    });
    expect(parseIpcCommand("FIGHT --framing minimal 0xa")).toEqual({
      type: "fight",
      guid: 0xan,
      instruction:
        "defeat the selected target while keeping the character alive",
      framing: "minimal",
    });
    expect(
      parseIpcCommand("FIGHT --framing=mechanics 0xa conserve mana"),
    ).toEqual({
      type: "fight",
      guid: 0xan,
      instruction: "conserve mana",
      framing: "mechanics",
    });
    expect(parseIpcCommand("FIGHT --framing invalid 0xa")?.type).toBe(
      "invalid",
    );
    expect(parseIpcCommand("FIGHT --framing")?.type).toBe("invalid");
    expect(parseIpcCommand("CYCLE 0xa 0xb")).toEqual({
      type: "cycle",
      guids: [0xan, 0xbn],
      instruction:
        "defeat the selected target while keeping the character alive",
    });
    expect(parseIpcCommand("CYCLE 0xa --max 3")).toEqual({
      type: "cycle",
      guids: [0xan],
      instruction:
        "defeat the selected target while keeping the character alive",
      maxStarts: 3,
    });
    expect(
      parseIpcCommand("CYCLE 0xa 0xb --instruction hold aggro --max 5"),
    ).toEqual({
      type: "cycle",
      guids: [0xan, 0xbn],
      instruction: "hold aggro",
      maxStarts: 5,
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
      type: "say",
      message: "hello",
    });
  });

  test("slash /whisper maps to whisper", () => {
    expect(parseIpcCommand("/whisper Xiara hi")).toEqual({
      type: "whisper",
      target: "Xiara",
      message: "hi",
    });
  });

  test("slash /emote maps to emote", () => {
    expect(parseIpcCommand("/emote waves")).toEqual({
      type: "emote",
      message: "waves",
    });
  });

  test("slash /dnd maps to dnd", () => {
    expect(parseIpcCommand("/dnd busy")).toEqual({
      type: "dnd",
      message: "busy",
    });
  });

  test("slash /afk maps to afk", () => {
    expect(parseIpcCommand("/afk brb")).toEqual({
      type: "afk",
      message: "brb",
    });
  });

  test("slash /who maps to who with filter", () => {
    expect(parseIpcCommand("/who mage")).toEqual({
      type: "who",
      filter: "mage",
    });
  });

  test("slash /who maps to who without filter", () => {
    expect(parseIpcCommand("/who")).toEqual({ type: "who" });
  });

  test("slash /invite maps to invite", () => {
    expect(parseIpcCommand("/invite Voidtrix")).toEqual({
      type: "invite",
      target: "Voidtrix",
    });
  });

  test("slash /kick maps to kick", () => {
    expect(parseIpcCommand("/kick Voidtrix")).toEqual({
      type: "kick",
      target: "Voidtrix",
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
      type: "add_ignore",
      target: "someone",
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
      type: "del_ignore",
      target: "someone",
    });
  });

  test("slash /join maps to join_channel", () => {
    expect(parseIpcCommand("/join Trade")).toEqual({
      type: "join_channel",
      channel: "Trade",
    });
  });

  test("slash /leave channel maps to leave_channel", () => {
    expect(parseIpcCommand("/leave Trade")).toEqual({
      type: "leave_channel",
      channel: "Trade",
    });
  });

  test("unknown slash command maps to say with full input", () => {
    expect(parseIpcCommand("/dance hello")).toEqual({
      type: "say",
      message: "/dance hello",
    });
  });

  test("slash command unsupported by daemon falls back to say", () => {
    expect(parseIpcCommand("/r hello")).toEqual({
      type: "say",
      message: "/r hello",
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
      type: "join_channel",
      channel: "Trade",
    });
  });

  test("JOIN parses channel with password", () => {
    expect(parseIpcCommand("JOIN Secret hunter2")).toEqual({
      type: "join_channel",
      channel: "Secret",
      password: "hunter2",
    });
  });

  test("JOIN with no channel returns undefined", () => {
    expect(parseIpcCommand("JOIN")).toBeUndefined();
  });

  test("LEAVE with channel parses leave_channel", () => {
    expect(parseIpcCommand("LEAVE Trade")).toEqual({
      type: "leave_channel",
      channel: "Trade",
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
          type: "unimplemented",
          feature,
        });
      });
    }

    test("/mail slash path returns unimplemented", () => {
      expect(parseIpcCommand("/mail")).toEqual({
        type: "unimplemented",
        feature: "Mail reading",
      });
    });
  });

  test("unrecognized verb becomes chat", () => {
    expect(parseIpcCommand("DANCE")).toEqual({
      type: "chat",
      message: "DANCE",
    });
  });

  test("unrecognized text becomes chat command", () => {
    expect(parseIpcCommand("hello world")).toEqual({
      type: "chat",
      message: "hello world",
    });
  });

  test("single word becomes chat command", () => {
    expect(parseIpcCommand("hello")).toEqual({
      type: "chat",
      message: "hello",
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
      type: "read_wait",
      ms: 60_000,
    });
  });

  test("READ_WAIT_JSON with empty argument returns undefined", () => {
    expect(parseIpcCommand("READ_WAIT_JSON")).toBeUndefined();
  });

  test("READ_WAIT_JSON clamps to 60000ms", () => {
    expect(parseIpcCommand("READ_WAIT_JSON 999999")).toEqual({
      type: "read_wait_json",
      ms: 60_000,
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
      type: "add_friend",
      target: "Arthas",
    });
  });

  test("ADD_FRIEND with no target returns undefined", () => {
    expect(parseIpcCommand("ADD_FRIEND")).toBeUndefined();
  });

  test("DEL_FRIEND", () => {
    expect(parseIpcCommand("DEL_FRIEND Arthas")).toEqual({
      type: "del_friend",
      target: "Arthas",
    });
  });

  test("DEL_FRIEND with no target returns undefined", () => {
    expect(parseIpcCommand("DEL_FRIEND")).toBeUndefined();
  });

  test("slash /friend add maps to add_friend", () => {
    expect(parseIpcCommand("/friend add Arthas")).toEqual({
      type: "add_friend",
      target: "Arthas",
    });
  });

  test("slash /friend remove maps to del_friend", () => {
    expect(parseIpcCommand("/friend remove Arthas")).toEqual({
      type: "del_friend",
      target: "Arthas",
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
      type: "add_ignore",
      target: "Spammer",
    });
  });

  test("ADD_IGNORE with no target returns undefined", () => {
    expect(parseIpcCommand("ADD_IGNORE")).toBeUndefined();
  });

  test("DEL_IGNORE", () => {
    expect(parseIpcCommand("DEL_IGNORE Spammer")).toEqual({
      type: "del_ignore",
      target: "Spammer",
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
      type: "guild_invite",
      target: "Thrall",
    });
  });

  test("GINVITE without target returns undefined", () => {
    expect(parseIpcCommand("GINVITE")).toBeUndefined();
  });

  test("GKICK parses guild kick", () => {
    expect(parseIpcCommand("GKICK Garrosh")).toEqual({
      type: "guild_kick",
      target: "Garrosh",
    });
  });

  test("GLEAVE parses guild leave", () => {
    expect(parseIpcCommand("GLEAVE")).toEqual({ type: "guild_leave" });
  });

  test("GPROMOTE parses guild promote", () => {
    expect(parseIpcCommand("GPROMOTE Jaina")).toEqual({
      type: "guild_promote",
      target: "Jaina",
    });
  });

  test("GDEMOTE parses guild demote", () => {
    expect(parseIpcCommand("GDEMOTE Arthas")).toEqual({
      type: "guild_demote",
      target: "Arthas",
    });
  });

  test("GLEADER parses guild leader", () => {
    expect(parseIpcCommand("GLEADER Sylvanas")).toEqual({
      type: "guild_leader",
      target: "Sylvanas",
    });
  });

  test("GMOTD parses guild motd", () => {
    expect(parseIpcCommand("GMOTD Raid tonight")).toEqual({
      type: "guild_motd",
      message: "Raid tonight",
    });
  });

  test("GMOTD with empty message clears motd", () => {
    expect(parseIpcCommand("GMOTD")).toEqual({
      type: "guild_motd",
      message: "",
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
      type: "guild_invite",
      target: "Thrall",
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
      type: "guild_kick",
      target: "Garrosh",
    });
  });

  test("/gleave via slash parses guild leave", () => {
    expect(parseIpcCommand("/gleave")).toEqual({ type: "guild_leave" });
  });

  test("/gpromote via slash parses guild promote", () => {
    expect(parseIpcCommand("/gpromote Jaina")).toEqual({
      type: "guild_promote",
      target: "Jaina",
    });
  });

  test("/gdemote via slash parses guild demote", () => {
    expect(parseIpcCommand("/gdemote Arthas")).toEqual({
      type: "guild_demote",
      target: "Arthas",
    });
  });

  test("/gleader via slash parses guild leader", () => {
    expect(parseIpcCommand("/gleader Sylvanas")).toEqual({
      type: "guild_leader",
      target: "Sylvanas",
    });
  });

  test("/gmotd via slash parses guild motd", () => {
    expect(parseIpcCommand("/gmotd Raid tonight")).toEqual({
      type: "guild_motd",
      message: "Raid tonight",
    });
  });
});
