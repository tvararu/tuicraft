import { describe, expect, test } from "bun:test";
import { parseIpcCommand } from "daemon/parse";

describe("parseIpcCommand", () => {
  test("NEARBY", () => {
    expect(parseIpcCommand("NEARBY")).toEqual({ type: "nearby" });
  });

  test("NEARBY_JSON", () => {
    expect(parseIpcCommand("NEARBY_JSON")).toEqual({ type: "nearby_json" });
  });

  test("NEARBY all and NEARBY_JSON all", () => {
    expect(parseIpcCommand("NEARBY all")).toEqual({
      all: true,
      type: "nearby",
    });
    expect(parseIpcCommand("NEARBY_JSON all")).toEqual({
      all: true,
      type: "nearby_json",
    });
  });

  test("CONTROL and CONTROL_JSON", () => {
    expect(parseIpcCommand("CONTROL")).toEqual({ type: "control" });
    expect(parseIpcCommand("CONTROL_JSON")).toEqual({ type: "control_json" });
  });

  test("MOVE defaults to 1000ms", () => {
    expect(parseIpcCommand("MOVE forward")).toEqual({
      direction: "forward",
      durationMs: 1000,
      type: "move",
    });
  });

  test("MOVE accepts duration bounds", () => {
    expect(parseIpcCommand("MOVE backward 1")).toEqual({
      direction: "backward",
      durationMs: 1,
      type: "move",
    });
    expect(parseIpcCommand("MOVE left 10000")).toEqual({
      direction: "left",
      durationMs: 10_000,
      type: "move",
    });
  });

  test("MOVE rejects malformed and out-of-range args", () => {
    expect(parseIpcCommand("MOVE")).toEqual({
      reason: "invalid move",
      type: "invalid",
    });
    expect(parseIpcCommand("MOVE up")).toEqual({
      reason: "invalid direction",
      type: "invalid",
    });
    expect(parseIpcCommand("MOVE forward 0")).toEqual({
      reason: "invalid duration",
      type: "invalid",
    });
    expect(parseIpcCommand("MOVE forward 10001")).toEqual({
      reason: "invalid duration",
      type: "invalid",
    });
    expect(parseIpcCommand("MOVE forward 1.5")).toEqual({
      reason: "invalid duration",
      type: "invalid",
    });
    expect(parseIpcCommand("MOVE forward Infinity")).toEqual({
      reason: "invalid duration",
      type: "invalid",
    });
  });

  test("FACE accepts finite radians", () => {
    expect(parseIpcCommand("FACE 1.57")).toEqual({
      orientation: 1.57,
      type: "face",
    });
    expect(parseIpcCommand("FACE 0")).toEqual({
      orientation: 0,
      type: "face",
    });
  });

  test("FACE rejects nonfinite and missing", () => {
    expect(parseIpcCommand("FACE")?.type).toBe("invalid");
    expect(parseIpcCommand("FACE NaN")?.type).toBe("invalid");
    expect(parseIpcCommand("FACE Infinity")?.type).toBe("invalid");
    expect(parseIpcCommand("FACE 1 2")?.type).toBe("invalid");
  });

  test("FACE_GUID and WALK_TOWARD preserve typed destinations", () => {
    expect(parseIpcCommand("FACE_GUID 0x42")).toEqual({
      guid: 0x42n,
      type: "face_guid",
    });
    expect(parseIpcCommand("WALK_TOWARD 3 0x42")).toEqual({
      target: { guid: 0x42n, kind: "guid" },
      type: "walk_toward",
      yards: 3,
    });
    expect(parseIpcCommand("WALK_TOWARD 2.5 1 -2 3")).toEqual({
      target: { kind: "point", x: 1, y: -2, z: 3 },
      type: "walk_toward",
      yards: 2.5,
    });
    expect(parseIpcCommand("WALK_TOWARD 21 0x42")?.type).toBe("invalid");
    expect(parseIpcCommand("WALK_TOWARD 2 NaN 0 0")?.type).toBe("invalid");
  });

  test("TARGET accepts hex and decimal uint64", () => {
    expect(parseIpcCommand("TARGET 0x1")).toEqual({ guid: 1n, type: "target" });
    expect(parseIpcCommand("TARGET 0")).toEqual({ guid: 0n, type: "target" });
    expect(parseIpcCommand("TARGET 18446744073709551615")).toEqual({
      guid: 0xffff_ffff_ffff_ffffn,
      type: "target",
    });
  });

  test("TARGET rejects malformed guid", () => {
    expect(parseIpcCommand("TARGET")?.type).toBe("invalid");
    expect(parseIpcCommand("TARGET -1")?.type).toBe("invalid");
    expect(parseIpcCommand("TARGET 0x")?.type).toBe("invalid");
    expect(parseIpcCommand("TARGET 18446744073709551616")?.type).toBe(
      "invalid",
    );
  });

  test("HALT", () => {
    expect(parseIpcCommand("HALT")).toEqual({ type: "halt" });
  });
});
