import { describe, expect, test } from "bun:test";
import { messageOf } from "lib/errors";

describe("messageOf", () => {
  test("reads an error message", () => {
    expect(messageOf(new Error("boom"), "fallback")).toBe("boom");
  });

  test("falls back for a thrown non-error", () => {
    expect(messageOf("raw")).toBe("raw");
    expect(messageOf(42, "fallback")).toBe("fallback");
  });
});
