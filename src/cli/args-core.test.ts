import { describe, expect, test } from "bun:test";
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

  test("record takes an optional --since epoch millisecond bound", () => {
    expect(parseArgs(["record"])).toEqual({ mode: "record" });
    expect(parseArgs(["record", "--since", "1790382736199"])).toEqual({
      mode: "record",
      since: 1_790_382_736_199,
    });
    expect(() => parseArgs(["record", "--since"])).toThrow("invalid record");
    expect(() => parseArgs(["record", "--since", "-1"])).toThrow(
      "invalid record",
    );
    expect(() => parseArgs(["record", "--json"])).toThrow();
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

  test("unknown positional arg throws", () => {
    expect(() => parseArgs(["foo"])).toThrow("Unknown command");
  });

  test("unknown flag throws", () => {
    expect(() => parseArgs(["--foo"])).toThrow("Unknown command");
  });

  test("bare message without send throws", () => {
    expect(() => parseArgs(["hello world"])).toThrow("Unknown command");
  });
});
