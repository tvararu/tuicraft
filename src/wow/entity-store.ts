import { ObjectType } from "wow/protocol/entity-fields";

export type Position = {
  mapId: number;
  x: number;
  y: number;
  z: number;
  orientation: number;
};

export type BaseEntity = {
  guid: bigint;
  objectType: ObjectType;
  entry: number;
  scale: number;
  position: Position | undefined;
  rawFields: Map<number, number>;
  name: string | undefined;
};

export type UnitEntity = BaseEntity & {
  objectType: ObjectType.UNIT | ObjectType.PLAYER;
  health: number;
  maxHealth: number;
  level: number;
  factionTemplate: number;
  displayId: number;
  npcFlags: number;
  unitFlags: number;
  target: bigint;
  race: number;
  class_: number;
  gender: number;
  power: number[];
  maxPower: number[];
};

export type GameObjectEntity = BaseEntity & {
  objectType: ObjectType.GAMEOBJECT;
  displayId: number;
  flags: number;
  gameObjectType: number;
  bytes1: number;
};

export type Entity = UnitEntity | GameObjectEntity | BaseEntity;

export type EntityEvent =
  | { type: "appear"; entity: Entity }
  | { type: "disappear"; guid: bigint; name?: string }
  | { type: "update"; entity: Entity; changed: string[] };

function createBase(guid: bigint, objectType: ObjectType): BaseEntity {
  return {
    guid,
    objectType,
    entry: 0,
    scale: 0,
    position: undefined,
    rawFields: new Map(),
    name: undefined,
  };
}

function createUnit(
  guid: bigint,
  objectType: ObjectType.UNIT | ObjectType.PLAYER,
): UnitEntity {
  return {
    ...createBase(guid, objectType),
    objectType,
    health: 0,
    maxHealth: 0,
    level: 0,
    factionTemplate: 0,
    displayId: 0,
    npcFlags: 0,
    unitFlags: 0,
    target: 0n,
    race: 0,
    class_: 0,
    gender: 0,
    power: [0, 0, 0, 0, 0, 0, 0],
    maxPower: [0, 0, 0, 0, 0, 0, 0],
  };
}

function createGameObject(guid: bigint): GameObjectEntity {
  return {
    ...createBase(guid, ObjectType.GAMEOBJECT),
    objectType: ObjectType.GAMEOBJECT,
    displayId: 0,
    flags: 0,
    gameObjectType: 0,
    bytes1: 0,
  };
}

type EntityFields = Partial<
  Omit<UnitEntity, "objectType"> & Omit<GameObjectEntity, "objectType">
>;

export class EntityStore {
  private entities = new Map<bigint, Entity>();
  private byType = new Map<number, Set<bigint>>();
  private listener?: (event: EntityEvent) => void;

  onEvent(cb: (event: EntityEvent) => void): void {
    this.listener = cb;
  }

  create(guid: bigint, objectType: ObjectType, fields: EntityFields): void {
    let entity: Entity;
    if (objectType === ObjectType.UNIT || objectType === ObjectType.PLAYER) {
      entity = Object.assign(createUnit(guid, objectType), fields);
    } else if (objectType === ObjectType.GAMEOBJECT) {
      entity = Object.assign(createGameObject(guid), fields);
    } else {
      entity = Object.assign(createBase(guid, objectType), fields);
    }

    this.entities.set(guid, entity);

    let typeSet = this.byType.get(objectType);
    if (!typeSet) {
      typeSet = new Set();
      this.byType.set(objectType, typeSet);
    }
    typeSet.add(guid);

    this.listener?.({ type: "appear", entity });
  }

  update(guid: bigint, fields: Record<string, unknown>): void {
    const entity = this.entities.get(guid);
    if (!entity) return;

    const changed: string[] = [];
    for (const [key, value] of Object.entries(fields)) {
      changed.push(key);
      (entity as Record<string, unknown>)[key] = value;
    }

    this.listener?.({ type: "update", entity, changed });
  }

  destroy(guid: bigint): void {
    const entity = this.entities.get(guid);
    if (!entity) return;

    this.entities.delete(guid);
    this.byType.get(entity.objectType)?.delete(guid);

    this.listener?.({ type: "disappear", guid, name: entity.name });
  }

  clear(): void {
    for (const [guid, entity] of this.entities) {
      this.listener?.({ type: "disappear", guid, name: entity.name });
    }
    this.entities.clear();
    this.byType.clear();
  }

  get(guid: bigint): Entity | undefined {
    return this.entities.get(guid);
  }

  getByType(type: ObjectType): Entity[] {
    const guids = this.byType.get(type);
    if (!guids) return [];
    const result: Entity[] = [];
    for (const guid of guids) {
      const entity = this.entities.get(guid);
      if (entity) result.push(entity);
    }
    return result;
  }

  all(): Entity[] {
    return [...this.entities.values()];
  }

  setName(guid: bigint, name: string): void {
    const entity = this.entities.get(guid);
    if (!entity) return;
    entity.name = name;
    this.listener?.({ type: "update", entity, changed: ["name"] });
  }

  setPosition(guid: bigint, pos: Position): void {
    const entity = this.entities.get(guid);
    if (!entity) return;
    entity.position = pos;
    this.listener?.({ type: "update", entity, changed: ["position"] });
  }
}
