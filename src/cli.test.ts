import { test, expect, describe } from "bun:test";
import { writeFile, unlink } from "node:fs/promises";
import { parseArgs, sendToSocket } from "cli";

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

  test("bare string = say", () => {
    expect(parseArgs(["hello world"])).toEqual({
      mode: "say",
      message: "hello world",
      json: false,
    });
  });

  test("-w flag = whisper", () => {
    expect(parseArgs(["-w", "Xiara", "follow me"])).toEqual({
      mode: "whisper",
      target: "Xiara",
      message: "follow me",
      json: false,
    });
  });

  test("-y flag = yell", () => {
    expect(parseArgs(["-y", "HELLO"])).toEqual({
      mode: "yell",
      message: "HELLO",
      json: false,
    });
  });

  test("-g flag = guild", () => {
    expect(parseArgs(["-g", "guild msg"])).toEqual({
      mode: "guild",
      message: "guild msg",
      json: false,
    });
  });

  test("-p flag = party", () => {
    expect(parseArgs(["-p", "party msg"])).toEqual({
      mode: "party",
      message: "party msg",
      json: false,
    });
  });

  test("--who flag", () => {
    expect(parseArgs(["--who"])).toEqual({
      mode: "who",
      filter: undefined,
      json: false,
    });
  });

  test("--who with filter", () => {
    expect(parseArgs(["--who", "mage"])).toEqual({
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
    const result = parseArgs(["-y", "--json", "hello"]);
    expect(result).toEqual({
      mode: "yell",
      message: "hello",
      json: true,
    });
  });

  test("--json does not leak into guild message", () => {
    const result = parseArgs(["-g", "--json", "inv pls"]);
    expect(result).toEqual({
      mode: "guild",
      message: "inv pls",
      json: true,
    });
  });

  test("--json does not leak into party message", () => {
    const result = parseArgs(["-p", "--json", "pull now"]);
    expect(result).toEqual({
      mode: "party",
      message: "pull now",
      json: true,
    });
  });

  test("--json does not leak into whisper message", () => {
    const result = parseArgs(["-w", "Xiara", "--json", "hey"]);
    expect(result).toEqual({
      mode: "whisper",
      target: "Xiara",
      message: "hey",
      json: true,
    });
  });
});

describe("sendToSocket", () => {
  test("rejects on stale socket file", async () => {
    const path = `./tmp/stale-sock-${Date.now()}.sock`;
    await writeFile(path, "");
    try {
      await expect(sendToSocket("STATUS", path)).rejects.toThrow();
    } finally {
      await unlink(path).catch(() => {});
    }
  });
});
