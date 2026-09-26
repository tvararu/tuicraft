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
  test("nearby excludes a target beyond 100 yards before rounding", async () => {
    const handle = attachControl(createMockHandle());
    handle.getControlState.mockReturnValue(sampleState());
    const target: BaseEntity = {
      entry: 0,
      guid: 0xfn,
      name: undefined,
      objectType: ObjectType.CORPSE,
      position: {
        mapId: 530,
        orientation: 0,
        x: 8809.464,
        y: -6671.76,
        z: 70.34,
      },
      rawFields: new Map(),
      scale: 1,
    };
    (handle.getNearbyEntities as ReturnType<typeof jest.fn>).mockReturnValue([
      target,
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
    expect(socket.written()).toBe("\n");
  });

  test("nearby_json with all returns distant and off-map entities", async () => {
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
      position: { mapId: 530, orientation: 0, x: 10, y: 10, z: 10 },
      power: [0, 0, 0, 0, 0, 0, 0],
      race: 1,
      rawFields: new Map(),
      scale: 1,
      target: 0n,
      unitFlags: 0,
    };
    const near: UnitEntity = {
      ...selfEntity,
      guid: 0x2n,
      name: "NearUnit",
      position: { mapId: 530, orientation: 0, x: 13, y: 14, z: 10 },
    };
    const distant: GameObjectEntity = {
      bytes1: 0,
      displayId: 0,
      entry: 100,
      flags: 0,
      gameObjectType: 11,
      guid: 0x4n,
      name: "DistantElevator",
      objectType: ObjectType.GAMEOBJECT,
      position: { mapId: 530, orientation: 0, x: 210, y: 10, z: 10 },
      rawFields: new Map(),
      scale: 1,
    };
    const offMap: UnitEntity = {
      ...selfEntity,
      guid: 0x5n,
      name: "OffMapUnit",
      position: { mapId: 0, orientation: 0, x: 10, y: 10, z: 10 },
    };
    (handle.getNearbyEntities as ReturnType<typeof jest.fn>).mockReturnValue([
      distant,
      offMap,
      selfEntity,
      near,
    ]);

    const socket = createMockSocket();
    await dispatchCommand(
      { all: true, type: "nearby_json" },
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
    expect(rows).toHaveLength(4);
    expect(must(rows[0]).guid).toBe("0x1");
    expect(must(rows[0]).distance).toBe(0);
    expect(must(rows[1]).guid).toBe("0x2");
    expect(must(rows[1]).distance).toBe(5);
    expect(must(rows[2]).guid).toBe("0x4");
    expect(must(rows[2]).distance).toBe(200);
    expect(must(rows[3]).guid).toBe("0x5");
    expect(must(rows[3]).distance).toBeNull();
    expect(must(rows[3]).horizontalDistance).toBeNull();
    expect(must(rows[3]).bearingRadians).toBeNull();
    expect(must(rows[3]).turnRadians).toBeNull();
  });

  test("nearby plain text filters by range and supports all", async () => {
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
    const near: UnitEntity = {
      ...selfEntity,
      guid: 0x2n,
      name: "NearUnit",
      position: { mapId: 530, orientation: 0, x: 13, y: 14, z: 10 },
    };
    const distant: GameObjectEntity = {
      bytes1: 0,
      displayId: 0,
      entry: 100,
      flags: 0,
      gameObjectType: 11,
      guid: 0x4n,
      name: "DistantElevator",
      objectType: ObjectType.GAMEOBJECT,
      position: { mapId: 530, orientation: 0, x: 210, y: 10, z: 10 },
      rawFields: new Map(),
      scale: 1,
    };
    (handle.getNearbyEntities as ReturnType<typeof jest.fn>).mockReturnValue([
      distant,
      near,
      selfEntity,
    ]);

    const socket1 = createMockSocket();
    await dispatchCommand(
      { type: "nearby" },
      {
        cleanup: jest.fn(),
        events: new RingBuffer<EventEntry>(10),
        handle,
        socket: socket1,
      },
    );
    const lines1 = socket1.written().trim().split("\n");
    expect(lines1).toHaveLength(2);
    expect(lines1[0]).toContain("PlayerOne");
    expect(lines1[0]).toContain("at 10.00, 10.00, 10.00");
    expect(lines1[1]).toContain("NearUnit");
    expect(lines1[1]).toContain("0x2");
    expect(lines1[1]).toContain("5.00 yd");
    expect(lines1[1]).toContain("xy=5.00 yd");
    expect(lines1[1]).toContain("face=0.9273");
    expect(lines1[1]).toContain("turn=0.9273");
    expect(lines1[1]).toContain("predicted");

    const socket2 = createMockSocket();
    await dispatchCommand(
      { all: true, type: "nearby" },
      {
        cleanup: jest.fn(),
        events: new RingBuffer<EventEntry>(10),
        handle,
        socket: socket2,
      },
    );
    const lines2 = socket2.written().trim().split("\n");
    expect(lines2).toHaveLength(3);
    expect(lines2[0]).toContain("PlayerOne");
    expect(lines2[1]).toContain("NearUnit");
    expect(lines2[2]).toContain("DistantElevator");
  });

  test("nearby json includes targeting fields", async () => {
    const handle = attachControl(createMockHandle());
    const testUnit: UnitEntity = {
      class_: 0,
      displayId: 0,
      entry: 15_652,
      factionTemplate: 7,
      gender: 0,
      guid: 0x11n,
      health: 100,
      level: 8,
      maxHealth: 120,
      maxPower: [0, 0, 0, 0, 0, 0, 0],
      name: "Lynx",
      npcFlags: 0,
      objectType: ObjectType.UNIT,
      position: {
        mapId: 530,
        orientation: 0.5,
        x: 1,
        y: 2,
        z: 3,
      },
      power: [0, 0, 0, 0, 0, 0, 0],
      race: 0,
      rawFields: new Map(),
      scale: 1,
      target: 0x2n,
      unitFlags: 0,
    };
    (handle.getNearbyEntities as ReturnType<typeof jest.fn>).mockReturnValue([
      testUnit,
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
    const parsed = JSON.parse(socket.written().trim());
    expect(parsed.guid).toBe("0x11");
    expect(parsed.entry).toBe(15_652);
    expect(parsed.mapId).toBe(530);
    expect(parsed.orientation).toBe(0.5);
    expect(parsed.target).toBe("0x2");
    expect(parsed.unitFlags).toBe(0);
    expect(parsed.self).toBe(false);
  });

  test("nearby json marks only the observed self guid", async () => {
    const handle = attachControl(createMockHandle());
    handle.getControlState.mockReturnValue(sampleState({ selfGuid: 0x10n }));
    const selfPlayer: UnitEntity = {
      class_: 0,
      displayId: 0,
      entry: 0,
      factionTemplate: 0,
      gender: 0,
      guid: 0x10n,
      health: 187,
      level: 10,
      maxHealth: 187,
      maxPower: [0, 0, 0, 0, 0, 0, 0],
      name: "Xiara",
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
    const otherPlayer: UnitEntity = {
      ...selfPlayer,
      guid: 0x11n,
      name: "Landra",
    };
    (handle.getNearbyEntities as ReturnType<typeof jest.fn>).mockReturnValue([
      selfPlayer,
      otherPlayer,
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
    expect(must(rows[0]).self).toBe(true);
    expect(must(rows[1]).self).toBe(false);
  });

  test("nearby json reports a remote pose with its age and exact flags", async () => {
    const handle = attachControl(createMockHandle());
    const peer: UnitEntity = {
      class_: 0,
      displayId: 0,
      entry: 0,
      factionTemplate: 0,
      gender: 0,
      guid: 0x9ffn,
      health: 100,
      level: 10,
      maxHealth: 100,
      maxPower: [0, 0, 0, 0, 0, 0, 0],
      name: "Landra",
      npcFlags: 0,
      objectType: ObjectType.PLAYER,
      position: { mapId: 530, orientation: 1, x: 5, y: 6, z: 7 },
      power: [0, 0, 0, 0, 0, 0, 0],
      race: 0,
      rawFields: new Map(),
      scale: 1,
      target: 0n,
      unitFlags: 0,
    };
    (handle.getNearbyEntities as ReturnType<typeof jest.fn>).mockReturnValue([
      peer,
      { ...peer, guid: 0xaan, name: "NoPose" },
    ]);
    (handle.getRemotePoses as ReturnType<typeof jest.fn>).mockReturnValue([
      {
        extraFlags: 0x80_00,
        flags: 1,
        guid: 0x9ffn,
        invalid: "unknown_flags",
        moverTime: 77,
        position: { mapId: 530, orientation: 1, x: 5, y: 6, z: 7 },
        receivedAt: 9600,
        source: "observer",
      },
    ]);
    const now = jest.spyOn(Date, "now").mockReturnValue(10_000);
    const socket = createMockSocket();
    try {
      await dispatchCommand(
        { type: "nearby_json" },
        {
          cleanup: jest.fn(),
          events: new RingBuffer<EventEntry>(10),
          handle,
          socket,
        },
      );
    } finally {
      now.mockRestore();
    }
    const rows = socket
      .written()
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(rows.find((row) => row.name === "Landra").remotePose).toEqual({
      ageMs: 400,
      extraFlags: 0x80_00,
      flags: 1,
      invalid: "unknown_flags",
      mapId: 530,
      motion: null,
      moverTime: 77,
      orientation: 1,
      receivedAt: 9600,
      source: "observer",
      x: 5,
      y: 6,
      z: 7,
    });
    expect(
      rows.find((row) => row.name === "NoPose").remotePose,
    ).toBeUndefined();
  });
});
