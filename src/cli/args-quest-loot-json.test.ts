import { describe, expect, test } from "bun:test";
import { type CliAction, parseArgs } from "cli/args";

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

  test("use takes a uint8 bag and slot and nothing else", () => {
    expect(parseArgs(["use", "255", "29"])).toEqual({
      bag: 255,
      mode: "use",
      slot: 29,
    });
    expect(parseArgs(["use", "19", "0", "--json"])).toEqual({
      bag: 19,
      json: true,
      mode: "use",
      slot: 0,
    });
    for (const args of [
      ["use"],
      ["use", "255"],
      ["use", "256", "29"],
      ["use", "255", "256"],
      ["use", "255", "-1"],
      ["use", "255", "1.5"],
      ["use", "255", "29", "extra"],
    ])
      expect(() => parseArgs(args)).toThrow("invalid item slot");
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
