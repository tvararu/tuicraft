import { describe, expect, test } from "bun:test";
import { formatSendOutput } from "cli/send-output";

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
