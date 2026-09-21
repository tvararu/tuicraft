import { expect, test } from "bun:test";
import {
  CONSERVE_MANA_FIGHT_INSTRUCTION,
  DEFAULT_FIGHT_INSTRUCTION,
} from "wow/standing-instructions";

test("standing instructions are defined with expected texts", () => {
  expect(DEFAULT_FIGHT_INSTRUCTION).toBe(
    "defeat the selected target while keeping the character alive",
  );
  expect(CONSERVE_MANA_FIGHT_INSTRUCTION).toBe(
    "Conserve mana for several encounters. Favor efficient damage and use weapon attacks when useful. Keep enough health to survive safely.",
  );
});
