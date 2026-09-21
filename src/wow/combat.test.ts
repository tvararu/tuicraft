import { describe, expect, test } from "bun:test";
import { CombatRuntime } from "wow/combat";
import { PacketReader, PacketWriter } from "wow/protocol/packet";
import { GameOpcode } from "wow/protocol/opcodes";

function packet(write: (w: PacketWriter) => void): PacketReader {
  const w = new PacketWriter();
  write(w);
  return new PacketReader(w.finish());
}

function setup() {
  let now = 1000;
  const sent: number[] = [];
  const combat = new CombatRuntime({
    send: (opcode) => {
      sent.push(opcode);
    },
    now: () => now,
    selfGuid: () => 1n,
    selectedGuid: () => 2n,
    getEntity: () => undefined,
    selfPose: () => undefined,
  });
  combat.applyInitialSpells(
    packet((w) => {
      w.uint8(0);
      w.uint16LE(1);
      w.uint32LE(17);
      w.uint16LE(0);
      w.uint16LE(0);
    }),
  );
  return {
    combat,
    sent,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

function failure(count: number, result = 90): PacketReader {
  return packet((w) => {
    w.uint8(count);
    w.uint32LE(17);
    w.uint8(result);
  });
}

describe("combat observations", () => {
  test("manual learned cast without metadata awaits server and HALT cancels an unacknowledged attack", async () => {
    const { combat, sent } = setup();
    expect(combat.snapshot().unknownLearned).toEqual([17]);
    await expect(combat.spellbook()).rejects.toThrow("missing_spell_data");
    combat.cast(17, 2n);
    combat.attack(2n);
    expect(combat.snapshot().lastOutcome?.status).toBe("sent");
    expect(combat.snapshot().casting).toBeUndefined();
    expect(combat.snapshot().attacking).toBe(false);
    combat.halt();
    expect(sent.slice(-2)).toEqual([
      GameOpcode.CMSG_CANCEL_CAST,
      GameOpcode.CMSG_ATTACKSTOP,
    ]);
    expect(combat.snapshot().pendingCast?.cancelRequested).toBe(true);
    expect(combat.snapshot().lastOutcome?.status).not.toBe("succeeded");
  });

  test("late failure from a prior count cannot clear the new pending cast", () => {
    const { combat } = setup();
    combat.cast(17, 2n);
    combat.applyCastFailed(failure(1));
    expect(combat.snapshot().pendingCast).toBeUndefined();
    combat.cast(17, 2n);
    combat.applyCastFailed(failure(1));
    expect(combat.snapshot().pendingCast?.count).toBe(2);
    expect(combat.snapshot().lastOutcome?.status).toBe("sent");
    combat.applyCastFailed(failure(2));
    expect(combat.snapshot().pendingCast).toBeUndefined();
    expect(combat.snapshot().lastOutcome?.status).toBe("failed");
  });

  test("full aura snapshots replace stale slots and duration expiry is reflected", () => {
    const { combat, advance } = setup();
    combat.applyAuraAll(
      packet((w) => {
        w.packedGuid(1, 0);
        for (const [slot, spell] of [
          [0, 17],
          [1, 18],
        ]) {
          w.uint8(slot!);
          w.uint32LE(spell!);
          w.uint8(0x28);
          w.uint8(10);
          w.uint8(1);
          w.uint32LE(1000);
          w.uint32LE(500);
        }
      }),
    );
    expect(combat.snapshot().auras.map((aura) => aura.spellId)).toEqual([
      17, 18,
    ]);
    advance(501);
    expect(combat.snapshot().auras).toEqual([]);
    combat.applyAuraAll(
      packet((w) => {
        w.packedGuid(1, 0);
      }),
    );
    expect(combat.snapshot().auras).toEqual([]);
  });

  test("foreign cooldown packets cannot block self and clears release observed cooldown", () => {
    const { combat } = setup();
    const cooldown = (guid: bigint) =>
      packet((w) => {
        w.uint64LE(guid);
        w.uint8(0);
        w.uint32LE(17);
        w.uint32LE(3000);
      });
    combat.applyCooldown(cooldown(2n));
    expect(combat.snapshot().cooldowns).toEqual([]);
    combat.applyCooldown(cooldown(1n));
    expect(combat.snapshot().cooldowns[0]?.remainingMs).toBe(3000);
    combat.applyClearCooldown(
      packet((w) => {
        w.uint32LE(17);
        w.uint64LE(1n);
      }),
    );
    expect(combat.snapshot().cooldowns).toEqual([]);
  });

  test("attack stop on a dead victim does not fabricate kill credit", () => {
    const { combat } = setup();
    combat.applyAttackStop(
      packet((w) => {
        w.packedGuid(1, 0);
        w.packedGuid(2, 0);
        w.uint32LE(1);
      }),
    );
    expect(combat.snapshot().lastXp).toBeUndefined();
    combat.applyXp(
      packet((w) => {
        w.uint64LE(2n);
        w.uint32LE(55);
        w.uint8(0);
        w.uint32LE(55);
        w.floatLE(1);
        w.uint8(0);
      }),
    );
    expect(combat.snapshot().lastXp).toMatchObject({
      victim: 2n,
      kind: "kill",
      total: 55,
    });
  });

  test("spline predictions preserve observed provenance and disappear clears motion", () => {
    const { combat, advance } = setup();
    combat.observePosition(2n, {
      mapId: 530,
      x: 0,
      y: 0,
      z: 3,
      orientation: 1,
    });
    combat.applyMonsterMove(
      packet((w) => {
        w.packedGuid(2, 0);
        w.uint8(0);
        w.floatLE(0);
        w.floatLE(0);
        w.floatLE(3);
        w.uint32LE(1);
        w.uint8(0);
        w.uint32LE(0);
        w.uint32LE(1000);
        w.uint32LE(1);
        w.floatLE(10);
        w.floatLE(0);
        w.floatLE(3);
      }),
      530,
    );
    advance(500);
    const target = combat.snapshot().target!;
    expect(target.pose).toMatchObject({ source: "predicted", x: 5 });
    expect(target.serverPose).toMatchObject({
      source: "server",
      x: 0,
      updatedAt: 1000,
    });
    advance(500);
    expect(combat.snapshot().target?.serverPose?.updatedAt).toBe(1000);
    combat.forget(2n);
    expect(combat.snapshot().target?.pose).toBeUndefined();
  });
});

test("cancellation intent survives START and repeated server failures", () => {
  const { combat } = setup();
  combat.cast(17, 2n);
  combat.cancelCast();
  combat.applySpellStart(
    packet((w) => {
      w.packedGuid(1, 0);
      w.packedGuid(1, 0);
      w.uint8(1);
      w.uint32LE(17);
      w.uint32LE(0);
      w.uint32LE(1500);
      w.uint32LE(2);
      w.packedGuid(2, 0);
    }),
  );
  expect(combat.snapshot().casting?.cancelRequested).toBe(true);
  combat.applyCastFailed(failure(1, 40));
  expect(combat.snapshot().lastOutcome?.kind).toBe("cancel");
  combat.applySpellFailure(
    packet((w) => {
      w.packedGuid(1, 0);
      w.uint8(1);
      w.uint32LE(17);
      w.uint8(40);
    }),
  );
  expect(combat.snapshot().casting).toBeUndefined();
  expect(combat.snapshot().lastOutcome?.kind).toBe("cancel");
});

test("a new cast does not inherit the previous cancellation intent", () => {
  const { combat } = setup();
  combat.cast(17, 2n);
  combat.cancelCast();
  combat.applyCastFailed(failure(1, 40));
  combat.cast(17, 2n);
  combat.applyCastFailed(failure(2, 40));
  expect(combat.snapshot().lastOutcome).toMatchObject({
    kind: "cast",
    status: "failed",
  });
});

test("cancellation requests do not hide other server errors", () => {
  const { combat } = setup();
  combat.cast(17, 2n);
  combat.cancelCast();
  combat.applyCastFailed(failure(1, 41));
  expect(combat.snapshot().lastOutcome).toMatchObject({
    kind: "cast",
    status: "failed",
    result: 41,
  });
});

test("full creature aura snapshots preserve unsigned GUID halves", () => {
  const guid = 0xf130003fd20009e5n;
  const combat = new CombatRuntime({
    send() {},
    now: () => 1,
    selfGuid: () => 1n,
    selectedGuid: () => guid,
    getEntity: () => undefined,
    selfPose: () => undefined,
  });
  combat.applyAuraAll(
    packet((w) => {
      w.packedGuid(0xd20009e5, 0xf130003f);
      w.uint8(2);
      w.uint32LE(17);
      w.uint8(8);
      w.uint8(10);
      w.uint8(1);
    }),
  );
  expect(combat.snapshot().targetAuras[0]).toMatchObject({
    spellId: 17,
    caster: guid,
  });
  expect(combat.snapshot().auras).toEqual([]);
});

test("a new open Catmull packet cannot promote old facing to authoritative launch yaw", () => {
  const { combat } = setup();
  combat.observePosition(2n, { mapId: 530, x: 0, y: 0, z: 0, orientation: 0 });
  combat.applyMonsterMove(
    packet((w) => {
      w.packedGuid(2, 0);
      w.uint8(0);
      w.floatLE(0);
      w.floatLE(2);
      w.floatLE(0);
      w.uint32LE(1);
      w.uint8(0);
      w.uint32LE(0x40000);
      w.uint32LE(1000);
      w.uint32LE(2);
      w.floatLE(0);
      w.floatLE(5);
      w.floatLE(0);
      w.floatLE(0);
      w.floatLE(10);
      w.floatLE(0);
    }),
    530,
  );
  const target = combat.snapshot().target!;
  expect(target.serverPose).toMatchObject({
    y: 2,
    source: "server",
    orientation: undefined,
  });
  expect(target.motion?.unsupportedReason).toBe("unknown_launch_orientation");
  expect(target.pose).toBeUndefined();
});
