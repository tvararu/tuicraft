import { jest } from "bun:test";
import { bytes } from "test/hex";
import { startMockWorldServer } from "test/mock-world-server";
import {
  base,
  fakeAuth,
  waitForEchoProbe,
  writePackedGuid,
  writeUpdateMask,
} from "test/world-handlers-fixtures";
import { type WorldHandle, worldSession } from "wow/client";
import {
  ObjectType,
  UNIT_FIELDS,
  UpdateFlag,
  UpdateType,
} from "wow/protocol/entity-fields";
import { type MovementInfo, writeMovementInfo } from "wow/protocol/movement";
import { GameOpcode } from "wow/protocol/opcodes";
import { PacketWriter } from "wow/protocol/packet";
import type { RemoteMotionEvent, RemotePose } from "wow/remote-motion";

export const PEER = 0x9ffn;
export const MAP = 530;

export const CAPTURED = {
  create:
    "9a0100007801636460606066fecfc992006480008baca36cb83f87dbff82f3476d05a73b313034d84364141c18181e00f104874299e9401ac17fc0efe970f8ab878396284383f07486033fe41a58417a1819185c78400c64b04aab4109993f10ecff9c0c0c92608b1becb95819196e02d9f14c0c0c29401ac67ec10ce183682ea0b8171b030307480f987060f80014bcc0cec0c0a47ddc8e81e1807db10d030308430024d0048021000e4016b02823886b0ac4a26a0c0caf81e6089a03696008f5031df306489fb56660b826c8c0705e98810100b5fb2ccb",
  heartbeat:
    "03ff090100000000003767401d1f30084614bbcfc5e77e91420000803f00000000",
  startForward:
    "03ff090100000000002f64401d8f280846a4d2cfc5df8091420000803f00000000",
  stop: "03ff09000000000000596e401dec4f08460758cfc5385c99420000803f00000000",
  teleport:
    "03ff09000000000000ef33411d574f0846ff70cfc53d9197420000803f00000000",
};

const SPEEDS = [2.5, 7, 4.5, 4.7, 2.5, 3.14, 7, 4.5, 3.14];

export function info(x: number, flags = 0, extraFlags = 0): MovementInfo {
  return {
    extraFlags,
    fallTime: 0,
    flags,
    orientation: 0,
    time: 77,
    x,
    y: 2,
    z: 3,
  };
}

function writeLiving(w: PacketWriter, movement: MovementInfo): void {
  w.uint16LE(UpdateFlag.LIVING);
  writeMovementInfo(w, movement);
  for (const speed of SPEEDS) w.floatLE(speed);
}

export function createObject(
  guid: bigint,
  movement: MovementInfo,
  objectType: ObjectType = ObjectType.PLAYER,
  health = 100,
): Uint8Array {
  const w = new PacketWriter();
  w.uint32LE(1);
  w.uint8(UpdateType.CREATE_OBJECT2);
  writePackedGuid(w, guid);
  w.uint8(objectType);
  writeLiving(w, movement);
  writeUpdateMask(
    w,
    new Map([
      [UNIT_FIELDS.HEALTH.offset, health],
      [UNIT_FIELDS.MAXHEALTH.offset, 100],
    ]),
  );
  return w.finish();
}

export function updateMovement(
  guid: bigint,
  movement: MovementInfo | number,
): Uint8Array {
  const w = new PacketWriter();
  w.uint32LE(1);
  w.uint8(UpdateType.MOVEMENT);
  writePackedGuid(w, guid);
  if (typeof movement === "number") {
    w.uint16LE(UpdateFlag.HAS_POSITION);
    for (const value of [movement, 2, 3, 0]) w.floatLE(value);
  } else writeLiving(w, movement);
  return w.finish();
}

export function setHealth(guid: bigint, health: number): Uint8Array {
  const w = new PacketWriter();
  w.uint32LE(1);
  w.uint8(UpdateType.VALUES);
  writePackedGuid(w, guid);
  writeUpdateMask(w, new Map([[UNIT_FIELDS.HEALTH.offset, health]]));
  return w.finish();
}

export function moveBody(guid: bigint, movement: MovementInfo): Uint8Array {
  const w = new PacketWriter();
  writePackedGuid(w, guid);
  writeMovementInfo(w, movement);
  return w.finish();
}

export function worldPosition(mapId: number): Uint8Array {
  const w = new PacketWriter();
  w.uint32LE(mapId);
  for (const value of [1, 2, 3, 0]) w.floatLE(value);
  return w.finish();
}

type Server = Awaited<ReturnType<typeof startMockWorldServer>>;

export type MotionFixture = {
  server: Server;
  handle: WorldHandle;
  events: RemoteMotionEvent[];
  errors: number[];
  setNow: (ms: number) => void;
  inject: (opcode: number, body: Uint8Array | string) => Promise<void>;
  pose: () => RemotePose | undefined;
  close: () => Promise<void>;
};

export async function motionFixture(): Promise<MotionFixture> {
  const server = await startMockWorldServer({ loginMapId: MAP });
  const handle = await worldSession(
    { ...base, host: "127.0.0.1", port: server.port },
    fakeAuth(server.port),
  );
  const now = jest.spyOn(Date, "now").mockReturnValue(10_000);
  const events: RemoteMotionEvent[] = [];
  const errors: number[] = [];
  handle.onRemoteMotionEvent((event) => events.push(event));
  handle.onPacketError((opcode) => errors.push(opcode));
  const inject = async (opcode: number, body: Uint8Array | string) => {
    server.inject(opcode, typeof body === "string" ? bytes(body) : body);
    await waitForEchoProbe(handle);
  };
  await inject(GameOpcode.SMSG_COMPRESSED_UPDATE_OBJECT, CAPTURED.create);
  events.length = 0;
  return {
    async close() {
      now.mockRestore();
      handle.close();
      await handle.closed;
      server.stop();
    },
    errors,
    events,
    handle,
    inject,
    pose: () => handle.getRemotePoses().find((pose) => pose.guid === PEER),
    server,
    setNow: (ms) => now.mockReturnValue(ms),
  };
}
