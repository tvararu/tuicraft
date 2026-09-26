import { describe, expect, test } from "bun:test";
import { makeGameObjectEntity, makeUnitEntity } from "test/format-fixtures";
import { formatEntityEvent, formatEntityEventObj } from "ui/format";
import { type Entity, ObjectType } from "wow";

describe("formatEntityEvent", () => {
  test("formats unit appear with name and level", () => {
    const result = formatEntityEvent({
      entity: makeUnitEntity(),
      type: "appear",
    });
    expect(result).toBe("[world] Innkeeper Palla appeared (NPC, level 55)");
  });

  test("suppresses appear without name", () => {
    const result = formatEntityEvent({
      entity: {
        guid: 2n,
        level: 1,
        name: undefined,
        objectType: ObjectType.UNIT,
      } as unknown as Entity,
      type: "appear",
    });
    expect(result).toBeUndefined();
  });

  test("formats player appear", () => {
    const result = formatEntityEvent({
      entity: makeUnitEntity({
        guid: 2n,
        level: 80,
        name: "Thrall",
        objectType: ObjectType.PLAYER,
      }),
      type: "appear",
    });
    expect(result).toBe("[world] Thrall appeared (Player, level 80)");
  });

  test("formats gameobject appear", () => {
    const result = formatEntityEvent({
      entity: makeGameObjectEntity(),
      type: "appear",
    });
    expect(result).toBe("[world] Mailbox appeared (GameObject)");
  });

  test("formats disappear", () => {
    const result = formatEntityEvent({
      guid: 1n,
      name: "Silvermoon Guardian",
      type: "disappear",
    });
    expect(result).toBe("[world] Silvermoon Guardian left range");
  });

  test("formats disappear without name", () => {
    const result = formatEntityEvent({
      guid: 1n,
      type: "disappear",
    });
    expect(result).toBe("[world] Unknown entity left range");
  });

  test("update returns undefined for non-name changes", () => {
    const result = formatEntityEvent({
      changed: ["health"],
      entity: { guid: 1n } as unknown as Entity,
      type: "update",
    });
    expect(result).toBeUndefined();
  });

  test("update with name change formats appear-like message for NPC", () => {
    const result = formatEntityEvent({
      changed: ["name"],
      entity: {
        guid: 1n,
        level: 1,
        name: "Springpaw Cub",
        objectType: ObjectType.UNIT,
      } as unknown as Entity,
      type: "update",
    });
    expect(result).toBe("[world] Springpaw Cub appeared (NPC, level 1)");
  });

  test("appear for CORPSE returns undefined", () => {
    const result = formatEntityEvent({
      entity: {
        entry: 0,
        guid: 10n,
        name: "Some Corpse",
        objectType: ObjectType.CORPSE,
        position: undefined,
        rawFields: new Map(),
        scale: 1,
      },
      type: "appear",
    });
    expect(result).toBeUndefined();
  });
});

describe("formatEntityEventObj", () => {
  test("appear for UNIT with position", () => {
    const result = formatEntityEventObj({
      entity: makeUnitEntity({
        health: 4200,
        maxHealth: 5000,
        position: { mapId: 0, orientation: 0, x: 100.5, y: 200.5, z: 50.0 },
      }),
      type: "appear",
    });
    expect(result).toEqual({
      guid: "0x1",
      health: 4200,
      level: 55,
      maxHealth: 5000,
      name: "Innkeeper Palla",
      objectType: ObjectType.UNIT,
      type: "ENTITY_APPEAR",
      x: 100.5,
      y: 200.5,
      z: 50.0,
    });
  });

  test("appear for UNIT without position", () => {
    const result = formatEntityEventObj({
      entity: makeUnitEntity({ level: 75, name: "Guard" }),
      type: "appear",
    });
    expect(result).toEqual({
      guid: "0x1",
      health: 100,
      level: 75,
      maxHealth: 100,
      name: "Guard",
      objectType: ObjectType.UNIT,
      type: "ENTITY_APPEAR",
    });
    expect(result).not.toHaveProperty("x");
    expect(result).not.toHaveProperty("y");
    expect(result).not.toHaveProperty("z");
  });

  test("appear for PLAYER with position", () => {
    const result = formatEntityEventObj({
      entity: makeUnitEntity({
        guid: 5n,
        health: 9000,
        level: 80,
        maxHealth: 9000,
        name: "Thrall",
        objectType: ObjectType.PLAYER,
        position: { mapId: 0, orientation: 0, x: 1, y: 2, z: 3 },
      }),
      type: "appear",
    });
    expect(result).toEqual({
      guid: "0x5",
      health: 9000,
      level: 80,
      maxHealth: 9000,
      name: "Thrall",
      objectType: ObjectType.PLAYER,
      type: "ENTITY_APPEAR",
      x: 1,
      y: 2,
      z: 3,
    });
  });

  test("appear for GAMEOBJECT", () => {
    const result = formatEntityEventObj({
      entity: makeGameObjectEntity({ guid: 1n }),
      type: "appear",
    });
    expect(result).toEqual({
      guid: "0x1",
      name: "Mailbox",
      objectType: ObjectType.GAMEOBJECT,
      type: "ENTITY_APPEAR",
    });
    expect(result).not.toHaveProperty("level");
    expect(result).not.toHaveProperty("health");
    expect(result).not.toHaveProperty("maxHealth");
  });

  test("disappear", () => {
    const result = formatEntityEventObj({
      guid: 1n,
      name: "Silvermoon Guardian",
      type: "disappear",
    });
    expect(result).toEqual({
      guid: "0x1",
      name: "Silvermoon Guardian",
      type: "ENTITY_DISAPPEAR",
    });
  });

  test("update returns undefined", () => {
    const result = formatEntityEventObj({
      changed: ["health"],
      entity: { guid: 1n, objectType: ObjectType.UNIT } as unknown as Entity,
      type: "update",
    });
    expect(result).toBeUndefined();
  });
});
