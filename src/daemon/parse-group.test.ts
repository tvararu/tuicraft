import { describe, expect, test } from "bun:test";
import { parseIpcCommand } from "daemon/parse";

describe("parseIpcCommand", () => {
  test("INVITE", () => {
    expect(parseIpcCommand("INVITE Voidtrix")).toEqual({
      target: "Voidtrix",
      type: "invite",
    });
  });

  test("KICK", () => {
    expect(parseIpcCommand("KICK Voidtrix")).toEqual({
      target: "Voidtrix",
      type: "kick",
    });
  });

  test("LEAVE", () => {
    expect(parseIpcCommand("LEAVE")).toEqual({ type: "leave" });
  });

  test("LEADER", () => {
    expect(parseIpcCommand("LEADER Voidtrix")).toEqual({
      target: "Voidtrix",
      type: "leader",
    });
  });

  test("ACCEPT", () => {
    expect(parseIpcCommand("ACCEPT")).toEqual({ type: "accept" });
  });

  test("DECLINE", () => {
    expect(parseIpcCommand("DECLINE")).toEqual({ type: "decline" });
  });

  test("JOIN parses channel", () => {
    expect(parseIpcCommand("JOIN Trade")).toEqual({
      channel: "Trade",
      type: "join_channel",
    });
  });

  test("JOIN parses channel with password", () => {
    expect(parseIpcCommand("JOIN Secret hunter2")).toEqual({
      channel: "Secret",
      password: "hunter2",
      type: "join_channel",
    });
  });

  test("JOIN with no channel returns undefined", () => {
    expect(parseIpcCommand("JOIN")).toBeUndefined();
  });

  test("LEAVE with channel parses leave_channel", () => {
    expect(parseIpcCommand("LEAVE Trade")).toEqual({
      channel: "Trade",
      type: "leave_channel",
    });
  });

  test("LEAVE without channel parses leave", () => {
    expect(parseIpcCommand("LEAVE")).toEqual({ type: "leave" });
  });
});
