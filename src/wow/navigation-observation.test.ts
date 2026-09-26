import { describe, expect, test } from "bun:test";
import type { NavigationState } from "wow/control";
import { nextStepFor, observeNavigation } from "wow/navigation-observation";

function state(overrides: Partial<NavigationState> = {}): NavigationState {
  return {
    active: false,
    blockedReason: undefined,
    destination: undefined,
    owner: "none",
    refusal: undefined,
    remaining: undefined,
    ...overrides,
  };
}

describe("nextStepFor", () => {
  test("obstructed asks for a different route", () => {
    expect(nextStepFor("obstructed")).toBe(
      "Choose a different route. Inspect the ground before moving.",
    );
  });

  test("height_unresolved forbids retrying the heading", () => {
    expect(nextStepFor("height_unresolved")).toContain(
      "Do not retry this heading",
    );
  });

  test("any ambiguous ground column reason asks for one ground height", () => {
    expect(nextStepFor("ambiguous ground column at 8713.8, -6625.3")).toBe(
      "Choose a destination with one ground height. Do not guess Z.",
    );
  });

  test("other or missing reasons have no hint", () => {
    expect(nextStepFor(undefined)).toBeNull();
    expect(nextStepFor("rooted")).toBeNull();
    expect(nextStepFor("arrived")).toBeNull();
  });
});

describe("observeNavigation", () => {
  test("keeps the navigation state and adds the hint for its reason", () => {
    const blocked = state({
      blockedReason: "obstructed",
      destination: { x: 1, y: 2, z: 3 },
      refusal: "stop",
    });
    expect(observeNavigation(blocked)).toEqual({
      ...blocked,
      nextStep: "Choose a different route. Inspect the ground before moving.",
    });
  });

  test("an unblocked state has a null hint", () => {
    expect(observeNavigation(state({ active: true })).nextStep).toBeNull();
  });
});
