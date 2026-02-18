import { test, expect, describe } from "bun:test";
import { stripColorCodes } from "lib/strip-colors";

describe("stripColorCodes", () => {
  test("returns plain text unchanged", () => {
    expect(stripColorCodes("hello world")).toBe("hello world");
  });

  test("handles empty string", () => {
    expect(stripColorCodes("")).toBe("");
  });

  test("strips color code and reset", () => {
    expect(stripColorCodes("|cFF00FF00Green text|r")).toBe("Green text");
  });

  test("strips multiple color codes", () => {
    expect(stripColorCodes("|cFF00FF00Green|r and |cFFFF0000Red|r")).toBe(
      "Green and Red",
    );
  });

  test("strips item link preserving display text", () => {
    expect(
      stripColorCodes("|cff1eff00|Hitem:19019:0:0:0|h[Thunderfury]|h|r"),
    ).toBe("[Thunderfury]");
  });

  test("strips standalone reset", () => {
    expect(stripColorCodes("before|rafter")).toBe("beforeafter");
  });

  test("strips multiple item links in one string", () => {
    expect(
      stripColorCodes(
        "|cff0070dd|Hitem:1234|h[Blue Sword]|h|r and |cffffffff|Hitem:5678|h[White Shield]|h|r",
      ),
    ).toBe("[Blue Sword] and [White Shield]");
  });

  test("case insensitive hex digits", () => {
    expect(stripColorCodes("|cFFaaBBcc mixed case|r")).toBe(" mixed case");
  });
});
