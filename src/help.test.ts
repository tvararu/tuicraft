import { test, expect } from "bun:test";
import { helpText } from "help";

const text = helpText();

test("help text includes all subcommands", () => {
  for (const cmd of ["setup", "read", "tail", "logs", "stop", "status", "help"])
    expect(text).toContain(cmd);
});

test("help text includes all chat flags", () => {
  for (const flag of ["-w", "-y", "-g", "-p", "--who"])
    expect(text).toContain(flag);
});

test("help text includes all global flags", () => {
  for (const flag of ["--json", "--wait", "--daemon"])
    expect(text).toContain(flag);
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
