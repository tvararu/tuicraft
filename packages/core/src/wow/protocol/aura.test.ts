import { describe, expect, test } from "bun:test";
import { parseAuraUpdate, parseAuraUpdateAll } from "#wow/protocol/aura";
import { PacketReader } from "#wow/protocol/packet";

function reader(bytes: number[]): PacketReader {
  return new PacketReader(Uint8Array.from(bytes));
}

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
      duration: 10_000,
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
