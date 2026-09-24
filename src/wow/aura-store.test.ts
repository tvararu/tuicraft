import { describe, expect, test } from "bun:test";
import { AuraStore } from "wow/aura-store";

describe("AuraStore", () => {
  test("a self-cast flag names the unit as caster and expiry hides the aura", () => {
    let now = 0;
    const store = new AuraStore(() => now);
    store.apply({
      unit: 2n,
      slot: 1,
      removed: false,
      spellId: 17,
      flags: 0x08,
      level: 1,
      stacks: 1,
      duration: 1000,
      timeLeft: 1000,
    });
    expect(store.forUnit(2n)).toMatchObject([{ caster: 2n, timeLeft: 1000 }]);
    now = 400;
    expect(store.forUnit(2n)[0]?.timeLeft).toBe(600);
    now = 1000;
    expect(store.forUnit(2n)).toEqual([]);
  });

  test("a full update replaces every slot of that unit only", () => {
    const store = new AuraStore(() => 0);
    const aura = (unit: bigint, slot: number) => ({
      unit,
      slot,
      removed: false as const,
      spellId: 17,
      flags: 0,
      level: 1,
      stacks: 1,
    });
    store.apply(aura(1n, 0));
    store.apply(aura(2n, 0));
    store.replace({ unit: 1n, auras: [aura(1n, 3)] });
    expect(store.forUnit(1n).map((a) => a.slot)).toEqual([3]);
    expect(store.forUnit(2n)).toHaveLength(1);
  });
});
