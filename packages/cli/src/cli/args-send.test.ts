import { describe, expect, test } from "bun:test";
import { parseArgs } from "#cli/args";

describe("parseArgs", () => {
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
});
