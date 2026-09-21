import { parseMovementInfo, type MovementInfo } from "wow/protocol/movement";
import { GameOpcode } from "wow/protocol/opcodes";
import type { PacketReader } from "wow/protocol/packet";

export type RemoteMovementBody =
  | {
      kind: "movement";
      info: MovementInfo;
      transition: "ordinary" | "teleport" | "knockback";
      speed?: number;
      collisionHeight?: number;
      knockback?: {
        sinAngle: number;
        cosAngle: number;
        xySpeed: number;
        zSpeed: number;
      };
    }
  | { kind: "time_skipped"; milliseconds: number };

type Layout =
  | "ordinary"
  | "speed"
  | "collision_height"
  | "teleport"
  | "knockback"
  | "time_skipped";

const layouts = new Map<number, Layout>([
  [GameOpcode.MSG_MOVE_START_FORWARD, "ordinary"],
  [GameOpcode.MSG_MOVE_START_BACKWARD, "ordinary"],
  [GameOpcode.MSG_MOVE_STOP, "ordinary"],
  [GameOpcode.MSG_MOVE_START_STRAFE_LEFT, "ordinary"],
  [GameOpcode.MSG_MOVE_START_STRAFE_RIGHT, "ordinary"],
  [GameOpcode.MSG_MOVE_STOP_STRAFE, "ordinary"],
  [GameOpcode.MSG_MOVE_JUMP, "ordinary"],
  [GameOpcode.MSG_MOVE_START_TURN_LEFT, "ordinary"],
  [GameOpcode.MSG_MOVE_START_TURN_RIGHT, "ordinary"],
  [GameOpcode.MSG_MOVE_STOP_TURN, "ordinary"],
  [GameOpcode.MSG_MOVE_START_PITCH_UP, "ordinary"],
  [GameOpcode.MSG_MOVE_START_PITCH_DOWN, "ordinary"],
  [GameOpcode.MSG_MOVE_STOP_PITCH, "ordinary"],
  [GameOpcode.MSG_MOVE_SET_RUN_MODE, "ordinary"],
  [GameOpcode.MSG_MOVE_SET_WALK_MODE, "ordinary"],
  [GameOpcode.MSG_MOVE_FALL_LAND, "ordinary"],
  [GameOpcode.MSG_MOVE_START_SWIM, "ordinary"],
  [GameOpcode.MSG_MOVE_STOP_SWIM, "ordinary"],
  [GameOpcode.MSG_MOVE_SET_FACING, "ordinary"],
  [GameOpcode.MSG_MOVE_SET_PITCH, "ordinary"],
  [GameOpcode.MSG_MOVE_ROOT, "ordinary"],
  [GameOpcode.MSG_MOVE_UNROOT, "ordinary"],
  [GameOpcode.MSG_MOVE_HEARTBEAT, "ordinary"],
  [GameOpcode.MSG_MOVE_HOVER, "ordinary"],
  [GameOpcode.MSG_MOVE_FEATHER_FALL, "ordinary"],
  [GameOpcode.MSG_MOVE_WATER_WALK, "ordinary"],
  [GameOpcode.CMSG_MOVE_SET_FLY, "ordinary"],
  [GameOpcode.MSG_MOVE_START_ASCEND, "ordinary"],
  [GameOpcode.MSG_MOVE_STOP_ASCEND, "ordinary"],
  [GameOpcode.MSG_MOVE_START_DESCEND, "ordinary"],
  [GameOpcode.MSG_MOVE_UPDATE_CAN_FLY, "ordinary"],
  [GameOpcode.MSG_MOVE_GRAVITY_CHNG, "ordinary"],
  [GameOpcode.MSG_MOVE_SET_RUN_SPEED, "speed"],
  [GameOpcode.MSG_MOVE_SET_RUN_BACK_SPEED, "speed"],
  [GameOpcode.MSG_MOVE_SET_WALK_SPEED, "speed"],
  [GameOpcode.MSG_MOVE_SET_SWIM_SPEED, "speed"],
  [GameOpcode.MSG_MOVE_SET_SWIM_BACK_SPEED, "speed"],
  [GameOpcode.MSG_MOVE_SET_TURN_RATE, "speed"],
  [GameOpcode.MSG_MOVE_SET_FLIGHT_SPEED, "speed"],
  [GameOpcode.MSG_MOVE_SET_FLIGHT_BACK_SPEED, "speed"],
  [GameOpcode.MSG_MOVE_SET_PITCH_RATE, "speed"],
  [GameOpcode.MSG_MOVE_SET_COLLISION_HGT, "collision_height"],
  [GameOpcode.MSG_MOVE_TELEPORT, "teleport"],
  [GameOpcode.MSG_MOVE_KNOCK_BACK, "knockback"],
  [GameOpcode.MSG_MOVE_TIME_SKIPPED, "time_skipped"],
]);

export const REMOTE_MOVEMENT_OPCODES: number[] = [...layouts.keys()];

function finite(value: number | undefined): void {
  if (value !== undefined && !Number.isFinite(value))
    throw new RangeError("Nonfinite remote movement value");
}

function position(
  info: Pick<MovementInfo, "x" | "y" | "z" | "orientation">,
): void {
  finite(info.x);
  finite(info.y);
  finite(info.z);
  finite(info.orientation);
}

function validate(info: MovementInfo): void {
  position(info);
  if (info.transport) position(info.transport);
  finite(info.pitch);
  finite(info.splineElevation);
  if (info.fall) {
    finite(info.fall.sinAngle);
    finite(info.fall.cosAngle);
    finite(info.fall.xySpeed);
    finite(info.fall.zSpeed);
  }
}

function float(reader: PacketReader): number {
  const value = reader.floatLE();
  finite(value);
  return value;
}

function end(reader: PacketReader): void {
  if (reader.remaining !== 0)
    throw new RangeError("Unexpected trailing remote movement payload");
}

export function parseRemoteMovementBody(
  opcode: number,
  reader: PacketReader,
): RemoteMovementBody {
  const layout = layouts.get(opcode);
  if (layout === undefined)
    throw new RangeError("Unsupported remote movement opcode");
  if (layout === "time_skipped") {
    const milliseconds = reader.uint32LE();
    end(reader);
    return { kind: "time_skipped", milliseconds };
  }
  const info = parseMovementInfo(reader);
  validate(info);
  const result: RemoteMovementBody = {
    kind: "movement",
    info,
    transition: "ordinary",
  };
  if (layout === "teleport") result.transition = "teleport";
  if (layout === "speed") result.speed = float(reader);
  if (layout === "collision_height") result.collisionHeight = float(reader);
  if (layout === "knockback") {
    result.transition = "knockback";
    result.knockback = {
      sinAngle: float(reader),
      cosAngle: float(reader),
      xySpeed: float(reader),
      zSpeed: float(reader),
    };
  }
  end(reader);
  return result;
}
