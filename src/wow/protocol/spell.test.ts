import { test, expect, describe } from "bun:test";
import { PacketReader } from "wow/protocol/packet";
import {
  buildCastSpell,
  buildCancelCast,
  parseInitialSpells,
  parseSpellStart,
  parseSpellGo,
  parseCastFailed,
  parseSpellFailure,
  parseSpellCooldown,
  parseSpellDelayed,
  parseLearnedSpell,
  parseRemovedSpell,
  parseSupersededSpell,
} from "wow/protocol/spell";

function reader(bytes: number[]): PacketReader {
  return new PacketReader(Uint8Array.from(bytes));
}

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
  test("reads uint32 spell ids and empty cooldowns", () => {
    const result = parseInitialSpells(
      reader([
        0x00, 0x02, 0x00, 0x4e, 0x00, 0x00, 0x00, 0x00, 0x00, 0xcb, 0x19, 0x00,
        0x00, 0x07, 0x00, 0x00, 0x00,
      ]),
    );
    expect(result.spells).toEqual([{ spellId: 78 }, { spellId: 6603 }]);
    expect(result.cooldowns).toEqual([]);
  });

  test("reads uint32 cooldown spell id and infinity category sentinel", () => {
    const result = parseInitialSpells(
      reader([
        0x03, 0x00, 0x00, 0x01, 0x00, 0x4e, 0x00, 0x00, 0x00, 0x01, 0x00, 0x02,
        0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x80,
      ]),
    );
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

  test("reads ammo after PROJECTILE and skips the unknown23 pair", () => {
    const r = reader([
      0x00, 0x00, 0x01, 0x75, 0x00, 0x00, 0x00, 0x20, 0x00, 0x40, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x6e, 0x17, 0x00, 0x00, 0x18,
      0x00, 0x00, 0x00, 0x11, 0x00, 0x00, 0x00, 0x22, 0x00, 0x00, 0x00,
    ]);
    const result = parseSpellStart(r);
    expect(result.ammo).toEqual({ displayId: 5998, inventoryType: 24 });
    expect(r.remaining).toBe(0);
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
});

describe("parseSpellDelayed", () => {
  test("reads caster and delay", () => {
    const r = reader([0x01, 0x17, 0xf4, 0x01, 0x00, 0x00]);
    expect(parseSpellDelayed(r)).toEqual({ caster: 0x17n, delayMs: 500 });
    expect(r.remaining).toBe(0);
  });
});

describe("parseLearnedSpell", () => {
  test("reads the spell id", () => {
    expect(
      parseLearnedSpell(reader([0x85, 0x00, 0x00, 0x00, 0x07, 0x00])),
    ).toEqual({ spellId: 133 });
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
});
