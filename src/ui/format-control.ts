import { formatGuid } from "ui/format";
import {
  type ControlEvent,
  type ControlPose,
  type ControlState,
  nextStepFor,
} from "wow";

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

const STEP_STOPS = ["lease", "direction_change"];

export function formatControlEvent(event: ControlEvent): string | undefined {
  const origin = event.state.pose?.source ?? "unknown";
  const step =
    event.type === "movement_started" ||
    event.type === "facing_changed" ||
    (event.type === "movement_stopped" &&
      STEP_STOPS.includes(event.reason ?? ""));
  if (step && origin === "predicted") return undefined;
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
