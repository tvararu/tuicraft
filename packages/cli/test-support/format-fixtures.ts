import {
  type FriendEntry,
  FriendStatus,
  type GameObjectEntity,
  type IgnoreEntry,
  ObjectType,
  type UnitEntity,
} from "@tuicraft/core";

export function makeUnitEntity(
  overrides: Partial<UnitEntity> = {},
): UnitEntity {
  return {
    class_: 0,
    displayId: 0,
    entry: 0,
    factionTemplate: 0,
    gender: 0,
    guid: 1n,
    health: 100,
    level: 55,
    maxHealth: 100,
    maxPower: [],
    name: "Innkeeper Palla",
    npcFlags: 0,
    objectType: ObjectType.UNIT,
    position: undefined,
    power: [],
    race: 0,
    rawFields: new Map(),
    scale: 1,
    target: 0n,
    unitFlags: 0,
    ...overrides,
  };
}

export function makeGameObjectEntity(
  overrides: Partial<GameObjectEntity> = {},
): GameObjectEntity {
  return {
    bytes1: 0,
    displayId: 0,
    entry: 0,
    flags: 0,
    gameObjectType: 19,
    guid: 3n,
    name: "Mailbox",
    objectType: ObjectType.GAMEOBJECT,
    position: undefined,
    rawFields: new Map(),
    scale: 1,
    ...overrides,
  };
}

export function makeFriendEntry(
  overrides: Partial<FriendEntry> = {},
): FriendEntry {
  return {
    area: 0,
    guid: 1n,
    level: 80,
    name: "Arthas",
    note: "",
    playerClass: 6,
    status: FriendStatus.ONLINE,
    ...overrides,
  };
}

export function makeIgnoreEntry(
  overrides: Partial<IgnoreEntry> = {},
): IgnoreEntry {
  return {
    guid: 1n,
    name: "Spammer",
    ...overrides,
  };
}
