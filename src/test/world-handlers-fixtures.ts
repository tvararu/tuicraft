import {
  clientPrivateKey,
  clientSeed,
  FIXTURE_ACCOUNT,
  FIXTURE_CHARACTER,
  FIXTURE_PASSWORD,
  sessionKey,
} from "test/fixtures";
import { must } from "test/must";
import type { AuthResult } from "wow/auth";
import type { DuelEvent, GroupEvent, WorldHandle } from "wow/client";
import type { EntityEvent } from "wow/entity-store";
import {
  OBJECT_FIELDS,
  UNIT_FIELDS,
  UpdateFlag,
} from "wow/protocol/entity-fields";
import { PacketWriter } from "wow/protocol/packet";

export const base = {
  account: FIXTURE_ACCOUNT,
  character: FIXTURE_CHARACTER,
  clientSeed,
  password: FIXTURE_PASSWORD,
  srpPrivateKey: clientPrivateKey,
};

export function fakeAuth(port: number): AuthResult {
  return {
    realmHost: "127.0.0.1",
    realmId: 1,
    realmPort: port,
    sessionKey,
  };
}

export async function waitForEchoProbe(
  handle: Pick<WorldHandle, "onMessage" | "sendSay">,
): Promise<void> {
  const received = Promise.withResolvers<void>();
  const unsubscribe = handle.onMessage((msg) => {
    if (msg.message === "probe") received.resolve();
  });
  handle.sendSay("probe");
  await received.promise;
  unsubscribe();
}

export function waitForGroupEvents(
  handle: Pick<WorldHandle, "onGroupEvent">,
  count: number,
): Promise<GroupEvent[]> {
  const events: GroupEvent[] = [];
  return new Promise((resolve) => {
    handle.onGroupEvent((event) => {
      events.push(event);
      if (events.length === count) resolve(events);
    });
  });
}

export function waitForDuelEvents(
  handle: Pick<WorldHandle, "onDuelEvent">,
  count: number,
): Promise<DuelEvent[]> {
  const events: DuelEvent[] = [];
  return new Promise((resolve) => {
    handle.onDuelEvent((event) => {
      events.push(event);
      if (events.length === count) resolve(events);
    });
  });
}

export function writePackedGuid(w: PacketWriter, guid: bigint) {
  const low = Number(guid & 0xffffffffn);
  const high = Number((guid >> 32n) & 0xffffffffn);
  let mask = 0;
  const bytes: number[] = [];
  for (let i = 0; i < 4; i++) {
    const b = (low >> (i * 8)) & 0xff;
    if (b !== 0) {
      mask |= 1 << i;
      bytes.push(b);
    }
  }
  for (let i = 0; i < 4; i++) {
    const b = (high >> (i * 8)) & 0xff;
    if (b !== 0) {
      mask |= 1 << (i + 4);
      bytes.push(b);
    }
  }
  w.uint8(mask);
  for (const b of bytes) w.uint8(b);
}

export function writeLivingMovementBlock(
  w: PacketWriter,
  [x, y, z, orientation]: readonly [number, number, number, number],
) {
  w.uint16LE(UpdateFlag.LIVING);
  w.uint32LE(0);
  w.uint16LE(0);
  w.uint32LE(0);
  w.floatLE(x);
  w.floatLE(y);
  w.floatLE(z);
  w.floatLE(orientation);
  w.floatLE(0);
  for (let i = 0; i < 9; i++) w.floatLE(0);
}

export function writeHasPositionMovementBlock(
  w: PacketWriter,
  [x, y, z, orientation]: readonly [number, number, number, number],
) {
  w.uint16LE(UpdateFlag.HAS_POSITION);
  w.floatLE(x);
  w.floatLE(y);
  w.floatLE(z);
  w.floatLE(orientation);
}

export function writeUpdateMask(w: PacketWriter, fields: Map<number, number>) {
  let maxBit = 0;
  for (const bit of fields.keys()) {
    if (bit > maxBit) maxBit = bit;
  }
  const blockCount =
    maxBit === 0 && fields.size === 0 ? 0 : Math.floor(maxBit / 32) + 1;
  w.uint8(blockCount);
  const masks = new Array<number>(blockCount).fill(0);
  for (const bit of fields.keys()) {
    const block = Math.floor(bit / 32);
    masks[block] = must(masks[block]) | (1 << (bit % 32));
  }
  for (const m of masks) w.uint32LE(m);
  for (let block = 0; block < blockCount; block++) {
    for (let bit = 0; bit < 32; bit++) {
      const index = block * 32 + bit;
      if (fields.has(index)) {
        w.uint32LE(must(fields.get(index)));
      }
    }
  }
}

function nameQueryGuidMask(guidLow: number): number {
  if (guidLow === 0) return 0;
  if (guidLow <= 0xff) return 0x01;
  return 0x03;
}

export function buildContactList(
  entries: {
    guid: bigint;
    flags: number;
    note: string;
    status?: number;
    area?: number;
    level?: number;
    playerClass?: number;
  }[],
): Uint8Array {
  const w = new PacketWriter();
  w.uint32LE(7);
  w.uint32LE(entries.length);
  for (const e of entries) {
    w.uint64LE(e.guid);
    w.uint32LE(e.flags);
    w.cString(e.note);
    if (e.flags & 0x01) {
      const status = e.status ?? 0;
      w.uint8(status);
      if (status !== 0) {
        w.uint32LE(e.area ?? 0);
        w.uint32LE(e.level ?? 0);
        w.uint32LE(e.playerClass ?? 0);
      }
    }
  }
  return w.finish();
}

export function buildFriendStatus(opts: {
  result: number;
  guid: bigint;
  note?: string;
  status?: number;
  area?: number;
  level?: number;
  playerClass?: number;
}): Uint8Array {
  const w = new PacketWriter();
  w.uint8(opts.result);
  w.uint64LE(opts.guid);
  if (opts.result === 0x06 || opts.result === 0x07) {
    w.cString(opts.note ?? "");
  }
  if (opts.result === 0x06 || opts.result === 0x02) {
    w.uint8(opts.status ?? 1);
    w.uint32LE(opts.area ?? 0);
    w.uint32LE(opts.level ?? 0);
    w.uint32LE(opts.playerClass ?? 0);
  }
  return w.finish();
}

export function buildNameQueryResponse(
  guidLow: number,
  name: string,
): Uint8Array {
  const w = new PacketWriter();
  const mask = nameQueryGuidMask(guidLow);
  w.uint8(mask);
  if (mask & 0x01) w.uint8(guidLow & 0xff);
  if (mask & 0x02) w.uint8((guidLow >> 8) & 0xff);
  w.uint8(0);
  w.cString(name);
  w.cString("");
  w.uint32LE(1);
  w.uint32LE(0);
  w.uint32LE(1);
  return w.finish();
}

export function buildCreateUnitPacket(
  guid: bigint,
  entry: number,
  health: number,
  maxHealth: number,
): Uint8Array {
  const w = new PacketWriter();
  w.uint32LE(1);
  w.uint8(3);
  writePackedGuid(w, guid);
  w.uint8(3);
  writeLivingMovementBlock(w, [100, 200, 300, 1.5]);
  const fields = new Map<number, number>([
    [OBJECT_FIELDS.ENTRY.offset, entry],
    [UNIT_FIELDS.HEALTH.offset, health],
    [UNIT_FIELDS.MAXHEALTH.offset, maxHealth],
  ]);
  writeUpdateMask(w, fields);
  return w.finish();
}

export function waitForEntityEvents(
  handle: Pick<WorldHandle, "onEntityEvent">,
  count: number,
): Promise<EntityEvent[]> {
  const events: EntityEvent[] = [];
  return new Promise((resolve) => {
    handle.onEntityEvent((event) => {
      events.push(event);
      if (events.length === count) resolve(events);
    });
  });
}
