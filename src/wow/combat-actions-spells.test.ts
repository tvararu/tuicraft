import { expect, jest, test } from "bun:test";
import { context, setup, spell } from "test/combat-actions-fixtures";
import { must } from "test/must";
import { UNIT_FIELDS } from "wow/protocol/entity-fields";

test("unknown learned mechanics are explicit and never offered as executable", () => {
  const { actions } = setup();
  const frame = actions.observe(context);
  expect(frame.candidates.map((candidate) => candidate.id)).toEqual(["wait"]);
  expect(frame.observation["unavailable"]).toEqual([
    { id: "spell:17:self", reason: "unknown_metadata" },
  ]);
  expect(() => actions.execute("spell:17:self", context)).toThrow();
  expect(frame.outcome).toEqual({
    status: "blocked",
    reason: "no_supported_combat_actions",
  });
  expect(JSON.stringify(frame.observation)).toContain("unknown_metadata");
});

test("mana percentages use base mana and execution rechecks resources", () => {
  const { actions, combat, fields } = setup();
  const definition = jest.spyOn(combat, "definition").mockReturnValue(spell());
  try {
    expect(
      actions
        .observe(context)
        .candidates.some((candidate) => candidate.id === "spell:17:target"),
    ).toBe(true);
    fields.set(UNIT_FIELDS.POWER1.offset, 9);
    expect(() => actions.execute("spell:17:target", context)).toThrow(
      "action_no_longer_legal",
    );
    expect(combat.snapshot().pendingCast).toBeUndefined();
  } finally {
    definition.mockRestore();
  }
});

test("unsupported effects are blocked rather than silently dropped from a multi-effect spell", () => {
  const { actions, combat } = setup();
  const data = spell();
  data.effects.push({ ...must(data.effects[0]), effect: 64 });
  const definition = jest.spyOn(combat, "definition").mockReturnValue(data);
  try {
    expect(
      actions.observe(context).candidates.map((candidate) => candidate.id),
    ).toEqual(["wait"]);
    expect(actions.observe(context).observation["unavailable"]).toEqual([
      { id: "spell:17:target", reason: "unsupported_effect:64" },
    ]);
  } finally {
    definition.mockRestore();
  }
});

test("unsupported hostile range blocks the kit even during cooldown", () => {
  const { actions, combat } = setup();
  const data = spell();
  must(data.range).flags = 1;
  const definition = jest.spyOn(combat, "definition").mockReturnValue(data);
  const cooldown = jest.spyOn(combat, "readyAt").mockReturnValue(2500);
  try {
    const frame = actions.observe(context);
    expect(frame.outcome).toEqual({
      status: "blocked",
      reason: "no_supported_combat_actions",
    });
    expect(frame.observation["unavailable"]).toEqual([
      { id: "spell:17:target", reason: "unsupported_range" },
    ]);
  } finally {
    cooldown.mockRestore();
    definition.mockRestore();
  }
});

test("normal-form spell restrictions use the observed high form byte", () => {
  const { actions, combat, fields } = setup();
  const data = spell();
  data.attributes.raw = 0x1_00_00;
  const definition = jest.spyOn(combat, "definition").mockReturnValue(data);
  try {
    expect(
      actions
        .observe(context)
        .candidates.some((candidate) => candidate.id === "spell:17:target"),
    ).toBe(true);
    fields.set(0x7a, 0x1c_00_28_01);
    expect(() => actions.execute("spell:17:target", context)).toThrow(
      "action_no_longer_legal",
    );
    expect(combat.snapshot().pendingCast).toBeUndefined();
  } finally {
    definition.mockRestore();
  }
});

test("a nonzero stance mask permits normal form only with its allowance flag", () => {
  const { actions, combat } = setup();
  const data = spell();
  data.attributes.raw = 0x1_00_00;
  data.targets.stances = 0x80_00_00_00;
  const definition = jest.spyOn(combat, "definition").mockReturnValue(data);
  try {
    expect(() => actions.execute("spell:17:target", context)).toThrow(
      "action_no_longer_legal",
    );
    data.attributes.ex2 = 0x8_00_00;
    actions.execute("spell:17:target", context);
    expect(combat.snapshot().pendingCast?.spellId).toBe(17);
  } finally {
    definition.mockRestore();
  }
});

test("an unobserved form is not treated as normal form", () => {
  const { actions, combat, fields } = setup();
  const definition = jest.spyOn(combat, "definition").mockReturnValue(spell());
  try {
    fields.delete(0x7a);
    expect(() => actions.execute("spell:17:target", context)).toThrow(
      "action_no_longer_legal",
    );
    expect(combat.snapshot().pendingCast).toBeUndefined();
  } finally {
    definition.mockRestore();
  }
});
