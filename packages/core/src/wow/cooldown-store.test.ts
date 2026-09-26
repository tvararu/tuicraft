import { describe, expect, test } from "bun:test";
import { CooldownStore } from "#wow/cooldown-store";

function setup() {
  let now = 1000;
  const store = new CooldownStore(
    () => now,
    (id) =>
      id === 17
        ? {
            category: 5,
            recoveryTimeMs: 2000,
            categoryRecoveryTimeMs: 4000,
            startRecoveryTimeMs: 1500,
          }
        : undefined,
  );
  return { store, advance: (ms: number) => (now += ms) };
}

describe("CooldownStore", () => {
  test("the longest of spell, category and global cooldown wins", () => {
    const { store } = setup();
    store.beginGlobal(17);
    expect(store.readyAt(17)).toBe(2500);
    store.predict(17);
    expect(store.readyAt(17)).toBe(5000);
    expect(store.list(new Set([17]))).toEqual([
      { spellId: 17, until: 5000, remainingMs: 4000, source: "predicted" },
    ]);
  });

  test("server cooldowns expire and release clears the category", () => {
    const { store, advance } = setup();
    store.observe(17, 3000);
    store.predict(17);
    store.release(17);
    expect(store.list(new Set([17]))).toEqual([]);
    store.observe(18, 500);
    advance(500);
    expect(store.list(new Set())).toEqual([]);
  });
});
