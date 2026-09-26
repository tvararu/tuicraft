import { GameOpcode } from "wow/protocol/opcodes";
import type { PacketReader } from "wow/protocol/packet";
import type { WorldConn } from "wow/world-conn";
import { sendPacket } from "wow/world-handlers";

export const LOGOUT_TIMEOUT_MS = 30_000;

export type LogoutOutcome = "complete" | "refused" | "timeout" | "closed";

export function parseLogoutResponse(r: PacketReader): {
  result: number;
  instant: boolean;
} {
  return { result: r.uint32LE(), instant: r.uint8() !== 0 };
}

export function requestLogout(
  conn: WorldConn,
  closed: Promise<void>,
  timeoutMs: number,
): Promise<LogoutOutcome> {
  const { promise, resolve } = Promise.withResolvers<LogoutOutcome>();
  const timer = setTimeout(() => resolve("timeout"), timeoutMs);
  promise.then(() => clearTimeout(timer));
  closed.then(() => resolve("closed"));
  conn.dispatch.on(GameOpcode.SMSG_LOGOUT_RESPONSE, (r) => {
    if (parseLogoutResponse(r).result !== 0) resolve("refused");
  });
  conn.dispatch.on(GameOpcode.SMSG_LOGOUT_COMPLETE, () => resolve("complete"));
  try {
    sendPacket(conn, GameOpcode.CMSG_LOGOUT_REQUEST);
  } catch {
    resolve("closed");
  }
  return promise;
}
