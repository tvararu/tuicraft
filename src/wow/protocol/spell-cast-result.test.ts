import { expect, test } from "bun:test";
import { spellCastReason } from "wow/protocol/spell-cast-result";

test("names AzerothCore SpellCastResult codes", () => {
  expect(spellCastReason(97)).toBe("out_of_range");
  expect(spellCastReason(12)).toBe("bad_targets");
  expect(spellCastReason(40)).toBe("interrupted");
  expect(spellCastReason(85)).toBe("no_power");
  expect(spellCastReason(61)).toBe("not_infront");
  expect(spellCastReason(100)).toBe("reagents");
  expect(spellCastReason(186)).toBe("target_cannot_be_resurrected");
});

test("codes outside the 3.3.5a enum are unknown", () => {
  expect(spellCastReason(188)).toBe("unknown");
  expect(spellCastReason(255)).toBe("unknown");
  expect(spellCastReason(-1)).toBe("unknown");
});
