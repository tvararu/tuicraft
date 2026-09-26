import {
  type PacketReader,
  PacketWriter,
  type Vec3,
} from "wow/protocol/packet";

export type CorpseQuery =
  | { found: false }
  | {
      found: true;
      mapId: number;
      position: Vec3;
      corpseMapId: number;
      unknown: number;
    };
export type CorpseReclaimDelay = { delayMs: number };
export type DeathReleaseLocation =
  | { kind: "clear" }
  | { kind: "location"; mapId: number; position: Vec3 };
export type ResurrectRequest = {
  guid: bigint;
  name: string;
  reserved: number;
  sickness: number;
  delayMs: number | undefined;
};
export type SpiritHealerConfirm = { guid: bigint };

function guidRequest(guid: bigint): PacketWriter {
  const w = new PacketWriter();
  w.uint64LE(guid);
  return w;
}

export function buildRepopRequest(unknownByte: number): Uint8Array {
  const w = new PacketWriter();
  w.uint8(unknownByte);
  return w.finish();
}

export function buildReclaimCorpse(guid: bigint): Uint8Array {
  return guidRequest(guid).finish();
}

export function buildResurrectResponse(
  guid: bigint,
  accept: boolean,
): Uint8Array {
  const w = guidRequest(guid);
  w.uint8(accept ? 1 : 0);
  return w.finish();
}

export function buildSpiritHealerActivate(guid: bigint): Uint8Array {
  return guidRequest(guid).finish();
}

export function parseCorpseQuery(r: PacketReader): CorpseQuery {
  if (r.uint8() === 0) return { found: false };
  const mapId = r.uint32LE() | 0;
  const position = r.vec3();
  const corpseMapId = r.uint32LE() | 0;
  return { found: true, mapId, position, corpseMapId, unknown: r.uint32LE() };
}

export function parseCorpseReclaimDelay(r: PacketReader): CorpseReclaimDelay {
  return { delayMs: r.uint32LE() };
}

export function parseDeathReleaseLocation(
  r: PacketReader,
): DeathReleaseLocation {
  const mapId = r.uint32LE();
  const position = r.vec3();
  if (mapId === 0xff_ff_ff_ff) return { kind: "clear" };
  return { kind: "location", mapId, position };
}

export function parseResurrectRequest(r: PacketReader): ResurrectRequest {
  const guid = r.uint64LE();
  const name = r.sizedString();
  const reserved = r.uint8();
  const sickness = r.uint8();
  const delayMs = r.remaining >= 4 ? r.uint32LE() : undefined;
  return { guid, name, reserved, sickness, delayMs };
}

export function parseSpiritHealerConfirm(r: PacketReader): SpiritHealerConfirm {
  return { guid: r.uint64LE() };
}
