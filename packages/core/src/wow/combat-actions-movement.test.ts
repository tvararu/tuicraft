import { expect, jest, test } from "bun:test";
import {
  context,
  MOVE_IDS,
  movementCompatibleSpell,
  setup,
  spell,
  standingRequiredSpell,
} from "#test-support/combat-actions-fixtures";

test("observation carries separation and facing to the target", () => {
  const { actions } = setup();
  const frame = actions.observe(context);
  expect(frame.observation["separation"]).toBe(10);
  expect(frame.observation["facingTarget"]).toBe(true);
});

test("unobserved target distance stays explicit rather than invented", () => {
  const { actions } = setup(undefined, { observeTargetPosition: false });
  const frame = actions.observe(context);
  expect(frame.observation["separation"]).toBeNull();
  expect(frame.observation["facingTarget"]).toBe(false);
});

test("movement candidates are offered exactly when movement is allowed", () => {
  const { actions, combat, control } = setup();
  const definition = jest.spyOn(combat, "definition").mockReturnValue(spell());
  try {
    let frame = actions.observe(context);
    expect(frame.outcome).toBeUndefined();
    for (const id of MOVE_IDS)
      expect(frame.candidates.map((c) => c.id)).toContain(id);
    control.forceRoot(1);
    frame = actions.observe(context);
    expect(frame.outcome).toBeUndefined();
    for (const id of MOVE_IDS)
      expect(frame.candidates.map((c) => c.id)).not.toContain(id);
  } finally {
    definition.mockRestore();
  }
});

test("wait holds the current movement direction by refreshing its lease", () => {
  const { actions, combat, control } = setup();
  const definition = jest.spyOn(combat, "definition").mockReturnValue(spell());
  try {
    actions.execute("move_forward", context);
    expect(control.snapshot().moving).toBe(true);
    const move = jest.spyOn(control, "move");
    try {
      actions.execute("wait", context);
      expect(move).toHaveBeenCalledWith("forward", 2500);
      expect(control.snapshot().moving).toBe(true);
      expect(control.snapshot().direction).toBe("forward");
    } finally {
      move.mockRestore();
    }
  } finally {
    definition.mockRestore();
  }
});

test("wait is a no-op while stationary", () => {
  const { actions, combat, control } = setup();
  const definition = jest.spyOn(combat, "definition").mockReturnValue(spell());
  const move = jest.spyOn(control, "move");
  try {
    actions.execute("wait", context);
    expect(move).not.toHaveBeenCalled();
    expect(control.snapshot().moving).toBe(false);
  } finally {
    move.mockRestore();
    definition.mockRestore();
  }
});

test("stop_moving halts an active movement lease", () => {
  const { actions, combat, control } = setup();
  const definition = jest.spyOn(combat, "definition").mockReturnValue(spell());
  try {
    actions.execute("move_forward", context);
    expect(control.snapshot().moving).toBe(true);
    actions.execute("stop_moving", context);
    expect(control.snapshot().moving).toBe(false);
  } finally {
    definition.mockRestore();
  }
});

test("a standing-required spell executed while moving halts movement before casting", () => {
  const { actions, combat, control } = setup();
  const definition = jest
    .spyOn(combat, "definition")
    .mockReturnValue(standingRequiredSpell());
  try {
    actions.execute("move_forward", context);
    expect(control.snapshot().moving).toBe(true);
    actions.execute("spell:17:target", context);
    expect(control.snapshot().moving).toBe(false);
    expect(combat.snapshot().pendingCast?.spellId).toBe(17);
  } finally {
    definition.mockRestore();
  }
});

test("a movement-compatible spell executed while moving does not release the lease", () => {
  const { actions, combat, control } = setup();
  const definition = jest
    .spyOn(combat, "definition")
    .mockReturnValue(movementCompatibleSpell());
  try {
    actions.execute("move_forward", context);
    expect(control.snapshot().moving).toBe(true);
    actions.execute("spell:17:target", context);
    expect(control.snapshot().moving).toBe(true);
    expect(combat.snapshot().pendingCast?.spellId).toBe(17);
  } finally {
    definition.mockRestore();
  }
});
