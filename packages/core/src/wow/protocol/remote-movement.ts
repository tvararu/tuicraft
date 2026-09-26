import { inflateSync } from "node:zlib";
import { type MovementInfo, parseMovementInfo } from "#wow/protocol/movement";
import { GameOpcode } from "#wow/protocol/opcodes";
import { PacketReader } from "#wow/protocol/packet";

export type RemoteTransition = "ordinary" | "teleport" | "knockback";

export type RemoteMovementBody =
  | {
      kind: "movement";
      info: MovementInfo;
      transition: RemoteTransition;
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

export type CompressedMove = { opcode: number; body: Uint8Array };

type Layout =
  | "ordinary"
  | "speed"
  | "collision_height"
  | "teleport"
  | "knockback"
  | "time_skipped";

const LAYOUTS = new Map<number, Layout>([
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

export const REMOTE_MOVEMENT_OPCODES: readonly number[] = [...LAYOUTS.keys()];

export function isRemoteMovementOpcode(opcode: number): boolean {
  return LAYOUTS.has(opcode);
}

function finite(value: number | undefined): void {
  if (value !== undefined && !Number.isFinite(value))
    throw new RangeError("Nonfinite remote movement value");
}

function finitePlacement(
  place: Pick<MovementInfo, "x" | "y" | "z" | "orientation">,
): void {
  finite(place.x);
  finite(place.y);
  finite(place.z);
  finite(place.orientation);
}

export function assertFiniteMovement(info: MovementInfo): void {
  finitePlacement(info);
  if (info.transport) finitePlacement(info.transport);
  finite(info.pitch);
  finite(info.splineElevation);
  if (info.fall) {
    finite(info.fall.sinAngle);
    finite(info.fall.cosAngle);
    finite(info.fall.xySpeed);
    finite(info.fall.zSpeed);
  }
}

function float(r: PacketReader): number {
  const value = r.floatLE();
  finite(value);
  return value;
}

function end(r: PacketReader): void {
  if (r.remaining !== 0)
    throw new RangeError("Unexpected trailing remote movement payload");
}

export function parseRemoteMovementBody(
  opcode: number,
  r: PacketReader,
): RemoteMovementBody {
  const layout = LAYOUTS.get(opcode);
  if (layout === undefined)
    throw new RangeError("Unsupported remote movement opcode");
  if (layout === "time_skipped") {
    const milliseconds = r.uint32LE();
    end(r);
    return { kind: "time_skipped", milliseconds };
  }
  const info = parseMovementInfo(r);
  assertFiniteMovement(info);
  const body: RemoteMovementBody = {
    kind: "movement",
    info,
    transition: "ordinary",
  };
  if (layout === "teleport") body.transition = "teleport";
  if (layout === "speed") body.speed = float(r);
  if (layout === "collision_height") body.collisionHeight = float(r);
  if (layout === "knockback") {
    body.transition = "knockback";
    const sinAngle = float(r);
    const cosAngle = float(r);
    const xySpeed = float(r);
    body.knockback = { sinAngle, cosAngle, xySpeed, zSpeed: float(r) };
  }
  end(r);
  return body;
}

export function parseCompressedMoves(r: PacketReader): CompressedMove[] {
  const size = r.uint32LE();
  const inflated = inflateSync(r.bytes(r.remaining));
  if (inflated.length !== size)
    throw new RangeError(
      `Compressed moves size mismatch: expected ${size}, got ${inflated.length}`,
    );
  const moves = new PacketReader(new Uint8Array(inflated));
  const result: CompressedMove[] = [];
  while (moves.remaining > 0) {
    const length = moves.uint8();
    if (length < 2 || length > moves.remaining)
      throw new RangeError(`Compressed move length ${length} out of bounds`);
    const opcode = moves.uint16LE();
    result.push({ opcode, body: moves.bytes(length - 2) });
  }
  return result;
}
