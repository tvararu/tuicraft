import type { NavigationState } from "#wow/control";
import { classifyNavigationRefusal } from "#wow/navigation";

export type NavigationObservation = NavigationState & {
  nextStep: string | null;
};

const EXACT_STEPS = new Map<string, string>([
  ["obstructed", "Choose a different route. Inspect the ground before moving."],
  [
    "height_unresolved",
    "Choose a different short heading or a known grounded waypoint. Do not retry this heading.",
  ],
  [
    "too_steep",
    "The ground ahead rises or drops more than a character can walk. Turn along the slope or pick another heading.",
  ],
  [
    "target_lost",
    "The destination creature is no longer observed. Choose a currently observed target; the route was not retried.",
  ],
  [
    "replan_no_progress",
    "The route stopped again before moving far from its last plan. Choose another destination or a nearer grounded waypoint.",
  ],
]);

const CONTAINED_STEPS: readonly (readonly [string, string])[] = [
  [
    "ambiguous ground column at start",
    "The current position is under a surface less than a character's height above it. Move to open ground before planning again.",
  ],
  [
    "ambiguous ground column leaving start",
    "The route is refused before it leaves the multi-floor ground at the current position, such as a platform or building: the start is the problem, not the destination. Move to open ground, a spot with one floor, before planning again.",
  ],
  [
    "ambiguous ground column at route",
    "The route crosses ground with more than one floor. Choose a different destination or an open-ground waypoint.",
  ],
  [
    "ambiguous ground column at destination",
    "The destination has more than one floor. Repeat the goto with one of floors as Z, or choose another destination. Do not guess Z.",
  ],
  [
    "destination is not on a ground floor",
    "The requested Z is not on a floor at this destination. Repeat the goto with one of floors as Z. Do not guess Z.",
  ],
  [
    "start snapped off",
    "The current position is off the walkable mesh, for example against an object or a building. Move 3 to 5 yards into open ground with face and move forward, then plan again. Do not repeat this goto from here.",
  ],
  [
    "ground corridor changes surface",
    "The route's ground changes to another surface on the way, such as a ramp onto a platform. Choose a nearer waypoint on the same floor or another destination; do not repeat this goto unchanged.",
  ],
];

export function nextStepFor(reason: string | undefined): string | null {
  if (reason === undefined) return null;
  const exact = EXACT_STEPS.get(reason);
  if (exact !== undefined) return exact;
  const contained = CONTAINED_STEPS.find(([cause]) => reason.includes(cause));
  if (contained) return contained[1];
  if (classifyNavigationRefusal(reason) === "unreachable")
    return "The navigation mesh cannot reach this destination. Choose another destination; do not retry this one.";
  if (reason.startsWith("replan_refused"))
    return "The planner refused a new route from the stopped pose. Choose another destination; do not repeat this goto unchanged.";
  if (reason.startsWith("replan_"))
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
