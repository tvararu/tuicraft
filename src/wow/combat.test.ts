import { describe, expect, test } from "bun:test";
import { CombatRuntime } from "wow/combat";
import { EntityStore } from "wow/entity-store";
import { ObjectType } from "wow/protocol/entity-fields";
import type { MonsterMovePath } from "wow/protocol/monster-move";
import { GameOpcode } from "wow/protocol/opcodes";
import type { CastFailed, SpellStart } from "wow/protocol/spell";

function path(over: Partial<MonsterMovePath>): MonsterMovePath {
  return {
    kind: "move",
    guid: 2n,
    extra: 0,
    start: { x: 0, y: 0, z: 3 },
    splineId: 1,
    facing: { kind: "none" },
    flags: 0,
    duration: 1000,
    points: [
      { x: 0, y: 0, z: 3 },
      { x: 10, y: 0, z: 3 },
    ],
    interpolation: "linear",
    cyclic: false,
    ...over,
  };
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
  combat.applyInitialSpells({ spells: [{ spellId: 17 }], cooldowns: [] });
  return {
    combat,
    sent,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

function failure(castCount: number, result = 90): CastFailed {
  return { castCount, spellId: 17, result, extra: [] };
}

describe("combat observations", () => {
  test("manual learned cast without metadata awaits server and HALT cancels an unacknowledged attack", async () => {
    const { combat, sent } = setup();
    expect(combat.snapshot().unknownLearned).toEqual([17]);
    expect(() => combat.spellbook()).toThrow("missing_spell_data");
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
    combat.applyAuraAll({
      unit: 1n,
      auras: [
        {
          unit: 1n,
          slot: 0,
          removed: false,
          spellId: 17,
          flags: 0x28,
          level: 10,
          stacks: 1,
          duration: 1000,
          timeLeft: 500,
        },
        {
          unit: 1n,
          slot: 1,
          removed: false,
          spellId: 18,
          flags: 0x28,
          level: 10,
          stacks: 1,
          duration: 1000,
          timeLeft: 500,
        },
      ],
    });
    expect(combat.snapshot().auras.map((aura) => aura.spellId)).toEqual([
      17, 18,
    ]);
    advance(501);
    expect(combat.snapshot().auras).toEqual([]);
    combat.applyAuraAll({ unit: 1n, auras: [] });
    expect(combat.snapshot().auras).toEqual([]);
  });

  test("foreign cooldown packets cannot block self and clears release observed cooldown", () => {
    const { combat } = setup();
    const cooldown = (guid: bigint) => ({
      guid,
      flags: 0,
      cooldowns: [{ spellId: 17, time: 3000 }],
    });
    combat.applyCooldown(cooldown(2n));
    expect(combat.snapshot().cooldowns).toEqual([]);
    combat.applyCooldown(cooldown(1n));
    expect(combat.snapshot().cooldowns[0]?.remainingMs).toBe(3000);
    combat.applyClearCooldown({ spellId: 17, guid: 1n });
    expect(combat.snapshot().cooldowns).toEqual([]);
  });

  test("attack stop on a dead victim does not fabricate kill credit", () => {
    const { combat } = setup();
    combat.applyAttackStop({ attacker: 1n, victim: 2n, dead: 1 });
    expect(combat.snapshot().lastXp).toBeUndefined();
    combat.applyXp({
      victim: 2n,
      total: 55,
      kind: "kill",
      original: 55,
      groupRate: 1,
      recruitAFriend: false,
    });
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
    combat.applyMonsterMove(path({}), 530);
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
  const start: SpellStart = {
    castItem: 1n,
    caster: 1n,
    castCount: 1,
    spellId: 17,
    flags: 0,
    timer: 1500,
    targets: { flags: 2, objectGuid: 2n },
  };
  combat.applySpellStart(start);
  expect(combat.snapshot().casting?.cancelRequested).toBe(true);
  combat.applyCastFailed(failure(1, 40));
  expect(combat.snapshot().lastOutcome?.kind).toBe("cancel");
  combat.applySpellFailure({
    caster: 1n,
    extraCasts: 1,
    spellId: 17,
    result: 40,
  });
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
  combat.applyAuraAll({
    unit: guid,
    auras: [
      {
        unit: guid,
        slot: 2,
        removed: false,
        spellId: 17,
        flags: 8,
        level: 10,
        stacks: 1,
      },
    ],
  });
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
    path({
      start: { x: 0, y: 2, z: 0 },
      flags: 0x4_00_00,
      points: [
        { x: 0, y: 2, z: 0 },
        { x: 0, y: 5, z: 0 },
        { x: 0, y: 10, z: 0 },
      ],
      interpolation: "catmullrom",
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

test("incoming attack start registers attacker against self and stop clears it", () => {
  const { combat } = setup();
  expect(combat.isAttackingSelf(0x10n)).toBe(false);
  combat.applyAttackStart({ attacker: 0x10n, victim: 1n });
  expect(combat.isAttackingSelf(0x10n)).toBe(true);
  expect(combat.isAttackingSelf(0x20n)).toBe(false);
  combat.applyAttackStop({ attacker: 0x10n, victim: 1n, dead: 0 });
  expect(combat.isAttackingSelf(0x10n)).toBe(false);
});

test("dead incoming attacker is cleared on check", () => {
  const store = new EntityStore();
  store.create(0x10n, ObjectType.UNIT, { health: 50 });
  const combat = new CombatRuntime({
    send() {},
    now: () => 1000,
    selfGuid: () => 1n,
    selectedGuid: () => 2n,
    getEntity: (guid) => store.get(guid),
    selfPose: () => undefined,
  });
  combat.applyAttackStart({ attacker: 0x10n, victim: 1n });
  expect(combat.isAttackingSelf(0x10n)).toBe(true);
  store.update(0x10n, { health: 0 });
  expect(combat.isAttackingSelf(0x10n)).toBe(false);
});
