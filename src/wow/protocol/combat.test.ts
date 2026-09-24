import { test, expect, describe } from "bun:test";
import { PacketReader } from "wow/protocol/packet";
import {
  buildAttackSwing,
  buildCastSpell,
  buildCancelCast,
  parseInitialSpells,
  parseSpellStart,
  parseSpellGo,
  parseCastFailed,
  parseSpellFailure,
  parseSpellCooldown,
  parseAttackStart,
  parseAttackStop,
  parseAuraUpdate,
  parseAuraUpdateAll,
  parseSpellDelayed,
  parseXpGain,
  parseLearnedSpell,
  parseRemovedSpell,
  parseSupersededSpell,
} from "wow/protocol/combat";

function reader(bytes: number[]): PacketReader {
  return new PacketReader(Uint8Array.from(bytes));
}

describe("buildAttackSwing", () => {
  test("writes unpacked little-endian guid 100", () => {
    expect([...buildAttackSwing(100n)]).toEqual([
      0x64, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    ]);
  });

  test("writes high guid bytes", () => {
    expect([...buildAttackSwing(0x0100000002n)]).toEqual([
      0x02, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00,
    ]);
  });
});

describe("buildCastSpell", () => {
  test("writes count, spell, zero extra flags, and packed unit target", () => {
    expect([...buildCastSpell(1, 133, 0x64n)]).toEqual([
      0x01, 0x85, 0x00, 0x00, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00, 0x01, 0x64,
    ]);
  });

  test("self target writes empty target flags", () => {
    expect([...buildCastSpell(2, 6603, 0n)]).toEqual([
      0x02, 0xcb, 0x19, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    ]);
  });
});

describe("buildCancelCast", () => {
  test("writes unused counter then spell 20600", () => {
    expect([...buildCancelCast(20600)]).toEqual([0x00, 0x78, 0x50, 0x00, 0x00]);
  });
});

describe("parseInitialSpells", () => {
  test("reads unknown, uint32 spell ids, and empty cooldowns", () => {
    const result = parseInitialSpells(
      reader([
        0x00, 0x02, 0x00, 0x4e, 0x00, 0x00, 0x00, 0x00, 0x00, 0xcb, 0x19, 0x00,
        0x00, 0x07, 0x00, 0x00, 0x00,
      ]),
    );
    expect(result.unknown).toBe(0);
    expect(result.spells).toEqual([
      { spellId: 78, unknown: 0 },
      { spellId: 6603, unknown: 7 },
    ]);
    expect(result.cooldowns).toEqual([]);
  });

  test("reads uint32 cooldown spell id and infinity category sentinel", () => {
    const result = parseInitialSpells(
      reader([
        0x03, 0x00, 0x00, 0x01, 0x00, 0x4e, 0x00, 0x00, 0x00, 0x01, 0x00, 0x02,
        0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x80,
      ]),
    );
    expect(result.unknown).toBe(3);
    expect(result.spells).toEqual([]);
    expect(result.cooldowns).toEqual([
      {
        spellId: 78,
        itemId: 1,
        category: 2,
        cooldown: 1,
        categoryCooldown: 0x80000000,
      },
    ]);
  });

  test("throws when spell list is truncated", () => {
    expect(() =>
      parseInitialSpells(reader([0x00, 0x01, 0x00, 0x4e])),
    ).toThrow();
  });
});

describe("parseSpellStart", () => {
  test("reads packed identities, signed timer, and empty targets", () => {
    const result = parseSpellStart(
      reader([
        0x01, 0x17, 0x01, 0x17, 0x01, 0x85, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0xdc, 0x05, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      ]),
    );
    expect(result.castItem).toBe(0x17n);
    expect(result.caster).toBe(0x17n);
    expect(result.castCount).toBe(1);
    expect(result.spellId).toBe(133);
    expect(result.flags).toBe(0);
    expect(result.timer).toBe(1500);
    expect(result.targets.flags).toBe(0);
    expect(result.power).toBeUndefined();
  });

  test("preserves negative timer as signed", () => {
    const result = parseSpellStart(
      reader([
        0x00, 0x00, 0x01, 0x78, 0x50, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xff,
        0xff, 0xff, 0xff, 0x00, 0x00, 0x00, 0x00,
      ]),
    );
    expect(result.timer).toBe(-1);
  });

  test("reads power after POWER_LEFT_SELF and packed unit target", () => {
    const result = parseSpellStart(
      reader([
        0x01, 0x17, 0x01, 0x42, 0x03, 0x85, 0x00, 0x00, 0x00, 0x00, 0x08, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00, 0x01, 0x64, 0x2c,
        0x01, 0x00, 0x00,
      ]),
    );
    expect(result.caster).toBe(0x42n);
    expect(result.flags).toBe(0x00000800);
    expect(result.targets.objectGuid).toBe(0x64n);
    expect(result.power).toBe(300);
  });

  test("reads ammo after PROJECTILE and unknown23 pair", () => {
    const result = parseSpellStart(
      reader([
        0x00, 0x00, 0x01, 0x75, 0x00, 0x00, 0x00, 0x20, 0x00, 0x40, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x6e, 0x17, 0x00, 0x00, 0x18,
        0x00, 0x00, 0x00, 0x11, 0x00, 0x00, 0x00, 0x22, 0x00, 0x00, 0x00,
      ]),
    );
    expect(result.ammo).toEqual({ displayId: 5998, inventoryType: 24 });
    expect(result.unknown23).toEqual({ unknown1: 17, unknown2: 34 });
  });

  test("reads dest location with packed transport then xyz", () => {
    const result = parseSpellStart(
      reader([
        0x00, 0x00, 0x00, 0x85, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x40, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x80, 0x3f,
        0x00, 0x00, 0x00, 0x40, 0x00, 0x00, 0x40, 0x40,
      ]),
    );
    expect(result.targets.dest).toEqual({
      transport: 0n,
      x: 1,
      y: 2,
      z: 3,
    });
  });

  test("throws on truncated packed caster", () => {
    expect(() => parseSpellStart(reader([0xff]))).toThrow();
  });
});

describe("parseSpellGo", () => {
  test("reads unpacked hit and miss guids with reflect extra", () => {
    const result = parseSpellGo(
      reader([
        0x01, 0x17, 0x01, 0x17, 0x01, 0x85, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x78, 0x56, 0x34, 0x12, 0x01, 0x64, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x01, 0x65, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x0b,
        0x07, 0x00, 0x00, 0x00, 0x00,
      ]),
    );
    expect(result.extraCasts).toBe(1);
    expect(result.timestamp).toBe(0x12345678);
    expect(result.hits).toEqual([0x64n]);
    expect(result.misses).toEqual([{ guid: 0x65n, reason: 11, reflect: 7 }]);
    expect(result.targets.flags).toBe(0);
  });

  test("rune list writes cooldown bytes only for consumed runes", () => {
    const result = parseSpellGo(
      reader([
        0x00, 0x00, 0x00, 0x85, 0x00, 0x00, 0x00, 0x00, 0x00, 0x20, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x05, 0x01, 0xaa,
      ]),
    );
    expect(result.runes).toEqual({ initial: 5, after: 1, cooldowns: [0xaa] });
  });

  test("dest extra byte follows flag tails using target mask not dest cast flag", () => {
    const result = parseSpellGo(
      reader([
        0x00, 0x00, 0x00, 0x85, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x40, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x80, 0x3f, 0x00, 0x00, 0x00, 0x40, 0x00, 0x00, 0x40, 0x40, 0x09,
      ]),
    );
    expect(result.targets.dest?.z).toBe(3);
    expect(result.destUnknown).toBe(9);
  });

  test("throws when hit count exceeds remaining bytes", () => {
    expect(() =>
      parseSpellGo(
        reader([
          0x00, 0x00, 0x00, 0x85, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
          0x00, 0x00, 0x00, 0x00, 0x00, 0x01,
        ]),
      ),
    ).toThrow();
  });
});

describe("parseCastFailed", () => {
  test("reads count spell result with no extra and no extra bool", () => {
    const result = parseCastFailed(
      reader([0x01, 0x85, 0x00, 0x00, 0x00, 0x0c]),
    );
    expect(result).toEqual({
      castCount: 1,
      spellId: 133,
      result: 12,
      extra: [],
    });
  });

  test("requires-spell-focus extra is a uint32 argument", () => {
    const result = parseCastFailed(
      reader([0x02, 0x78, 0x50, 0x00, 0x00, 0x66, 0x04, 0x00, 0x00, 0x00]),
    );
    expect(result.result).toBe(102);
    expect(result.extra).toEqual([4]);
  });

  test("equipped-item-class extra is two uint32s", () => {
    const result = parseCastFailed(
      reader([
        0x00, 0x85, 0x00, 0x00, 0x00, 0x1d, 0x02, 0x00, 0x00, 0x00, 0xff, 0x00,
        0x00, 0x00,
      ]),
    );
    expect(result.result).toBe(29);
    expect(result.extra).toEqual([2, 255]);
  });

  test("throws on leftover non-uint32 extra", () => {
    expect(() =>
      parseCastFailed(reader([0x00, 0x85, 0x00, 0x00, 0x00, 0x0c, 0xff])),
    ).toThrow();
  });
});

describe("parseSpellFailure", () => {
  test("reads packed caster not unpacked guid", () => {
    const result = parseSpellFailure(
      reader([0x01, 0x17, 0x04, 0x85, 0x00, 0x00, 0x00, 0x28]),
    );
    expect(result).toEqual({
      caster: 0x17n,
      extraCasts: 4,
      spellId: 133,
      result: 40,
    });
  });

  test("throws when packed caster mask is truncated", () => {
    expect(() => parseSpellFailure(reader([0x0f]))).toThrow();
  });
});

describe("parseSpellCooldown", () => {
  test("reads unpacked guid, flags, and remaining cooldown pairs", () => {
    const result = parseSpellCooldown(
      reader([
        0x17, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x85, 0x00, 0x00,
        0x00, 0xe8, 0x03, 0x00, 0x00, 0x4e, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00,
      ]),
    );
    expect(result.guid).toBe(0x17n);
    expect(result.flags).toBe(1);
    expect(result.cooldowns).toEqual([
      { spellId: 133, time: 1000 },
      { spellId: 78, time: 0 },
    ]);
  });

  test("throws on leftover truncated cooldown", () => {
    expect(() =>
      parseSpellCooldown(
        reader([
          0x17, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x85, 0x00,
          0x00,
        ]),
      ),
    ).toThrow();
  });
});

describe("parseAttackStart", () => {
  test("reads unpacked attacker and victim", () => {
    const result = parseAttackStart(
      reader([
        0x17, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x64, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00,
      ]),
    );
    expect(result).toEqual({ attacker: 0x17n, victim: 0x64n });
  });

  test("throws when victim guid is truncated", () => {
    expect(() =>
      parseAttackStart(
        reader([0x17, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]),
      ),
    ).toThrow();
  });
});

describe("parseAttackStop", () => {
  test("reads packed identities and dead uint32", () => {
    const result = parseAttackStop(
      reader([0x01, 0x17, 0x01, 0x64, 0x01, 0x00, 0x00, 0x00]),
    );
    expect(result).toEqual({ attacker: 0x17n, victim: 0x64n, dead: 1 });
  });

  test("throws when packed victim is missing", () => {
    expect(() => parseAttackStop(reader([0x01, 0x17]))).toThrow();
  });
});

describe("parseAuraUpdate", () => {
  test("spell id zero is a removal and does not invent success", () => {
    const result = parseAuraUpdate(
      reader([0x01, 0x17, 0x03, 0x00, 0x00, 0x00, 0x00]),
    );
    expect(result).toEqual({ unit: 0x17n, slot: 3, removed: true });
  });

  test("caster packed guid is present when AFLAG_CASTER is unset", () => {
    const result = parseAuraUpdate(
      reader([
        0x01, 0x17, 0x02, 0xe8, 0x03, 0x00, 0x00, 0x20, 0x3c, 0x02, 0x01, 0x42,
        0x10, 0x27, 0x00, 0x00, 0xe8, 0x03, 0x00, 0x00,
      ]),
    );
    expect(result).toEqual({
      unit: 0x17n,
      slot: 2,
      removed: false,
      spellId: 1000,
      flags: 0x20,
      level: 60,
      stacks: 2,
      caster: 0x42n,
      duration: 10000,
      timeLeft: 1000,
    });
  });

  test("AFLAG_CASTER omits caster guid", () => {
    const result = parseAuraUpdate(
      reader([0x00, 0x01, 0x4e, 0x00, 0x00, 0x00, 0x08, 0x01, 0x01]),
    );
    expect(result).toEqual({
      unit: 0n,
      slot: 1,
      removed: false,
      spellId: 78,
      flags: 0x08,
      level: 1,
      stacks: 1,
      caster: undefined,
      duration: undefined,
      timeLeft: undefined,
    });
  });

  test("throws when duration flag is set without duration fields", () => {
    expect(() =>
      parseAuraUpdate(
        reader([0x00, 0x00, 0x4e, 0x00, 0x00, 0x00, 0x28, 0x01, 0x01]),
      ),
    ).toThrow();
  });
});

describe("parseAuraUpdateAll", () => {
  test("every entry reuses the unit header", () => {
    const r = reader([
      0x01, 0x17, 0x01, 0x4e, 0x00, 0x00, 0x00, 0x08, 0x01, 0x01, 0x03, 0x00,
      0x00, 0x00, 0x00,
    ]);
    const all = parseAuraUpdateAll(r);
    expect(all.unit).toBe(0x17n);
    expect(all.auras).toHaveLength(2);
    expect(all.auras[0]).toMatchObject({ unit: 0x17n, slot: 1, spellId: 78 });
    expect(all.auras[1]).toEqual({ unit: 0x17n, slot: 3, removed: true });
    expect(r.remaining).toBe(0);
  });
});

describe("parseSpellDelayed", () => {
  test("reads caster and delay", () => {
    const r = reader([0x01, 0x17, 0xf4, 0x01, 0x00, 0x00]);
    expect(parseSpellDelayed(r)).toEqual({ caster: 0x17n, delayMs: 500 });
    expect(r.remaining).toBe(0);
  });
});

describe("parseXpGain", () => {
  test("kill credit includes victim, original xp, and group rate", () => {
    const result = parseXpGain(
      reader([
        0x64, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xc8, 0x00, 0x00, 0x00,
        0x00, 0x96, 0x00, 0x00, 0x00, 0x00, 0x00, 0x80, 0x3f, 0x00,
      ]),
    );
    expect(result).toEqual({
      victim: 0x64n,
      total: 200,
      kind: "kill",
      original: 150,
      groupRate: 1,
      recruitAFriend: false,
    });
  });

  test("non-kill xp has no original fields", () => {
    const result = parseXpGain(
      reader([
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x32, 0x00, 0x00, 0x00,
        0x01, 0x01,
      ]),
    );
    expect(result.kind).toBe("other");
    expect(result.total).toBe(50);
    expect(result.original).toBeUndefined();
    expect(result.recruitAFriend).toBe(true);
  });

  test("throws when kill extra is truncated", () => {
    expect(() =>
      parseXpGain(
        reader([
          0x64, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xc8, 0x00, 0x00,
          0x00, 0x00,
        ]),
      ),
    ).toThrow();
  });
});

describe("parseLearnedSpell", () => {
  test("reads spell id and trailing unknown uint16", () => {
    expect(
      parseLearnedSpell(reader([0x85, 0x00, 0x00, 0x00, 0x07, 0x00])),
    ).toEqual({
      spellId: 133,
      unknown: 7,
    });
  });

  test("throws when unknown uint16 is missing", () => {
    expect(() => parseLearnedSpell(reader([0x85, 0x00, 0x00, 0x00]))).toThrow();
  });
});

describe("parseRemovedSpell", () => {
  test("reads unlearned spell id", () => {
    expect(parseRemovedSpell(reader([0x4e, 0x00, 0x00, 0x00])).spellId).toBe(
      78,
    );
  });
});

describe("parseSupersededSpell", () => {
  test("reads old rank then newly learned rank", () => {
    expect(
      parseSupersededSpell(
        reader([0x4e, 0x00, 0x00, 0x00, 0x1c, 0x01, 0x00, 0x00]),
      ),
    ).toEqual({ superseded: 78, learned: 284 });
  });

  test("throws when new spell id is truncated", () => {
    expect(() =>
      parseSupersededSpell(reader([0x4e, 0x00, 0x00, 0x00])),
    ).toThrow();
  });
});
