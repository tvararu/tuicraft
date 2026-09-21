import { PacketReader, PacketWriter } from "wow/protocol/packet";

export type DeathPosition = { x: number; y: number; z: number };
export type CorpseQuery =
  | { found: false }
  | {
      found: true;
      mapId: number;
      position: DeathPosition;
      corpseMapId: number;
      unknown: number;
    };
export type CorpseReclaimDelay = { delayMs: number };
export type DeathReleaseLocation =
  | { kind: "clear" }
  | { kind: "location"; mapId: number; position: DeathPosition };
export type ResurrectRequest = {
  guid: bigint;
  name: string;
  reserved: number;
  sickness: number;
  delayMs: number | undefined;
};

export function buildRepopRequest(unknownByte: number): Uint8Array {
  if (!Number.isInteger(unknownByte) || unknownByte < 0 || unknownByte > 255)
    throw new RangeError("Repop byte outside uint8 range");
  const writer = new PacketWriter(1);
  writer.uint8(unknownByte);
  return writer.finish();
}

export function buildReclaimCorpse(guid: bigint): Uint8Array {
  checkGuid(guid);
  const writer = new PacketWriter(8);
  writer.uint64LE(guid);
  return writer.finish();
}

export function buildResurrectResponse(
  guid: bigint,
  accept: boolean,
): Uint8Array {
  checkGuid(guid);
  const writer = new PacketWriter(9);
  writer.uint64LE(guid);
  writer.uint8(accept ? 1 : 0);
  return writer.finish();
}

export function parseCorpseQuery(reader: PacketReader): CorpseQuery {
  const found = reader.uint8();
  if (found === 0) {
    end(reader);
    return { found: false };
  }
  if (found !== 1) throw new RangeError("Invalid corpse query presence flag");
  const mapId = reader.uint32LE() | 0;
  const position = readPosition(reader);
  const corpseMapId = reader.uint32LE() | 0;
  const unknown = reader.uint32LE();
  end(reader);
  return { found: true, mapId, position, corpseMapId, unknown };
}

export function parseCorpseReclaimDelay(
  reader: PacketReader,
): CorpseReclaimDelay {
  const delayMs = reader.uint32LE();
  end(reader);
  return { delayMs };
}

export function parseDeathReleaseLocation(
  reader: PacketReader,
): DeathReleaseLocation {
  const mapId = reader.uint32LE();
  const position = readPosition(reader);
  end(reader);
  if (mapId === 0xffffffff) return { kind: "clear" };
  return { kind: "location", mapId, position };
}

export function parseResurrectRequest(reader: PacketReader): ResurrectRequest {
  const guid = reader.uint64LE();
  const name = readName(reader);
  const reserved = reader.uint8();
  const sickness = reader.uint8();
  if (reader.remaining !== 0 && reader.remaining !== 4)
    throw new RangeError("Invalid resurrection delay payload size");
  const delayMs = reader.remaining === 4 ? reader.uint32LE() : undefined;
  return { guid, name, reserved, sickness, delayMs };
}

function readName(reader: PacketReader): string {
  const length = reader.uint32LE();
  if (length === 0) throw new RangeError("Resurrection name has no terminator");
  const bytes = reader.bytes(length);
  if (bytes.indexOf(0) !== length - 1)
    throw new RangeError("Resurrection name terminator does not match length");
  return new TextDecoder("utf-8", { fatal: true }).decode(
    bytes.subarray(0, -1),
  );
}

function readPosition(reader: PacketReader): DeathPosition {
  return { x: reader.floatLE(), y: reader.floatLE(), z: reader.floatLE() };
}

function checkGuid(guid: bigint): void {
  if (guid < 0n || guid > 0xffffffffffffffffn)
    throw new RangeError("GUID outside uint64 range");
}

function end(reader: PacketReader): void {
  if (reader.remaining !== 0)
    throw new RangeError("Unexpected trailing death payload");
}
