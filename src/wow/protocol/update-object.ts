import type { Position } from "wow/entity-store";
import type { PacketReader } from "wow/protocol/packet";
import { UpdateType } from "wow/protocol/entity-fields";
import { parseUpdateMask } from "wow/protocol/update-mask";
import { parseMovementBlock } from "wow/protocol/movement-block";
import type { CreateSpline } from "wow/protocol/monster-move";

type Movement = {
  position: Position;
  updateFlags: number;
  movementFlags?: number;
  runSpeed?: number;
  runBackSpeed?: number;
  spline?: CreateSpline;
};

export type UpdateEntry =
  | ({
      type: "create";
      guid: bigint;
      objectType: number;
      fields: Map<number, number>;
    } & Movement)
  | { type: "values"; guid: bigint; fields: Map<number, number> }
  | ({ type: "movement"; guid: bigint } & Movement)
  | { type: "outOfRange"; guids: bigint[] }
  | { type: "nearObjects"; guids: bigint[] };

function readMovement(r: PacketReader, mapId: number): Movement {
  const { x, y, z, orientation, ...rest } = parseMovementBlock(r);
  return { position: { mapId, x, y, z, orientation }, ...rest };
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
    case UpdateType.MOVEMENT:
      return {
        type: "movement",
        guid: r.packedGuidBig(),
        ...readMovement(r, mapId),
      };
    case UpdateType.CREATE_OBJECT:
    case UpdateType.CREATE_OBJECT2: {
      const guid = r.packedGuidBig();
      const objectType = r.uint8();
      const movement = readMovement(r, mapId);
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
  }
  return undefined;
}

export function parseUpdateObject(r: PacketReader, mapId = 0): UpdateEntry[] {
  const count = r.uint32LE();
  const entries: UpdateEntry[] = [];
  for (let i = 0; i < count; i++) {
    try {
      const entry = readEntry(r, mapId);
      if (entry) entries.push(entry);
    } catch {
      break;
    }
  }
  return entries;
}
