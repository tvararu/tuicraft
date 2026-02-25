import type { PacketReader } from "./packet";
import { UpdateType } from "./entity-fields";
import { parseUpdateMask } from "./update-mask";
import { parseMovementBlock } from "./movement-block";
import type { Position } from "wow/entity-store";

export type UpdateEntry =
  | {
      type: "create";
      guid: bigint;
      objectType: number;
      position: Position;
      fields: Map<number, number>;
    }
  | { type: "values"; guid: bigint; fields: Map<number, number> }
  | { type: "movement"; guid: bigint; position: Position }
  | { type: "outOfRange"; guids: bigint[] }
  | { type: "nearObjects"; guids: bigint[] };

export function parseUpdateObject(r: PacketReader): UpdateEntry[] {
  const count = r.uint32LE();
  const entries: UpdateEntry[] = [];
  for (let i = 0; i < count; i++) {
    const updateType = r.uint8();
    switch (updateType) {
      case UpdateType.VALUES: {
        const guid = readGuidBigint(r);
        const fields = parseUpdateMask(r);
        entries.push({ type: "values", guid, fields });
        break;
      }
      case UpdateType.MOVEMENT: {
        const guid = readGuidBigint(r);
        const movement = parseMovementBlock(r);
        entries.push({
          type: "movement",
          guid,
          position: {
            mapId: 0,
            x: movement.x,
            y: movement.y,
            z: movement.z,
            orientation: movement.orientation,
          },
        });
        break;
      }
      case UpdateType.CREATE_OBJECT:
      case UpdateType.CREATE_OBJECT2: {
        const guid = readGuidBigint(r);
        const objectType = r.uint8();
        const movement = parseMovementBlock(r);
        const fields = parseUpdateMask(r);
        const position: Position = {
          mapId: 0,
          x: movement.x,
          y: movement.y,
          z: movement.z,
          orientation: movement.orientation,
        };
        entries.push({ type: "create", guid, objectType, position, fields });
        break;
      }
      case UpdateType.OUT_OF_RANGE: {
        const n = r.uint32LE();
        const guids: bigint[] = [];
        for (let j = 0; j < n; j++) guids.push(readGuidBigint(r));
        entries.push({ type: "outOfRange", guids });
        break;
      }
      case UpdateType.NEAR_OBJECTS: {
        const n = r.uint32LE();
        const guids: bigint[] = [];
        for (let j = 0; j < n; j++) guids.push(readGuidBigint(r));
        entries.push({ type: "nearObjects", guids });
        break;
      }
    }
  }
  return entries;
}

export function readGuidBigint(r: PacketReader): bigint {
  const { low, high } = r.packedGuid();
  return (BigInt(high >>> 0) << 32n) | BigInt(low >>> 0);
}
