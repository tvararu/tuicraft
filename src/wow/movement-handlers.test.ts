import { test, expect, describe } from "bun:test";
import { worldSession, type ChatMessage, type WorldHandle } from "wow/client";
import type { AuthResult } from "wow/auth";
import { startMockWorldServer } from "test/mock-world-server";
import { PacketReader, PacketWriter } from "wow/protocol/packet";
import { GameOpcode } from "wow/protocol/opcodes";
import { MovementFlag } from "wow/protocol/entity-fields";
import { writeMovementInfo, parseMovementInfo } from "wow/protocol/movement";
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
};

function fakeAuth(port: number): AuthResult {
  return {
    sessionKey,
    realmHost: "127.0.0.1",
    realmPort: port,
    realmId: 1,
  };
}

type Session = {
  handle: WorldHandle;
  ws: Awaited<ReturnType<typeof startMockWorldServer>>;
  messages: ChatMessage[];
};

async function startSession(): Promise<Session> {
  const ws = await startMockWorldServer();
  const handle = await worldSession(
    { ...base, host: "127.0.0.1", port: ws.port },
    fakeAuth(ws.port),
  );
  const messages: ChatMessage[] = [];
  handle.onMessage((msg) => messages.push(msg));
  return { handle, ws, messages };
}

async function endSession(s: Session): Promise<void> {
  s.handle.close();
  await s.handle.closed;
  s.ws.stop();
}

describe("speed change acks", () => {
  test("acks run speed change echoing counter and exact speed", async () => {
    const s = await startSession();
    try {
      const w = new PacketWriter();
      w.packedGuid(0x42, 0);
      w.uint32LE(7);
      w.uint8(0);
      w.floatLE(Math.fround(14.25));
      s.ws.inject(GameOpcode.SMSG_FORCE_RUN_SPEED_CHANGE, w.finish());

      const ack = await s.ws.waitForCapture(
        (p) => p.opcode === GameOpcode.CMSG_FORCE_RUN_SPEED_CHANGE_ACK,
      );
      const r = new PacketReader(ack.body);
      expect(r.packedGuid()).toEqual({ low: 0x42, high: 0 });
      expect(r.uint32LE()).toBe(7);
      parseMovementInfo(r);
      expect(r.floatLE()).toBe(Math.fround(14.25));
      expect(r.remaining).toBe(0);
    } finally {
      await endSession(s);
    }
  });

  test("acks walk speed change without the run-only extra byte", async () => {
    const s = await startSession();
    try {
      const w = new PacketWriter();
      w.packedGuid(0x42, 0);
      w.uint32LE(3);
      w.floatLE(Math.fround(2.5));
      s.ws.inject(GameOpcode.SMSG_FORCE_WALK_SPEED_CHANGE, w.finish());

      const ack = await s.ws.waitForCapture(
        (p) => p.opcode === GameOpcode.CMSG_FORCE_WALK_SPEED_CHANGE_ACK,
      );
      const r = new PacketReader(ack.body);
      r.packedGuid();
      expect(r.uint32LE()).toBe(3);
      parseMovementInfo(r);
      expect(r.floatLE()).toBe(Math.fround(2.5));
    } finally {
      await endSession(s);
    }
  });

  test("acks every remaining speed change type", async () => {
    const s = await startSession();
    try {
      const cases: Array<[number, number]> = [
        [
          GameOpcode.SMSG_FORCE_RUN_BACK_SPEED_CHANGE,
          GameOpcode.CMSG_FORCE_RUN_BACK_SPEED_CHANGE_ACK,
        ],
        [
          GameOpcode.SMSG_FORCE_SWIM_SPEED_CHANGE,
          GameOpcode.CMSG_FORCE_SWIM_SPEED_CHANGE_ACK,
        ],
        [
          GameOpcode.SMSG_FORCE_SWIM_BACK_SPEED_CHANGE,
          GameOpcode.CMSG_FORCE_SWIM_BACK_SPEED_CHANGE_ACK,
        ],
        [
          GameOpcode.SMSG_FORCE_TURN_RATE_CHANGE,
          GameOpcode.CMSG_FORCE_TURN_RATE_CHANGE_ACK,
        ],
        [
          GameOpcode.SMSG_FORCE_FLIGHT_SPEED_CHANGE,
          GameOpcode.CMSG_FORCE_FLIGHT_SPEED_CHANGE_ACK,
        ],
        [
          GameOpcode.SMSG_FORCE_FLIGHT_BACK_SPEED_CHANGE,
          GameOpcode.CMSG_FORCE_FLIGHT_BACK_SPEED_CHANGE_ACK,
        ],
      ];
      for (const [i, [smsg, ackOp]] of cases.entries()) {
        const w = new PacketWriter();
        w.packedGuid(0x42, 0);
        w.uint32LE(10 + i);
        w.floatLE(Math.fround(4.5 + i));
        s.ws.inject(smsg, w.finish());
        const ack = await s.ws.waitForCapture((p) => p.opcode === ackOp);
        const r = new PacketReader(ack.body);
        r.packedGuid();
        expect(r.uint32LE()).toBe(10 + i);
        parseMovementInfo(r);
        expect(r.floatLE()).toBe(Math.fround(4.5 + i));
      }
    } finally {
      await endSession(s);
    }
  });
});

describe("teleport acks", () => {
  test("acks near teleport and adopts the destination", async () => {
    const s = await startSession();
    try {
      const w = new PacketWriter();
      w.packedGuid(0x42, 0);
      w.uint32LE(1);
      writeMovementInfo(w, {
        flags: 0,
        extraFlags: 0,
        time: 0,
        x: 100.5,
        y: -200.25,
        z: 30,
        orientation: 1.5,
        fallTime: 0,
      });
      s.ws.inject(GameOpcode.MSG_MOVE_TELEPORT_ACK, w.finish());

      const ack = await s.ws.waitForCapture(
        (p) => p.opcode === GameOpcode.MSG_MOVE_TELEPORT_ACK,
      );
      const r = new PacketReader(ack.body);
      expect(r.packedGuid()).toEqual({ low: 0x42, high: 0 });
      expect(r.uint32LE()).toBe(1);
      r.uint32LE();
      expect(r.remaining).toBe(0);
      expect(
        s.messages.some((m) => m.message.includes("Teleported to (100.5")),
      ).toBe(true);
    } finally {
      await endSession(s);
    }
  });

  test("far teleport sends worldport ack and reclaims active mover", async () => {
    const s = await startSession();
    try {
      const pending = new PacketWriter();
      pending.uint32LE(1);
      s.ws.inject(GameOpcode.SMSG_TRANSFER_PENDING, pending.finish());

      const w = new PacketWriter();
      w.uint32LE(1);
      w.floatLE(1000);
      w.floatLE(2000);
      w.floatLE(50);
      w.floatLE(0);
      s.ws.inject(GameOpcode.SMSG_NEW_WORLD, w.finish());

      const ack = await s.ws.waitForCapture(
        (p) => p.opcode === GameOpcode.MSG_MOVE_WORLDPORT_ACK,
      );
      expect(ack.body.byteLength).toBe(0);

      await s.ws.waitForCapture(
        (p) =>
          p.opcode === GameOpcode.CMSG_SET_ACTIVE_MOVER &&
          s.ws.captured.filter(
            (q) => q.opcode === GameOpcode.CMSG_SET_ACTIVE_MOVER,
          ).length >= 2,
      );
      expect(
        s.messages.some((m) => m.message.includes("Transferring to map 1")),
      ).toBe(true);
      expect(
        s.messages.some((m) => m.message.includes("Entered map 1 at (1000.0")),
      ).toBe(true);
    } finally {
      await endSession(s);
    }
  });
});

describe("root acks", () => {
  test("acks root with the root flag set, unroot with it cleared", async () => {
    const s = await startSession();
    try {
      const root = new PacketWriter();
      root.packedGuid(0x42, 0);
      root.uint32LE(5);
      s.ws.inject(GameOpcode.SMSG_FORCE_MOVE_ROOT, root.finish());

      const rootAck = await s.ws.waitForCapture(
        (p) => p.opcode === GameOpcode.CMSG_FORCE_MOVE_ROOT_ACK,
      );
      const r1 = new PacketReader(rootAck.body);
      r1.packedGuid();
      expect(r1.uint32LE()).toBe(5);
      const rootInfo = parseMovementInfo(r1);
      expect(rootInfo.flags & MovementFlag.ROOT).toBe(MovementFlag.ROOT);

      const unroot = new PacketWriter();
      unroot.packedGuid(0x42, 0);
      unroot.uint32LE(6);
      s.ws.inject(GameOpcode.SMSG_FORCE_MOVE_UNROOT, unroot.finish());

      const unrootAck = await s.ws.waitForCapture(
        (p) => p.opcode === GameOpcode.CMSG_FORCE_MOVE_UNROOT_ACK,
      );
      const r2 = new PacketReader(unrootAck.body);
      r2.packedGuid();
      expect(r2.uint32LE()).toBe(6);
      const unrootInfo = parseMovementInfo(r2);
      expect(unrootInfo.flags & MovementFlag.ROOT).toBe(0);
    } finally {
      await endSession(s);
    }
  });
});
