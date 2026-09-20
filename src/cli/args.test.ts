import { test, expect, describe } from "bun:test";
import { parseArgs } from "cli/args";

describe("parseArgs", () => {
  test("no args with tty = interactive", () => {
    expect(parseArgs([])).toEqual({ mode: "interactive" });
  });

  test("no args without tty = interactive", () => {
    expect(parseArgs([])).toEqual({ mode: "interactive" });
  });

  test("setup subcommand", () => {
    expect(parseArgs(["setup", "--account", "x"])).toEqual({
      mode: "setup",
      args: ["--account", "x"],
    });
  });

  test("stop subcommand", () => {
    expect(parseArgs(["stop"])).toEqual({ mode: "stop" });
  });

  test("status subcommand", () => {
    expect(parseArgs(["status"])).toEqual({ mode: "status" });
  });

  test("read subcommand", () => {
    expect(parseArgs(["read"])).toEqual({
      mode: "read",
      wait: undefined,
      json: false,
    });
  });

  test("read with --wait", () => {
    expect(parseArgs(["read", "--wait", "5"])).toEqual({
      mode: "read",
      wait: 5,
      json: false,
    });
  });

  test("read with --json", () => {
    expect(parseArgs(["read", "--json"])).toEqual({
      mode: "read",
      wait: undefined,
      json: true,
    });
  });

  test("tail subcommand", () => {
    expect(parseArgs(["tail"])).toEqual({
      mode: "tail",
      json: false,
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
      mode: "say",
      message: "hello world",
      json: false,
      wait: undefined,
    });
  });

  test("send -s = explicit say", () => {
    expect(parseArgs(["send", "-s", "hello"])).toEqual({
      mode: "say",
      message: "hello",
      json: false,
      wait: undefined,
    });
  });

  test("send with --json", () => {
    expect(parseArgs(["send", "--json", "hello"])).toEqual({
      mode: "say",
      message: "hello",
      json: true,
      wait: undefined,
    });
  });

  test("send slash command uses slash mode", () => {
    expect(parseArgs(["send", "/accept"])).toEqual({
      mode: "slash",
      input: "/accept",
      json: false,
      wait: undefined,
    });
  });

  test("send -w = whisper", () => {
    expect(parseArgs(["send", "-w", "Xiara", "follow me"])).toEqual({
      mode: "whisper",
      target: "Xiara",
      message: "follow me",
      json: false,
      wait: undefined,
    });
  });

  test("send -y = yell", () => {
    expect(parseArgs(["send", "-y", "HELLO"])).toEqual({
      mode: "yell",
      message: "HELLO",
      json: false,
      wait: undefined,
    });
  });

  test("send -g = guild", () => {
    expect(parseArgs(["send", "-g", "guild msg"])).toEqual({
      mode: "guild",
      message: "guild msg",
      json: false,
      wait: undefined,
    });
  });

  test("send -p = party", () => {
    expect(parseArgs(["send", "-p", "party msg"])).toEqual({
      mode: "party",
      message: "party msg",
      json: false,
      wait: undefined,
    });
  });

  test("send with --wait", () => {
    expect(parseArgs(["send", "hello", "--wait", "5"])).toEqual({
      mode: "say",
      message: "hello",
      json: false,
      wait: 5,
    });
  });

  test("send -y with --json", () => {
    expect(parseArgs(["send", "-y", "--json", "hello"])).toEqual({
      mode: "yell",
      message: "hello",
      json: true,
      wait: undefined,
    });
  });

  test("send -w with --wait and --json", () => {
    expect(
      parseArgs(["send", "-w", "Xiara", "los", "--wait", "3", "--json"]),
    ).toEqual({
      mode: "whisper",
      target: "Xiara",
      message: "los",
      json: true,
      wait: 3,
    });
  });

  test("-w flag = whisper", () => {
    expect(parseArgs(["-w", "Xiara", "follow me"])).toEqual({
      mode: "whisper",
      target: "Xiara",
      message: "follow me",
      json: false,
      wait: undefined,
    });
  });

  test("-y flag = yell", () => {
    expect(parseArgs(["-y", "HELLO"])).toEqual({
      mode: "yell",
      message: "HELLO",
      json: false,
      wait: undefined,
    });
  });

  test("-g flag = guild", () => {
    expect(parseArgs(["-g", "guild msg"])).toEqual({
      mode: "guild",
      message: "guild msg",
      json: false,
      wait: undefined,
    });
  });

  test("-p flag = party", () => {
    expect(parseArgs(["-p", "party msg"])).toEqual({
      mode: "party",
      message: "party msg",
      json: false,
      wait: undefined,
    });
  });

  test("who subcommand", () => {
    expect(parseArgs(["who"])).toEqual({
      mode: "who",
      filter: undefined,
      json: false,
    });
  });

  test("who with filter", () => {
    expect(parseArgs(["who", "mage"])).toEqual({
      mode: "who",
      filter: "mage",
      json: false,
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

  test("--json does not leak into yell message", () => {
    expect(parseArgs(["-y", "--json", "hello"])).toEqual({
      mode: "yell",
      message: "hello",
      json: true,
      wait: undefined,
    });
  });

  test("--json does not leak into guild message", () => {
    expect(parseArgs(["-g", "--json", "inv pls"])).toEqual({
      mode: "guild",
      message: "inv pls",
      json: true,
      wait: undefined,
    });
  });

  test("--json does not leak into party message", () => {
    expect(parseArgs(["-p", "--json", "pull now"])).toEqual({
      mode: "party",
      message: "pull now",
      json: true,
      wait: undefined,
    });
  });

  test("--json does not leak into whisper message", () => {
    expect(parseArgs(["-w", "Xiara", "--json", "hey"])).toEqual({
      mode: "whisper",
      target: "Xiara",
      message: "hey",
      json: true,
      wait: undefined,
    });
  });

  test("whisper with --wait", () => {
    expect(parseArgs(["-w", "Xiara", "los", "--wait", "3"])).toEqual({
      mode: "whisper",
      target: "Xiara",
      message: "los",
      json: false,
      wait: 3,
    });
  });

  test("yell with --wait", () => {
    expect(parseArgs(["-y", "hey", "--wait", "2"])).toEqual({
      mode: "yell",
      message: "hey",
      json: false,
      wait: 2,
    });
  });

  test("--wait does not leak into whisper message", () => {
    expect(parseArgs(["-w", "Xiara", "--wait", "3", "follow me"])).toEqual({
      mode: "whisper",
      target: "Xiara",
      message: "follow me",
      json: false,
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
      mode: "whisper",
      target: "Xiara",
      message: "los",
      json: false,
      wait: 0.1,
    });
  });

  test("whisper with --wait and --json", () => {
    expect(parseArgs(["-w", "Xiara", "los", "--wait", "3", "--json"])).toEqual({
      mode: "whisper",
      target: "Xiara",
      message: "los",
      json: true,
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
    expect(parseArgs(["control"])).toEqual({ mode: "control", json: false });
  });

  test("control --json", () => {
    expect(parseArgs(["control", "--json"])).toEqual({
      mode: "control",
      json: true,
    });
  });

  test("nearby subcommand", () => {
    expect(parseArgs(["nearby"])).toEqual({ mode: "nearby", json: false });
  });

  test("nearby --json", () => {
    expect(parseArgs(["nearby", "--json"])).toEqual({
      mode: "nearby",
      json: true,
    });
  });

  test("move defaults to 1000ms", () => {
    expect(parseArgs(["move", "forward"])).toEqual({
      mode: "move",
      direction: "forward",
      durationMs: 1000,
    });
  });

  test("move accepts duration in range", () => {
    expect(parseArgs(["move", "left", "2500"])).toEqual({
      mode: "move",
      direction: "left",
      durationMs: 2500,
    });
  });

  test("move rejects unknown direction without sending", () => {
    expect(() => parseArgs(["move", "up"])).toThrow("Invalid move direction");
  });

  test("move rejects nonfinite duration", () => {
    expect(() => parseArgs(["move", "forward", "1.5"])).toThrow(
      "Invalid move duration",
    );
  });

  test("move rejects duration below 1", () => {
    expect(() => parseArgs(["move", "forward", "0"])).toThrow(
      "Invalid move duration",
    );
  });

  test("move rejects duration above 10000", () => {
    expect(() => parseArgs(["move", "forward", "10001"])).toThrow(
      "Invalid move duration",
    );
  });

  test("face parses radians", () => {
    expect(parseArgs(["face", "1.57"])).toEqual({
      mode: "face",
      orientation: 1.57,
    });
  });

  test("face rejects nonfinite", () => {
    expect(() => parseArgs(["face", "NaN"])).toThrow("Invalid facing");
    expect(() => parseArgs(["face", "Infinity"])).toThrow("Invalid facing");
  });

  test("face rejects empty and whitespace before IPC", () => {
    expect(() => parseArgs(["face", ""])).toThrow("Invalid face arguments");
    expect(() => parseArgs(["face", "   "])).toThrow("Invalid face arguments");
  });

  test("target accepts hex and decimal uint64", () => {
    expect(parseArgs(["target", "0x1"])).toEqual({ mode: "target", guid: 1n });
    expect(parseArgs(["target", "0"])).toEqual({ mode: "target", guid: 0n });
    expect(parseArgs(["target", "18446744073709551615"])).toEqual({
      mode: "target",
      guid: 0xffff_ffff_ffff_ffffn,
    });
  });

  test("target rejects malformed guid", () => {
    expect(() => parseArgs(["target", "-1"])).toThrow("Invalid target guid");
    expect(() => parseArgs(["target", "0x"])).toThrow("Invalid target guid");
    expect(() => parseArgs(["target", "18446744073709551616"])).toThrow(
      "Invalid target guid",
    );
  });

  test("halt subcommand", () => {
    expect(parseArgs(["halt"])).toEqual({ mode: "halt" });
  });
});
