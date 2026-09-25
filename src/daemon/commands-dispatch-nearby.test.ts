import { describe, expect, jest, test } from "bun:test";
import { dispatchCommand, type EventEntry } from "daemon/commands";
import { RingBuffer } from "lib/ring-buffer";
import {
  attachControl,
  createMockSocket,
  sampleState,
} from "test/commands-fixtures";
import { createMockHandle } from "test/mock-handle";
import { must } from "test/must";
import type {
  BaseEntity,
  GameObjectEntity,
  UnitEntity,
} from "wow/entity-store";
import { ObjectType } from "wow/protocol/entity-fields";

describe("dispatchCommand", () => {
  test("nearby returns formatted entity list", async () => {
    const handle = createMockHandle();
    const testUnit: UnitEntity = {
      class_: 0,
      displayId: 0,
      entry: 0,
      factionTemplate: 0,
      gender: 0,
      guid: 1n,
      health: 5000,
      level: 80,
      maxHealth: 5000,
      maxPower: [0, 0, 0, 0, 0, 0, 0],
      name: "Thrall",
      npcFlags: 0,
      objectType: ObjectType.UNIT,
      position: { mapId: 1, orientation: 0, x: 1.23, y: 4.56, z: 7.89 },
      power: [0, 0, 0, 0, 0, 0, 0],
      race: 0,
      rawFields: new Map(),
      scale: 1,
      target: 0n,
      unitFlags: 0,
    };
    const testGo: GameObjectEntity = {
      bytes1: 0,
      displayId: 0,
      entry: 0,
      flags: 0,
      gameObjectType: 19,
      guid: 2n,
      name: "Mailbox",
      objectType: ObjectType.GAMEOBJECT,
      position: { mapId: 1, orientation: 0, x: 1.5, y: 4.6, z: 7.89 },
      rawFields: new Map(),
      scale: 1,
    };
    (handle.getNearbyEntities as ReturnType<typeof jest.fn>).mockReturnValue([
      testUnit,
      testGo,
    ]);
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand(
      { type: "nearby" },
      { cleanup, events, handle, socket },
    );

    const output = socket.written();
    expect(output).toContain(
      "Thrall (NPC, level 80) HP 5000/5000 at 1.23, 4.56, 7.89",
    );
    expect(output).toContain("Mailbox (GameObject) at 1.50, 4.60, 7.89");
  });

  test("nearby_json returns JSONL entity list", async () => {
    const handle = attachControl(createMockHandle());
    const testUnit: UnitEntity = {
      class_: 0,
      displayId: 0,
      entry: 0,
      factionTemplate: 0,
      gender: 0,
      guid: 1n,
      health: 5000,
      level: 80,
      maxHealth: 5000,
      maxPower: [0, 0, 0, 0, 0, 0, 0],
      name: "Thrall",
      npcFlags: 0,
      objectType: ObjectType.UNIT,
      position: { mapId: 1, orientation: 0, x: 1.23, y: 4.56, z: 7.89 },
      power: [0, 0, 0, 0, 0, 0, 0],
      race: 0,
      rawFields: new Map(),
      scale: 1,
      target: 0n,
      unitFlags: 0,
    };
    (handle.getNearbyEntities as ReturnType<typeof jest.fn>).mockReturnValue([
      testUnit,
    ]);
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand(
      { type: "nearby_json" },
      { cleanup, events, handle, socket },
    );

    const lines = socket.written().trim().split("\n").filter(Boolean);
    const parsed = JSON.parse(must(lines[0]));
    expect(parsed.guid).toBe("0x1");
    expect(parsed.type).toBe("unit");
    expect(parsed.name).toBe("Thrall");
    expect(parsed.level).toBe(80);
    expect(parsed.health).toBe(5000);
    expect(parsed.maxHealth).toBe(5000);
    expect(parsed.x).toBe(1.23);
    expect(parsed.y).toBe(4.56);
    expect(parsed.z).toBe(7.89);
  });

  test("nearby with no entities returns just terminator", async () => {
    const handle = createMockHandle();
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand(
      { type: "nearby" },
      { cleanup, events, handle, socket },
    );

    expect(socket.written()).toBe("\n");
  });

  test("nearby formats player entity", async () => {
    const handle = createMockHandle();
    const testPlayer: UnitEntity = {
      class_: 0,
      displayId: 0,
      entry: 0,
      factionTemplate: 0,
      gender: 0,
      guid: 10n,
      health: 3000,
      level: 55,
      maxHealth: 4000,
      maxPower: [0, 0, 0, 0, 0, 0, 0],
      name: "Arthas",
      npcFlags: 0,
      objectType: ObjectType.PLAYER,
      position: { mapId: 0, orientation: 0, x: 10.0, y: 20.0, z: 30.0 },
      power: [0, 0, 0, 0, 0, 0, 0],
      race: 0,
      rawFields: new Map(),
      scale: 1,
      target: 0n,
      unitFlags: 0,
    };
    (handle.getNearbyEntities as ReturnType<typeof jest.fn>).mockReturnValue([
      testPlayer,
    ]);
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand(
      { type: "nearby" },
      { cleanup, events, handle, socket },
    );

    const output = socket.written();
    expect(output).toContain(
      "Arthas (Player, level 55) HP 3000/4000 at 10.00, 20.00, 30.00",
    );
  });

  test("nearby formats unknown entity type", async () => {
    const handle = createMockHandle();
    const testCorpse: BaseEntity = {
      entry: 0,
      guid: 0xabn,
      name: undefined,
      objectType: ObjectType.CORPSE,
      position: undefined,
      rawFields: new Map(),
      scale: 1,
    };
    (handle.getNearbyEntities as ReturnType<typeof jest.fn>).mockReturnValue([
      testCorpse,
    ]);
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand(
      { type: "nearby" },
      { cleanup, events, handle, socket },
    );

    const output = socket.written();
    expect(output).toContain("Entity 0xab (type 7)");
  });

  test("nearby_json formats player and gameobject types", async () => {
    const handle = attachControl(createMockHandle());
    const testPlayer: UnitEntity = {
      class_: 0,
      displayId: 0,
      entry: 0,
      factionTemplate: 0,
      gender: 0,
      guid: 1n,
      health: 8000,
      level: 70,
      maxHealth: 8000,
      maxPower: [0, 0, 0, 0, 0, 0, 0],
      name: "Jaina",
      npcFlags: 0,
      objectType: ObjectType.PLAYER,
      position: undefined,
      power: [0, 0, 0, 0, 0, 0, 0],
      race: 0,
      rawFields: new Map(),
      scale: 1,
      target: 0n,
      unitFlags: 0,
    };
    const testGo: GameObjectEntity = {
      bytes1: 0,
      displayId: 0,
      entry: 0,
      flags: 0,
      gameObjectType: 3,
      guid: 2n,
      name: "Chest",
      objectType: ObjectType.GAMEOBJECT,
      position: undefined,
      rawFields: new Map(),
      scale: 1,
    };
    const testCorpse: BaseEntity = {
      entry: 0,
      guid: 3n,
      name: undefined,
      objectType: ObjectType.CORPSE,
      position: undefined,
      rawFields: new Map(),
      scale: 1,
    };
    (handle.getNearbyEntities as ReturnType<typeof jest.fn>).mockReturnValue([
      testPlayer,
      testGo,
      testCorpse,
    ]);
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand(
      { type: "nearby_json" },
      { cleanup, events, handle, socket },
    );

    const lines = socket.written().trim().split("\n").filter(Boolean);
    expect(lines).toHaveLength(3);
    const player = JSON.parse(must(lines[0]));
    const go = JSON.parse(must(lines[1]));
    const corpse = JSON.parse(must(lines[2]));
    expect(player.type).toBe("player");
    expect(player.level).toBe(70);
    expect(player.health).toBe(8000);
    expect(player.distance).toBe(0);
    expect(player.horizontalDistance).toBeNull();
    expect(player.originSource).toBeNull();
    expect(go.distance).toBeNull();
    expect(go.bearingRadians).toBeNull();
    expect(go.type).toBe("gameobject");
    expect(go.gameObjectType).toBe(3);
    expect(corpse.type).toBe("object");
  });

  test("nearby_json uses predicted self pose for distance, order, and range", async () => {
    const handle = attachControl(createMockHandle());
    handle.getControlState.mockReturnValue(
      sampleState({
        pose: {
          mapId: 530,
          orientation: 0,
          source: "predicted",
          updatedAt: 1000,
          x: 10,
          y: 10,
          z: 10,
        },
        selfGuid: 0x1n,
      }),
    );
    const selfEntity: UnitEntity = {
      class_: 1,
      displayId: 0,
      entry: 0,
      factionTemplate: 1,
      gender: 0,
      guid: 0x1n,
      health: 100,
      level: 70,
      maxHealth: 100,
      maxPower: [0, 0, 0, 0, 0, 0, 0],
      name: "PlayerOne",
      npcFlags: 0,
      objectType: ObjectType.PLAYER,
      position: { mapId: 530, orientation: 0, x: 1000, y: 1000, z: 10 },
      power: [0, 0, 0, 0, 0, 0, 0],
      race: 1,
      rawFields: new Map(),
      scale: 1,
      target: 0n,
      unitFlags: 0,
    };
    const near1: UnitEntity = {
      ...selfEntity,
      guid: 0x2n,
      name: "NearUnit",
      position: { mapId: 530, orientation: 0, x: 13, y: 14, z: 10 },
    };
    const near2: GameObjectEntity = {
      bytes1: 0,
      displayId: 0,
      entry: 100,
      flags: 0,
      gameObjectType: 3,
      guid: 0x3n,
      name: "NearChest",
      objectType: ObjectType.GAMEOBJECT,
      position: { mapId: 530, orientation: 0, x: 20, y: 10, z: 10 },
      rawFields: new Map(),
      scale: 1,
    };
    const distant: GameObjectEntity = {
      ...near2,
      gameObjectType: 11,
      guid: 0x4n,
      name: "DistantElevator",
      position: { mapId: 530, orientation: 0, x: 200, y: 10, z: 10 },
    };
    const offMap: UnitEntity = {
      ...selfEntity,
      guid: 0x5n,
      name: "OffMapUnit",
      position: { mapId: 0, orientation: 0, x: 10, y: 10, z: 10 },
    };
    (handle.getNearbyEntities as ReturnType<typeof jest.fn>).mockReturnValue([
      distant,
      near2,
      selfEntity,
      offMap,
      near1,
    ]);

    const socket = createMockSocket();
    await dispatchCommand(
      { type: "nearby_json" },
      {
        cleanup: jest.fn(),
        events: new RingBuffer<EventEntry>(10),
        handle,
        socket,
      },
    );

    const rows = socket
      .written()
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(rows).toHaveLength(3);
    expect(must(rows[0]).guid).toBe("0x1");
    expect(must(rows[0]).self).toBe(true);
    expect(must(rows[0]).distance).toBe(0);
    expect(must(rows[0]).x).toBe(10);
    expect(must(rows[0]).y).toBe(10);
    expect(must(rows[0]).bearingRadians).toBeNull();
    expect(must(rows[0]).turnRadians).toBeNull();
    expect(must(rows[1]).guid).toBe("0x2");
    expect(must(rows[1]).distance).toBe(5);
    expect(must(rows[1]).horizontalDistance).toBe(5);
    expect(must(rows[1]).bearingRadians).toBeCloseTo(0.927_295_218, 8);
    expect(must(rows[1]).turnRadians).toBeCloseTo(0.927_295_218, 8);
    expect(must(rows[1]).originSource).toBe("predicted");
    expect(must(rows[1]).originUpdatedAt).toBe(1000);
    expect(must(rows[2]).guid).toBe("0x3");
    expect(must(rows[2]).distance).toBe(10);
  });
});
