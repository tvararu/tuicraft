import { describe, expect, jest, test } from "bun:test";
import { info, RUN_SPEED, setup } from "test/control-fixtures";
import { must } from "test/must";
import { MovementFlag } from "wow/protocol/entity-fields";
import { parseMovementInfo } from "wow/protocol/movement";
import { GameOpcode } from "wow/protocol/opcodes";
import { PacketReader } from "wow/protocol/packet";

describe("ControlRuntime", () => {
  test("heartbeat uses the time-sync clock while moving", () => {
    jest.useFakeTimers();
    try {
      const { runtime, sent, advance } = setup();
      sent.length = 0;
      runtime.move("forward", 2000);
      advance(500);
      expect(sent.some((p) => p.opcode === GameOpcode.MSG_MOVE_HEARTBEAT)).toBe(
        true,
      );
      runtime.halt();
    } finally {
      jest.useRealTimers();
    }
  });

  test("force run speed ack skips the extra byte and stores speed", () => {
    jest.useFakeTimers();
    try {
      const { runtime, sent } = setup();
      sent.length = 0;
      runtime.forceSpeed(RUN_SPEED, { guid: 0x0764n, counter: 8, speed: 8.5 });
      expect(must(sent[0]).opcode).toBe(
        GameOpcode.CMSG_FORCE_RUN_SPEED_CHANGE_ACK,
      );
      expect(runtime.snapshot().speed).toBeCloseTo(8.5, 4);
    } finally {
      jest.useRealTimers();
    }
  });

  test("knockback ack keeps FALLING trajectory in server order", () => {
    jest.useFakeTimers();
    try {
      const { runtime, sent, advance } = setup();
      runtime.move("forward", 2000);
      sent.length = 0;
      runtime.knockBack({
        guid: 0x0764n,
        counter: 11,
        fall: { cosAngle: 0.5, sinAngle: 0.866, xySpeed: 12, zSpeed: -20 },
      });
      expect(must(sent[0]).opcode).toBe(GameOpcode.CMSG_MOVE_KNOCK_BACK_ACK);
      const ack = new PacketReader(must(sent[0]).body);
      ack.packedGuid();
      expect(ack.uint32LE()).toBe(11);
      const knockback = parseMovementInfo(ack);
      expect(knockback.flags & MovementFlag.FALLING).toBe(MovementFlag.FALLING);
      expect(knockback.fall?.zSpeed).toBeCloseTo(-20, 4);
      expect(knockback.fall?.sinAngle).toBeCloseTo(0.866, 4);
      expect(knockback.fall?.cosAngle).toBeCloseTo(0.5, 4);
      expect(knockback.fall?.xySpeed).toBe(12);
      expect(runtime.snapshot().blockedReason).toBe("falling");
      expect(() => runtime.move("forward", 500)).toThrow("falling");
      const after = sent.length;
      advance(500);
      expect(sent.length).toBe(after);
    } finally {
      jest.useRealTimers();
    }
  });

  test("observed transport root and pose cancel timers and block renewal", () => {
    jest.useFakeTimers();
    try {
      const { runtime, sent, advance } = setup();
      runtime.move("forward", 5000);
      runtime.observeSelf({
        movementFlags: MovementFlag.ON_TRANSPORT,
        runSpeed: 7,
      });
      expect(runtime.snapshot().moving).toBe(false);
      expect(() => runtime.move("forward", 500)).toThrow("transport");
      sent.length = 0;
      advance(500);
      expect(sent.some((p) => p.opcode === GameOpcode.MSG_MOVE_HEARTBEAT)).toBe(
        false,
      );

      const rooted = setup();
      rooted.runtime.move("forward", 5000);
      rooted.runtime.observeSelf({
        movementFlags: MovementFlag.ROOT,
        runSpeed: 7,
      });
      expect(rooted.runtime.snapshot().moving).toBe(false);
      expect(() => rooted.runtime.move("forward", 500)).toThrow("rooted");
      rooted.runtime.observeSelf({ movementFlags: 0, runSpeed: 7 });
      rooted.runtime.move("forward", 500);
      expect(rooted.runtime.snapshot().moving).toBe(true);

      const corrected = setup();
      corrected.runtime.move("forward", 5000);
      corrected.advance(200);
      corrected.runtime.observeSelf({
        position: {
          mapId: 530,
          x: 100,
          y: 200,
          z: 50,
          orientation: 0.5,
        },
        runSpeed: 7,
      });
      expect(corrected.runtime.snapshot().moving).toBe(false);
      expect(corrected.runtime.snapshot().pose?.source).toBe("server");
      expect(corrected.runtime.snapshot().pose?.x).toBe(100);
      corrected.sent.length = 0;
      corrected.advance(500);
      expect(
        corrected.sent.some((p) => p.opcode === GameOpcode.MSG_MOVE_HEARTBEAT),
      ).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });

  test("FACE and MOVE refuse unsupported teleport and control loss", () => {
    jest.useFakeTimers();
    try {
      const { runtime, sent } = setup();
      runtime.clientControl({ guid: 0x0764n, allow: false });
      sent.length = 0;
      expect(() => runtime.face(1)).toThrow("no_control");
      expect(
        sent.some((p) => p.opcode === GameOpcode.MSG_MOVE_SET_FACING),
      ).toBe(false);

      const tele = setup();
      tele.runtime.teleportAck({
        guid: 0x0764n,
        counter: 2,
        info: info({
          flags: MovementFlag.ON_TRANSPORT,
          transport: {
            guid: 0x99n,
            x: 0,
            y: 0,
            z: 0,
            orientation: 0,
            time: 0,
            seat: 0,
          },
        }),
      });
      tele.sent.length = 0;
      expect(() => tele.runtime.move("forward", 500)).toThrow("transport");
      expect(() => tele.runtime.face(0.2)).toThrow("transport");
      expect(
        tele.sent.some((p) => p.opcode === GameOpcode.MSG_MOVE_START_FORWARD),
      ).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });

  test("SET_CAN_FLY acks and blocks until unset", () => {
    jest.useFakeTimers();
    try {
      const { runtime, sent } = setup();
      runtime.move("forward", 2000);
      sent.length = 0;
      runtime.setCanFly(4, true);
      expect(must(sent[0]).opcode).toBe(GameOpcode.CMSG_MOVE_SET_CAN_FLY_ACK);
      const ack = new PacketReader(must(sent[0]).body);
      ack.packedGuid();
      expect(ack.uint32LE()).toBe(4);
      const flyInfo = parseMovementInfo(ack);
      expect(flyInfo.flags & MovementFlag.CAN_FLY).toBe(MovementFlag.CAN_FLY);
      expect(ack.uint32LE()).toBe(1);
      expect(runtime.snapshot().moving).toBe(false);
      expect(() => runtime.move("forward", 500)).toThrow("flying");
      sent.length = 0;
      runtime.setCanFly(5, false);
      const landAck = new PacketReader(must(sent[0]).body);
      landAck.packedGuid();
      landAck.uint32LE();
      const landInfo = parseMovementInfo(landAck);
      expect(landInfo.flags & MovementFlag.CAN_FLY).toBe(0);
      expect(landAck.uint32LE()).toBe(0);
      runtime.move("forward", 500);
      expect(runtime.snapshot().moving).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  test("speed change integrates elapsed movement at the old speed", () => {
    jest.useFakeTimers();
    try {
      const { runtime, advance } = setup();
      runtime.move("forward", 2000);
      advance(250);
      runtime.forceSpeed(RUN_SPEED, { guid: 0x0764n, counter: 1, speed: 3.5 });
      advance(250);
      const pose = must(runtime.snapshot().pose);
      const expected = 8709.46 + Math.cos(0.5) * (7 * 0.25 + 3.5 * 0.25);
      expect(pose.x).toBeCloseTo(expected, 5);
    } finally {
      jest.useRealTimers();
    }
  });

  test("transport teleport ACKs include the transport block", () => {
    jest.useFakeTimers();
    try {
      const { runtime, sent } = setup();
      runtime.teleportAck({
        guid: 0x0764n,
        counter: 2,
        info: info({
          flags: MovementFlag.ON_TRANSPORT,
          transport: {
            guid: 0x99n,
            x: 1,
            y: 2,
            z: 3,
            orientation: 0.25,
            time: 44,
            seat: 1,
          },
        }),
      });
      sent.length = 0;
      runtime.forceRoot(9);
      const rootAck = new PacketReader(must(sent[0]).body);
      rootAck.packedGuid();
      expect(rootAck.uint32LE()).toBe(9);
      const rooted = parseMovementInfo(rootAck);
      expect(rooted.flags & MovementFlag.ON_TRANSPORT).toBe(
        MovementFlag.ON_TRANSPORT,
      );
      expect(rooted.transport?.guid).toBe(0x99n);
      expect(rooted.transport?.seat).toBe(1);
      expect(rootAck.remaining).toBe(0);
      sent.length = 0;
      runtime.forceSpeed(RUN_SPEED, { guid: 0x0764n, counter: 3, speed: 7 });
      const speedAck = new PacketReader(must(sent[0]).body);
      speedAck.packedGuid();
      expect(speedAck.uint32LE()).toBe(3);
      const moving = parseMovementInfo(speedAck);
      expect(moving.transport?.guid).toBe(0x99n);
      expect(speedAck.floatLE()).toBe(7);
      expect(speedAck.remaining).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });
});
