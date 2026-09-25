import { describe, expect, jest, test } from "bun:test";
import type { EventEntry } from "daemon/commands";
import { onEntityEvent } from "daemon/events";
import { RingBuffer } from "lib/ring-buffer";
import type { SessionLog } from "lib/session-log";
import { must } from "test/must";
import type { UnitEntity } from "wow/entity-store";
import { ObjectType } from "wow/protocol/entity-fields";

describe("onEntityEvent", () => {
  test("pushes appear event to ring buffer with text and json", () => {
    const events = new RingBuffer<EventEntry>(10);
    const entity: UnitEntity = {
      class_: 0,
      displayId: 0,
      entry: 0,
      factionTemplate: 0,
      gender: 0,
      guid: 1n,
      health: 100,
      level: 10,
      maxHealth: 100,
      maxPower: [0, 0, 0, 0, 0, 0, 0],
      name: "Test NPC",
      npcFlags: 0,
      objectType: ObjectType.UNIT,
      position: undefined,
      power: [0, 0, 0, 0, 0, 0, 0],
      race: 0,
      rawFields: new Map(),
      scale: 1,
      target: 0n,
      unitFlags: 0,
    };

    const append = jest.fn(async () => {});
    const log = { append } as unknown as SessionLog;
    onEntityEvent({ entity, type: "appear" }, events, log);

    const drained = events.drain();
    expect(drained).toHaveLength(1);
    expect(must(drained[0]).text).toContain("Test NPC");
    expect(must(drained[0]).text).toContain("appeared");
    const json = JSON.parse(must(drained[0]).json);
    expect(json.type).toBe("ENTITY_APPEAR");
    expect(json.name).toBe("Test NPC");
    expect(append).toHaveBeenCalledTimes(1);
  });

  test("pushes disappear event to ring buffer", () => {
    const events = new RingBuffer<EventEntry>(10);
    const append = jest.fn(async () => {});
    const log = { append } as unknown as SessionLog;
    onEntityEvent(
      { guid: 1n, name: "Gone NPC", type: "disappear" },
      events,
      log,
    );

    const drained = events.drain();
    expect(drained).toHaveLength(1);
    expect(must(drained[0]).text).toContain("Gone NPC");
    expect(must(drained[0]).text).toContain("left range");
    const json = JSON.parse(must(drained[0]).json);
    expect(json.type).toBe("ENTITY_DISAPPEAR");
  });

  test("skips update events with no obj", () => {
    const events = new RingBuffer<EventEntry>(10);
    const entity: UnitEntity = {
      class_: 0,
      displayId: 0,
      entry: 0,
      factionTemplate: 0,
      gender: 0,
      guid: 1n,
      health: 100,
      level: 10,
      maxHealth: 100,
      maxPower: [0, 0, 0, 0, 0, 0, 0],
      name: "Test NPC",
      npcFlags: 0,
      objectType: ObjectType.UNIT,
      position: undefined,
      power: [0, 0, 0, 0, 0, 0, 0],
      race: 0,
      rawFields: new Map(),
      scale: 1,
      target: 0n,
      unitFlags: 0,
    };

    const append = jest.fn(async () => {});
    const log = { append } as unknown as SessionLog;
    onEntityEvent({ changed: ["health"], entity, type: "update" }, events, log);

    expect(events.drain()).toHaveLength(0);
    expect(append).not.toHaveBeenCalled();
  });

  test("swallows entity event log append errors", async () => {
    const events = new RingBuffer<EventEntry>(10);
    const append = jest.fn(() => Promise.reject(new Error("disk full")));
    const log: SessionLog = { append } as unknown as SessionLog;

    onEntityEvent(
      { guid: 1n, name: "Gone NPC", type: "disappear" },
      events,
      log,
    );
    await Promise.resolve();

    expect(append).toHaveBeenCalled();
  });
});
