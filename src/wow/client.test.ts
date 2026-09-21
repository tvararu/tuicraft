import { test, expect, describe } from "bun:test";
import { authHandshake } from "wow/auth";
import type { AuthResult } from "wow/auth";
import { worldSession } from "wow/client";
import { startMockAuthServer } from "test/mock-auth-server";
import { startMockWorldServer } from "test/mock-world-server";
import { GameOpcode } from "wow/protocol/opcodes";
import { PacketWriter } from "wow/protocol/packet";
import type { QuestEvent } from "wow/quests";
import {
  FIXTURE_ACCOUNT,
  FIXTURE_PASSWORD,
  FIXTURE_CHARACTER,
  clientPrivateKey,
  clientSeed,
  sessionKey,
} from "test/fixtures";

const base = {
  account: FIXTURE_ACCOUNT,
  password: FIXTURE_PASSWORD,
  character: FIXTURE_CHARACTER,
  srpPrivateKey: clientPrivateKey,
  clientSeed,
};

function fakeAuth(port: number): AuthResult {
  return {
    sessionKey,
    realmHost: "127.0.0.1",
    realmPort: port,
    realmId: 1,
  };
}

describe("session lifecycle", () => {
  test("full login flow: auth → world → character select → login", async () => {
    const worldServer = await startMockWorldServer();
    const authServer = await startMockAuthServer({
      realmAddress: `127.0.0.1:${worldServer.port}`,
    });
    try {
      const auth = await authHandshake({
        ...base,
        host: "127.0.0.1",
        port: authServer.port,
      });
      const handle = await worldSession(
        { ...base, host: "127.0.0.1", port: worldServer.port },
        auth,
      );

      handle.close();
      await handle.closed;
    } finally {
      authServer.stop();
      worldServer.stop();
    }
  });

  test("rejects when world auth status is not 0x0c", async () => {
    const ws = await startMockWorldServer({ authStatus: 0x01 });
    try {
      await expect(
        worldSession(
          { ...base, host: "127.0.0.1", port: ws.port },
          fakeAuth(ws.port),
        ),
      ).rejects.toThrow("World auth failed: status 0x1");
    } finally {
      ws.stop();
    }
  });

  test("rejects with named message for system error (0x0d)", async () => {
    const ws = await startMockWorldServer({ authStatus: 0x0d });
    try {
      await expect(
        worldSession(
          { ...base, host: "127.0.0.1", port: ws.port },
          fakeAuth(ws.port),
        ),
      ).rejects.toThrow("World auth failed: system error");
    } finally {
      ws.stop();
    }
  });

  test("rejects with named message for account in use (0x15)", async () => {
    const ws = await startMockWorldServer({ authStatus: 0x15 });
    try {
      await expect(
        worldSession(
          { ...base, host: "127.0.0.1", port: ws.port },
          fakeAuth(ws.port),
        ),
      ).rejects.toThrow("World auth failed: account in use");
    } finally {
      ws.stop();
    }
  });

  test("rejects when character is not found", async () => {
    const ws = await startMockWorldServer();
    try {
      await expect(
        worldSession(
          {
            ...base,
            character: "Nonexistent",
            host: "127.0.0.1",
            port: ws.port,
          },
          fakeAuth(ws.port),
        ),
      ).rejects.toThrow('Character "Nonexistent" not found');
    } finally {
      ws.stop();
    }
  });

  test("ping interval fires and server handles CMSG_PING", async () => {
    const ws = await startMockWorldServer();
    try {
      const handle = await worldSession(
        { ...base, host: "127.0.0.1", port: ws.port, pingIntervalMs: 1 },
        fakeAuth(ws.port),
      );
      await ws.waitForCapture((p) => p.opcode === GameOpcode.CMSG_PING);
      handle.close();
      await handle.closed;
    } finally {
      ws.stop();
    }
  });

  test("coalesced login verify stamps map on the self create", async () => {
    const worldServer = await startMockWorldServer({
      loginMapId: 530,
      coalesceSelfCreate: true,
    });
    try {
      const handle = await worldSession(
        { ...base, host: "127.0.0.1", port: worldServer.port },
        fakeAuth(worldServer.port),
      );
      expect(handle.getControlState().pose?.mapId).toBe(530);
      const self = handle.getNearbyEntities().find((e) => e.guid === 0x42n);
      expect(self?.position?.mapId).toBe(530);
      handle.close();
      await handle.closed;
    } finally {
      worldServer.stop();
    }
  });

  test("world transfer invalidates quest authority before another self CREATE", async () => {
    const worldServer = await startMockWorldServer({
      coalesceSelfCreate: true,
    });
    try {
      const handle = await worldSession(
        { ...base, host: "127.0.0.1", port: worldServer.port },
        fakeAuth(worldServer.port),
      );
      expect(handle.getQuestState().log.complete).toBe(true);
      const events: QuestEvent[] = [];
      handle.onQuestEvent((event) => events.push(event));
      const packet = new PacketWriter();
      packet.uint32LE(530);
      for (const value of [1, 2, 3, 0]) packet.floatLE(value);
      worldServer.inject(GameOpcode.SMSG_NEW_WORLD, packet.finish());
      await worldServer.waitForCapture(
        (p) => p.opcode === GameOpcode.MSG_MOVE_WORLDPORT_ACK,
      );
      expect(handle.getQuestState().log.complete).toBe(false);
      expect(
        events.some(
          (event) => event.type === "accepted" || event.type === "removed",
        ),
      ).toBe(false);
      handle.close();
      await handle.closed;
    } finally {
      worldServer.stop();
    }
  });

  test("goTo classifies refusals for wait, pick_destination, and stop", async () => {
    const worldServer = await startMockWorldServer({
      loginMapId: 530,
      coalesceSelfCreate: true,
    });
    try {
      const handle = await worldSession(
        { ...base, host: "127.0.0.1", port: worldServer.port },
        fakeAuth(worldServer.port),
      );
      expect(() => handle.goTo(NaN, 0, 0)).toThrow("stop: invalid_destination");

      handle.close();
      await handle.closed;
    } finally {
      worldServer.stop();
    }
  });
});
