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

  test("gives each ambiguous-column site its own advice", () => {
    expect(nextStepFor("ambiguous ground column at destination")).toContain(
      "Choose a destination with one ground height",
    );
    expect(nextStepFor("ambiguous ground column at start")).toContain(
      "Move to open ground",
    );
    expect(nextStepFor("ambiguous ground column at route")).toContain(
      "route crosses ground",
    );
  });

  test("a lost target and an unreachable destination forbid retrying", () => {
    expect(nextStepFor("target_lost")).toContain("route was not retried");
    expect(nextStepFor("pathfind_find_path failed (UNKNOWN_PATH)")).toContain(
      "do not retry this one",
    );
    expect(nextStepFor("start snapped off the requested ground position")).toBe(
      null,
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

  test("carries the site-specific hint for a start refusal", () => {
    const blocked = state({
      blockedReason: "ambiguous ground column at start",
      destination: { x: 1, y: 2 },
      refusal: "stop",
    });
    expect(observeNavigation(blocked).nextStep).toContain(
      "Move to open ground",
    );
  });

  test("an unblocked state has a null hint", () => {
    expect(observeNavigation(state({ active: true })).nextStep).toBeNull();
  });
});
