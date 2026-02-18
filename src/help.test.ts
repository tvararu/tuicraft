import { test, expect } from "bun:test";
import { helpText } from "help";

test("help text includes all subcommands", () => {
  const text = helpText();
  expect(text).toContain("setup");
  expect(text).toContain("read");
  expect(text).toContain("tail");
  expect(text).toContain("logs");
  expect(text).toContain("stop");
  expect(text).toContain("status");
  expect(text).toContain("help");
  expect(text).toContain("--json");
  expect(text).toContain("--wait");
  expect(text).toContain("-w");
  expect(text).toContain("-y");
  expect(text).toContain("-g");
  expect(text).toContain("-p");
  expect(text).toContain("--who");
});
