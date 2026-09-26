import { expect, jest, test } from "bun:test";
import { context, setup, spell } from "#test-support/combat-actions-fixtures";
import { must } from "#test-support/must";
import type { CombatState } from "#wow/combat";
import { NO_PROGRESS_MS, ProgressWatch } from "#wow/combat-progress";
import { UNIT_FIELDS } from "#wow/protocol/entity-fields";

function idleFight() {
  let time = 1000;
  const fixture = setup(() => time);
  const definition = jest
    .spyOn(fixture.combat, "definition")
    .mockReturnValue(spell());
  const at = (ms: number) => {
    time = 1000 + ms;
    return fixture.actions.observe(context).outcome;
  };
  const setHealth = (health: number) =>
    must(fixture.store.get(2n)).rawFields.set(
      UNIT_FIELDS.HEALTH.offset,
      health,
    );
  const place = (x: number) =>
    fixture.combat.observePosition(2n, {
      mapId: 530,
      x,
      y: 0,
      z: 0,
      orientation: 0,
    });
  return { at, definition, place, setHealth };
}

test("a fight with no damage and no approach stops as no_progress at the bound", () => {
  const { at, definition, place } = idleFight();
  try {
    place(20);
    expect(at(0)).toBeUndefined();
    expect(at(NO_PROGRESS_MS - 1)).toBeUndefined();
    expect(at(NO_PROGRESS_MS)).toEqual({
      status: "blocked",
      reason: "no_progress",
    });
  } finally {
    definition.mockRestore();
  }
});

test("target damage restarts the bound; healing back does not", () => {
  const { at, definition, place, setHealth } = idleFight();
  try {
    place(20);
    setHealth(8);
    expect(at(0)).toBeUndefined();
    setHealth(5);
    expect(at(20_000)).toBeUndefined();
    setHealth(9);
    expect(at(20_000 + NO_PROGRESS_MS - 1)).toBeUndefined();
    expect(at(20_000 + NO_PROGRESS_MS)?.reason).toBe("no_progress");
  } finally {
    definition.mockRestore();
  }
});

test("closing at least a yard restarts the bound; half a yard does not", () => {
  const { at, definition, place } = idleFight();
  try {
    place(25);
    expect(at(0)).toBeUndefined();
    place(20);
    expect(at(20_000)).toBeUndefined();
    place(19.5);
    expect(at(30_000)).toBeUndefined();
    expect(at(20_000 + NO_PROGRESS_MS - 1)).toBeUndefined();
    expect(at(20_000 + NO_PROGRESS_MS)?.reason).toBe("no_progress");
  } finally {
    definition.mockRestore();
  }
});

test("an unobserved separation never counts as approach", () => {
  const watch = new ProgressWatch();
  const unobserved = {
    self: { pose: undefined },
    target: { health: 120, pose: undefined },
  } as unknown as CombatState;
  expect(watch.observe(unobserved, 0)).toBeUndefined();
  expect(watch.observe(unobserved, 10_000)).toBeUndefined();
  expect(watch.observe(unobserved, NO_PROGRESS_MS - 1)).toBeUndefined();
  expect(watch.observe(unobserved, NO_PROGRESS_MS)).toEqual({
    status: "blocked",
    reason: "no_progress",
  });
});

test("damage before the separation is observed keeps it unobserved", () => {
  const watch = new ProgressWatch();
  const pose = (x: number) => ({ mapId: 530, x, y: 0, z: 0 });
  const state = (health: number, x?: number) =>
    ({
      self: { pose: pose(0) },
      target: { health, pose: x === undefined ? undefined : pose(x) },
    }) as unknown as CombatState;
  expect(watch.observe(state(120), 0)).toBeUndefined();
  expect(watch.observe(state(100), 10_000)).toBeUndefined();
  expect(watch.observe(state(100, 20), 20_000)).toBeUndefined();
  expect(watch.observe(state(100, 20), 10_000 + NO_PROGRESS_MS)).toEqual({
    status: "blocked",
    reason: "no_progress",
  });
});
