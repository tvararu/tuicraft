import { test, expect } from "bun:test";
import { helpText } from "cli/help";

const text = helpText();

test("help text includes all subcommands", () => {
  for (const cmd of [
    "setup",
    "send",
    "who",
    "read",
    "tail",
    "logs",
    "start",
    "stop",
    "status",
    "control",
    "move",
    "face",
    "target",
    "halt",
    "nearby",
    "combat",
    "spells",
    "cast",
    "attack",
    "cancel-cast",
    "stop-attack",
    "fight",
    "tactics",
    "goto",
    "navigation",
    "follow",
    "following",
    "recovery",
    "query-corpse",
    "release-spirit",
    "reclaim-corpse",
    "resurrect",
    "quests",
    "talk",
    "query-quest",
    "select-option",
    "select-quest",
    "accept-quest",
    "complete-quest",
    "request-reward",
    "choose-reward",
    "abandon-quest",
    "cancel-interaction",
    "inventory",
    "loot",
    "open-loot",
    "take-loot",
    "take-money",
    "release-loot",
    "help",
  ])
    expect(text).toContain(cmd);
});

test("help text includes all chat flags", () => {
  for (const flag of ["-w", "-y", "-g", "-p"]) expect(text).toContain(flag);
});

test("help text includes all global flags", () => {
  for (const flag of ["--version", "--json", "--wait", "--daemon"])
    expect(text).toContain(flag);
});

test("help text includes interactive group commands", () => {
  for (const cmd of [
    "/invite",
    "/kick",
    "/leave",
    "/leader",
    "/accept",
    "/decline",
  ])
    expect(text).toContain(cmd);
});

test("help text includes all setup flags", () => {
  for (const flag of [
    "--account",
    "--password",
    "--character",
    "--host",
    "--port",
    "--language",
    "--timeout_minutes",
  ])
    expect(text).toContain(flag);
});
