import { PacketWriter, PacketReader } from "./packet";

export function buildCreatureQuery(entry: number, guid: bigint): Uint8Array {
  const w = new PacketWriter();
  w.uint32LE(entry);
  w.uint64LE(guid);
  return w.finish();
}

export type CreatureQueryResult = {
  entry: number;
  name: string | undefined;
};

export function parseCreatureQueryResponse(
  r: PacketReader,
): CreatureQueryResult {
  const raw = r.uint32LE();
  const masked = raw & 0x80000000;
  const entry = raw & 0x7fffffff;
  if (masked) return { entry, name: undefined };
  const name = r.cString();
  return { entry, name };
}

export function buildGameObjectQuery(entry: number, guid: bigint): Uint8Array {
  const w = new PacketWriter();
  w.uint32LE(entry);
  w.uint64LE(guid);
  return w.finish();
}

export type GameObjectQueryResult = {
  entry: number;
  name: string | undefined;
  gameObjectType: number | undefined;
};

export function parseGameObjectQueryResponse(
  r: PacketReader,
): GameObjectQueryResult {
  const raw = r.uint32LE();
  const masked = raw & 0x80000000;
  const entry = raw & 0x7fffffff;
  if (masked) return { entry, name: undefined, gameObjectType: undefined };
  const gameObjectType = r.uint32LE();
  r.uint32LE();
  const name = r.cString();
  return { entry, name, gameObjectType };
}
