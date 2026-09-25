import type { WorldConn } from "wow/client";
import {
  parseClientControl,
  parseForceSpeed,
  parseKnockBack,
  parseMoveCounter,
  parseMovementInfo,
  parseTeleportAck,
  parseWorldPosition,
  SPEED_ACKS,
  type SpeedAck,
} from "wow/protocol/movement";
import { GameOpcode } from "wow/protocol/opcodes";
import type { PacketReader } from "wow/protocol/packet";
import { selfGuid } from "wow/world-handlers";

function handleNearTeleport(conn: WorldConn, r: PacketReader): void {
  const guid = r.packedGuidBig();
  const info = parseMovementInfo(r);
  if (guid === selfGuid(conn)) {
    conn.control?.nearTeleport(info);
    return;
  }
  const position = {
    mapId: conn.control?.currentMapId() ?? 0,
    x: info.x,
    y: info.y,
    z: info.z,
    orientation: info.orientation,
  };
  conn.entityStore.setPosition(guid, position);
  conn.combat?.observePosition(guid, position);
}

function handleTeleportAckRequest(conn: WorldConn, r: PacketReader): void {
  conn.control?.teleportAck(parseTeleportAck(r));
}

function handleTransferPending(conn: WorldConn): void {
  conn.control?.handleTransferPending();
}

function handleNewWorld(conn: WorldConn, r: PacketReader): void {
  conn.control?.newWorld(parseWorldPosition(r));
  conn.quests?.resetInteraction();
  conn.entityStore.clear();
  conn.quests?.observeQuestLog();
}

function handleForceMoveRoot(conn: WorldConn, r: PacketReader): void {
  conn.control?.forceRoot(parseMoveCounter(r).counter);
}

function handleForceMoveUnroot(conn: WorldConn, r: PacketReader): void {
  conn.control?.forceUnroot(parseMoveCounter(r).counter);
}

function handleMoveKnockBack(conn: WorldConn, r: PacketReader): void {
  conn.control?.knockBack(parseKnockBack(r));
}

function handleClientControlUpdate(conn: WorldConn, r: PacketReader): void {
  conn.control?.clientControl(parseClientControl(r));
}

function handleForceSpeedChange(
  conn: WorldConn,
  r: PacketReader,
  spec: SpeedAck,
): void {
  conn.control?.forceSpeed(spec, parseForceSpeed(r, spec));
}

function handleCanFly(conn: WorldConn, r: PacketReader, enable: boolean): void {
  conn.control?.setCanFly(parseMoveCounter(r).counter, enable);
}

export function registerMovementHandlers(conn: WorldConn): void {
  conn.dispatch.on(GameOpcode.SMSG_LOGIN_VERIFY_WORLD, (r) => {
    conn.control?.loginVerified(parseWorldPosition(r));
  });
  conn.dispatch.on(GameOpcode.MSG_MOVE_TELEPORT, (r) =>
    handleNearTeleport(conn, r),
  );
  conn.dispatch.on(GameOpcode.MSG_MOVE_TELEPORT_ACK, (r) =>
    handleTeleportAckRequest(conn, r),
  );
  conn.dispatch.on(GameOpcode.SMSG_TRANSFER_PENDING, () =>
    handleTransferPending(conn),
  );
  conn.dispatch.on(GameOpcode.SMSG_NEW_WORLD, (r) => handleNewWorld(conn, r));
  conn.dispatch.on(GameOpcode.SMSG_FORCE_MOVE_ROOT, (r) =>
    handleForceMoveRoot(conn, r),
  );
  conn.dispatch.on(GameOpcode.SMSG_FORCE_MOVE_UNROOT, (r) =>
    handleForceMoveUnroot(conn, r),
  );
  conn.dispatch.on(GameOpcode.SMSG_MOVE_KNOCK_BACK, (r) =>
    handleMoveKnockBack(conn, r),
  );
  conn.dispatch.on(GameOpcode.SMSG_CLIENT_CONTROL_UPDATE, (r) =>
    handleClientControlUpdate(conn, r),
  );
  conn.dispatch.on(GameOpcode.SMSG_MOVE_SET_CAN_FLY, (r) =>
    handleCanFly(conn, r, true),
  );
  conn.dispatch.on(GameOpcode.SMSG_MOVE_UNSET_CAN_FLY, (r) =>
    handleCanFly(conn, r, false),
  );
  for (const spec of SPEED_ACKS)
    conn.dispatch.on(spec.smsg, (r) => handleForceSpeedChange(conn, r, spec));
}
