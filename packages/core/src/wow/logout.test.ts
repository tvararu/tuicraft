import { describe, expect, test } from "bun:test";
import {
  clientPrivateKey,
  clientSeed,
  FIXTURE_ACCOUNT,
  FIXTURE_CHARACTER,
  FIXTURE_PASSWORD,
  sessionKey,
} from "#test-support/fixtures";
import { startMockWorldServer } from "#test-support/mock-world-server";
import { worldSession } from "#wow/client";
import { GameOpcode } from "#wow/protocol/opcodes";
import { PacketWriter } from "#wow/protocol/packet";

function logoutResponse(result: number, instant: boolean): Uint8Array {
  const w = new PacketWriter();
  w.uint32LE(result);
  w.uint8(instant ? 1 : 0);
  return w.finish();
}

async function session(logoutTimeoutMs?: number) {
  const server = await startMockWorldServer();
  const handle = await worldSession(
    {
      account: FIXTURE_ACCOUNT,
      character: FIXTURE_CHARACTER,
      clientSeed,
      host: "127.0.0.1",
      logoutTimeoutMs,
      password: FIXTURE_PASSWORD,
      port: server.port,
      srpPrivateKey: clientPrivateKey,
    },
    {
      realmHost: "127.0.0.1",
      realmId: 1,
      realmPort: server.port,
      sessionKey,
    },
  );
  let isClosed = false;
  handle.closed.then(() => {
    isClosed = true;
  });
  const requested = () =>
    server.waitForCapture((p) => p.opcode === GameOpcode.CMSG_LOGOUT_REQUEST);
  return { handle, isClosed: () => isClosed, requested, server };
}

describe("logout", () => {
  test("keeps the socket open through the countdown until logout completes", async () => {
    const s = await session();
    try {
      s.handle.logout();
      s.handle.logout();
      await s.requested();
      s.server.inject(
        GameOpcode.SMSG_LOGOUT_RESPONSE,
        logoutResponse(0, false),
      );
      const sync = new PacketWriter();
      sync.uint32LE(7);
      s.server.inject(GameOpcode.SMSG_TIME_SYNC_REQ, sync.finish());
      await s.server.waitForCapture(
        (p) => p.opcode === GameOpcode.CMSG_TIME_SYNC_RESP,
      );
      expect(s.isClosed()).toBe(false);
      s.server.inject(GameOpcode.SMSG_LOGOUT_COMPLETE, new Uint8Array(0));
      await s.handle.closed;
      const requests = s.server.captured.filter(
        (p) => p.opcode === GameOpcode.CMSG_LOGOUT_REQUEST,
      );
      expect(requests).toHaveLength(1);
    } finally {
      s.server.stop();
    }
  });

  test("closes at once when an instant logout completes", async () => {
    const s = await session();
    try {
      s.handle.logout();
      await s.requested();
      s.server.inject(GameOpcode.SMSG_LOGOUT_RESPONSE, logoutResponse(0, true));
      s.server.inject(GameOpcode.SMSG_LOGOUT_COMPLETE, new Uint8Array(0));
      await s.handle.closed;
    } finally {
      s.server.stop();
    }
  });

  test("disconnects when the server refuses the logout", async () => {
    const s = await session();
    try {
      s.handle.logout();
      await s.requested();
      s.server.inject(
        GameOpcode.SMSG_LOGOUT_RESPONSE,
        logoutResponse(1, false),
      );
      await s.handle.closed;
    } finally {
      s.server.stop();
    }
  });

  test("disconnects when the server never answers", async () => {
    const s = await session(10);
    try {
      s.handle.logout();
      await s.requested();
      await s.handle.closed;
    } finally {
      s.server.stop();
    }
  });
});
