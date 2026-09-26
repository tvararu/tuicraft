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
  if (reason === "too_steep")
    return "The ground ahead rises or drops more than a character can walk. Turn along the slope or pick another heading.";
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
  if (reason === "replan_no_progress")
    return "The route stopped again before moving far from its last plan. Choose another destination or a nearer grounded waypoint.";
  if (reason?.startsWith("replan_refused"))
    return "The planner refused a new route from the stopped pose. Choose another destination; do not repeat this goto unchanged.";
  if (reason?.startsWith("replan_"))
    return "Replanning reached its limit. Inspect navigation.replan and choose another destination; do not repeat this goto unchanged.";
  return null;
}

export function observeNavigation(
  state: NavigationState,
): NavigationObservation {
  const nextStep = state.replan?.pending
    ? "Replanning from the stopped pose. Wait for navigation to become active or stop; do not issue another goto."
    : nextStepFor(state.blockedReason);
  return { ...state, nextStep };
}
