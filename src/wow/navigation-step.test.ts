import { describe, expect, test } from "bun:test";
import { native, navigation } from "test/navigation-fixtures";
import { withinStep } from "wow/navigation";
import { groundError } from "wow/navigation-native";

describe("step height", () => {
  test("a reachable collision surface wins over a navmesh height floating above it", () => {
    const map = native({
      findHeight: () => 71.5,
      findHeights: () => [70.44],
    });
    const nav = navigation(map);
    const from = { x: 0, y: 0, z: 70.43 };
    expect(nav.stepHeight(530, 0.01, 0, from)).toBeCloseTo(70.44);
    expect(nav.stepHeight(530, 0.01, 0, { ...from, z: 60 })).toBeCloseTo(71.5);
  });

  test("steps onto the highest surface within climbing reach when the navmesh probe fails", () => {
    const map = native({
      findHeight: () => {
        throw groundError("pathfind_find_height failed (UNKNOWN_HEIGHT)");
      },
      findHeights: () => [71.0, 69.02, 71.04],
    });
    const nav = navigation(map);
    const from = { x: 0, y: 0, z: 70.998 };
    expect(nav.stepHeight(530, 0.5, 0, from)).toBeCloseTo(71.04);
  });

  test("a walkable rise or a short drop is reachable, a cliff is not", () => {
    const map = native({
      findHeight: () => {
        throw groundError("pathfind_find_height failed (UNKNOWN_HEIGHT)");
      },
      findHeights: () => [101.56, 70.6, 69.0],
    });
    const nav = navigation(map);
    expect(nav.stepHeight(530, 0.5, 0, { x: 0, y: 0, z: 70 })).toBeCloseTo(
      70.6,
    );
    expect(nav.stepHeight(530, 0.5, 0, { x: 0, y: 0, z: 72 })).toBeCloseTo(
      70.6,
    );
    expect(() => nav.stepHeight(530, 0.5, 0, { x: 0, y: 0, z: 84 })).toThrow(
      /ambiguous ground column/,
    );
  });

  test("a step rises at most the navmesh 50° slope plus one cell and drops less than a damaging fall", () => {
    const from = { x: 0, y: 0, z: 70 };
    const reach = 0.25 + 0.5 * Math.tan((50 * Math.PI) / 180);
    expect(withinStep(from, { x: 0.5, y: 0, z: 70 + reach - 0.001 })).toBe(
      true,
    );
    expect(withinStep(from, { x: 0.5, y: 0, z: 70 + reach + 0.001 })).toBe(
      false,
    );
    expect(withinStep(from, { x: 0.01, y: 0, z: 70.5 })).toBe(false);
    expect(withinStep(from, { x: 0.5, y: 0, z: 57 })).toBe(true);
    expect(withinStep(from, { x: 0.5, y: 0, z: 56.99 })).toBe(false);
  });
});
