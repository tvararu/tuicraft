import { describe, expect, test } from "bun:test";
import { buildFraming, parseFramingVariant } from "#wow/framing";

describe("parseFramingVariant", () => {
  test("defaults undefined or empty string to none", () => {
    expect(parseFramingVariant(undefined)).toBe("none");
    expect(parseFramingVariant("")).toBe("none");
  });

  test("accepts valid variants", () => {
    expect(parseFramingVariant("none")).toBe("none");
    expect(parseFramingVariant("minimal")).toBe("minimal");
    expect(parseFramingVariant("mechanics")).toBe("mechanics");
  });

  test("rejects unknown variant with clear error", () => {
    expect(() => parseFramingVariant("invalid")).toThrow(
      'Unknown framing variant: "invalid". Must be one of: none, minimal, mechanics',
    );
    expect(() => parseFramingVariant("combat")).toThrow(
      'Unknown framing variant: "combat". Must be one of: none, minimal, mechanics',
    );
  });
});

describe("buildFraming", () => {
  test("returns undefined for none variant", () => {
    expect(buildFraming("none", { self: { level: 10 } })).toBeUndefined();
  });

  test("names no class when the class is unknown", () => {
    const text = buildFraming("minimal", { self: { level: 10 } });
    expect(text).toBe(
      "In World of Warcraft 3.3.5a, you are a level 10 character fighting a hostile creature.",
    );
  });

  test("uses dynamic observed level rather than fixed number", () => {
    const text1 = buildFraming("minimal", { self: { level: 14 } }, "Priest");
    expect(text1).toBe(
      "In World of Warcraft 3.3.5a, you are a level 14 Priest fighting a hostile creature.",
    );

    const text2 = buildFraming("minimal", { self: { level: 60 } }, "Priest");
    expect(text2).toBe(
      "In World of Warcraft 3.3.5a, you are a level 60 Priest fighting a hostile creature.",
    );
  });

  test("supports custom character class parameter", () => {
    const text = buildFraming("minimal", { self: { level: 5 } }, "Mage");
    expect(text).toBe(
      "In World of Warcraft 3.3.5a, you are a level 5 Mage fighting a hostile creature.",
    );
  });

  test("handles missing level in observation safely", () => {
    const text = buildFraming("minimal", {}, "Priest");
    expect(text).toBe(
      "In World of Warcraft 3.3.5a, you are a Priest fighting a hostile creature.",
    );
  });

  test("builds mechanics framing extending minimal with combat mechanics", () => {
    const text = buildFraming("mechanics", { self: { level: 10 } }, "Priest");
    expect(text).toBe(
      "In World of Warcraft 3.3.5a, you are a level 10 Priest fighting a hostile creature. The resource pool does not refill during the fight. Some actions apply effects over time. Some actions take time and can be disrupted.",
    );
  });
});
