import { describe, expect, test } from "bun:test";
import { type CliAction, parseArgs } from "cli/args";

describe("parseArgs", () => {
  test("no args with tty = interactive", () => {
    expect(parseArgs([])).toEqual({ mode: "interactive" });
  });

  test("no args without tty = interactive", () => {
    expect(parseArgs([])).toEqual({ mode: "interactive" });
  });

  test("setup subcommand", () => {
    expect(parseArgs(["setup", "--account", "x"])).toEqual({
      args: ["--account", "x"],
      mode: "setup",
    });
  });

  test("stop subcommand", () => {
    expect(parseArgs(["stop"])).toEqual({ mode: "stop" });
  });

  test("status subcommand", () => {
    expect(parseArgs(["status"])).toEqual({ mode: "status" });
  });

  test("start subcommand", () => {
    expect(parseArgs(["start"])).toEqual({ mode: "start" });
  });

  test("read subcommand", () => {
    expect(parseArgs(["read"])).toEqual({
      json: false,
      mode: "read",
      wait: undefined,
    });
  });

  test("read with --wait", () => {
    expect(parseArgs(["read", "--wait", "5"])).toEqual({
      json: false,
      mode: "read",
      wait: 5,
    });
  });

  test("read with --json", () => {
    expect(parseArgs(["read", "--json"])).toEqual({
      json: true,
      mode: "read",
      wait: undefined,
    });
  });

  test("tail subcommand", () => {
    expect(parseArgs(["tail"])).toEqual({
      json: false,
      mode: "tail",
    });
  });

  test("logs subcommand", () => {
    expect(parseArgs(["logs"])).toEqual({ mode: "logs" });
  });

  test("help subcommand", () => {
    expect(parseArgs(["help"])).toEqual({ mode: "help" });
  });

  test("--help flag", () => {
    expect(parseArgs(["--help"])).toEqual({ mode: "help" });
  });

  test("-h flag", () => {
    expect(parseArgs(["-h"])).toEqual({ mode: "help" });
  });

  test("--version flag", () => {
    expect(parseArgs(["--version"])).toEqual({ mode: "version" });
  });

  test("version subcommand", () => {
    expect(parseArgs(["version"])).toEqual({ mode: "version" });
  });

  test("-v flag", () => {
    expect(parseArgs(["-v"])).toEqual({ mode: "version" });
  });

  test("send = say", () => {
    expect(parseArgs(["send", "hello world"])).toEqual({
      json: false,
      message: "hello world",
      mode: "say",
      wait: undefined,
    });
  });

  test("send -s = explicit say", () => {
    expect(parseArgs(["send", "-s", "hello"])).toEqual({
      json: false,
      message: "hello",
      mode: "say",
      wait: undefined,
    });
  });

  test("send with --json", () => {
    expect(parseArgs(["send", "--json", "hello"])).toEqual({
      json: true,
      message: "hello",
      mode: "say",
      wait: undefined,
    });
  });

  test("send slash command uses slash mode", () => {
    expect(parseArgs(["send", "/accept"])).toEqual({
      input: "/accept",
      json: false,
      mode: "slash",
      wait: undefined,
    });
  });

  test("send -w = whisper", () => {
    expect(parseArgs(["send", "-w", "Xiara", "follow me"])).toEqual({
      json: false,
      message: "follow me",
      mode: "whisper",
      target: "Xiara",
      wait: undefined,
    });
  });

  test("send -y = yell", () => {
    expect(parseArgs(["send", "-y", "HELLO"])).toEqual({
      json: false,
      message: "HELLO",
      mode: "yell",
      wait: undefined,
    });
  });

  test("send -g = guild", () => {
    expect(parseArgs(["send", "-g", "guild msg"])).toEqual({
      json: false,
      message: "guild msg",
      mode: "guild",
      wait: undefined,
    });
  });

  test("send -p = party", () => {
    expect(parseArgs(["send", "-p", "party msg"])).toEqual({
      json: false,
      message: "party msg",
      mode: "party",
      wait: undefined,
    });
  });

  test("send with --wait", () => {
    expect(parseArgs(["send", "hello", "--wait", "5"])).toEqual({
      json: false,
      message: "hello",
      mode: "say",
      wait: 5,
    });
  });

  test("send -y with --json", () => {
    expect(parseArgs(["send", "-y", "--json", "hello"])).toEqual({
      json: true,
      message: "hello",
      mode: "yell",
      wait: undefined,
    });
  });

  test("send -w with --wait and --json", () => {
    expect(
      parseArgs(["send", "-w", "Xiara", "los", "--wait", "3", "--json"]),
    ).toEqual({
      json: true,
      message: "los",
      mode: "whisper",
      target: "Xiara",
      wait: 3,
    });
  });

  test("-w flag = whisper", () => {
    expect(parseArgs(["-w", "Xiara", "follow me"])).toEqual({
      json: false,
      message: "follow me",
      mode: "whisper",
      target: "Xiara",
      wait: undefined,
    });
  });

  test("-y flag = yell", () => {
    expect(parseArgs(["-y", "HELLO"])).toEqual({
      json: false,
      message: "HELLO",
      mode: "yell",
      wait: undefined,
    });
  });

  test("-g flag = guild", () => {
    expect(parseArgs(["-g", "guild msg"])).toEqual({
      json: false,
      message: "guild msg",
      mode: "guild",
      wait: undefined,
    });
  });

  test("-p flag = party", () => {
    expect(parseArgs(["-p", "party msg"])).toEqual({
      json: false,
      message: "party msg",
      mode: "party",
      wait: undefined,
    });
  });

  test("who subcommand", () => {
    expect(parseArgs(["who"])).toEqual({
      filter: undefined,
      json: false,
      mode: "who",
    });
  });

  test("who with filter", () => {
    expect(parseArgs(["who", "mage"])).toEqual({
      filter: "mage",
      json: false,
      mode: "who",
    });
  });

  test("--daemon flag", () => {
    expect(parseArgs(["--daemon"])).toEqual({ mode: "daemon" });
  });

  test("--wait with invalid value throws", () => {
    expect(() => parseArgs(["read", "--wait", "abc"])).toThrow(
      "Invalid --wait value: abc",
    );
  });

  test("rejects --json where --wait requires a value", () => {
    expect(() => parseArgs(["send", "hi", "--wait", "--json"])).toThrow();
  });

  test("--json does not leak into yell message", () => {
    expect(parseArgs(["-y", "--json", "hello"])).toEqual({
      json: true,
      message: "hello",
      mode: "yell",
      wait: undefined,
    });
  });

  test("--json does not leak into guild message", () => {
    expect(parseArgs(["-g", "--json", "inv pls"])).toEqual({
      json: true,
      message: "inv pls",
      mode: "guild",
      wait: undefined,
    });
  });

  test("--json does not leak into party message", () => {
    expect(parseArgs(["-p", "--json", "pull now"])).toEqual({
      json: true,
      message: "pull now",
      mode: "party",
      wait: undefined,
    });
  });

  test("--json does not leak into whisper message", () => {
    expect(parseArgs(["-w", "Xiara", "--json", "hey"])).toEqual({
      json: true,
      message: "hey",
      mode: "whisper",
      target: "Xiara",
      wait: undefined,
    });
  });

  test("whisper with --wait", () => {
    expect(parseArgs(["-w", "Xiara", "los", "--wait", "3"])).toEqual({
      json: false,
      message: "los",
      mode: "whisper",
      target: "Xiara",
      wait: 3,
    });
  });

  test("yell with --wait", () => {
    expect(parseArgs(["-y", "hey", "--wait", "2"])).toEqual({
      json: false,
      message: "hey",
      mode: "yell",
      wait: 2,
    });
  });

  test("--wait does not leak into whisper message", () => {
    expect(parseArgs(["-w", "Xiara", "--wait", "3", "follow me"])).toEqual({
      json: false,
      message: "follow me",
      mode: "whisper",
      target: "Xiara",
      wait: 3,
    });
  });

  test("--wait with invalid value throws on send commands", () => {
    expect(() => parseArgs(["-w", "Xiara", "hi", "--wait", "abc"])).toThrow(
      "Invalid --wait value: abc",
    );
  });

  test("fractional --wait", () => {
    expect(parseArgs(["-w", "Xiara", "los", "--wait", "0.1"])).toEqual({
      json: false,
      message: "los",
      mode: "whisper",
      target: "Xiara",
      wait: 0.1,
    });
  });

  test("whisper with --wait and --json", () => {
    expect(parseArgs(["-w", "Xiara", "los", "--wait", "3", "--json"])).toEqual({
      json: true,
      message: "los",
      mode: "whisper",
      target: "Xiara",
      wait: 3,
    });
  });

  test("unknown positional arg throws", () => {
    expect(() => parseArgs(["foo"])).toThrow("Unknown command");
  });

  test("unknown flag throws", () => {
    expect(() => parseArgs(["--foo"])).toThrow("Unknown command");
  });

  test("bare message without send throws", () => {
    expect(() => parseArgs(["hello world"])).toThrow("Unknown command");
  });

  test("control subcommand", () => {
    expect(parseArgs(["control"])).toEqual({ json: false, mode: "control" });
  });

  test("control --json", () => {
    expect(parseArgs(["control", "--json"])).toEqual({
      json: true,
      mode: "control",
    });
  });

  test("nearby subcommand", () => {
    expect(parseArgs(["nearby"])).toEqual({ json: false, mode: "nearby" });
  });

  test("nearby --json", () => {
    expect(parseArgs(["nearby", "--json"])).toEqual({
      json: true,
      mode: "nearby",
    });
  });

  test("nearby --all", () => {
    expect(parseArgs(["nearby", "--all"])).toEqual({
      all: true,
      json: false,
      mode: "nearby",
    });
  });

  test("nearby --all --json", () => {
    expect(parseArgs(["nearby", "--all", "--json"])).toEqual({
      all: true,
      json: true,
      mode: "nearby",
    });
  });

  test("move defaults to 1000ms", () => {
    expect(parseArgs(["move", "forward"])).toEqual({
      direction: "forward",
      durationMs: 1000,
      mode: "move",
    });
  });

  test("move accepts duration in range", () => {
    expect(parseArgs(["move", "left", "2500"])).toEqual({
      direction: "left",
      durationMs: 2500,
      mode: "move",
    });
  });

  test("face parses radians", () => {
    expect(parseArgs(["face", "1.57"])).toEqual({
      mode: "face",
      orientation: 1.57,
    });
  });

  test("face-guid preserves a current entity GUID", () => {
    expect(parseArgs(["face-guid", "0xffffffffffffffff"])).toEqual({
      guid: 0xffff_ffff_ffff_ffffn,
      mode: "face_guid",
    });
    expect(() => parseArgs(["face-guid", "0"])).toThrow();
  });

  test("walk-toward accepts a bounded observed GUID or grounded point", () => {
    expect(parseArgs(["walk-toward", "3", "0x42"])).toEqual({
      mode: "walk_toward",
      target: { guid: 0x42n, kind: "guid" },
      yards: 3,
    });
    expect(parseArgs(["walk-toward", "2.5", "1", "-2", "3"])).toEqual({
      mode: "walk_toward",
      target: { kind: "point", x: 1, y: -2, z: 3 },
      yards: 2.5,
    });
    expect(() => parseArgs(["walk-toward", "21", "0x42"])).toThrow();
    expect(() => parseArgs(["walk-toward", "2", "NaN", "0", "0"])).toThrow();
  });

  test("target accepts hex and decimal uint64", () => {
    expect(parseArgs(["target", "0x1"])).toEqual({ guid: 1n, mode: "target" });
    expect(parseArgs(["target", "0"])).toEqual({ guid: 0n, mode: "target" });
    expect(parseArgs(["target", "18446744073709551615"])).toEqual({
      guid: 0xffff_ffff_ffff_ffffn,
      mode: "target",
    });
  });

  test("halt subcommand", () => {
    expect(parseArgs(["halt"])).toEqual({ mode: "halt" });
  });

  test("cast attack fight goto parse and reject", () => {
    expect(parseArgs(["cast", "585", "0xa"])).toEqual({
      guid: 0xan,
      mode: "cast",
      spellId: 585,
    });
    expect(parseArgs(["fight", "0xa"])).toEqual({
      framing: "none",
      guid: 0xan,
      instruction:
        "defeat the selected target while keeping the character alive",
      mode: "fight",
    });
    expect(parseArgs(["fight", "--framing", "minimal", "0xa"])).toEqual({
      framing: "minimal",
      guid: 0xan,
      instruction:
        "defeat the selected target while keeping the character alive",
      mode: "fight",
    });
    expect(
      parseArgs(["fight", "--framing=mechanics", "0xa", "hold threat"]),
    ).toEqual({
      framing: "mechanics",
      guid: 0xan,
      instruction: "hold threat",
      mode: "fight",
    });
    expect(() => parseArgs(["fight", "--framing", "bogus", "0xa"])).toThrow(
      'Unknown framing variant: "bogus". Must be one of: none, minimal, mechanics',
    );
    expect(() => parseArgs(["fight", "--framing"])).toThrow(
      "missing framing variant",
    );
    expect(parseArgs(["goto", "1.5", "2", "3"])).toEqual({
      mode: "goto",
      x: 1.5,
      y: 2,
      z: 3,
    });
    expect(() => parseArgs(["cast", "585"])).toThrow("invalid cast");
    expect(() => parseArgs(["goto", "1", "2", "NaN"])).toThrow("invalid goto");
    expect(() => parseArgs(["fight"])).toThrow("invalid fight");
    expect(parseArgs(["combat", "--json"])).toEqual({
      json: true,
      mode: "combat",
    });
  });
});

describe("cycle arguments", () => {
  test("parses guid queue, instruction and max starts", () => {
    expect(parseArgs(["cycle", "0xa", "0xb", "--max", "3"])).toEqual({
      guids: [0xan, 0xbn],
      instruction:
        "defeat the selected target while keeping the character alive",
      maxStarts: 3,
      mode: "cycle",
    });
    expect(parseArgs(["cycle", "0xa", "--instruction", "kill fast"])).toEqual({
      guids: [0xan],
      instruction: "kill fast",
      mode: "cycle",
    });
    expect(
      parseArgs([
        "cycle",
        "0xa",
        "0xb",
        "--instruction",
        "hold aggro",
        "--max",
        "5",
      ]),
    ).toEqual({
      guids: [0xan, 0xbn],
      instruction: "hold aggro",
      maxStarts: 5,
      mode: "cycle",
    });
    expect(parseArgs(["cycling", "--json"])).toEqual({
      json: true,
      mode: "cycling",
    });
  });

  test("rejects missing guids, invalid guids and non-positive max", () => {
    expect(() => parseArgs(["cycle"])).toThrow("invalid cycle");
    expect(() => parseArgs(["cycle", "0"])).toThrow("invalid guid");
    expect(() => parseArgs(["cycle", "0xa", "--max", "0"])).toThrow(
      "invalid cycle max",
    );
    expect(() => parseArgs(["cycle", "0xa", "--max", "-1"])).toThrow(
      "invalid cycle max",
    );
    expect(() => parseArgs(["cycle", "0xa", "--max"])).toThrow(
      "invalid cycle max",
    );
  });

  test("rejects multiline cycle instructions", () => {
    expect(() =>
      parseArgs(["cycle", "0xa", "--instruction", "line1\nline2"]),
    ).toThrow("instruction must not contain line breaks");
  });
});

describe("recovery arguments", () => {
  test("parses inspection and explicit resurrection decisions", () => {
    expect(parseArgs(["recovery", "--json"])).toEqual({
      json: true,
      mode: "recovery",
    });
    expect(parseArgs(["query-corpse"])).toEqual({ mode: "query_corpse" });
    expect(parseArgs(["release-spirit"])).toEqual({ mode: "release_spirit" });
    expect(parseArgs(["reclaim-corpse"])).toEqual({ mode: "reclaim_corpse" });
    expect(parseArgs(["resurrect", "accept"])).toEqual({
      accept: true,
      mode: "resurrect",
    });
    expect(parseArgs(["resurrect", "decline"])).toEqual({
      accept: false,
      mode: "resurrect",
    });
  });

  test("rejects implicit resurrection decisions and extra action arguments", () => {
    for (const args of [
      ["resurrect"],
      ["resurrect", "yes"],
      ["resurrect", "accept", "extra"],
      ["query-corpse", "1"],
      ["release-spirit", "1"],
      ["reclaim-corpse", "0x1"],
    ])
      expect(() => parseArgs(args)).toThrow();
  });

  test("parses an explicit spirit-healer GUID and rejects bare or zero GUIDs", () => {
    expect(parseArgs(["spirit-healer", "0xa"])).toEqual({
      guid: 10n,
      mode: "spirit_healer",
    });
    for (const args of [
      ["spirit-healer"],
      ["spirit-healer", "0"],
      ["spirit-healer", "0xa", "extra"],
    ])
      expect(() => parseArgs(args)).toThrow();
  });
});

describe("quest arguments", () => {
  test("distinguishes absent and empty gossip code without concatenating arguments", () => {
    expect(parseArgs(["select-option", "0"])).toEqual({
      code: undefined,
      mode: "select_option",
      optionId: 0,
    });
    expect(parseArgs(["select-option", "0", ""])).toEqual({
      code: "",
      mode: "select_option",
      optionId: 0,
    });
    const code = "  two words\nHALT\r\n  ";
    expect(parseArgs(["select-option", "4294967295", code])).toEqual({
      code,
      mode: "select_option",
      optionId: 0xff_ff_ff_ff,
    });
    expect(() => parseArgs(["select-option", "0", "one", "two"])).toThrow();
    expect(() => parseArgs(["select-option", "0", "bad\0code"])).toThrow();
  });

  test("preserves GUID precision and uses zero-based reward and log slots", () => {
    expect(parseArgs(["talk", "18446744073709551615"])).toEqual({
      guid: 0xffff_ffff_ffff_ffffn,
      mode: "talk",
    });
    expect(parseArgs(["query-quest", "4294967295"])).toEqual({
      mode: "query_quest",
      questId: 0xff_ff_ff_ff,
    });
    expect(parseArgs(["choose-reward", "0"])).toEqual({
      index: 0,
      mode: "choose_reward",
    });
    expect(parseArgs(["abandon-quest", "24"])).toEqual({
      mode: "abandon_quest",
      slot: 24,
    });
    expect(parseArgs(["quests", "--json"])).toEqual({
      json: true,
      mode: "quests",
    });
  });

  test("rejects out-of-range IDs, slots and unexpected action arguments", () => {
    for (const args of [
      ["talk", "0"],
      ["query-quest", "0"],
      ["select-quest", "4294967296"],
      ["complete-quest", "1.5"],
      ["select-option", "-1"],
      ["choose-reward", "6"],
      ["abandon-quest", "25"],
      ["accept-quest", "1"],
      ["request-reward", "0"],
      ["cancel-interaction", "force"],
    ])
      expect(() => parseArgs(args)).toThrow();
  });
});

describe("loot arguments", () => {
  test("preserves creature GUID precision and the uint8 offered-slot boundary", () => {
    expect(parseArgs(["open-loot", "18446744073709551615"])).toEqual({
      guid: 0xffff_ffff_ffff_ffffn,
      mode: "open_loot",
    });
    expect(parseArgs(["take-loot", "0"])).toEqual({
      mode: "take_loot",
      slot: 0,
    });
    expect(parseArgs(["take-loot", "255"])).toEqual({
      mode: "take_loot",
      slot: 255,
    });
    expect(parseArgs(["inventory", "--json"])).toEqual({
      json: true,
      mode: "inventory",
    });
    expect(parseArgs(["loot", "--json"])).toEqual({ json: true, mode: "loot" });
  });

  test("rejects invalid loot targets, slots and extra mutation arguments", () => {
    for (const args of [
      ["open-loot"],
      ["open-loot", "0"],
      ["open-loot", "18446744073709551616"],
      ["open-loot", "1", "extra"],
      ["take-loot", "-1"],
      ["take-loot", "256"],
      ["take-loot", "1.5"],
      ["take-loot", "NaN"],
      ["take-money", "1"],
      ["release-loot", "1"],
    ])
      expect(() => parseArgs(args)).toThrow();
  });
});

describe("daemon JSON arguments", () => {
  const actions = [
    [["start"], { mode: "start" }],
    [["status"], { mode: "status" }],
    [["stop"], { mode: "stop" }],
    [
      ["move", "left", "250"],
      { direction: "left", durationMs: 250, mode: "move" },
    ],
    [["face", "1.57"], { mode: "face", orientation: 1.57 }],
    [["target", "0xa"], { guid: 10n, mode: "target" }],
    [["halt"], { mode: "halt" }],
    [["cast", "585", "0xa"], { guid: 10n, mode: "cast", spellId: 585 }],
    [["attack", "0xa"], { guid: 10n, mode: "attack" }],
    [["cancel-cast"], { mode: "cancel_cast" }],
    [["stop-attack"], { mode: "stop_attack" }],
    [
      ["fight", "--framing", "minimal", "0xa", "hold threat"],
      {
        framing: "minimal",
        guid: 10n,
        instruction: "hold threat",
        mode: "fight",
      },
    ],
    [
      ["cycle", "0xa", "0xb", "--max", "3", "--instruction", "hold threat"],
      {
        guids: [10n, 11n],
        instruction: "hold threat",
        maxStarts: 3,
        mode: "cycle",
      },
    ],
    [["goto", "1.5", "2", "3"], { mode: "goto", x: 1.5, y: 2, z: 3 }],
    [["query-corpse"], { mode: "query_corpse" }],
    [["release-spirit"], { mode: "release_spirit" }],
    [["reclaim-corpse"], { mode: "reclaim_corpse" }],
    [["spirit-healer", "0xa"], { guid: 10n, mode: "spirit_healer" }],
    [["resurrect", "accept"], { accept: true, mode: "resurrect" }],
    [["talk", "0xa"], { guid: 10n, mode: "talk" }],
    [["query-quest", "7"], { mode: "query_quest", questId: 7 }],
    [
      ["select-option", "0", "door"],
      { code: "door", mode: "select_option", optionId: 0 },
    ],
    [["select-quest", "7"], { mode: "select_quest", questId: 7 }],
    [["accept-quest"], { mode: "accept_quest" }],
    [["complete-quest", "7"], { mode: "complete_quest", questId: 7 }],
    [["request-reward"], { mode: "request_reward" }],
    [["choose-reward", "0"], { index: 0, mode: "choose_reward" }],
    [["abandon-quest", "24"], { mode: "abandon_quest", slot: 24 }],
    [["cancel-interaction"], { mode: "cancel_interaction" }],
    [["open-loot", "0xa"], { guid: 10n, mode: "open_loot" }],
    [["take-loot", "255"], { mode: "take_loot", slot: 255 }],
    [["take-money"], { mode: "take_money" }],
    [["release-loot"], { mode: "release_loot" }],
  ] satisfies [string[], CliAction][];

  for (const [args, action] of actions) {
    test(`${args[0]} keeps operands and adds JSON only when requested`, () => {
      expect(parseArgs([...args])).toEqual(action);
      expect(parseArgs([...args, "--json"])).toEqual({ ...action, json: true });
    });
  }

  test("removes JSON from fight instructions and positions before parsing", () => {
    expect(parseArgs(["fight", "--json", "0xa", "hold", "threat"])).toEqual({
      framing: "none",
      guid: 10n,
      instruction: "hold threat",
      json: true,
      mode: "fight",
    });
    expect(parseArgs(["goto", "1", "--json", "2", "3"])).toEqual({
      json: true,
      mode: "goto",
      x: 1,
      y: 2,
      z: 3,
    });
    expect(parseArgs(["move", "forward", "--json"])).toEqual({
      direction: "forward",
      durationMs: 1000,
      json: true,
      mode: "move",
    });
  });

  test("does not insert JSON into cycle instructions or chat aliases", () => {
    expect(
      parseArgs(["cycle", "0xa", "--instruction", "hold", "--json", "threat"]),
    ).toEqual({
      guids: [10n],
      instruction: "hold threat",
      json: true,
      mode: "cycle",
    });
    expect(parseArgs(["-w", "--json", "Xiara", "follow me"])).toEqual({
      json: true,
      message: "follow me",
      mode: "whisper",
      target: "Xiara",
      wait: undefined,
    });
  });

  test("rejects explicit JSON on unsupported modes", () => {
    for (const args of [
      ["help", "--json"],
      ["version", "--json"],
      ["logs", "--json"],
      ["skill", "--json"],
      ["--help", "--json"],
      ["--json", "-h"],
      ["--version", "--json"],
      ["--json", "-v"],
      ["--daemon", "--json"],
      ["setup", "--json"],
      ["setup", "--password", "secret", "--json"],
      ["--json"],
    ]) {
      expect(() => parseArgs(args)).toThrow();
    }
  });

  test("keeps setup password values equal to --json", () => {
    expect(parseArgs(["setup", "--password", "--json"])).toEqual({
      args: ["--password", "--json"],
      mode: "setup",
    });
    expect(
      parseArgs([
        "setup",
        "--account",
        "player",
        "--password",
        "--json",
        "--character",
        "Hero",
      ]),
    ).toEqual({
      args: [
        "--account",
        "player",
        "--password",
        "--json",
        "--character",
        "Hero",
      ],
      mode: "setup",
    });
    expect(() =>
      parseArgs(["setup", "--password", "--json", "--json"]),
    ).toThrow();
  });
});
