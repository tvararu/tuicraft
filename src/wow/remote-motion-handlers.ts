import { GameOpcode } from "wow/protocol/opcodes";
import { PacketReader } from "wow/protocol/packet";
import {
  isRemoteMovementOpcode,
  parseCompressedMoves,
  parseRemoteMovementBody,
  REMOTE_MOVEMENT_OPCODES,
  type RemoteMovementBody,
} from "wow/protocol/remote-movement";
import type { WorldConn } from "wow/world-conn";

export function observeRemoteMovement(
  conn: WorldConn,
  opcode: number,
  guid: bigint,
  r: PacketReader,
): void {
  let body: RemoteMovementBody;
  try {
    body = parseRemoteMovementBody(opcode, r);
  } catch (error) {
    conn.remoteMotion.invalidate(guid, "malformed");
    throw error;
  }
  if (body.kind === "time_skipped") {
    conn.remoteMotion.invalidate(guid, "time_skipped");
    return;
  }
  const { info, transition } = body;
  const position = {
    mapId: conn.control?.currentMapId() ?? 0,
    x: info.x,
    y: info.y,
    z: info.z,
    orientation: info.orientation,
  };
  const source = "observer";
  conn.remoteMotion.observe(guid, { position, source, info, transition });
  conn.entityStore.setPosition(guid, position);
  conn.combat?.observePosition(guid, position, undefined, "movement");
}

export function handleCompressedMoves(conn: WorldConn, r: PacketReader): void {
  let failure: unknown;
  for (const move of parseCompressedMoves(r)) {
    const supported =
      isRemoteMovementOpcode(move.opcode) ||
      move.opcode === GameOpcode.SMSG_MONSTER_MOVE;
    if (!supported) continue;
    try {
      conn.dispatch.handle(move.opcode, new PacketReader(move.body));
    } catch (error) {
      failure ??= error;
    }
  }
  if (failure) throw failure;
}

export function registerRemoteMotionHandlers(conn: WorldConn): void {
  for (const opcode of REMOTE_MOVEMENT_OPCODES) {
    if (opcode === GameOpcode.MSG_MOVE_TELEPORT) continue;
    conn.dispatch.on(opcode, (r) =>
      observeRemoteMovement(conn, opcode, r.packedGuidBig(), r),
    );
  }
  conn.dispatch.on(GameOpcode.SMSG_COMPRESSED_MOVES, (r) =>
    handleCompressedMoves(conn, r),
  );
}
