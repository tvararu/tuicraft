import { describe, expect, test } from "bun:test";
import {
  formatSendOutput,
  daemonCommandFailed,
  walkCommandFailed,
} from "cli/send-output";

describe("formatSendOutput", () => {
  test("non-json returns daemon lines", () => {
    expect(formatSendOutput(["OK WHO"], false, false)).toEqual(["OK WHO"]);
  });

  test("json send mode returns status line", () => {
    expect(formatSendOutput(["OK"], true, false)).toEqual([
      JSON.stringify({ status: "ok" }),
    ]);
  });

  test("json slash mode preserves daemon lines", () => {
    expect(
      formatSendOutput(
        ['{"type":"WHO","count":1}', "UNIMPLEMENTED Mail"],
        true,
        true,
      ),
    ).toEqual(['{"type":"WHO","count":1}', "UNIMPLEMENTED Mail"]);
  });
});

describe("daemonCommandFailed", () => {
  test("OK is success", () => {
    expect(daemonCommandFailed(["OK"])).toBe(false);
  });

  test("ERR fails the consumer", () => {
    expect(daemonCommandFailed(["ERR rooted"])).toBe(true);
  });
});

test("a directed walk exits unsuccessfully on a stop or missing outcome", () => {
  expect(walkCommandFailed(['{"status":"completed","traveled":2}'])).toBe(
    false,
  );
  expect(
    walkCommandFailed(['{"status":"stopped","reason":"obstructed"}']),
  ).toBe(true);
  expect(walkCommandFailed([])).toBe(true);
  expect(walkCommandFailed(["ERR target_not_observed"])).toBe(true);
});
