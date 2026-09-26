import { describe, expect, test } from "bun:test";
import {
  createObject,
  info,
  type MotionFixture,
  motionFixture,
} from "#test-support/remote-motion-fixtures";
import { writePackedGuid } from "#test-support/world-handlers-fixtures";
import { CombatRuntime } from "#wow/combat";
import { registerCombatHandlers } from "#wow/gameplay-handlers";
import { ObjectType } from "#wow/protocol/entity-fields";
import { GameOpcode } from "#wow/protocol/opcodes";
import { PacketReader, PacketWriter } from "#wow/protocol/packet";
import { OpcodeDispatch } from "#wow/protocol/world";
import type { WorldConn } from "#wow/world-conn";

const MOB = 0xf130003d29021c28n;

function monsterMove(
  guid: bigint,
  start: number,
  destination?: number,
): Uint8Array {
  const w = new PacketWriter();
  writePackedGuid(w, guid);
  w.uint8(0);
  for (const value of [start, 2, 3]) w.floatLE(value);
  w.uint32LE(7);
  if (destination === undefined) {
    w.uint8(1);
    return w.finish();
  }
  w.uint8(0);
  w.uint32LE(0);
  w.uint32LE(1000);
  w.uint32LE(1);
  for (const value of [destination, 2, 3]) w.floatLE(value);
  return w.finish();
}

async function withMob(run: (f: MotionFixture) => Promise<void>) {
  const f = await motionFixture();
  try {
    await f.inject(
      GameOpcode.SMSG_UPDATE_OBJECT,
      createObject(MOB, info(40), ObjectType.UNIT),
    );
    await run(f);
  } finally {
    await f.close();
  }
}

function row(f: MotionFixture, guid: bigint) {
  return f.handle
    .queryNearby({ all: true })
    .find((r) => r.entity.guid === guid);
}

describe("SMSG_MONSTER_MOVE positions", () => {
  test("a spawned creature is listed at its update-object position", async () => {
    await withMob(async (f) => {
      expect(row(f, MOB)).toMatchObject({
        position: { x: 40, y: 2, z: 3 },
        positionKind: "observed",
        positionObservedAt: 10_000,
        positionSource: "update_object",
      });
    });
  });

  test("a move for a known creature updates the store and nearby", async () => {
    await withMob(async (f) => {
      f.setNow(11_000);
      await f.inject(GameOpcode.SMSG_MONSTER_MOVE, monsterMove(MOB, 30, 10));
      const stored = f.handle.getNearbyEntities().find((e) => e.guid === MOB);
      expect(stored?.position).toMatchObject({ mapId: 530, x: 30, y: 2 });
      f.setNow(11_500);
      expect(row(f, MOB)).toMatchObject({
        position: { mapId: 530, x: 20, y: 2, z: 3 },
        positionKind: "predicted",
        positionObservedAt: 11_000,
        positionSource: "monster_move",
      });
    });
  });

  test("a creature that stops and dies is listed where it stopped", async () => {
    await withMob(async (f) => {
      f.setNow(11_000);
      await f.inject(GameOpcode.SMSG_MONSTER_MOVE, monsterMove(MOB, 30, 10));
      f.setNow(11_800);
      await f.inject(GameOpcode.SMSG_MONSTER_MOVE, monsterMove(MOB, 14));
      f.setNow(60_000);
      expect(row(f, MOB)).toMatchObject({
        position: { x: 14, y: 2, z: 3 },
        positionKind: "observed",
        positionObservedAt: 11_800,
        positionSource: "monster_move",
      });
    });
  });

  test("a move for an unknown guid is ignored", async () => {
    await withMob(async (f) => {
      const before = f.handle.queryNearby({ all: true });
      await f.inject(GameOpcode.SMSG_MONSTER_MOVE, monsterMove(0x777n, 5, 9));
      expect(f.errors).toEqual([]);
      expect(f.handle.queryNearby({ all: true })).toEqual(before);
    });
  });
});

describe("registerCombatHandlers", () => {
  test("attack swing errors are named, not opcode numbers", () => {
    const combat = new CombatRuntime({
      send() {},
      now: () => 1,
      selfGuid: () => 1n,
      selectedGuid: () => 2n,
      getEntity: () => undefined,
      selfPose: () => undefined,
    });
    const conn = {
      dispatch: new OpcodeDispatch(),
      combat,
    } as unknown as WorldConn;
    registerCombatHandlers(conn);
    combat.attack(2n);
    conn.dispatch.handle(
      GameOpcode.SMSG_ATTACKSWING_NOTINRANGE,
      new PacketReader(new Uint8Array()),
    );
    const outcome = combat.snapshot().lastOutcome;
    expect(outcome).toMatchObject({
      kind: "attack",
      status: "failed",
      error: "not_in_range",
    });
    expect(outcome?.result).toBeUndefined();
  });
});
