import { expect, test } from "bun:test";
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
    "record",
    "start",
    "stop",
    "status",
    "control",
    "move",
    "face",
    "face-guid",
    "walk-toward",
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
    "cycle",
    "cycling",
    "goto",
    "navigation",
    "recovery",
    "query-corpse",
    "release-spirit",
    "reclaim-corpse",
    "spirit-healer",
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
    "trainer",
    "open-trainer",
    "train",
    "vendor",
    "open-vendor",
    "sell",
    "buy",
    "repair",
    "help",
  ])
    expect(text).toContain(cmd);
});

test("help text includes all chat flags", () => {
  for (const flag of ["-s", "-w", "-y", "-g", "-p"])
    expect(text).toContain(flag);
});

test("help text includes all global flags", () => {
  for (const flag of [
    "--version",
    "--json",
    "--wait",
    "--daemon",
    "--framing",
    "--instruction",
    "--max",
    "--resume",
  ])
    expect(text).toContain(flag);
});

test("help text includes daemon environment variables", () => {
  for (const name of [
    "TYPESAFE_API_KEY",
    "JEV_ENDPOINT_URL",
    "TYPESAFE_ENDPOINT_URL",
    "JEV_FAULT",
    "WOW_JEV_FRAMING",
  ])
    expect(text).toContain(name);
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
