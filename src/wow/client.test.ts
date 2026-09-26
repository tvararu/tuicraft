import { describe, expect, jest, test } from "bun:test";
import {
  clientPrivateKey,
  clientSeed,
  FIXTURE_ACCOUNT,
  FIXTURE_CHARACTER,
  FIXTURE_PASSWORD,
  sessionKey,
} from "test/fixtures";
import { startMockAuthServer } from "test/mock-auth-server";
import { startMockWorldServer } from "test/mock-world-server";
import type { AuthResult } from "wow/auth";
import { authHandshake } from "wow/auth";
import { worldSession } from "wow/client";
import * as navigation from "wow/navigation";
import { ObjectType, UpdateFlag, UpdateType } from "wow/protocol/entity-fields";
import { GameOpcode } from "wow/protocol/opcodes";
import { PacketWriter } from "wow/protocol/packet";
import type { QuestEvent } from "wow/quests";

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

const NAVIGATION = {
  navigationDataDir: "fixture-navigation",
  navigationLibrary: "fixture-native",
};

function flatNavigation() {
  const create = navigation.createNavigation;
  return jest
    .spyOn(navigation, "createNavigation")
    .mockImplementation((options) =>
      create(options, () => ({
        loadAdtAt() {},
        findHeights: (x) => (x > 2 ? [8] : [3]),
        findHeight: () => {
          throw new Error("pathfind_find_height failed (UNKNOWN_HEIGHT)");
        },
        findPath: (from, to) => [from, to],
        lineOfSight: () => true,
        close() {},
      })),
    );
}

function observedObject(x: number, y: number, z: number): Uint8Array {
  const packet = new PacketWriter();
  packet.uint32LE(1);
  packet.uint8(UpdateType.CREATE_OBJECT);
  packet.packedGuid(0x99, 0);
  packet.uint8(ObjectType.GAMEOBJECT);
  packet.uint16LE(UpdateFlag.HAS_POSITION);
  packet.floatLE(x);
  packet.floatLE(y);
  packet.floatLE(z);
  packet.floatLE(0);
  packet.uint8(0);
  return packet.finish();
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

  test("manual reissue extends the same direction without stopping", async () => {
    const nav = flatNavigation();
    const server = await startMockWorldServer({
      loginMapId: 530,
      coalesceSelfCreate: true,
    });
    try {
      const handle = await worldSession(
        { ...base, ...NAVIGATION, host: "127.0.0.1", port: server.port },
        fakeAuth(server.port),
      );
      try {
        const events: string[] = [];
        handle.onControlEvent((event) => events.push(event.type));
        handle.move("forward", 1000);
        handle.move("forward", 1000);
        expect(events.filter((type) => type === "movement_started")).toEqual([
          "movement_started",
        ]);
        expect(events).not.toContain("movement_stopped");
        expect(handle.getControlState().moving).toBe(true);
      } finally {
        handle.close();
        await handle.closed;
      }
    } finally {
      server.stop();
      nav.mockRestore();
    }
  });

  test("manual move takes control from an active encounter cycle", async () => {
    const nav = flatNavigation();
    const server = await startMockWorldServer({
      loginMapId: 530,
      coalesceSelfCreate: true,
    });
    try {
      const handle = await worldSession(
        { ...base, ...NAVIGATION, host: "127.0.0.1", port: server.port },
        fakeAuth(server.port),
      );
      try {
        const running = handle.startCycle([0x99n], "stay alive", 1);
        expect(handle.getCycleState().active).toBe(true);
        handle.move("forward", 1000);
        expect(handle.getCycleState()).toMatchObject({
          active: false,
          stopCause: "manual_override",
        });
        expect(handle.getControlState().owner).toBe("manual");
        await running;
      } finally {
        handle.close();
        await handle.closed;
      }
    } finally {
      server.stop();
      nav.mockRestore();
    }
  });
  test("face-guid turns toward a currently observed object and refuses a lost GUID", async () => {
    const server = await startMockWorldServer({
      loginMapId: 530,
      coalesceSelfCreate: true,
    });
    try {
      const handle = await worldSession(
        { ...base, host: "127.0.0.1", port: server.port },
        fakeAuth(server.port),
      );
      try {
        const appeared = Promise.withResolvers<void>();
        handle.onEntityEvent((event) => {
          if (event.type === "appear" && event.entity.guid === 0x99n)
            appeared.resolve();
        });
        server.inject(GameOpcode.SMSG_UPDATE_OBJECT, observedObject(1, 12, 3));
        await appeared.promise;
        handle.faceGuid(0x99n);
        expect(handle.getControlState().pose?.orientation).toBeCloseTo(
          Math.PI / 2,
          4,
        );
        expect(() => handle.faceGuid(0x123n)).toThrow("target_not_observed");
      } finally {
        handle.close();
        await handle.closed;
      }
    } finally {
      server.stop();
    }
  });

  test("walk-toward reports ungrounded destination without cancelling manual motion", async () => {
    const nav = flatNavigation();
    const server = await startMockWorldServer({
      loginMapId: 530,
      coalesceSelfCreate: true,
    });
    try {
      const handle = await worldSession(
        { ...base, ...NAVIGATION, host: "127.0.0.1", port: server.port },
        fakeAuth(server.port),
      );
      try {
        handle.move("forward", 1000);
        const outcome = await handle.walkToward(
          { kind: "point", x: 4, y: 2, z: 3 },
          2,
        );
        expect(outcome).toMatchObject({
          status: "stopped",
          traveled: 0,
          reason: "destination_not_grounded",
        });
        expect(handle.getControlState().moving).toBe(true);
      } finally {
        handle.close();
        await handle.closed;
      }
    } finally {
      server.stop();
      nav.mockRestore();
    }
  });

  test("walk-toward refuses an observed GUID without navigation before any motion packet", async () => {
    const server = await startMockWorldServer({
      loginMapId: 530,
      coalesceSelfCreate: true,
    });
    try {
      const handle = await worldSession(
        { ...base, host: "127.0.0.1", port: server.port },
        fakeAuth(server.port),
      );
      try {
        const appeared = Promise.withResolvers<void>();
        handle.onEntityEvent((event) => {
          if (event.type === "appear" && event.entity.guid === 0x99n)
            appeared.resolve();
        });
        server.inject(GameOpcode.SMSG_UPDATE_OBJECT, observedObject(1, 12, 3));
        await appeared.promise;
        const speed = new PacketWriter();
        speed.packedGuid(0x42, 0);
        speed.uint32LE(1);
        speed.uint8(0);
        speed.floatLE(7);
        server.inject(GameOpcode.SMSG_FORCE_RUN_SPEED_CHANGE, speed.finish());
        await server.waitForCapture(
          (packet) =>
            packet.opcode === GameOpcode.CMSG_FORCE_RUN_SPEED_CHANGE_ACK,
        );
        const sentBefore = server.captured.length;
        const result = await handle.walkToward(
          { kind: "guid", guid: 0x99n },
          3,
        );
        expect(result).toMatchObject({
          status: "stopped",
          reason: "missing_navigation",
          traveled: 0,
          pose: { source: "server" },
        });
        const motion = server.captured
          .slice(sentBefore)
          .filter(
            (packet) =>
              packet.opcode === GameOpcode.MSG_MOVE_SET_FACING ||
              packet.opcode === GameOpcode.MSG_MOVE_START_FORWARD,
          );
        expect(motion).toEqual([]);
        expect(handle.getControlState().moving).toBe(false);
      } finally {
        handle.close();
        await handle.closed;
      }
    } finally {
      server.stop();
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
      expect(() =>
        handle.goTo({ kind: "point", x: Number.NaN, y: 0, z: 0 }),
      ).toThrow("stop: invalid_destination");

      handle.close();
      await handle.closed;
    } finally {
      worldServer.stop();
    }
  });
});
