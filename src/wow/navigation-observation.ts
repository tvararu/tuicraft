import type { NavigationState } from "wow/control";
import { classifyNavigationRefusal } from "wow/navigation";

export type NavigationObservation = NavigationState & {
  nextStep: string | null;
};

export function nextStepFor(reason: string | undefined): string | null {
  if (reason === "obstructed")
    return "Choose a different route. Inspect the ground before moving.";
  if (reason === "height_unresolved")
    return "Choose a different short heading or a known grounded waypoint. Do not retry this heading.";
  if (reason?.includes("ambiguous ground column at start"))
    return "The current position has more than one floor. Move to open ground with one ground height before planning again.";
  if (reason?.includes("ambiguous ground column at route"))
    return "The route crosses ground with more than one floor. Choose a different destination or an open-ground waypoint.";
  if (reason?.includes("ambiguous ground column"))
    return "Choose a destination with one ground height. Do not guess Z.";
  if (reason === "target_lost")
    return "The destination creature is no longer observed. Choose a currently observed target; the route was not retried.";
  if (reason && classifyNavigationRefusal(reason) === "unreachable")
    return "The navigation mesh cannot reach this destination. Choose another destination; do not retry this one.";
  return null;
}

export function observeNavigation(
  state: NavigationState,
): NavigationObservation {
  return { ...state, nextStep: nextStepFor(state.blockedReason) };
}
