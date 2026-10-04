import { PacketWriter } from "#wow/protocol/packet";

function packedOrZero(w: PacketWriter, guid: bigint | undefined): void {
  if (guid === undefined) w.uint8(0);
  else w.packedGuidBig(guid);
}

export function lootingLootListBody(init: {
  creature: bigint;
  master?: bigint;
  looter?: bigint;
}): Uint8Array {
  const w = new PacketWriter();
  w.uint64LE(init.creature);
  packedOrZero(w, init.master);
  packedOrZero(w, init.looter);
  return w.finish();
}

export function lootingLootMasterListBody(
  guids: readonly bigint[],
): Uint8Array {
  const w = new PacketWriter();
  w.uint8(guids.length);
  for (const guid of guids) w.uint64LE(guid);
  return w.finish();
}

export function lootingLootRemovedBody(slot: number): Uint8Array {
  const w = new PacketWriter();
  w.uint8(slot);
  return w.finish();
}

export function lootingLootErrorBody(guid: bigint, error: number): Uint8Array {
  const w = new PacketWriter();
  w.uint64LE(guid);
  w.uint8(0);
  w.uint8(error);
  return w.finish();
}

export function lootingLootReleaseBody(
  guid: bigint,
  status: number,
): Uint8Array {
  const w = new PacketWriter();
  w.uint64LE(guid);
  w.uint8(status);
  return w.finish();
}

export function lootingLootOpenBody(
  guid: bigint,
  items: readonly { slot: number; itemId: number }[],
): Uint8Array {
  const w = new PacketWriter();
  w.uint64LE(guid);
  w.uint8(1);
  w.uint32LE(0);
  w.uint8(items.length);
  for (const item of items) {
    w.uint8(item.slot);
    w.uint32LE(item.itemId);
    w.uint32LE(1);
    w.uint32LE(0);
    w.uint32LE(0);
    w.uint32LE(0x80_00_00_00);
    w.uint8(0);
  }
  return w.finish();
}
