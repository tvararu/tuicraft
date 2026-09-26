import { describe, expect, test } from "bun:test";
import { native, navigation } from "test/navigation-fixtures";
import { type NavPoint, refusalFloors } from "wow/navigation";

const start: NavPoint = { x: 0, y: 0, z: 0 };
const end = { x: 10, y: 0 };

function nearest(column: number[], z: number): number {
  return column.reduce((best, height) =>
    Math.abs(height - z) < Math.abs(best - z) ? height : best,
  );
}

function atEnd(column: number[]) {
  return navigation(
    native({
      findHeight: (from, x) => (x === 10 ? nearest(column, from.z) : 0),
      findHeights: (x) => (x === 10 ? column : [0]),
    }),
  );
}

function refusal(plan: () => unknown): Error {
  try {
    plan();
  } catch (error) {
    if (error instanceof Error) return error;
  }
  throw new Error("expected a refusal");
}

describe("ground floors at the start and destination", () => {
  test("a surface under less than agent height of headroom is not a floor", () => {
    const covered = atEnd([0, -1.59]).planGround(530, start, end);
    expect(covered.points.at(-1)).toMatchObject({ ...end, z: 0 });
    const error = refusal(() => atEnd([0, -1.61]).planGround(530, start, end));
    expect(error.message).toBe(
      "ambiguous ground column at destination (floors 0.00, -1.61)",
    );
    expect(refusalFloors(error)).toEqual([0, -1.61]);
  });

  test("lists only the surfaces with headroom, highest first", () => {
    const error = refusal(() =>
      atEnd([50.68, 23.82, 25.27]).planGround(530, start, end),
    );
    expect(refusalFloors(error)).toEqual([50.68, 25.27]);
  });

  test("an explicit Z selects one floor of a multi-floor column", () => {
    const route = atEnd([10, 0]).plan(530, start, { ...end, z: 0 });
    expect(route.points.at(-1)).toMatchObject({ ...end, z: 0 });
  });

  test("an explicit Z off every floor is refused with the floors, not replaced", () => {
    for (const z of [0.5, 5, -1]) {
      const error = refusal(() =>
        atEnd([10, 0]).plan(530, start, { ...end, z }),
      );
      expect(error.message).toBe(
        "destination is not on a ground floor (floors 10.00, 0.00)",
      );
      expect(refusalFloors(error)).toEqual([10, 0]);
    }
    const underCover = refusal(() =>
      atEnd([1, 0]).plan(530, start, { ...end, z: 0 }),
    );
    expect(refusalFloors(underCover)).toEqual([1]);
  });

  test("the start pose must stand on a floor of its column", () => {
    const column = (under: number[]) =>
      navigation(native({ findHeights: (x) => (x === 0 ? under : [0]) }));
    const route = column([10, 0]).plan(530, start, { ...end, z: 0 });
    expect(route.points[0]).toEqual(start);
    expect(() => column([1, 0]).plan(530, start, { ...end, z: 0 })).toThrow(
      "ambiguous ground column at start",
    );
    expect(() =>
      column([10, 0]).plan(530, { ...start, z: 5 }, { ...end, z: 0 }),
    ).toThrow("position disagrees with ground height");
  });
});
