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
    return "The current position is under a surface less than a character's height above it. Move to open ground before planning again.";
  if (reason?.includes("ambiguous ground column leaving start"))
    return "The route is refused before it leaves the multi-floor ground at the current position, such as a platform or building: the start is the problem, not the destination. Move to open ground, a spot with one floor, before planning again.";
  if (reason?.includes("ambiguous ground column at route"))
    return "The route crosses ground with more than one floor. Choose a different destination or an open-ground waypoint.";
  if (reason?.includes("ambiguous ground column at destination"))
    return "The destination has more than one floor. Repeat the goto with one of floors as Z, or choose another destination. Do not guess Z.";
  if (reason?.includes("destination is not on a ground floor"))
    return "The requested Z is not on a floor at this destination. Repeat the goto with one of floors as Z. Do not guess Z.";
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

function navigationNextStep(state: NavigationState): string | null {
  if (state.replan?.pending)
    return "Replanning from the stopped pose. Wait for navigation to become active or stop; do not issue another goto.";
  if (state.blockedReason === "pathfind_find_height failed (UNKNOWN_HEIGHT)")
    return "The planner lost the ground between this pose and the destination. Do not repeat this goto unchanged. Move about 10 yards off this spot with face and move forward, then plan again, or choose a nearer grounded waypoint. When several destinations fail this way from one pose, move first.";
  return nextStepFor(state.blockedReason);
}

export function observeNavigation(
  state: NavigationState,
): NavigationObservation {
  return { ...state, nextStep: navigationNextStep(state) };
}
