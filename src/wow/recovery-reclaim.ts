import type { ControlPose } from "wow/control";
import { distance } from "wow/geometry";
import type { PlayerLife } from "wow/player-state";
import type {
  RecoveryCorpse,
  RecoveryDelay,
  RecoveryReclaim,
} from "wow/recovery";

const RECLAIM_RANGE_YARDS = 39;

type GateInput = {
  life: PlayerLife;
  corpse: RecoveryCorpse;
  delay: RecoveryDelay | undefined;
  pose: ControlPose | undefined;
  now: number;
};

export function reclaimGate(input: GateInput): RecoveryReclaim {
  const { corpse, delay, pose, now } = input;
  const remainingMs = delay ? Math.max(0, delay.readyAt - now) : undefined;
  const result: RecoveryReclaim = {
    canRequest: false,
    readiness: "blocked",
    reason: reclaimBlocker(input),
    distance: undefined,
    remainingMs,
    pose: pose ? { ...pose } : undefined,
  };
  if (result.reason || corpse.status !== "found" || !pose) return result;
  result.distance = distance(pose, corpse.position);
  if (result.distance > RECLAIM_RANGE_YARDS)
    result.reason = "corpse_out_of_range";
  else if (remainingMs !== undefined && remainingMs > 0)
    result.reason = "reclaim_delay";
  else {
    result.canRequest = true;
    result.readiness = remainingMs === undefined ? "unverified" : "ready";
  }
  return result;
}

function finite(point: { x: number; y: number; z: number }): boolean {
  return [point.x, point.y, point.z].every(Number.isFinite);
}

function reclaimBlocker({ life, corpse, pose }: GateInput): string | undefined {
  if (life === "unknown") return "life_unknown";
  if (life !== "ghost") return "not_ghost";
  if (corpse.status === "unknown") return "corpse_unknown";
  if (corpse.status === "absent") return "corpse_absent";
  if (corpse.mapId !== corpse.corpseMapId || corpse.mapId < 0)
    return "corpse_position_unknown";
  if (!(pose && finite(pose))) return "pose_unknown";
  if (pose.mapId !== corpse.corpseMapId) return "corpse_map_mismatch";
  if (!finite(corpse.position)) return "corpse_position_unknown";
  return undefined;
}
