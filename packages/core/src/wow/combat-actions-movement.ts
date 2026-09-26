import type { MovementDirection } from "#wow/control";

export const WAIT = {
  id: "wait",
  description:
    "Hold current state and start nothing new: if moving, this refreshes the current direction's movement lease; if stationary, this is a no-op. Use stop_moving to release movement explicitly.",
};
const MOVEMENT_LEASE_DESCRIPTION =
  "continues under a renewable movement lease until a later decision names a different direction, stop_moving is chosen, or the lease lapses without being renewed.";
export const MOVE_CANDIDATES: ReadonlyArray<{
  id: string;
  direction: MovementDirection;
  description: string;
}> = [
  {
    id: "move_forward",
    direction: "forward",
    description: `Move forward; ${MOVEMENT_LEASE_DESCRIPTION}`,
  },
  {
    id: "move_backward",
    direction: "backward",
    description: `Move backward; ${MOVEMENT_LEASE_DESCRIPTION}`,
  },
  {
    id: "strafe_left",
    direction: "left",
    description: `Strafe left; ${MOVEMENT_LEASE_DESCRIPTION}`,
  },
  {
    id: "strafe_right",
    direction: "right",
    description: `Strafe right; ${MOVEMENT_LEASE_DESCRIPTION}`,
  },
];
export const MOVE_DIRECTION_BY_ID: Record<string, MovementDirection> = {
  move_forward: "forward",
  move_backward: "backward",
  strafe_left: "left",
  strafe_right: "right",
};
export const STOP_MOVING = {
  id: "stop_moving",
  description: "Stop moving now and release the movement lease immediately.",
};
export const MOVE_LEASE_MS = 2500;
