import { describe, expect, test } from "bun:test";
import { parseArgs } from "cli/args";

describe("cycle arguments", () => {
  test("parses guid queue, instruction and max starts", () => {
    expect(parseArgs(["cycle", "0xa", "0xb", "--max", "3"])).toEqual({
      guids: [0xan, 0xbn],
      instruction:
        "defeat the selected target while keeping the character alive",
      maxStarts: 3,
      mode: "cycle",
    });
    expect(parseArgs(["cycle", "0xa", "--instruction", "kill fast"])).toEqual({
      guids: [0xan],
      instruction: "kill fast",
      mode: "cycle",
    });
    expect(
      parseArgs([
        "cycle",
        "0xa",
        "0xb",
        "--instruction",
        "hold aggro",
        "--max",
        "5",
      ]),
    ).toEqual({
      guids: [0xan, 0xbn],
      instruction: "hold aggro",
      maxStarts: 5,
      mode: "cycle",
    });
    expect(parseArgs(["cycling", "--json"])).toEqual({
      json: true,
      mode: "cycling",
    });
  });

  test("rejects missing guids, invalid guids and non-positive max", () => {
    expect(() => parseArgs(["cycle"])).toThrow("invalid cycle");
    expect(() => parseArgs(["cycle", "0"])).toThrow("invalid guid");
    expect(() => parseArgs(["cycle", "0xa", "--max", "0"])).toThrow(
      "invalid cycle max",
    );
    expect(() => parseArgs(["cycle", "0xa", "--max", "-1"])).toThrow(
      "invalid cycle max",
    );
    expect(() => parseArgs(["cycle", "0xa", "--max"])).toThrow(
      "invalid cycle max",
    );
  });

  test("rejects multiline cycle instructions", () => {
    expect(() =>
      parseArgs(["cycle", "0xa", "--instruction", "line1\nline2"]),
    ).toThrow("instruction must not contain line breaks");
  });
});

describe("recovery arguments", () => {
  test("parses inspection and explicit resurrection decisions", () => {
    expect(parseArgs(["recovery", "--json"])).toEqual({
      json: true,
      mode: "recovery",
    });
    expect(parseArgs(["query-corpse"])).toEqual({ mode: "query_corpse" });
    expect(parseArgs(["release-spirit"])).toEqual({ mode: "release_spirit" });
    expect(parseArgs(["reclaim-corpse"])).toEqual({ mode: "reclaim_corpse" });
    expect(parseArgs(["resurrect", "accept"])).toEqual({
      accept: true,
      mode: "resurrect",
    });
    expect(parseArgs(["resurrect", "decline"])).toEqual({
      accept: false,
      mode: "resurrect",
    });
  });

  test("rejects implicit resurrection decisions and extra action arguments", () => {
    for (const args of [
      ["resurrect"],
      ["resurrect", "yes"],
      ["resurrect", "accept", "extra"],
      ["query-corpse", "1"],
      ["release-spirit", "1"],
      ["reclaim-corpse", "0x1"],
    ])
      expect(() => parseArgs(args)).toThrow();
  });

  test("parses an explicit spirit-healer GUID and rejects bare or zero GUIDs", () => {
    expect(parseArgs(["spirit-healer", "0xa"])).toEqual({
      guid: 10n,
      mode: "spirit_healer",
    });
    for (const args of [
      ["spirit-healer"],
      ["spirit-healer", "0"],
      ["spirit-healer", "0xa", "extra"],
    ])
      expect(() => parseArgs(args)).toThrow();
  });
});
