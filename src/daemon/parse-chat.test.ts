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
});
