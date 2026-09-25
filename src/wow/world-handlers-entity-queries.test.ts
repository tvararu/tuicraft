import { describe, expect, test } from "bun:test";
import { deflateSync } from "node:zlib";
import { FIXTURE_CHARACTER } from "test/fixtures";
import { startMockWorldServer } from "test/mock-world-server";
import { must } from "test/must";
import {
  base,
  buildCreateUnitPacket,
  fakeAuth,
  waitForEntityEvents,
  writeHasPositionMovementBlock,
  writeLivingMovementBlock,
  writePackedGuid,
  writeUpdateMask,
} from "test/world-handlers-fixtures";
import { worldSession } from "wow/client";
import { GAMEOBJECT_FIELDS, OBJECT_FIELDS } from "wow/protocol/entity-fields";
import { GameOpcode } from "wow/protocol/opcodes";
import { PacketWriter } from "wow/protocol/packet";

describe("world handler tests", () => {
  describe("entity handling", () => {
    test("player name backfill via CMSG_NAME_QUERY", async () => {
      const ws = await startMockWorldServer();
      try {
        const handle = await worldSession(
          { ...base, host: "127.0.0.1", port: ws.port },
          fakeAuth(ws.port),
        );

        const events = waitForEntityEvents(handle, 2);

        const createW = new PacketWriter();
        createW.uint32LE(1);
        createW.uint8(3);
        writePackedGuid(createW, 0x42n);
        createW.uint8(4);
        writeLivingMovementBlock(createW, [10, 20, 30, 0]);
        writeUpdateMask(createW, new Map([[OBJECT_FIELDS.ENTRY.offset, 0]]));
        ws.inject(GameOpcode.SMSG_UPDATE_OBJECT, createW.finish());

        const [appear, nameUpdate] = await events;
        expect(must(appear).type).toBe("appear");
        const nameUpdateEvent = must(nameUpdate);
        expect(nameUpdateEvent.type).toBe("update");
        if (nameUpdateEvent.type === "update") {
          expect(nameUpdateEvent.entity.name).toBe(FIXTURE_CHARACTER);
        }

        handle.close();
        await handle.closed;
      } finally {
        ws.stop();
      }
    });

    test("compressed update object", async () => {
      const ws = await startMockWorldServer();
      try {
        const handle = await worldSession(
          { ...base, host: "127.0.0.1", port: ws.port },
          fakeAuth(ws.port),
        );

        const appearReady = waitForEntityEvents(handle, 1);

        const payload = buildCreateUnitPacket(700n, 3333, 250, 500);
        const compressed = deflateSync(payload, { level: 6 });
        const envelope = new PacketWriter();
        envelope.uint32LE(payload.byteLength);
        envelope.rawBytes(new Uint8Array(compressed));
        ws.inject(GameOpcode.SMSG_COMPRESSED_UPDATE_OBJECT, envelope.finish());

        const [appear] = await appearReady;
        const appearEvent = must(appear);
        expect(appearEvent.type).toBe("appear");
        if (appearEvent.type === "appear") {
          expect(appearEvent.entity.guid).toBe(700n);
        }

        handle.close();
        await handle.closed;
      } finally {
        ws.stop();
      }
    });

    test("cached creature name lookup", async () => {
      const ws = await startMockWorldServer();
      try {
        const handle = await worldSession(
          { ...base, host: "127.0.0.1", port: ws.port },
          fakeAuth(ws.port),
        );

        const firstAppear = waitForEntityEvents(handle, 1);
        ws.inject(
          GameOpcode.SMSG_UPDATE_OBJECT,
          buildCreateUnitPacket(800n, 5555, 100, 200),
        );
        await firstAppear;

        const nameReady = waitForEntityEvents(handle, 1);
        const creatureResp = new PacketWriter();
        creatureResp.uint32LE(5555);
        creatureResp.cString("Stormwind Guard");
        ws.inject(
          GameOpcode.SMSG_CREATURE_QUERY_RESPONSE,
          creatureResp.finish(),
        );
        await nameReady;

        const secondAppear = waitForEntityEvents(handle, 1);
        ws.inject(
          GameOpcode.SMSG_UPDATE_OBJECT,
          buildCreateUnitPacket(801n, 5555, 100, 200),
        );

        const [appear] = await secondAppear;
        const appearEvent = must(appear);
        expect(appearEvent.type).toBe("appear");
        if (appearEvent.type === "appear") {
          expect(appearEvent.entity.name).toBe("Stormwind Guard");
        }

        handle.close();
        await handle.closed;
      } finally {
        ws.stop();
      }
    });

    test("gameobject values update", async () => {
      const ws = await startMockWorldServer();
      try {
        const handle = await worldSession(
          { ...base, host: "127.0.0.1", port: ws.port },
          fakeAuth(ws.port),
        );

        const appear = waitForEntityEvents(handle, 1);
        const createW = new PacketWriter();
        createW.uint32LE(1);
        createW.uint8(2);
        writePackedGuid(createW, 500n);
        createW.uint8(5);
        writeHasPositionMovementBlock(createW, [1, 2, 3, 0]);
        writeUpdateMask(createW, new Map([[OBJECT_FIELDS.ENTRY.offset, 100]]));
        ws.inject(GameOpcode.SMSG_UPDATE_OBJECT, createW.finish());
        await appear;

        const update = waitForEntityEvents(handle, 1);
        const valW = new PacketWriter();
        valW.uint32LE(1);
        valW.uint8(0);
        writePackedGuid(valW, 500n);
        writeUpdateMask(valW, new Map([[GAMEOBJECT_FIELDS.FLAGS.offset, 42]]));
        ws.inject(GameOpcode.SMSG_UPDATE_OBJECT, valW.finish());
        const [evt] = await update;
        expect(must(evt).type).toBe("update");

        const nearW = new PacketWriter();
        nearW.uint32LE(1);
        nearW.uint8(5);
        nearW.uint32LE(1);
        writePackedGuid(nearW, 500n);
        ws.inject(GameOpcode.SMSG_UPDATE_OBJECT, nearW.finish());
        await Bun.sleep(1);

        handle.close();
        await handle.closed;
      } finally {
        ws.stop();
      }
    });

    test("compressed size mismatch triggers packet error", async () => {
      const ws = await startMockWorldServer();
      try {
        const handle = await worldSession(
          { ...base, host: "127.0.0.1", port: ws.port },
          fakeAuth(ws.port),
        );

        const gotError = new Promise<Error>((resolve) => {
          handle.onPacketError((_op, packetError) => resolve(packetError));
        });

        const payload = buildCreateUnitPacket(300n, 1, 50, 50);
        const compressed = deflateSync(payload);
        const w = new PacketWriter();
        w.uint32LE(payload.byteLength + 999);
        w.rawBytes(new Uint8Array(compressed));
        ws.inject(GameOpcode.SMSG_COMPRESSED_UPDATE_OBJECT, w.finish());

        const err = await gotError;
        expect(err.message).toContain("size mismatch");

        handle.close();
        await handle.closed;
      } finally {
        ws.stop();
      }
    });

    test("corpse entity create uses base entity", async () => {
      const ws = await startMockWorldServer();
      try {
        const handle = await worldSession(
          { ...base, host: "127.0.0.1", port: ws.port },
          fakeAuth(ws.port),
        );

        const appear = waitForEntityEvents(handle, 1);
        const w = new PacketWriter();
        w.uint32LE(1);
        w.uint8(2);
        writePackedGuid(w, 999n);
        w.uint8(7);
        writeHasPositionMovementBlock(w, [10, 20, 30, 0]);
        writeUpdateMask(w, new Map([[OBJECT_FIELDS.ENTRY.offset, 42]]));
        ws.inject(GameOpcode.SMSG_UPDATE_OBJECT, w.finish());

        const [evt] = await appear;
        const event = must(evt);
        expect(event.type).toBe("appear");
        if (event.type === "appear") {
          expect(event.entity.objectType).toBe(7);
        }

        handle.close();
        await handle.closed;
      } finally {
        ws.stop();
      }
    });

    test("cached game object name lookup", async () => {
      const ws = await startMockWorldServer();
      try {
        const handle = await worldSession(
          { ...base, host: "127.0.0.1", port: ws.port },
          fakeAuth(ws.port),
        );

        const firstAppear = waitForEntityEvents(handle, 1);
        const createW = new PacketWriter();
        createW.uint32LE(1);
        createW.uint8(2);
        writePackedGuid(createW, 900n);
        createW.uint8(5);
        writeHasPositionMovementBlock(createW, [1, 2, 3, 0]);
        writeUpdateMask(createW, new Map([[OBJECT_FIELDS.ENTRY.offset, 7777]]));
        ws.inject(GameOpcode.SMSG_UPDATE_OBJECT, createW.finish());
        await firstAppear;

        const nameReady = waitForEntityEvents(handle, 2);
        const goResp = new PacketWriter();
        goResp.uint32LE(7777);
        goResp.uint32LE(19);
        goResp.uint32LE(0);
        goResp.cString("Forge");
        ws.inject(GameOpcode.SMSG_GAMEOBJECT_QUERY_RESPONSE, goResp.finish());
        await nameReady;

        const secondAppear = waitForEntityEvents(handle, 1);
        const create2 = new PacketWriter();
        create2.uint32LE(1);
        create2.uint8(2);
        writePackedGuid(create2, 901n);
        create2.uint8(5);
        writeHasPositionMovementBlock(create2, [4, 5, 6, 0]);
        writeUpdateMask(create2, new Map([[OBJECT_FIELDS.ENTRY.offset, 7777]]));
        ws.inject(GameOpcode.SMSG_UPDATE_OBJECT, create2.finish());

        const [appear] = await secondAppear;
        const appearEvent = must(appear);
        expect(appearEvent.type).toBe("appear");
        if (appearEvent.type === "appear") {
          expect(appearEvent.entity.name).toBe("Forge");
        }

        handle.close();
        await handle.closed;
      } finally {
        ws.stop();
      }
    });
  });
});
