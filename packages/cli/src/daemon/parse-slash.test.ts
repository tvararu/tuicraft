import { describe, expect, test } from "bun:test";
import { parseIpcCommand } from "#daemon/parse";

describe("parseIpcCommand", () => {
  test("slash /accept maps to accept", () => {
    expect(parseIpcCommand("/accept")).toEqual({ type: "accept" });
  });

  test("slash /say maps to say", () => {
    expect(parseIpcCommand("/say hello")).toEqual({
      message: "hello",
      type: "say",
    });
  });

  test("slash /whisper maps to whisper", () => {
    expect(parseIpcCommand("/whisper Xiara hi")).toEqual({
      message: "hi",
      target: "Xiara",
      type: "whisper",
    });
  });

  test("slash /emote maps to emote", () => {
    expect(parseIpcCommand("/emote waves")).toEqual({
      message: "waves",
      type: "emote",
    });
  });

  test("slash /dnd maps to dnd", () => {
    expect(parseIpcCommand("/dnd busy")).toEqual({
      message: "busy",
      type: "dnd",
    });
  });

  test("slash /afk maps to afk", () => {
    expect(parseIpcCommand("/afk brb")).toEqual({
      message: "brb",
      type: "afk",
    });
  });

  test("slash /who maps to who with filter", () => {
    expect(parseIpcCommand("/who mage")).toEqual({
      filter: "mage",
      type: "who",
    });
  });

  test("slash /who maps to who without filter", () => {
    expect(parseIpcCommand("/who")).toEqual({ type: "who" });
  });

  test("slash /invite maps to invite", () => {
    expect(parseIpcCommand("/invite Voidtrix")).toEqual({
      target: "Voidtrix",
      type: "invite",
    });
  });

  test("slash /kick maps to kick", () => {
    expect(parseIpcCommand("/kick Voidtrix")).toEqual({
      target: "Voidtrix",
      type: "kick",
    });
  });

  test("slash /leave maps to leave", () => {
    expect(parseIpcCommand("/leave")).toEqual({ type: "leave" });
  });

  test("slash /friends maps to friends", () => {
    expect(parseIpcCommand("/friends")).toEqual({ type: "friends" });
  });

  test("slash /ignore maps to add_ignore", () => {
    expect(parseIpcCommand("/ignore someone")).toEqual({
      target: "someone",
      type: "add_ignore",
    });
  });

  test("slash /ignore bare maps to ignored", () => {
    expect(parseIpcCommand("/ignore")).toEqual({ type: "ignored" });
  });

  test("slash /ignorelist maps to ignored", () => {
    expect(parseIpcCommand("/ignorelist")).toEqual({ type: "ignored" });
  });

  test("slash /unignore maps to del_ignore", () => {
    expect(parseIpcCommand("/unignore someone")).toEqual({
      target: "someone",
      type: "del_ignore",
    });
  });

  test("slash /join maps to join_channel", () => {
    expect(parseIpcCommand("/join Trade")).toEqual({
      channel: "Trade",
      type: "join_channel",
    });
  });

  test("slash /leave channel maps to leave_channel", () => {
    expect(parseIpcCommand("/leave Trade")).toEqual({
      channel: "Trade",
      type: "leave_channel",
    });
  });

  test("unknown slash command maps to say with full input", () => {
    expect(parseIpcCommand("/dance hello")).toEqual({
      message: "/dance hello",
      type: "say",
    });
  });

  test("slash command unsupported by daemon falls back to say", () => {
    expect(parseIpcCommand("/r hello")).toEqual({
      message: "/r hello",
      type: "say",
    });
  });

  test("INVITE with no target returns undefined", () => {
    expect(parseIpcCommand("INVITE")).toBeUndefined();
  });

  test("KICK with no target returns undefined", () => {
    expect(parseIpcCommand("KICK")).toBeUndefined();
  });

  test("LEADER with no target returns undefined", () => {
    expect(parseIpcCommand("LEADER")).toBeUndefined();
  });
});
