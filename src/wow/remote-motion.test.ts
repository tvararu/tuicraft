import { describe, expect, test } from "bun:test";
import { deflateSync } from "node:zlib";
import { bytes } from "test/hex";
import {
  CAPTURED,
  createObject,
  info,
  MAP,
  type MotionFixture,
  motionFixture,
  moveBody,
  PEER,
} from "test/remote-motion-fixtures";
import { MovementFlag } from "wow/protocol/entity-fields";
import { GameOpcode } from "wow/protocol/opcodes";
import { PacketWriter } from "wow/protocol/packet";
import {
  classifyGroundFlags,
  type RemoteInvalidReason,
} from "wow/remote-motion";

async function withFixture(run: (f: MotionFixture) => Promise<void>) {
  const f = await motionFixture();
  try {
    await run(f);
  } finally {
    await f.close();
  }
}

function compressed(opcode: number, ...bodies: Uint8Array[]): Uint8Array {
  const inner = new PacketWriter();
  for (const body of bodies) {
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

describe("classifyGroundFlags", () => {
  test("accepts ground movement flags and rejects each unsafe class", () => {
    const F = MovementFlag;
    const cases: [number, number, RemoteInvalidReason | undefined][] = [
      [0, 0, undefined],
      [F.FORWARD | F.STRAFE_LEFT | F.WALKING | F.LEFT, 0, undefined],
      [F.ROOT | F.LEFT, 0, undefined],
      [F.WATERWALKING | F.FALLING_SLOW, 0, undefined],
      [0x80_00_00_00, 0, "unknown_flags"],
      [0, 0x80_00, "unknown_flags"],
      [F.FORWARD | F.BACKWARD, 0, "contradictory_flags"],
      [F.STRAFE_LEFT | F.STRAFE_RIGHT, 0, "contradictory_flags"],
      [F.LEFT | F.RIGHT, 0, "contradictory_flags"],
      [F.ROOT | F.FORWARD, 0, "contradictory_flags"],
      [F.ROOT | F.FALLING, 0, "contradictory_flags"],
      [F.PENDING_STOP, 0, "pending_flags"],
      [F.ON_TRANSPORT, 0, "transport"],
      [F.FLYING, 0, "flying"],
      [F.DISABLE_GRAVITY, 0, "disable_gravity"],
      [F.HOVER, 0, "hover"],
      [F.FALLING, 0, "falling"],
      [F.SWIMMING, 0, "swimming"],
      [F.SPLINE_ENABLED, 0, "spline"],
    ];
    for (const [flags, extra, reason] of cases)
      expect(classifyGroundFlags(flags, extra)).toBe(reason);
  });
});

describe("remote player movement reception", () => {
  test("captured create and broadcasts give exact, non-extrapolated poses", async () => {
    const f = await motionFixture();
    try {
      expect(f.pose()).toMatchObject({
        source: "create",
        flags: 0,
        extraFlags: 0,
        moverTime: 490_806_532,
        receivedAt: 10_000,
        motion: "stationary",
        position: { mapId: MAP, x: 8723.834_960_937_5 },
      });
      const seen: (string | undefined)[] = [];
      f.handle.onEntityEvent((event) => {
        if (
          event.type === "update" &&
          event.entity.guid === PEER &&
          event.changed.includes("position")
        )
          seen.push(`${f.pose()?.moverTime}@${event.entity.position?.x}`);
      });
      f.setNow(11_000);
      await f.inject(GameOpcode.MSG_MOVE_START_FORWARD, CAPTURED.startForward);
      f.setNow(11_800);
      await f.inject(GameOpcode.MSG_MOVE_HEARTBEAT, CAPTURED.heartbeat);
      expect(f.pose()).toEqual({
        guid: PEER,
        position: {
          mapId: MAP,
          x: 8716.030_273_437_5,
          y: -6647.384_765_625,
          z: 72.747_856_140_136_72,
          orientation: 1,
        },
        source: "observer",
        flags: MovementFlag.FORWARD,
        extraFlags: 0,
        moverTime: 490_759_991,
        receivedAt: 11_800,
        motion: "moving",
      });
      f.setNow(20_000);
      expect(f.pose()?.position.x).toBe(8716.030_273_437_5);
      await f.inject(GameOpcode.MSG_MOVE_STOP, CAPTURED.stop);
      expect(f.pose()).toMatchObject({ motion: "stationary", flags: 0 });
      expect(seen).toEqual([
        "490759215@8714.1396484375",
        "490759991@8716.0302734375",
        "490761817@8723.98046875",
      ]);
      expect(f.errors).toEqual([]);
    } finally {
      await f.close();
    }
  });

  test("unknown, NPC and self GUIDs cannot create poses or move self", async () => {
    await withFixture(async (f) => {
      const self = f.handle.getControlState().selfGuid;
      const serverPose = f.handle.getControlState().serverPose;
      await f.inject(
        GameOpcode.SMSG_UPDATE_OBJECT,
        createObject(0x77n, info(5), 3),
      );
      await f.inject(
        GameOpcode.MSG_MOVE_HEARTBEAT,
        moveBody(0x1234n, info(99)),
      );
      await f.inject(GameOpcode.MSG_MOVE_HEARTBEAT, moveBody(self, info(99)));
      await f.inject(GameOpcode.MSG_MOVE_HEARTBEAT, moveBody(0x77n, info(99)));
      await f.inject(GameOpcode.MSG_MOVE_HEARTBEAT, Uint8Array.of(0xff, 1));
      expect(f.handle.getRemotePoses().map((pose) => pose.guid)).toEqual([
        PEER,
      ]);
      expect(f.handle.getNearbyEntities().some((e) => e.guid === 0x1234n)).toBe(
        false,
      );
      expect(f.handle.getControlState().serverPose).toEqual(serverPose);
      expect(f.errors).toEqual([GameOpcode.MSG_MOVE_HEARTBEAT]);
    });
  });

  test("malformed and time-skipped known-GUID bodies invalidate without refreshing age", async () => {
    await withFixture(async (f) => {
      const before = f.pose();
      f.setNow(12_000);
      const broken = new PacketWriter();
      broken.rawBytes(bytes("03ff09"));
      broken.uint8(1);
      await f.inject(GameOpcode.MSG_MOVE_HEARTBEAT, broken.finish());
      expect(f.errors).toEqual([GameOpcode.MSG_MOVE_HEARTBEAT]);
      expect(f.pose()).toMatchObject({
        invalid: "malformed",
        receivedAt: before?.receivedAt,
        position: before?.position,
      });
      expect(f.pose()?.motion).toBeUndefined();

      await f.inject(GameOpcode.MSG_MOVE_HEARTBEAT, CAPTURED.heartbeat);
      expect(f.pose()).toMatchObject({ motion: "moving", receivedAt: 12_000 });
      f.setNow(13_000);
      const skipped = new PacketWriter();
      skipped.rawBytes(bytes("03ff09"));
      skipped.uint32LE(500);
      await f.inject(GameOpcode.MSG_MOVE_TIME_SKIPPED, skipped.finish());
      expect(f.pose()).toMatchObject({
        invalid: "time_skipped",
        receivedAt: 12_000,
        flags: MovementFlag.FORWARD,
        position: { x: 8716.030_273_437_5 },
      });
    });
  });

  test("teleport and knockback are observed discontinuities, not ground motion", async () => {
    await withFixture(async (f) => {
      await f.inject(GameOpcode.MSG_MOVE_TELEPORT, CAPTURED.teleport);
      expect(f.pose()).toMatchObject({
        invalid: "teleport",
        position: { x: 8723.834_960_937_5 },
      });
      await f.inject(GameOpcode.MSG_MOVE_HEARTBEAT, CAPTURED.heartbeat);
      expect(f.pose()?.invalid).toBeUndefined();
      const knock = new PacketWriter();
      knock.rawBytes(
        moveBody(PEER, {
          ...info(40, MovementFlag.FALLING),
          fall: { zSpeed: -1, sinAngle: 0, cosAngle: 1, xySpeed: 2 },
        }),
      );
      for (const value of [0, 1, 5, -3]) knock.floatLE(value);
      await f.inject(GameOpcode.MSG_MOVE_KNOCK_BACK, knock.finish());
      expect(f.pose()).toMatchObject({
        invalid: "knockback",
        position: { x: 40 },
      });
    });
  });

  test("unsupported, contradictory and unknown flags are kept but rejected", async () => {
    await withFixture(async (f) => {
      const rejected: [number, number, number, string][] = [
        [GameOpcode.MSG_MOVE_START_SWIM, MovementFlag.SWIMMING, 0, "swimming"],
        [
          GameOpcode.MSG_MOVE_HEARTBEAT,
          MovementFlag.FORWARD | MovementFlag.BACKWARD,
          0,
          "contradictory_flags",
        ],
        [
          GameOpcode.MSG_MOVE_ROOT,
          MovementFlag.ROOT | MovementFlag.FORWARD,
          0,
          "contradictory_flags",
        ],
        [
          GameOpcode.MSG_MOVE_HEARTBEAT,
          MovementFlag.FORWARD,
          0x80_00,
          "unknown_flags",
        ],
      ];
      for (const [opcode, flags, extraFlags, reason] of rejected) {
        await f.inject(opcode, moveBody(PEER, info(30, flags, extraFlags)));
        expect(f.pose()).toMatchObject({
          flags,
          extraFlags,
          invalid: reason,
          position: { x: 30 },
        });
      }
    });
  });

  test("compressed moves apply each subpacket and report a malformed one", async () => {
    await withFixture(async (f) => {
      await f.inject(
        GameOpcode.SMSG_COMPRESSED_MOVES,
        compressed(
          GameOpcode.MSG_MOVE_HEARTBEAT,
          bytes(CAPTURED.heartbeat),
          bytes("03ff0901"),
        ),
      );
      expect(f.errors).toEqual([GameOpcode.SMSG_COMPRESSED_MOVES]);
      expect(f.pose()).toMatchObject({
        invalid: "malformed",
        flags: MovementFlag.FORWARD,
        position: { x: 8716.030_273_437_5 },
      });
      await f.inject(
        GameOpcode.SMSG_COMPRESSED_MOVES,
        compressed(GameOpcode.MSG_MOVE_STOP, bytes(CAPTURED.stop)),
      );
      expect(f.pose()).toMatchObject({
        motion: "stationary",
        moverTime: 490_761_817,
      });
    });
  });
});
