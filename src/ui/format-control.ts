import { formatGuid } from "ui/format";
import type { ControlEvent, ControlPose, ControlState } from "wow/control";

function formatPoseObj(pose: ControlPose): Record<string, unknown> {
  return {
    mapId: pose.mapId,
    orientation: pose.orientation,
    source: pose.source,
    updatedAt: pose.updatedAt,
    x: pose.x,
    y: pose.y,
    z: pose.z,
  };
}

export function nextStepFor(reason: string | undefined): string | null {
  if (reason === "obstructed")
    return "Choose a different route. Inspect the ground before moving.";
  if (reason === "height_unresolved")
    return "Choose a different short heading or a known grounded waypoint. Do not retry this heading.";
  if (reason?.includes("ambiguous ground column"))
    return "Choose a destination with one ground height. Do not guess Z.";
  return null;
}

export function formatControlStateObj(
  state: ControlState,
): Record<string, unknown> {
  return {
    blockedReason: state.blockedReason ?? null,
    direction: state.direction ?? null,
    movementAllowed: state.movementAllowed,
    moving: state.moving,
    nextStep: nextStepFor(state.blockedReason),
    owner: state.owner,
    pose: state.pose ? formatPoseObj(state.pose) : null,
    requestedTarget:
      state.requestedTarget === undefined
        ? null
        : formatGuid(state.requestedTarget),
    selfGuid: formatGuid(state.selfGuid),
    serverPose: state.serverPose ? formatPoseObj(state.serverPose) : null,
    speed: state.speed,
    target: state.target === undefined ? null : formatGuid(state.target),
  };
}

function formatPoseLine(label: string, pose: ControlPose | undefined): string {
  if (!pose) return `${label} unknown`;
  const pos = `${pose.x.toFixed(2)},${pose.y.toFixed(2)},${pose.z.toFixed(2)}`;
  return `${label} ${pose.source} ${pos} map=${pose.mapId} facing=${pose.orientation} updatedAt=${pose.updatedAt}`;
}

export function formatControlState(state: ControlState): string {
  const moving = state.moving ? `moving ${state.direction ?? "yes"}` : "idle";
  const allowed = state.movementAllowed ? "allowed" : "rooted";
  const blocked = state.blockedReason ? ` blocked=${state.blockedReason}` : "";
  const nextStep = nextStepFor(state.blockedReason);
  const observed =
    state.target === undefined ? "none" : formatGuid(state.target);
  const requested =
    state.requestedTarget === undefined
      ? "none"
      : formatGuid(state.requestedTarget);
  const header = `self ${formatGuid(state.selfGuid)} owner=${state.owner} ${moving} speed=${state.speed} ${allowed}${blocked}`;
  return `${header}\n${formatPoseLine("current pose", state.pose)}\n${formatPoseLine("last server pose", state.serverPose)}\ntarget observed=${observed} requested=${requested}${nextStep ? `\nnext step: ${nextStep}` : ""}`;
}

export function formatControlEvent(event: ControlEvent): string {
  const origin = event.state.pose?.source ?? "unknown";
  const reason = event.reason ? ` ${event.reason}` : "";
  return `[control] ${event.type} ${origin}${reason}`;
}

export function formatControlEventObj(
  event: ControlEvent,
): Record<string, unknown> {
  return {
    event: event.type,
    reason: event.reason,
    type: "CONTROL",
    ...formatControlStateObj(event.state),
  };
}
