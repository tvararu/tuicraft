import { describe, expect, test } from "bun:test";
import { parseArgs } from "cli/args";

describe("parseArgs", () => {
  test("control subcommand", () => {
    expect(parseArgs(["control"])).toEqual({ json: false, mode: "control" });
  });

  test("control --json", () => {
    expect(parseArgs(["control", "--json"])).toEqual({
      json: true,
      mode: "control",
    });
  });

  test("nearby subcommand", () => {
    expect(parseArgs(["nearby"])).toEqual({ json: false, mode: "nearby" });
  });

  test("nearby --json", () => {
    expect(parseArgs(["nearby", "--json"])).toEqual({
      json: true,
      mode: "nearby",
    });
  });

  test("nearby --all", () => {
    expect(parseArgs(["nearby", "--all"])).toEqual({
      all: true,
      json: false,
      mode: "nearby",
    });
  });

  test("nearby --all --json", () => {
    expect(parseArgs(["nearby", "--all", "--json"])).toEqual({
      all: true,
      json: true,
      mode: "nearby",
    });
  });

  test("move defaults to 1000ms", () => {
    expect(parseArgs(["move", "forward"])).toEqual({
      direction: "forward",
      durationMs: 1000,
      mode: "move",
    });
  });

  test("move accepts duration in range", () => {
    expect(parseArgs(["move", "left", "2500"])).toEqual({
      direction: "left",
      durationMs: 2500,
      mode: "move",
    });
  });

  test("face parses radians", () => {
    expect(parseArgs(["face", "1.57"])).toEqual({
      mode: "face",
      orientation: 1.57,
    });
  });

  test("face-guid preserves a current entity GUID", () => {
    expect(parseArgs(["face-guid", "0xffffffffffffffff"])).toEqual({
      guid: 0xffff_ffff_ffff_ffffn,
      mode: "face_guid",
    });
    expect(() => parseArgs(["face-guid", "0"])).toThrow();
  });

  test("walk-toward accepts a bounded observed GUID or grounded point", () => {
    expect(parseArgs(["walk-toward", "3", "0x42"])).toEqual({
      mode: "walk_toward",
      target: { guid: 0x42n, kind: "guid" },
      yards: 3,
    });
    expect(parseArgs(["walk-toward", "2.5", "1", "-2", "3"])).toEqual({
      mode: "walk_toward",
      target: { kind: "point", x: 1, y: -2, z: 3 },
      yards: 2.5,
    });
    expect(() => parseArgs(["walk-toward", "21", "0x42"])).toThrow();
    expect(() => parseArgs(["walk-toward", "2", "NaN", "0", "0"])).toThrow();
  });

  test("target accepts hex and decimal uint64", () => {
    expect(parseArgs(["target", "0x1"])).toEqual({ guid: 1n, mode: "target" });
    expect(parseArgs(["target", "0"])).toEqual({ guid: 0n, mode: "target" });
    expect(parseArgs(["target", "18446744073709551615"])).toEqual({
      guid: 0xffff_ffff_ffff_ffffn,
      mode: "target",
    });
  });

  test("halt subcommand", () => {
    expect(parseArgs(["halt"])).toEqual({ mode: "halt" });
  });

  test("cast attack fight goto parse and reject", () => {
    expect(parseArgs(["cast", "585", "0xa"])).toEqual({
      guid: 0xan,
      mode: "cast",
      spellId: 585,
    });
    expect(parseArgs(["fight", "0xa"])).toEqual({
      framing: "none",
      guid: 0xan,
      instruction:
        "defeat the selected target while keeping the character alive",
      mode: "fight",
    });
    expect(parseArgs(["fight", "--framing", "minimal", "0xa"])).toEqual({
      framing: "minimal",
      guid: 0xan,
      instruction:
        "defeat the selected target while keeping the character alive",
      mode: "fight",
    });
    expect(
      parseArgs(["fight", "--framing=mechanics", "0xa", "hold threat"]),
    ).toEqual({
      framing: "mechanics",
      guid: 0xan,
      instruction: "hold threat",
      mode: "fight",
    });
    expect(() => parseArgs(["fight", "--framing", "bogus", "0xa"])).toThrow(
      'Unknown framing variant: "bogus". Must be one of: none, minimal, mechanics',
    );
    expect(() => parseArgs(["fight", "--framing"])).toThrow(
      "missing framing variant",
    );
    expect(parseArgs(["goto", "1.5", "2", "3"])).toEqual({
      mode: "goto",
      target: { kind: "point", x: 1.5, y: 2, z: 3 },
    });
    expect(parseArgs(["goto", "1.5", "-2"])).toEqual({
      mode: "goto",
      target: { kind: "point", x: 1.5, y: -2 },
    });
    expect(parseArgs(["goto", "0x2a"])).toEqual({
      mode: "goto",
      target: { guid: 42n, kind: "guid" },
    });
    expect(() => parseArgs(["goto", "0"])).toThrow("invalid goto");
    expect(() => parseArgs(["goto", "1.5"])).toThrow("invalid goto");
    expect(() => parseArgs(["goto", "1", "Infinity"])).toThrow("invalid goto");
    expect(() => parseArgs(["cast", "585"])).toThrow("invalid cast");
    expect(() => parseArgs(["goto", "1", "2", "NaN"])).toThrow("invalid goto");
    expect(() => parseArgs(["fight"])).toThrow("invalid fight");
    expect(parseArgs(["combat", "--json"])).toEqual({
      json: true,
      mode: "combat",
    });
  });
});
