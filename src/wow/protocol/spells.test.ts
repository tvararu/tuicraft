import { test, expect, describe } from "bun:test";
import { PacketReader, PacketWriter } from "wow/protocol/packet";
import {
  buildCastSpell,
  buildCancelCast,
  parseSpellStart,
  parseSpellGo,
  parseCastFailed,
  parseSpellFailure,
  parseInitialSpells,
  parseSpellCooldown,
  parseCooldownEvent,
  parseAuraUpdate,
  parseSpellNonMeleeDamage,
  parseSpellHealLog,
  SpellTargetFlag,
} from "wow/protocol/spells";

describe("buildCastSpell", () => {
  test("self-cast has SELF flags and no guid", () => {
    const body = buildCastSpell(3, 139, { kind: "self" });
    const r = new PacketReader(body);
    expect(r.uint8()).toBe(3);
    expect(r.uint32LE()).toBe(139);
    expect(r.uint8()).toBe(0);
    expect(r.uint32LE()).toBe(0);
    expect(r.remaining).toBe(0);
  });

  test("unit target carries UNIT flag and packed guid", () => {
    const body = buildCastSpell(1, 589, {
      kind: "unit",
      guidLow: 0x764,
      guidHigh: 0xf130,
    });
    const r = new PacketReader(body);
    r.skip(6);
    expect(r.uint32LE()).toBe(SpellTargetFlag.UNIT);
    expect(r.packedGuid()).toEqual({ low: 0x764, high: 0xf130 });
    expect(r.remaining).toBe(0);
  });

  test("cancel cast is count then spell", () => {
    const r = new PacketReader(buildCancelCast(0, 5019));
    expect(r.uint8()).toBe(0);
    expect(r.uint32LE()).toBe(5019);
  });
});

function writeTargets(w: PacketWriter, flags: number, guid?: number) {
  w.uint32LE(flags);
  if (guid !== undefined) w.packedGuid(guid, 0);
}

describe("parseSpellStart / parseSpellGo", () => {
  test("parses a basic start", () => {
    const w = new PacketWriter();
    w.packedGuid(0x42, 0);
    w.packedGuid(0x42, 0);
    w.uint8(2);
    w.uint32LE(585);
    w.uint32LE(0x800);
    w.uint32LE(2500);
    writeTargets(w, SpellTargetFlag.UNIT, 100);
    w.uint32LE(180);
    const start = parseSpellStart(new PacketReader(w.finish()));
    expect(start.caster).toBe(0x42n);
    expect(start.castCount).toBe(2);
    expect(start.spellId).toBe(585);
    expect(start.castTimeMs).toBe(2500);
    expect(start.target).toBe(100n);
  });

  test("parses go with hits, misses and power", () => {
    const w = new PacketWriter();
    w.packedGuid(0x42, 0);
    w.packedGuid(0x42, 0);
    w.uint8(1);
    w.uint32LE(589);
    w.uint32LE(0x800);
    w.uint32LE(123456);
    w.uint8(1);
    w.uint64LE(100n);
    w.uint8(1);
    w.uint64LE(101n);
    w.uint8(3);
    writeTargets(w, SpellTargetFlag.UNIT, 100);
    w.uint32LE(426);
    const go = parseSpellGo(new PacketReader(w.finish()));
    expect(go.spellId).toBe(589);
    expect(go.hits).toEqual([100n]);
    expect(go.misses).toEqual([{ target: 101n, reason: 3 }]);
    expect(go.powerLeft).toBe(426);
    expect(go.target).toBe(100n);
  });

  test("go with reflect miss consumes the extra byte", () => {
    const w = new PacketWriter();
    w.packedGuid(0x42, 0);
    w.packedGuid(0x42, 0);
    w.uint8(1);
    w.uint32LE(585);
    w.uint32LE(0);
    w.uint32LE(0);
    w.uint8(0);
    w.uint8(1);
    w.uint64LE(100n);
    w.uint8(11);
    w.uint8(0);
    writeTargets(w, 0);
    const go = parseSpellGo(new PacketReader(w.finish()));
    expect(go.misses[0]?.reason).toBe(11);
  });

  test("truncated go throws instead of hanging", () => {
    const w = new PacketWriter();
    w.packedGuid(0x42, 0);
    w.packedGuid(0x42, 0);
    w.uint8(1);
    expect(() => parseSpellGo(new PacketReader(w.finish()))).toThrow();
  });
});

describe("cast failures", () => {
  test("maps known results to names", () => {
    const w = new PacketWriter();
    w.uint8(4);
    w.uint32LE(2053);
    w.uint8(0x61);
    w.uint8(0);
    const failed = parseCastFailed(new PacketReader(w.finish()));
    expect(failed).toEqual({
      castCount: 4,
      spellId: 2053,
      result: 0x61,
      resultName: "OUT_OF_RANGE",
    });
  });

  test("unknown results fall back to hex", () => {
    const w = new PacketWriter();
    w.uint8(0);
    w.uint32LE(1);
    w.uint8(0x77);
    const failed = parseCastFailed(new PacketReader(w.finish()));
    expect(failed.resultName).toBe("0x77");
  });

  test("spell failure uses packed guid", () => {
    const w = new PacketWriter();
    w.packedGuid(0x42, 0);
    w.uint8(1);
    w.uint32LE(585);
    w.uint8(0x28);
    const failure = parseSpellFailure(new PacketReader(w.finish()));
    expect(failure.caster).toBe(0x42n);
    expect(failure.result).toBe(0x28);
  });
});

describe("parseInitialSpells", () => {
  test("reads spells and 16-byte cooldown entries", () => {
    const w = new PacketWriter();
    w.uint8(0);
    w.uint16LE(3);
    for (const id of [585, 589, 5019]) {
      w.uint32LE(id);
      w.uint16LE(0);
    }
    w.uint16LE(1);
    w.uint32LE(8092);
    w.uint16LE(0);
    w.uint16LE(0);
    w.uint32LE(8000);
    w.uint32LE(0);
    const parsed = parseInitialSpells(new PacketReader(w.finish()));
    expect(parsed.spells).toEqual([585, 589, 5019]);
    expect(parsed.cooldowns).toEqual([
      { spellId: 8092, category: 0, cooldownMs: 8000, categoryCooldownMs: 0 },
    ]);
  });
});

describe("cooldowns", () => {
  test("spell cooldown reads entries to end", () => {
    const w = new PacketWriter();
    w.uint64LE(0x42n);
    w.uint8(1);
    w.uint32LE(8092);
    w.uint32LE(8000);
    w.uint32LE(585);
    w.uint32LE(1500);
    const parsed = parseSpellCooldown(new PacketReader(w.finish()));
    expect(parsed.entries).toHaveLength(2);
    expect(parsed.entries[1]).toEqual({ spellId: 585, cooldownMs: 1500 });
  });

  test("cooldown event reads spell first", () => {
    const w = new PacketWriter();
    w.uint32LE(8092);
    w.uint64LE(0x42n);
    expect(parseCooldownEvent(new PacketReader(w.finish()))).toEqual({
      spellId: 8092,
    });
  });
});

describe("parseAuraUpdate", () => {
  test("single update with duration", () => {
    const w = new PacketWriter();
    w.packedGuid(0x42, 0);
    w.uint8(3);
    w.uint32LE(139);
    w.uint8(0x21);
    w.uint8(10);
    w.uint8(1);
    w.uint32LE(15000);
    w.uint32LE(12000);
    const parsed = parseAuraUpdate(new PacketReader(w.finish()), false);
    expect(parsed.unit).toBe(0x42n);
    expect(parsed.auras[0]).toMatchObject({
      slot: 3,
      spellId: 139,
      durationMs: 15000,
      timeLeftMs: 12000,
    });
  });

  test("slot cleared when spell id is zero", () => {
    const w = new PacketWriter();
    w.packedGuid(0x42, 0);
    w.uint8(3);
    w.uint32LE(0);
    const parsed = parseAuraUpdate(new PacketReader(w.finish()), false);
    expect(parsed.auras[0]).toEqual({
      slot: 3,
      spellId: 0,
      flags: 0,
      stackCount: 0,
    });
  });

  test("update_all reads entries with caster guids to end", () => {
    const w = new PacketWriter();
    w.packedGuid(100, 0);
    w.uint8(0);
    w.uint32LE(589);
    w.uint8(0x28 | 0x08);
    w.uint8(10);
    w.uint8(1);
    w.packedGuid(0x42, 0);
    w.uint32LE(18000);
    w.uint32LE(18000);
    w.uint8(1);
    w.uint32LE(0);
    const parsed = parseAuraUpdate(new PacketReader(w.finish()), true);
    expect(parsed.auras).toHaveLength(2);
    expect(parsed.auras[0]?.caster).toBe(0x42n);
    expect(parsed.auras[1]?.spellId).toBe(0);
  });
});

describe("damage and heal logs", () => {
  test("non-melee damage log", () => {
    const w = new PacketWriter();
    w.packedGuid(100, 0);
    w.packedGuid(0x42, 0);
    w.uint32LE(585);
    w.uint32LE(31);
    w.uint32LE(0);
    w.uint8(2);
    w.uint32LE(0);
    w.uint32LE(0);
    w.uint8(0);
    w.uint8(0);
    w.uint32LE(0);
    w.uint32LE(0x2);
    w.uint8(0);
    const dmg = parseSpellNonMeleeDamage(new PacketReader(w.finish()));
    expect(dmg).toMatchObject({
      target: 100n,
      caster: 0x42n,
      spellId: 585,
      damage: 31,
      schoolMask: 2,
      periodic: false,
      crit: true,
    });
  });

  test("heal log", () => {
    const w = new PacketWriter();
    w.packedGuid(0x42, 0);
    w.packedGuid(0x42, 0);
    w.uint32LE(2053);
    w.uint32LE(140);
    w.uint32LE(12);
    w.uint32LE(0);
    w.uint8(0);
    const heal = parseSpellHealLog(new PacketReader(w.finish()));
    expect(heal).toMatchObject({ spellId: 2053, amount: 140, crit: false });
  });
});
