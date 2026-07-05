import { test, expect, describe } from "bun:test";
import { worldSession, type MoveEvent, type WorldHandle } from "wow/client";
import type { AuthResult } from "wow/auth";
import {
  startMockWorldServer,
  type CapturedPacket,
} from "test/mock-world-server";
import { PacketReader, PacketWriter } from "wow/protocol/packet";
import { GameOpcode } from "wow/protocol/opcodes";
import {
  MovementFlag,
  UpdateFlag,
  OBJECT_FIELDS,
  UNIT_FIELDS,
} from "wow/protocol/entity-fields";
import { parseMovementInfo, writeMovementInfo } from "wow/protocol/movement";
import {
  FIXTURE_ACCOUNT,
  FIXTURE_PASSWORD,
  FIXTURE_CHARACTER,
  clientPrivateKey,
  clientSeed,
  sessionKey,
} from "test/fixtures";

const base = {
  account: FIXTURE_ACCOUNT,
  password: FIXTURE_PASSWORD,
  character: FIXTURE_CHARACTER,
  srpPrivateKey: clientPrivateKey,
  clientSeed,
  moveTickMs: 10,
  moveHeartbeatMs: 20,
  moveProgressMs: 30,
};

function fakeAuth(port: number): AuthResult {
  return {
    sessionKey,
    realmHost: "127.0.0.1",
    realmPort: port,
    realmId: 1,
  };
}

function writePackedGuid(w: PacketWriter, guid: bigint) {
  w.packedGuid(Number(guid & 0xffffffffn), Number((guid >> 32n) & 0xffffffffn));
}

function writeLivingBlock(
  w: PacketWriter,
  x: number,
  y: number,
  z: number,
  orientation: number,
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

function writeUpdateMask(w: PacketWriter, fields: Map<number, number>) {
  const maxOffset = Math.max(...fields.keys());
  const blockCount = Math.floor(maxOffset / 32) + 1;
  w.uint8(blockCount);
  const mask = new Array(blockCount).fill(0);
  for (const offset of fields.keys()) {
    mask[Math.floor(offset / 32)] |= 1 << (offset % 32);
  }
  for (const m of mask) w.uint32LE(m >>> 0);
  const sorted = [...fields.entries()].sort((a, b) => a[0] - b[0]);
  for (const [, value] of sorted) w.uint32LE(value);
}

function buildCreateUnit(
  guid: bigint,
  entry: number,
  x: number,
  y: number,
  z: number,
): Uint8Array {
  const w = new PacketWriter();
  w.uint32LE(1);
  w.uint8(3);
  writePackedGuid(w, guid);
  w.uint8(3);
  writeLivingBlock(w, x, y, z, 0);
  const fields = new Map<number, number>([
    [OBJECT_FIELDS.ENTRY.offset, entry],
    [UNIT_FIELDS.HEALTH.offset, 100],
    [UNIT_FIELDS.MAXHEALTH.offset, 100],
  ]);
  writeUpdateMask(w, fields);
  return w.finish();
}

function buildMovementUpdate(
  guid: bigint,
  x: number,
  y: number,
  z: number,
): Uint8Array {
  const w = new PacketWriter();
  w.uint32LE(1);
  w.uint8(1);
  writePackedGuid(w, guid);
  writeLivingBlock(w, x, y, z, 0);
  return w.finish();
}

function creatureName(entry: number, name: string): Uint8Array {
  const w = new PacketWriter();
  w.uint32LE(entry);
  w.cString(name);
  return w.finish();
}

type Collector = {
  events: MoveEvent[];
  waitFor(pred: (e: MoveEvent) => boolean): Promise<MoveEvent>;
};

function collectMoveEvents(handle: WorldHandle): Collector {
  const events: MoveEvent[] = [];
  let waiters: Array<{
    pred: (e: MoveEvent) => boolean;
    resolve: (e: MoveEvent) => void;
  }> = [];
  handle.onMoveEvent((e) => {
    events.push(e);
    waiters = waiters.filter((w) => {
      if (!w.pred(e)) return true;
      w.resolve(e);
      return false;
    });
  });
  return {
    events,
    waitFor(pred) {
      const existing = events.find(pred);
      if (existing) return Promise.resolve(existing);
      return new Promise((resolve) => {
        waiters.push({ pred, resolve });
      });
    },
  };
}

function readMoveBody(packet: CapturedPacket) {
  const r = new PacketReader(packet.body);
  const guid = r.packedGuid();
  const info = parseMovementInfo(r);
  return { guid, info };
}

type Session = {
  handle: WorldHandle;
  ws: Awaited<ReturnType<typeof startMockWorldServer>>;
  moves: Collector;
};

async function startSession(): Promise<Session> {
  const ws = await startMockWorldServer();
  const handle = await worldSession(
    { ...base, host: "127.0.0.1", port: ws.port },
    fakeAuth(ws.port),
  );
  return { handle, ws, moves: collectMoveEvents(handle) };
}

async function endSession(s: Session): Promise<void> {
  s.handle.close();
  await s.handle.closed;
  s.ws.stop();
}

describe("movement engine goto", () => {
  test("walks to the target and stops exactly there", async () => {
    const s = await startSession();
    try {
      s.handle.moveTo(0.5, 0.2, 0.1);
      await s.moves.waitFor((e) => e.type === "move_started");

      const start = await s.ws.waitForCapture(
        (p) => p.opcode === GameOpcode.MSG_MOVE_START_FORWARD,
      );
      const { guid, info } = readMoveBody(start);
      expect(guid).toEqual({ low: 0x42, high: 0 });
      expect(info.flags & MovementFlag.FORWARD).toBe(MovementFlag.FORWARD);
      expect(info.orientation).toBeCloseTo(Math.atan2(0.2, 0.5), 3);

      await s.moves.waitFor((e) => e.type === "arrived");
      const stop = await s.ws.waitForCapture(
        (p) => p.opcode === GameOpcode.MSG_MOVE_STOP,
      );
      const stopBody = readMoveBody(stop);
      expect(stopBody.info.flags).toBe(0);
      expect(stopBody.info.x).toBeCloseTo(0.5, 4);
      expect(stopBody.info.y).toBeCloseTo(0.2, 4);
      expect(stopBody.info.z).toBeCloseTo(0.1, 4);

      const pos = s.handle.getOwnPosition();
      expect(pos.x).toBeCloseTo(0.5, 4);
      expect(pos.state.kind).toBe("idle");
    } finally {
      await endSession(s);
    }
  });

  test("sends heartbeats with advancing positions", async () => {
    const s = await startSession();
    try {
      s.handle.moveTo(2, 0, 0);
      await s.moves.waitFor((e) => e.type === "arrived");
      const beats = s.ws.captured
        .filter((p) => p.opcode === GameOpcode.MSG_MOVE_HEARTBEAT)
        .map((p) => readMoveBody(p).info.x);
      expect(beats.length).toBeGreaterThan(2);
      for (let i = 1; i < beats.length; i++) {
        expect(beats[i]!).toBeGreaterThan(beats[i - 1]!);
      }
      expect(
        s.moves.events.filter((e) => e.type === "progress").length,
      ).toBeGreaterThan(0);
    } finally {
      await endSession(s);
    }
  });

  test("halt stops mid-move with a stop packet", async () => {
    const s = await startSession();
    try {
      s.handle.moveTo(100, 0, 0);
      await s.ws.waitForCapture(
        (p) => p.opcode === GameOpcode.MSG_MOVE_START_FORWARD,
      );
      s.handle.stopMoving();
      const stopped = await s.moves.waitFor((e) => e.type === "move_stopped");
      expect(stopped).toEqual({ type: "move_stopped", reason: "command" });
      const stop = await s.ws.waitForCapture(
        (p) => p.opcode === GameOpcode.MSG_MOVE_STOP,
      );
      const { info } = readMoveBody(stop);
      expect(info.x).toBeLessThan(100);
      expect(s.handle.getOwnPosition().state.kind).toBe("idle");
    } finally {
      await endSession(s);
    }
  });

  test("face sends SET_FACING with the new orientation", async () => {
    const s = await startSession();
    try {
      s.handle.face(-1.5);
      const packet = await s.ws.waitForCapture(
        (p) => p.opcode === GameOpcode.MSG_MOVE_SET_FACING,
      );
      const { info } = readMoveBody(packet);
      expect(info.orientation).toBeCloseTo(2 * Math.PI - 1.5, 3);
    } finally {
      await endSession(s);
    }
  });

  test("root halts movement without a stop packet", async () => {
    const s = await startSession();
    try {
      s.handle.moveTo(100, 0, 0);
      await s.ws.waitForCapture(
        (p) => p.opcode === GameOpcode.MSG_MOVE_START_FORWARD,
      );
      const root = new PacketWriter();
      root.packedGuid(0x42, 0);
      root.uint32LE(1);
      s.ws.inject(GameOpcode.SMSG_FORCE_MOVE_ROOT, root.finish());

      const stopped = await s.moves.waitFor((e) => e.type === "move_stopped");
      expect(stopped).toEqual({ type: "move_stopped", reason: "root" });
      expect(
        s.ws.captured.filter((p) => p.opcode === GameOpcode.MSG_MOVE_STOP)
          .length,
      ).toBe(0);
    } finally {
      await endSession(s);
    }
  });

  test("teleport cancels movement and adopts the destination", async () => {
    const s = await startSession();
    try {
      s.handle.moveTo(100, 0, 0);
      await s.ws.waitForCapture(
        (p) => p.opcode === GameOpcode.MSG_MOVE_START_FORWARD,
      );
      const w = new PacketWriter();
      w.packedGuid(0x42, 0);
      w.uint32LE(1);
      writeMovementInfo(w, {
        flags: 0,
        extraFlags: 0,
        time: 0,
        x: 500,
        y: 600,
        z: 70,
        orientation: 0,
        fallTime: 0,
      });
      s.ws.inject(GameOpcode.MSG_MOVE_TELEPORT_ACK, w.finish());

      const stopped = await s.moves.waitFor((e) => e.type === "move_stopped");
      expect(stopped).toEqual({ type: "move_stopped", reason: "teleport" });
      const pos = s.handle.getOwnPosition();
      expect(pos.x).toBe(500);
      expect(pos.y).toBe(600);
    } finally {
      await endSession(s);
    }
  });
});

describe("movement engine follow", () => {
  async function spawnWolf(s: Session, x: number, y: number): Promise<void> {
    s.ws.inject(
      GameOpcode.SMSG_UPDATE_OBJECT,
      buildCreateUnit(100n, 77, x, y, 0),
    );
    s.ws.inject(
      GameOpcode.SMSG_CREATURE_QUERY_RESPONSE,
      creatureName(77, "Wolf"),
    );
    await new Promise<void>((resolve) => {
      const check = () => {
        const found = s.handle
          .getNearbyEntities()
          .some((e) => e.name === "Wolf");
        if (found) resolve();
        else setTimeout(check, 5);
      };
      check();
    });
  }

  test("follows a named unit when it moves away and stops in range", async () => {
    const s = await startSession();
    try {
      await spawnWolf(s, 2, 0);
      expect(s.handle.follow("wolf")).toBe(true);
      await s.moves.waitFor((e) => e.type === "follow_started");
      expect(s.handle.getOwnPosition().state).toEqual({
        kind: "following",
        name: "Wolf",
      });

      s.ws.inject(
        GameOpcode.SMSG_UPDATE_OBJECT,
        buildMovementUpdate(100n, 8, 0, 0),
      );
      await s.ws.waitForCapture(
        (p) => p.opcode === GameOpcode.MSG_MOVE_START_FORWARD,
      );
      const stop = await s.ws.waitForCapture(
        (p) => p.opcode === GameOpcode.MSG_MOVE_STOP,
      );
      const { info } = readMoveBody(stop);
      expect(info.x).toBeGreaterThan(3.5);
      expect(info.x).toBeLessThan(8);
    } finally {
      await endSession(s);
    }
  });

  test("follow of an unknown name returns false", async () => {
    const s = await startSession();
    try {
      expect(s.handle.follow("Nobody")).toBe(false);
    } finally {
      await endSession(s);
    }
  });

  test("observed MSG_MOVE packets update entity positions", async () => {
    const s = await startSession();
    try {
      await spawnWolf(s, 2, 0);
      const w = new PacketWriter();
      w.packedGuid(100, 0);
      writeMovementInfo(w, {
        flags: MovementFlag.FORWARD,
        extraFlags: 0,
        time: 1234,
        x: 15,
        y: -3,
        z: 1,
        orientation: 0.5,
        fallTime: 0,
      });
      s.ws.inject(GameOpcode.MSG_MOVE_HEARTBEAT, w.finish());

      await new Promise<void>((resolve) => {
        const check = () => {
          const wolf = s.handle
            .getNearbyEntities()
            .find((e) => e.name === "Wolf");
          if (wolf?.position?.x === 15) resolve();
          else setTimeout(check, 5);
        };
        check();
      });
      const wolf = s.handle.getNearbyEntities().find((e) => e.name === "Wolf");
      expect(wolf?.position?.y).toBe(-3);
    } finally {
      await endSession(s);
    }
  });

  test("stops with target_lost when the target despawns", async () => {
    const s = await startSession();
    try {
      await spawnWolf(s, 2, 0);
      s.handle.follow("Wolf");
      const destroy = new PacketWriter();
      destroy.uint64LE(100n);
      destroy.uint8(0);
      s.ws.inject(GameOpcode.SMSG_DESTROY_OBJECT, destroy.finish());
      const stopped = await s.moves.waitFor((e) => e.type === "move_stopped");
      expect(stopped).toEqual({ type: "move_stopped", reason: "target_lost" });
    } finally {
      await endSession(s);
    }
  });
});
