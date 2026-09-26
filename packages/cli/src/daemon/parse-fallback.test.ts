import { describe, expect, test } from "bun:test";
import { parseIpcCommand } from "#daemon/parse";

describe("parseIpcCommand", () => {
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
});
