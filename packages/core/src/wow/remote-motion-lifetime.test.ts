import { describe, expect, test } from "bun:test";
import {
  CAPTURED,
  createObject,
  info,
  type MotionFixture,
  motionFixture,
  PEER,
  setHealth,
  updateMovement,
  worldPosition,
} from "#test-support/remote-motion-fixtures";
import { writePackedGuid } from "#test-support/world-handlers-fixtures";
import { MovementFlag, UpdateType } from "#wow/protocol/entity-fields";
import { GameOpcode } from "#wow/protocol/opcodes";
import { PacketWriter } from "#wow/protocol/packet";

async function withFixture(run: (f: MotionFixture) => Promise<void>) {
  const f = await motionFixture();
  try {
    await run(f);
  } finally {
    await f.close();
  }
}

describe("remote pose lifetime", () => {
  test("transfer invalidates, gates packets, and the new world clears poses", async () => {
    await withFixture(async (f) => {
      const before = f.pose();
      f.setNow(15_000);
      await f.inject(
        GameOpcode.SMSG_TRANSFER_PENDING,
        Uint8Array.of(1, 0, 0, 0),
      );
      await f.inject(GameOpcode.MSG_MOVE_HEARTBEAT, CAPTURED.heartbeat);
      expect(f.pose()).toMatchObject({
        invalid: "transfer",
        receivedAt: before?.receivedAt,
        position: before?.position,
      });
      await f.inject(GameOpcode.SMSG_NEW_WORLD, worldPosition(1));
      expect(f.events.at(-1)).toEqual({ type: "removed", guid: PEER });
      await f.inject(GameOpcode.MSG_MOVE_HEARTBEAT, CAPTURED.heartbeat);
      expect(f.handle.getRemotePoses()).toEqual([]);
      expect(f.handle.getNearbyEntities()).toEqual([]);
    });
  });

  test("a map change invalidates poses and refuses packets for the old map lifetime", async () => {
    await withFixture(async (f) => {
      const before = f.pose();
      await f.inject(GameOpcode.SMSG_LOGIN_VERIFY_WORLD, worldPosition(1));
      expect(f.pose()?.invalid).toBe("map_changed");
      await f.inject(GameOpcode.MSG_MOVE_HEARTBEAT, CAPTURED.heartbeat);
      expect(f.pose()).toMatchObject({
        invalid: "map_changed",
        position: before?.position,
        receivedAt: before?.receivedAt,
      });
    });
  });

  test("same-GUID replacement drops the old lifetime before the new CREATE pose", async () => {
    await withFixture(async (f) => {
      await f.inject(GameOpcode.MSG_MOVE_HEARTBEAT, CAPTURED.heartbeat);
      f.events.length = 0;
      await f.inject(
        GameOpcode.SMSG_UPDATE_OBJECT,
        createObject(PEER, info(31, 0, 0x80_00)),
      );
      expect(f.events.map((e) => e.type)).toEqual(["removed", "pose"]);
      expect(f.pose()).toMatchObject({
        source: "create",
        invalid: "unknown_flags",
        extraFlags: 0x80_00,
        moverTime: 77,
        position: { x: 31 },
      });
      await f.inject(
        GameOpcode.SMSG_UPDATE_OBJECT,
        createObject(PEER, info(32)),
      );
      expect(f.pose()).toMatchObject({
        motion: "stationary",
        position: { x: 32 },
      });
      expect(f.pose()?.invalid).toBeUndefined();
    });
  });

  test("disappearance removes the pose", async () => {
    await withFixture(async (f) => {
      const w = new PacketWriter();
      w.uint32LE(1);
      w.uint8(UpdateType.OUT_OF_RANGE);
      w.uint32LE(1);
      writePackedGuid(w, PEER);
      await f.inject(GameOpcode.SMSG_UPDATE_OBJECT, w.finish());
      expect(f.events).toEqual([{ type: "removed", guid: PEER }]);
      await f.inject(GameOpcode.MSG_MOVE_HEARTBEAT, CAPTURED.heartbeat);
      expect(f.handle.getRemotePoses()).toEqual([]);
    });
  });

  test("death invalidates at once and keeps later observations rejected", async () => {
    await withFixture(async (f) => {
      const before = f.pose();
      f.setNow(16_000);
      await f.inject(GameOpcode.SMSG_UPDATE_OBJECT, setHealth(PEER, 0));
      expect(f.pose()).toMatchObject({
        invalid: "dead",
        receivedAt: before?.receivedAt,
      });
      await f.inject(GameOpcode.MSG_MOVE_HEARTBEAT, CAPTURED.heartbeat);
      expect(f.pose()).toMatchObject({ invalid: "dead", receivedAt: 16_000 });
      await f.inject(GameOpcode.SMSG_UPDATE_OBJECT, setHealth(PEER, 50));
      await f.inject(GameOpcode.MSG_MOVE_HEARTBEAT, CAPTURED.heartbeat);
      expect(f.pose()).toMatchObject({ motion: "moving" });
    });
  });

  test("UPDATE_OBJECT movement follows flag authority and absent flags stay unknown", async () => {
    await withFixture(async (f) => {
      const positions: (string | undefined)[] = [];
      f.handle.onEntityEvent((event) => {
        if (event.type === "update" && event.changed.includes("position"))
          positions.push(f.pose()?.invalid);
      });
      await f.inject(
        GameOpcode.SMSG_UPDATE_OBJECT,
        updateMovement(PEER, info(22, MovementFlag.SWIMMING)),
      );
      await f.inject(GameOpcode.SMSG_UPDATE_OBJECT, updateMovement(PEER, 23));
      expect(positions).toEqual(["swimming", "flags_unobserved"]);
      expect(f.pose()).toMatchObject({
        source: "update",
        invalid: "flags_unobserved",
        position: { x: 23 },
      });
      expect(f.pose()?.flags).toBeUndefined();
      await f.inject(
        GameOpcode.SMSG_UPDATE_OBJECT,
        updateMovement(PEER, info(24, MovementFlag.FORWARD)),
      );
      expect(f.pose()).toMatchObject({ motion: "moving", flags: 1 });
    });
  });

  test("a malformed UPDATE_OBJECT movement block for a known GUID invalidates it", async () => {
    await withFixture(async (f) => {
      const before = f.pose();
      const w = new PacketWriter();
      w.uint32LE(1);
      w.uint8(UpdateType.MOVEMENT);
      writePackedGuid(w, PEER);
      w.uint16LE(0x20);
      w.uint32LE(0);
      await f.inject(GameOpcode.SMSG_UPDATE_OBJECT, w.finish());
      expect(f.pose()).toMatchObject({
        invalid: "malformed",
        position: before?.position,
        receivedAt: before?.receivedAt,
      });
    });
  });

  test("NPC CREATE movement stays on the spline path without a remote pose", async () => {
    await withFixture(async (f) => {
      const spline = info(5, MovementFlag.FORWARD);
      await f.inject(
        GameOpcode.SMSG_UPDATE_OBJECT,
        createObject(0x88n, spline, 3),
      );
      expect(f.handle.getRemotePoses().map((pose) => pose.guid)).toEqual([
        PEER,
      ]);
    });
  });
});
