import { describe, expect, test } from "bun:test";
import type { NavigationState } from "#wow/control";
import { nextStepFor, observeNavigation } from "#wow/navigation-observation";

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

  test("start-side refusals send the caller to open ground, not elsewhere", () => {
    for (const site of ["at start", "leaving start"]) {
      const hint = nextStepFor(`ambiguous ground column ${site}`);
      expect(hint).toContain("Move to open ground");
      expect(hint).not.toMatch(/choose/i);
    }
  });

  test("gives each ambiguous-column site its own advice", () => {
    expect(
      nextStepFor("ambiguous ground column at destination (floors 30, 20)"),
    ).toContain("one of floors as Z");
    expect(
      nextStepFor("destination is not on a ground floor (floors 30)"),
    ).toContain("one of floors as Z");
    expect(nextStepFor("ambiguous ground column at route")).toContain(
      "route crosses ground",
    );
  });

  test("a lost target and an unreachable destination forbid retrying", () => {
    expect(nextStepFor("target_lost")).toContain("route was not retried");
    expect(nextStepFor("pathfind_find_path failed (UNKNOWN_PATH)")).toContain(
      "do not retry this one",
    );
  });

  test("a snapped start sends the caller into open ground, not to retry", () => {
    const hint = nextStepFor("start snapped off the requested ground position");
    expect(hint).toContain("off the walkable mesh");
    expect(hint).toContain("Move 3 to 5 yards into open ground");
    expect(hint).toContain("Do not repeat this goto from here");
    expect(hint).not.toMatch(/NPC/);
  });

  test("an end snap keeps the unreachable hint", () => {
    expect(
      nextStepFor("end snapped off the requested ground position"),
    ).toContain("do not retry this one");
  });

  test("a corridor that changes surface names a different route", () => {
    const hint = nextStepFor("ground corridor changes surface");
    expect(hint).toContain("changes to another surface");
    expect(hint).toContain("nearer waypoint on the same floor");
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

  test("a planner UNKNOWN_HEIGHT refusal asks for a short move or a nearer waypoint", () => {
    const unknown = "pathfind_find_height failed (UNKNOWN_HEIGHT)";
    const hint = observeNavigation(
      state({ blockedReason: unknown, refusal: "stop" }),
    ).nextStep;
    expect(hint).toContain("Do not repeat this goto unchanged");
    expect(hint).toContain("Move about 10 yards off this spot");
    expect(hint).toContain("nearer grounded waypoint");
    expect(
      observeNavigation(
        state({ blockedReason: `replan_refused: ${unknown}`, refusal: "stop" }),
      ).nextStep,
    ).toContain("refused a new route from the stopped pose");
  });

  test("an unblocked state has a null hint", () => {
    expect(observeNavigation(state({ active: true })).nextStep).toBeNull();
  });
});
