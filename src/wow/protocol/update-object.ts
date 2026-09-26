import type { Position } from "wow/entity-store";
import { ObjectType, UpdateType } from "wow/protocol/entity-fields";
import type { CreateSpline } from "wow/protocol/monster-move";
import type { MovementInfo } from "wow/protocol/movement";
import { parseMovementBlock } from "wow/protocol/movement-block";
import type { PacketReader } from "wow/protocol/packet";
import { parseUpdateMask } from "wow/protocol/update-mask";

type Movement = {
  position: Position;
  updateFlags: number;
  movementInfo?: MovementInfo;
  runSpeed?: number;
  runBackSpeed?: number;
  spline?: CreateSpline;
};

export type UpdateEntry =
  | ({
      type: "create";
      guid: bigint;
      objectType: ObjectType;
      fields: Map<number, number>;
    } & Movement)
  | { type: "values"; guid: bigint; fields: Map<number, number> }
  | ({ type: "movement"; guid: bigint } & Movement)
  | { type: "outOfRange"; guids: bigint[] }
  | { type: "nearObjects"; guids: bigint[] }
  | { type: "malformed"; guid: bigint };

class MalformedEntry extends Error {
  readonly guid: bigint;

  constructor(guid: bigint, options: ErrorOptions) {
    super("malformed update entry", options);
    this.guid = guid;
  }
}

function readMovement(r: PacketReader, mapId: number, guid: bigint): Movement {
  try {
    const { x, y, z, orientation, ...rest } = parseMovementBlock(r);
    return { position: { mapId, x, y, z, orientation }, ...rest };
  } catch (error) {
    throw new MalformedEntry(guid, { cause: error });
  }
}

const OBJECT_TYPES = new Set<number>(Object.values(ObjectType));

function isObjectType(value: number): value is ObjectType {
  return OBJECT_TYPES.has(value);
}

function readObjectType(r: PacketReader): ObjectType {
  const value = r.uint8();
  if (!isObjectType(value))
    throw new RangeError(`unknown object type ${value}`);
  return value;
}

function readGuids(r: PacketReader): bigint[] {
  const n = r.uint32LE();
  const guids: bigint[] = [];
  for (let j = 0; j < n; j++) guids.push(r.packedGuidBig());
  return guids;
}

function readEntry(r: PacketReader, mapId: number): UpdateEntry | undefined {
  const updateType = r.uint8();
  switch (updateType) {
    case UpdateType.VALUES:
      return {
        type: "values",
        guid: r.packedGuidBig(),
        fields: parseUpdateMask(r),
      };
    case UpdateType.MOVEMENT: {
      const guid = r.packedGuidBig();
      return { type: "movement", guid, ...readMovement(r, mapId, guid) };
    }
    case UpdateType.CREATE_OBJECT:
    case UpdateType.CREATE_OBJECT2: {
      const guid = r.packedGuidBig();
      const objectType = readObjectType(r);
      const movement = readMovement(r, mapId, guid);
      return {
        type: "create",
        guid,
        objectType,
        ...movement,
        fields: parseUpdateMask(r),
      };
    }
    case UpdateType.OUT_OF_RANGE:
      return { type: "outOfRange", guids: readGuids(r) };
    case UpdateType.NEAR_OBJECTS:
      return { type: "nearObjects", guids: readGuids(r) };
    default:
      return undefined;
  }
}

export function parseUpdateObject(r: PacketReader, mapId = 0): UpdateEntry[] {
  const count = r.uint32LE();
  const entries: UpdateEntry[] = [];
  for (let i = 0; i < count; i++) {
    try {
      const entry = readEntry(r, mapId);
      if (entry) entries.push(entry);
    } catch (error) {
      if (error instanceof MalformedEntry)
        entries.push({ type: "malformed", guid: error.guid });
      break;
    }
  }
  return entries;
}
