import { describe, expect, test } from "bun:test";
import { deflateSync } from "node:zlib";
import { bytes } from "test/hex";
import { CAPTURED } from "test/remote-motion-fixtures";
import { GameOpcode } from "wow/protocol/opcodes";
import { PacketReader, PacketWriter } from "wow/protocol/packet";
import {
  parseCompressedMoves,
  parseRemoteMovementBody,
  type RemoteMovementBody,
} from "wow/protocol/remote-movement";

function ordinary(): Uint8Array {
  return bytes("010000000000785634120000803f00000040000040400000003f00000000");
}

function tail(body: Uint8Array, ...values: number[]): Uint8Array {
  const w = new PacketWriter();
  w.rawBytes(body);
  for (const value of values) w.floatLE(value);
  return w.finish();
}

function parse(opcode: number, data: Uint8Array): RemoteMovementBody {
  return parseRemoteMovementBody(opcode, new PacketReader(data));
}

type Floats = {
  x: number;
  transportOrientation: number;
  pitch: number;
  fallCosAngle: number;
  splineElevation: number;
};

function conditional(overrides: Partial<Floats> = {}): Uint8Array {
  const values = {
    x: 1,
    transportOrientation: 0.5,
    pitch: -0.25,
    fallCosAngle: 0.75,
    splineElevation: 3.5,
    ...overrides,
  };
  const w = new PacketWriter();
  w.uint32LE(0x84_20_12_00);
  w.uint16LE(0x84_20);
  w.uint32LE(123);
  w.floatLE(values.x);
  w.floatLE(2);
  w.floatLE(3);
  w.floatLE(0.5);
  w.packedGuid(9, 0);
  w.floatLE(4);
  w.floatLE(5);
  w.floatLE(6);
  w.floatLE(values.transportOrientation);
  w.uint32LE(456);
  w.uint8(2);
  w.uint32LE(789);
  w.floatLE(values.pitch);
  w.uint32LE(300);
  w.floatLE(-8);
  w.floatLE(0.25);
  w.floatLE(values.fallCosAngle);
  w.floatLE(7);
  w.floatLE(values.splineElevation);
  return w.finish();
}

function compressed(moves: { opcode: number; body: Uint8Array }[]): Uint8Array {
  const inner = new PacketWriter();
  for (const { opcode, body } of moves) {
    inner.uint8(body.length + 2);
    inner.uint16LE(opcode);
    inner.rawBytes(body);
  }
  const raw = inner.finish();
  const w = new PacketWriter();
  w.uint32LE(raw.length);
  w.rawBytes(deflateSync(raw));
  return w.finish();
}

describe("remote movement body boundaries", () => {
  test("captured AzerothCore heartbeat parses after the packed GUID", () => {
    const reader = new PacketReader(bytes(CAPTURED.heartbeat));
    expect(reader.packedGuidBig()).toBe(0x9ffn);
    const body = parseRemoteMovementBody(GameOpcode.MSG_MOVE_HEARTBEAT, reader);
    expect(body).toMatchObject({
      kind: "movement",
      transition: "ordinary",
      info: {
        flags: 1,
        extraFlags: 0,
        time: 490_759_991,
        x: 8716.030_273_437_5,
        y: -6647.384_765_625,
        orientation: 1,
      },
    });
    expect(reader.remaining).toBe(0);
  });

  test("observer flag-change opcodes carry MovementInfo, not forced-self counters", () => {
    const opcodes = [
      GameOpcode.MSG_MOVE_ROOT,
      GameOpcode.MSG_MOVE_UNROOT,
      GameOpcode.MSG_MOVE_HOVER,
      GameOpcode.MSG_MOVE_FEATHER_FALL,
      GameOpcode.MSG_MOVE_WATER_WALK,
      GameOpcode.CMSG_MOVE_SET_FLY,
      GameOpcode.MSG_MOVE_UPDATE_CAN_FLY,
      GameOpcode.MSG_MOVE_GRAVITY_CHNG,
    ];
    for (const opcode of opcodes) {
      expect(parse(opcode, ordinary())).toMatchObject({
        kind: "movement",
        transition: "ordinary",
        info: { x: 1 },
      });
      expect(() => parse(opcode, tail(ordinary(), 7))).toThrow(RangeError);
    }
  });

  test("preserves transport, pitch, falling, spline and unknown flag bits", () => {
    expect(parse(GameOpcode.MSG_MOVE_START_SWIM, conditional())).toMatchObject({
      kind: "movement",
      info: {
        flags: 0x84_20_12_00,
        extraFlags: 0x84_20,
        transport: {
          guid: 9n,
          x: 4,
          y: 5,
          z: 6,
          time: 456,
          seat: 2,
          time2: 789,
        },
        pitch: -0.25,
        fallTime: 300,
        fall: { zSpeed: -8, sinAngle: 0.25, cosAngle: 0.75, xySpeed: 7 },
        splineElevation: 3.5,
      },
    });
  });

  test("rejects a truncated conditional body at every byte boundary and a trailing byte", () => {
    const data = conditional();
    for (let length = 0; length < data.length; length++)
      expect(() =>
        parse(GameOpcode.MSG_MOVE_HEARTBEAT, data.subarray(0, length)),
      ).toThrow(RangeError);
    expect(() => parse(GameOpcode.MSG_MOVE_HEARTBEAT, tail(data, 1))).toThrow(
      RangeError,
    );
  });

  test("rejects nonfinite values in world and optional branches", () => {
    const corruptions: Partial<Floats>[] = [
      { x: Number.NaN },
      { transportOrientation: Number.POSITIVE_INFINITY },
      { pitch: Number.NEGATIVE_INFINITY },
      { fallCosAngle: Number.NaN },
      { splineElevation: Number.POSITIVE_INFINITY },
    ];
    for (const corruption of corruptions)
      expect(() =>
        parse(GameOpcode.MSG_MOVE_HEARTBEAT, conditional(corruption)),
      ).toThrow(RangeError);
  });

  test("rejects forced-self, acknowledgement and unknown opcodes before reading", () => {
    const opcodes = [
      GameOpcode.MSG_MOVE_TELEPORT_ACK,
      GameOpcode.MSG_MOVE_WORLDPORT_ACK,
      GameOpcode.SMSG_FORCE_RUN_SPEED_CHANGE,
      GameOpcode.SMSG_FORCE_MOVE_ROOT,
      GameOpcode.SMSG_MOVE_KNOCK_BACK,
      GameOpcode.CMSG_MOVE_KNOCK_BACK_ACK,
      GameOpcode.SMSG_MOVE_SET_CAN_FLY,
      GameOpcode.CMSG_MOVE_SET_CAN_FLY_ACK,
      0xff_ff,
    ];
    for (const opcode of opcodes) {
      const reader = new PacketReader(ordinary());
      expect(() => parseRemoteMovementBody(opcode, reader)).toThrow(RangeError);
      expect(reader.offset).toBe(0);
    }
  });
});

describe("remote movement observer tails", () => {
  test("collision height requires exactly one finite float", () => {
    const opcode = GameOpcode.MSG_MOVE_SET_COLLISION_HGT;
    expect(parse(opcode, tail(ordinary(), 2.25))).toMatchObject({
      collisionHeight: 2.25,
    });
    expect(() => parse(opcode, ordinary())).toThrow(RangeError);
    expect(() => parse(opcode, tail(ordinary(), 2.25, 1))).toThrow(RangeError);
    expect(() =>
      parse(opcode, tail(ordinary(), Number.NEGATIVE_INFINITY)),
    ).toThrow(RangeError);
  });

  test("all nine speed observer opcodes require exactly one finite float", () => {
    const opcodes = [
      GameOpcode.MSG_MOVE_SET_RUN_SPEED,
      GameOpcode.MSG_MOVE_SET_RUN_BACK_SPEED,
      GameOpcode.MSG_MOVE_SET_WALK_SPEED,
      GameOpcode.MSG_MOVE_SET_SWIM_SPEED,
      GameOpcode.MSG_MOVE_SET_SWIM_BACK_SPEED,
      GameOpcode.MSG_MOVE_SET_TURN_RATE,
      GameOpcode.MSG_MOVE_SET_FLIGHT_SPEED,
      GameOpcode.MSG_MOVE_SET_FLIGHT_BACK_SPEED,
      GameOpcode.MSG_MOVE_SET_PITCH_RATE,
    ];
    for (const opcode of opcodes) {
      expect(parse(opcode, tail(ordinary(), 7.5))).toMatchObject({
        speed: 7.5,
      });
      expect(() => parse(opcode, ordinary())).toThrow(RangeError);
      expect(() => parse(opcode, tail(ordinary(), 7.5, 1))).toThrow(RangeError);
      expect(() => parse(opcode, tail(ordinary(), Number.NaN))).toThrow(
        RangeError,
      );
    }
  });

  test("captured teleport keeps the ordinary layout with teleport provenance", () => {
    const reader = new PacketReader(bytes(CAPTURED.teleport));
    reader.packedGuidBig();
    expect(
      parseRemoteMovementBody(GameOpcode.MSG_MOVE_TELEPORT, reader),
    ).toMatchObject({
      transition: "teleport",
      info: { x: 8723.834_960_937_5 },
    });
    expect(() =>
      parse(GameOpcode.MSG_MOVE_TELEPORT, tail(ordinary(), 123)),
    ).toThrow(RangeError);
  });

  test("knockback keeps its four-float tail after the falling body", () => {
    const opcode = GameOpcode.MSG_MOVE_KNOCK_BACK;
    expect(parse(opcode, tail(conditional(), 0.5, 0.75, 12, -9))).toMatchObject(
      {
        transition: "knockback",
        info: { fall: { zSpeed: -8, sinAngle: 0.25 } },
        knockback: { sinAngle: 0.5, cosAngle: 0.75, xySpeed: 12, zSpeed: -9 },
      },
    );
    expect(() => parse(opcode, conditional())).toThrow(RangeError);
    expect(() => parse(opcode, tail(conditional(), 0.5, 0.75, 12))).toThrow(
      RangeError,
    );
    expect(() =>
      parse(opcode, tail(conditional(), 0.5, 0.75, 12, -9, 1)),
    ).toThrow(RangeError);
  });

  test("time skipped is only u32 milliseconds after the GUID", () => {
    const opcode = GameOpcode.MSG_MOVE_TIME_SKIPPED;
    expect(parse(opcode, Uint8Array.of(0x78, 0x56, 0x34, 0x12))).toEqual({
      kind: "time_skipped",
      milliseconds: 0x12_34_56_78,
    });
    expect(() => parse(opcode, Uint8Array.of(1, 2, 3))).toThrow(RangeError);
    expect(() => parse(opcode, Uint8Array.of(1, 2, 3, 4, 5))).toThrow(
      RangeError,
    );
  });
});

describe("parseCompressedMoves", () => {
  test("splits inflated size-prefixed subpackets", () => {
    const heartbeat = bytes(CAPTURED.heartbeat);
    const moves = parseCompressedMoves(
      new PacketReader(
        compressed([
          { opcode: GameOpcode.MSG_MOVE_HEARTBEAT, body: heartbeat },
          { opcode: GameOpcode.SMSG_MONSTER_MOVE, body: Uint8Array.of(1, 2) },
        ]),
      ),
    );
    expect(moves).toEqual([
      { opcode: GameOpcode.MSG_MOVE_HEARTBEAT, body: heartbeat },
      { opcode: GameOpcode.SMSG_MONSTER_MOVE, body: Uint8Array.of(1, 2) },
    ]);
  });

  test("rejects a size mismatch and subpackets that overrun the stream", () => {
    const good = compressed([{ opcode: 1, body: Uint8Array.of(9) }]);
    const lying = Uint8Array.from(good);
    lying[0] = 9;
    expect(() => parseCompressedMoves(new PacketReader(lying))).toThrow(
      RangeError,
    );
    const inner = Uint8Array.of(8, 0xee, 0x00, 1);
    const w = new PacketWriter();
    w.uint32LE(inner.length);
    w.rawBytes(deflateSync(inner));
    expect(() => parseCompressedMoves(new PacketReader(w.finish()))).toThrow(
      RangeError,
    );
  });
});
