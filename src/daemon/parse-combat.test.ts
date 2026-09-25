import { describe, expect, test } from "bun:test";
import { parseIpcCommand } from "daemon/parse";

describe("parseIpcCommand", () => {
  test("CAST ATTACK FIGHT GOTO parse exact arity", () => {
    expect(parseIpcCommand("CAST 585 0xa")).toEqual({
      guid: 0xan,
      spellId: 585,
      type: "cast",
    });
    expect(parseIpcCommand("ATTACK 0xa")).toEqual({
      guid: 0xan,
      type: "attack",
    });
    expect(parseIpcCommand("FIGHT 0xa")).toEqual({
      guid: 0xan,
      instruction:
        "defeat the selected target while keeping the character alive",
      type: "fight",
    });
    expect(parseIpcCommand("FIGHT 0xa hold threat")).toEqual({
      guid: 0xan,
      instruction: "hold threat",
      type: "fight",
    });
    expect(parseIpcCommand("FIGHT --framing minimal 0xa")).toEqual({
      framing: "minimal",
      guid: 0xan,
      instruction:
        "defeat the selected target while keeping the character alive",
      type: "fight",
    });
    expect(
      parseIpcCommand("FIGHT --framing=mechanics 0xa conserve mana"),
    ).toEqual({
      framing: "mechanics",
      guid: 0xan,
      instruction: "conserve mana",
      type: "fight",
    });
    expect(parseIpcCommand("FIGHT --framing invalid 0xa")?.type).toBe(
      "invalid",
    );
    expect(parseIpcCommand("FIGHT --framing")?.type).toBe("invalid");
    expect(parseIpcCommand("CYCLE 0xa 0xb")).toEqual({
      guids: [0xan, 0xbn],
      instruction:
        "defeat the selected target while keeping the character alive",
      type: "cycle",
    });
    expect(parseIpcCommand("CYCLE 0xa --max 3")).toEqual({
      guids: [0xan],
      instruction:
        "defeat the selected target while keeping the character alive",
      maxStarts: 3,
      type: "cycle",
    });
    expect(
      parseIpcCommand("CYCLE 0xa 0xb --instruction hold aggro --max 5"),
    ).toEqual({
      guids: [0xan, 0xbn],
      instruction: "hold aggro",
      maxStarts: 5,
      type: "cycle",
    });
    expect(parseIpcCommand("CYCLE")?.type).toBe("invalid");
    expect(parseIpcCommand("CYCLE 0")?.type).toBe("invalid");
    expect(parseIpcCommand("CYCLE 0xa --max 0")?.type).toBe("invalid");
    expect(parseIpcCommand("CYCLING")).toEqual({ type: "cycling" });
    expect(parseIpcCommand("CYCLING_JSON")).toEqual({
      type: "cycling_json",
    });
    expect(parseIpcCommand("GOTO 1 2 3")).toEqual({
      type: "goto",
      x: 1,
      y: 2,
      z: 3,
    });
    expect(parseIpcCommand("CAST")?.type).toBe("invalid");
    expect(parseIpcCommand("CAST 0 0x1")?.type).toBe("invalid");
    expect(parseIpcCommand("GOTO 1 2")?.type).toBe("invalid");
    expect(parseIpcCommand("GOTO 1 2 Infinity")?.type).toBe("invalid");
    expect(parseIpcCommand("COMBAT")).toEqual({ type: "combat" });
    expect(parseIpcCommand("SPELLS_JSON")).toEqual({ type: "spells_json" });
  });
});
