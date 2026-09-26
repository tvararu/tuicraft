import type { NavigationState } from "wow/control";

export type NavigationObservation = NavigationState & {
  nextStep: string | null;
};

export function nextStepFor(reason: string | undefined): string | null {
  if (reason === "obstructed")
    return "Choose a different route. Inspect the ground before moving.";
  if (reason === "height_unresolved")
    return "Choose a different short heading or a known grounded waypoint. Do not retry this heading.";
  if (reason?.includes("ambiguous ground column"))
    return "Choose a destination with one ground height. Do not guess Z.";
  return null;
}

export function observeNavigation(
  state: NavigationState,
): NavigationObservation {
  return { ...state, nextStep: nextStepFor(state.blockedReason) };
}
