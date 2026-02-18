import { test, expect, describe } from "bun:test";
import { parseCommand } from "tui";

describe("parseCommand", () => {
  test("bare text becomes say", () => {
    expect(parseCommand("hello")).toEqual({ type: "say", message: "hello" });
  });

  test("/s sends say", () => {
    expect(parseCommand("/s hello")).toEqual({ type: "say", message: "hello" });
  });

  test("/say sends say", () => {
    expect(parseCommand("/say hello there")).toEqual({
      type: "say",
      message: "hello there",
    });
  });

  test("/w sends whisper", () => {
    expect(parseCommand("/w Xiara follow me")).toEqual({
      type: "whisper",
      target: "Xiara",
      message: "follow me",
    });
  });

  test("/whisper sends whisper", () => {
    expect(parseCommand("/whisper Xiara hi")).toEqual({
      type: "whisper",
      target: "Xiara",
      message: "hi",
    });
  });

  test("/r sends reply", () => {
    expect(parseCommand("/r hello")).toEqual({
      type: "reply",
      message: "hello",
    });
  });

  test("/g sends guild", () => {
    expect(parseCommand("/g hello guild")).toEqual({
      type: "guild",
      message: "hello guild",
    });
  });

  test("/guild sends guild", () => {
    expect(parseCommand("/guild hi")).toEqual({
      type: "guild",
      message: "hi",
    });
  });

  test("/y sends yell", () => {
    expect(parseCommand("/y HELLO")).toEqual({
      type: "yell",
      message: "HELLO",
    });
  });

  test("/p sends party", () => {
    expect(parseCommand("/p inv")).toEqual({ type: "party", message: "inv" });
  });

  test("/party sends party", () => {
    expect(parseCommand("/party inv")).toEqual({
      type: "party",
      message: "inv",
    });
  });

  test("/raid sends raid", () => {
    expect(parseCommand("/raid pull")).toEqual({
      type: "raid",
      message: "pull",
    });
  });

  test("/1 sends channel 1", () => {
    expect(parseCommand("/1 hello general")).toEqual({
      type: "channel",
      target: "1",
      message: "hello general",
    });
  });

  test("/2 sends channel 2", () => {
    expect(parseCommand("/2 lfg")).toEqual({
      type: "channel",
      target: "2",
      message: "lfg",
    });
  });

  test("/who sends who query", () => {
    expect(parseCommand("/who")).toEqual({ type: "who" });
  });

  test("/who with name filter", () => {
    expect(parseCommand("/who Xiara")).toEqual({
      type: "who",
      target: "Xiara",
    });
  });

  test("/quit sends quit", () => {
    expect(parseCommand("/quit")).toEqual({ type: "quit" });
  });

  test("empty string becomes say with empty message", () => {
    expect(parseCommand("")).toEqual({ type: "say", message: "" });
  });
});
