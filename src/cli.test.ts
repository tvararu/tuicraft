import { test, expect, describe } from "bun:test";
import { parseArgs } from "cli";

describe("parseArgs", () => {
  test("no args with tty = interactive", () => {
    expect(parseArgs([], true)).toEqual({ mode: "interactive" });
  });

  test("no args without tty = interactive", () => {
    expect(parseArgs([], false)).toEqual({ mode: "interactive" });
  });

  test("setup subcommand", () => {
    expect(parseArgs(["setup", "--account", "x"], false)).toEqual({
      mode: "setup",
      args: ["--account", "x"],
    });
  });

  test("stop subcommand", () => {
    expect(parseArgs(["stop"], false)).toEqual({ mode: "stop" });
  });

  test("status subcommand", () => {
    expect(parseArgs(["status"], false)).toEqual({ mode: "status" });
  });

  test("read subcommand", () => {
    expect(parseArgs(["read"], false)).toEqual({
      mode: "read",
      wait: undefined,
      json: false,
    });
  });

  test("read with --wait", () => {
    expect(parseArgs(["read", "--wait", "5"], false)).toEqual({
      mode: "read",
      wait: 5,
      json: false,
    });
  });

  test("read with --json", () => {
    expect(parseArgs(["read", "--json"], false)).toEqual({
      mode: "read",
      wait: undefined,
      json: true,
    });
  });

  test("tail subcommand", () => {
    expect(parseArgs(["tail"], false)).toEqual({
      mode: "tail",
      json: false,
    });
  });

  test("logs subcommand", () => {
    expect(parseArgs(["logs"], false)).toEqual({ mode: "logs" });
  });

  test("help subcommand", () => {
    expect(parseArgs(["help"], false)).toEqual({ mode: "help" });
  });

  test("--help flag", () => {
    expect(parseArgs(["--help"], false)).toEqual({ mode: "help" });
  });

  test("bare string = say", () => {
    expect(parseArgs(["hello world"], false)).toEqual({
      mode: "say",
      message: "hello world",
      json: false,
    });
  });

  test("-w flag = whisper", () => {
    expect(parseArgs(["-w", "Xiara", "follow me"], false)).toEqual({
      mode: "whisper",
      target: "Xiara",
      message: "follow me",
      json: false,
    });
  });

  test("-y flag = yell", () => {
    expect(parseArgs(["-y", "HELLO"], false)).toEqual({
      mode: "yell",
      message: "HELLO",
      json: false,
    });
  });

  test("-g flag = guild", () => {
    expect(parseArgs(["-g", "guild msg"], false)).toEqual({
      mode: "guild",
      message: "guild msg",
      json: false,
    });
  });

  test("-p flag = party", () => {
    expect(parseArgs(["-p", "party msg"], false)).toEqual({
      mode: "party",
      message: "party msg",
      json: false,
    });
  });

  test("--who flag", () => {
    expect(parseArgs(["--who"], false)).toEqual({
      mode: "who",
      filter: undefined,
      json: false,
    });
  });

  test("--who with filter", () => {
    expect(parseArgs(["--who", "mage"], false)).toEqual({
      mode: "who",
      filter: "mage",
      json: false,
    });
  });

  test("--daemon flag", () => {
    expect(parseArgs(["--daemon"], false)).toEqual({ mode: "daemon" });
  });
});
