import { describe, expect, test } from "bun:test";
import { parseIpcCommand } from "#daemon/parse";

describe("parseIpcCommand", () => {
  test("FRIENDS", () => {
    expect(parseIpcCommand("FRIENDS")).toEqual({ type: "friends" });
  });

  test("FRIENDS_JSON", () => {
    expect(parseIpcCommand("FRIENDS_JSON")).toEqual({ type: "friends_json" });
  });

  test("ADD_FRIEND", () => {
    expect(parseIpcCommand("ADD_FRIEND Arthas")).toEqual({
      target: "Arthas",
      type: "add_friend",
    });
  });

  test("ADD_FRIEND with no target returns undefined", () => {
    expect(parseIpcCommand("ADD_FRIEND")).toBeUndefined();
  });

  test("DEL_FRIEND", () => {
    expect(parseIpcCommand("DEL_FRIEND Arthas")).toEqual({
      target: "Arthas",
      type: "del_friend",
    });
  });

  test("DEL_FRIEND with no target returns undefined", () => {
    expect(parseIpcCommand("DEL_FRIEND")).toBeUndefined();
  });

  test("slash /friend add maps to add_friend", () => {
    expect(parseIpcCommand("/friend add Arthas")).toEqual({
      target: "Arthas",
      type: "add_friend",
    });
  });

  test("slash /friend remove maps to del_friend", () => {
    expect(parseIpcCommand("/friend remove Arthas")).toEqual({
      target: "Arthas",
      type: "del_friend",
    });
  });

  test("IGNORED", () => {
    expect(parseIpcCommand("IGNORED")).toEqual({ type: "ignored" });
  });

  test("IGNORED_JSON", () => {
    expect(parseIpcCommand("IGNORED_JSON")).toEqual({ type: "ignored_json" });
  });

  test("ADD_IGNORE", () => {
    expect(parseIpcCommand("ADD_IGNORE Spammer")).toEqual({
      target: "Spammer",
      type: "add_ignore",
    });
  });

  test("ADD_IGNORE with no target returns undefined", () => {
    expect(parseIpcCommand("ADD_IGNORE")).toBeUndefined();
  });

  test("DEL_IGNORE", () => {
    expect(parseIpcCommand("DEL_IGNORE Spammer")).toEqual({
      target: "Spammer",
      type: "del_ignore",
    });
  });

  test("DEL_IGNORE with no target returns undefined", () => {
    expect(parseIpcCommand("DEL_IGNORE")).toBeUndefined();
  });

  test("GUILD_ROSTER", () => {
    expect(parseIpcCommand("GUILD_ROSTER")).toEqual({ type: "guild_roster" });
  });

  test("GUILD_ROSTER_JSON", () => {
    expect(parseIpcCommand("GUILD_ROSTER_JSON")).toEqual({
      type: "guild_roster_json",
    });
  });

  test("/groster", () => {
    expect(parseIpcCommand("/groster")).toEqual({ type: "guild_roster" });
  });

  test("GINVITE parses guild invite", () => {
    expect(parseIpcCommand("GINVITE Thrall")).toEqual({
      target: "Thrall",
      type: "guild_invite",
    });
  });

  test("GINVITE without target returns undefined", () => {
    expect(parseIpcCommand("GINVITE")).toBeUndefined();
  });

  test("GKICK parses guild kick", () => {
    expect(parseIpcCommand("GKICK Garrosh")).toEqual({
      target: "Garrosh",
      type: "guild_kick",
    });
  });

  test("GLEAVE parses guild leave", () => {
    expect(parseIpcCommand("GLEAVE")).toEqual({ type: "guild_leave" });
  });

  test("GPROMOTE parses guild promote", () => {
    expect(parseIpcCommand("GPROMOTE Jaina")).toEqual({
      target: "Jaina",
      type: "guild_promote",
    });
  });

  test("GDEMOTE parses guild demote", () => {
    expect(parseIpcCommand("GDEMOTE Arthas")).toEqual({
      target: "Arthas",
      type: "guild_demote",
    });
  });

  test("GLEADER parses guild leader", () => {
    expect(parseIpcCommand("GLEADER Sylvanas")).toEqual({
      target: "Sylvanas",
      type: "guild_leader",
    });
  });

  test("GMOTD parses guild motd", () => {
    expect(parseIpcCommand("GMOTD Raid tonight")).toEqual({
      message: "Raid tonight",
      type: "guild_motd",
    });
  });

  test("GMOTD with empty message clears motd", () => {
    expect(parseIpcCommand("GMOTD")).toEqual({
      message: "",
      type: "guild_motd",
    });
  });

  test("GACCEPT parses guild accept", () => {
    expect(parseIpcCommand("GACCEPT")).toEqual({ type: "guild_accept" });
  });

  test("GDECLINE parses guild decline", () => {
    expect(parseIpcCommand("GDECLINE")).toEqual({ type: "guild_decline" });
  });

  test("/ginvite via slash parses guild invite", () => {
    expect(parseIpcCommand("/ginvite Thrall")).toEqual({
      target: "Thrall",
      type: "guild_invite",
    });
  });

  test("/gaccept via slash parses guild accept", () => {
    expect(parseIpcCommand("/gaccept")).toEqual({ type: "guild_accept" });
  });

  test("/gdecline via slash parses guild decline", () => {
    expect(parseIpcCommand("/gdecline")).toEqual({ type: "guild_decline" });
  });

  test("/gkick via slash parses guild kick", () => {
    expect(parseIpcCommand("/gkick Garrosh")).toEqual({
      target: "Garrosh",
      type: "guild_kick",
    });
  });

  test("/gleave via slash parses guild leave", () => {
    expect(parseIpcCommand("/gleave")).toEqual({ type: "guild_leave" });
  });

  test("/gpromote via slash parses guild promote", () => {
    expect(parseIpcCommand("/gpromote Jaina")).toEqual({
      target: "Jaina",
      type: "guild_promote",
    });
  });

  test("/gdemote via slash parses guild demote", () => {
    expect(parseIpcCommand("/gdemote Arthas")).toEqual({
      target: "Arthas",
      type: "guild_demote",
    });
  });

  test("/gleader via slash parses guild leader", () => {
    expect(parseIpcCommand("/gleader Sylvanas")).toEqual({
      target: "Sylvanas",
      type: "guild_leader",
    });
  });

  test("/gmotd via slash parses guild motd", () => {
    expect(parseIpcCommand("/gmotd Raid tonight")).toEqual({
      message: "Raid tonight",
      type: "guild_motd",
    });
  });
});
