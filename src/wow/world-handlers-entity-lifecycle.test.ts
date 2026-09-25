import { describe, expect, test } from "bun:test";
import { startMockWorldServer } from "test/mock-world-server";
import { must } from "test/must";
import {
  base,
  buildCreateUnitPacket,
  fakeAuth,
  waitForEchoProbe,
  waitForEntityEvents,
  writeHasPositionMovementBlock,
  writePackedGuid,
  writeUpdateMask,
} from "test/world-handlers-fixtures";
import { worldSession } from "wow/client";
import { type PlayerLifeState, readLife } from "wow/player-state";
import {
  OBJECT_FIELDS,
  PLAYER_FIELDS,
  UNIT_FIELDS,
} from "wow/protocol/entity-fields";
import { GameOpcode } from "wow/protocol/opcodes";
import { PacketWriter } from "wow/protocol/packet";

describe("world handler tests", () => {
  describe("entity handling", () => {
    test("complete CREATE establishes zero public fields only for that entity lifetime", async () => {
      const ws = await startMockWorldServer();
      try {
        const handle = await worldSession(
          { ...base, host: "127.0.0.1", port: ws.port },
          fakeAuth(ws.port),
        );
        const guid = handle.getControlState().selfGuid;
        const update = async (create: boolean, fields: Map<number, number>) => {
          const w = new PacketWriter();
          w.uint32LE(1);
          w.uint8(create ? 3 : 0);
          writePackedGuid(w, guid);
          if (create) {
            w.uint8(4);
            w.uint16LE(0);
          }
          writeUpdateMask(w, fields);
          ws.inject(GameOpcode.SMSG_UPDATE_OBJECT, w.finish());
          await waitForEchoProbe(handle);
        };
        expect(handle.getCombatState().self.shapeshiftForm).toBeUndefined();
        await update(false, new Map([[UNIT_FIELDS.BYTES_2.offset, 3 << 24]]));
        expect(handle.getCombatState().self.shapeshiftForm).toBeUndefined();
        await update(true, new Map([[UNIT_FIELDS.HEALTH.offset, 187]]));
        expect(handle.getCombatState().self).toMatchObject({
          health: 187,
          powerType: 0,
          power: 0,
          shapeshiftForm: 0,
        });
        const lifeEvents: PlayerLifeState[] = [];
        handle.onEntityEvent((event) => {
          if (event.type === "update" && event.entity.guid === guid)
            lifeEvents.push(readLife(guid, () => event.entity));
        });
        await update(
          false,
          new Map([
            [UNIT_FIELDS.HEALTH.offset, 1],
            [PLAYER_FIELDS.FLAGS.offset, 0x10],
          ]),
        );
        expect(lifeEvents.at(-1)).toEqual({
          life: "ghost",
          health: 1,
          flags: 0x10,
        });
        const eventCount = lifeEvents.length;
        await update(false, new Map([[PLAYER_FIELDS.FLAGS.offset, 0]]));
        expect(lifeEvents.length).toBe(eventCount + 1);
        expect(lifeEvents.at(-1)).toEqual({
          life: "alive",
          health: 1,
          flags: 0,
        });
        await update(
          false,
          new Map([[UNIT_FIELDS.BYTES_0.offset, 0xff_00_00_00]]),
        );
        expect(handle.getCombatState().self.powerType).toBe(255);
        expect(handle.getCombatState().self.power).toBeUndefined();
        expect(handle.getCombatState().self.maxPower).toBeUndefined();
        await update(false, new Map([[UNIT_FIELDS.BYTES_2.offset, 3 << 24]]));
        await update(false, new Map([[UNIT_FIELDS.HEALTH.offset, 180]]));
        expect(handle.getCombatState().self).toMatchObject({
          health: 180,
          shapeshiftForm: 3,
        });
        await update(true, new Map([[UNIT_FIELDS.HEALTH.offset, 187]]));
        expect(handle.getCombatState().self.shapeshiftForm).toBe(0);
        const destroy = new PacketWriter();
        destroy.uint32LE(1);
        destroy.uint8(4);
        destroy.uint32LE(1);
        writePackedGuid(destroy, guid);
        ws.inject(GameOpcode.SMSG_UPDATE_OBJECT, destroy.finish());
        await waitForEchoProbe(handle);
        expect(handle.getCombatState().self.shapeshiftForm).toBeUndefined();
        await update(false, new Map([[UNIT_FIELDS.BYTES_2.offset, 3 << 24]]));
        expect(handle.getCombatState().self.shapeshiftForm).toBeUndefined();
        handle.close();
        await handle.closed;
      } finally {
        ws.stop();
      }
    });

    test("entity create and creature query response", async () => {
      const ws = await startMockWorldServer();
      try {
        const handle = await worldSession(
          { ...base, host: "127.0.0.1", port: ws.port },
          fakeAuth(ws.port),
        );

        const events = waitForEntityEvents(handle, 2);

        ws.inject(
          GameOpcode.SMSG_UPDATE_OBJECT,
          buildCreateUnitPacket(100n, 1234, 500, 1000),
        );

        const creatureResp = new PacketWriter();
        creatureResp.uint32LE(1234);
        creatureResp.cString("Young Wolf");
        ws.inject(
          GameOpcode.SMSG_CREATURE_QUERY_RESPONSE,
          creatureResp.finish(),
        );

        const [appear, nameUpdate] = await events;
        const appearEvent = must(appear);
        expect(appearEvent.type).toBe("appear");
        if (appearEvent.type === "appear") {
          expect(appearEvent.entity.guid).toBe(100n);
          expect(appearEvent.entity.objectType).toBe(3);
        }
        const nameUpdateEvent = must(nameUpdate);
        expect(nameUpdateEvent.type).toBe("update");
        if (nameUpdateEvent.type === "update") {
          expect(nameUpdateEvent.changed).toContain("name");
          expect(nameUpdateEvent.entity.name).toBe("Young Wolf");
        }

        handle.close();
        await handle.closed;
      } finally {
        ws.stop();
      }
    });

    test("entity values update", async () => {
      const ws = await startMockWorldServer();
      try {
        const handle = await worldSession(
          { ...base, host: "127.0.0.1", port: ws.port },
          fakeAuth(ws.port),
        );

        const appearReady = waitForEntityEvents(handle, 1);
        ws.inject(
          GameOpcode.SMSG_UPDATE_OBJECT,
          buildCreateUnitPacket(200n, 5000, 100, 200),
        );
        await appearReady;

        const updateReady = waitForEntityEvents(handle, 1);

        const w = new PacketWriter();
        w.uint32LE(1);
        w.uint8(0);
        writePackedGuid(w, 200n);
        writeUpdateMask(w, new Map([[UNIT_FIELDS.HEALTH.offset, 50]]));
        ws.inject(GameOpcode.SMSG_UPDATE_OBJECT, w.finish());

        const [update] = await updateReady;
        const updateEvent = must(update);
        expect(updateEvent.type).toBe("update");
        if (updateEvent.type === "update") {
          expect(updateEvent.changed).toContain("health");
        }

        handle.close();
        await handle.closed;
      } finally {
        ws.stop();
      }
    });

    test("entity movement", async () => {
      const ws = await startMockWorldServer();
      try {
        const handle = await worldSession(
          { ...base, host: "127.0.0.1", port: ws.port },
          fakeAuth(ws.port),
        );

        const appearReady = waitForEntityEvents(handle, 1);
        ws.inject(
          GameOpcode.SMSG_UPDATE_OBJECT,
          buildCreateUnitPacket(300n, 6000, 100, 200),
        );
        await appearReady;

        const moveReady = waitForEntityEvents(handle, 1);

        const w = new PacketWriter();
        w.uint32LE(1);
        w.uint8(1);
        writePackedGuid(w, 300n);
        writeHasPositionMovementBlock(w, [10.5, 20.5, 30.5, 1.25]);
        ws.inject(GameOpcode.SMSG_UPDATE_OBJECT, w.finish());

        const [move] = await moveReady;
        const moveEvent = must(move);
        expect(moveEvent.type).toBe("update");
        if (moveEvent.type === "update") {
          expect(moveEvent.changed).toContain("position");
          expect(must(moveEvent.entity.position).x).toBeCloseTo(10.5);
          expect(must(moveEvent.entity.position).y).toBeCloseTo(20.5);
          expect(must(moveEvent.entity.position).z).toBeCloseTo(30.5);
        }

        handle.close();
        await handle.closed;
      } finally {
        ws.stop();
      }
    });

    test("out of range removes entities", async () => {
      const ws = await startMockWorldServer();
      try {
        const handle = await worldSession(
          { ...base, host: "127.0.0.1", port: ws.port },
          fakeAuth(ws.port),
        );

        const appear1 = waitForEntityEvents(handle, 1);
        ws.inject(
          GameOpcode.SMSG_UPDATE_OBJECT,
          buildCreateUnitPacket(400n, 7000, 100, 200),
        );
        await appear1;

        const appear2 = waitForEntityEvents(handle, 1);
        ws.inject(
          GameOpcode.SMSG_UPDATE_OBJECT,
          buildCreateUnitPacket(401n, 7001, 100, 200),
        );
        await appear2;

        expect(handle.getNearbyEntities().length).toBe(2);

        const disappearReady = waitForEntityEvents(handle, 2);

        const w = new PacketWriter();
        w.uint32LE(1);
        w.uint8(4);
        w.uint32LE(2);
        writePackedGuid(w, 400n);
        writePackedGuid(w, 401n);
        ws.inject(GameOpcode.SMSG_UPDATE_OBJECT, w.finish());

        const events = await disappearReady;
        expect(must(events[0]).type).toBe("disappear");
        expect(must(events[1]).type).toBe("disappear");
        expect(handle.getNearbyEntities().length).toBe(0);

        handle.close();
        await handle.closed;
      } finally {
        ws.stop();
      }
    });

    test("SMSG_DESTROY_OBJECT removes entity", async () => {
      const ws = await startMockWorldServer();
      try {
        const handle = await worldSession(
          { ...base, host: "127.0.0.1", port: ws.port },
          fakeAuth(ws.port),
        );

        const appearReady = waitForEntityEvents(handle, 1);
        ws.inject(
          GameOpcode.SMSG_UPDATE_OBJECT,
          buildCreateUnitPacket(500n, 8000, 100, 200),
        );
        await appearReady;

        const disappearReady = waitForEntityEvents(handle, 1);

        const w = new PacketWriter();
        w.uint64LE(500n);
        w.uint8(0);
        ws.inject(GameOpcode.SMSG_DESTROY_OBJECT, w.finish());

        const [disappear] = await disappearReady;
        const disappearEvent = must(disappear);
        expect(disappearEvent.type).toBe("disappear");
        if (disappearEvent.type === "disappear") {
          expect(disappearEvent.guid).toBe(500n);
        }
        expect(handle.getNearbyEntities().length).toBe(0);

        handle.close();
        await handle.closed;
      } finally {
        ws.stop();
      }
    });

    test("game object query response", async () => {
      const ws = await startMockWorldServer();
      try {
        const handle = await worldSession(
          { ...base, host: "127.0.0.1", port: ws.port },
          fakeAuth(ws.port),
        );

        const appearReady = waitForEntityEvents(handle, 1);

        const createW = new PacketWriter();
        createW.uint32LE(1);
        createW.uint8(2);
        writePackedGuid(createW, 600n);
        createW.uint8(5);
        writeHasPositionMovementBlock(createW, [50, 60, 70, 0.5]);
        writeUpdateMask(createW, new Map([[OBJECT_FIELDS.ENTRY.offset, 9999]]));
        ws.inject(GameOpcode.SMSG_UPDATE_OBJECT, createW.finish());
        await appearReady;

        const updateReady = waitForEntityEvents(handle, 2);

        const goResp = new PacketWriter();
        goResp.uint32LE(9999);
        goResp.uint32LE(19);
        goResp.uint32LE(0);
        goResp.cString("Mailbox");
        ws.inject(GameOpcode.SMSG_GAMEOBJECT_QUERY_RESPONSE, goResp.finish());

        const events = await updateReady;
        const nameEvent = events.find(
          (e) => e.type === "update" && e.changed.includes("name"),
        );
        const typeEvent = events.find(
          (e) => e.type === "update" && e.changed.includes("gameObjectType"),
        );
        expect(nameEvent).toBeDefined();
        expect(typeEvent).toBeDefined();
        if (nameEvent?.type === "update") {
          expect(nameEvent.entity.name).toBe("Mailbox");
        }

        handle.close();
        await handle.closed;
      } finally {
        ws.stop();
      }
    });
  });
});
