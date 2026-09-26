import { expect, jest, test } from "bun:test";
import { context, MOVE_IDS, setup, spell } from "test/combat-actions-fixtures";
import { must } from "test/must";
import { CombatRuntime } from "wow/combat";
import { CombatActions } from "wow/combat-actions";
import { ControlRuntime } from "wow/control";
import { EntityStore } from "wow/entity-store";
import type { FactionTemplateCatalog } from "wow/faction-template";
import { ObjectType, UNIT_FIELDS } from "wow/protocol/entity-fields";

test("transient cooldown and cancellation waits do not block an encounter", () => {
  const { actions, combat } = setup();
  const definition = jest.spyOn(combat, "definition").mockReturnValue(spell());
  const cooldown = jest.spyOn(combat, "readyAt").mockReturnValue(2500);
  try {
    let frame = actions.observe(context);
    expect(frame.outcome).toBeUndefined();
    expect(frame.candidates.map((candidate) => candidate.id)).toEqual([
      "wait",
      ...MOVE_IDS,
    ]);
    combat.cast(17, 2n);
    combat.cancelCast();
    definition.mockReturnValue(undefined);
    frame = actions.observe(context);
    expect(frame.outcome).toBeUndefined();
    expect(frame.candidates.map((candidate) => candidate.id)).toEqual(["wait"]);
  } finally {
    cooldown.mockRestore();
    definition.mockRestore();
  }
});

test("an unsupported spellbook does not block facing and melee engagement", () => {
  const { actions, combat, store } = setup();
  store.update(1n, { combatReach: 1.5 });
  store.update(2n, { combatReach: 1.5 });
  combat.observePosition(2n, {
    mapId: 530,
    x: -1,
    y: 0,
    z: 0,
    orientation: 0,
  });
  expect(actions.observe(context).outcome).toBeUndefined();
  actions.execute("face_target", context);
  actions.execute("attack", context);
  expect(combat.snapshot().pendingAttack).toBe(2n);
});

test("root blocks movement but not a supported stationary spell", () => {
  const { actions, combat, control } = setup();
  const definition = jest.spyOn(combat, "definition").mockReturnValue(spell());
  try {
    control.forceRoot(1);
    const frame = actions.observe(context);
    expect(frame.outcome).toBeUndefined();
    expect(
      frame.candidates.some((candidate) => candidate.id === "spell:17:target"),
    ).toBe(true);
  } finally {
    definition.mockRestore();
  }
});

test("dead target waits for real credit and offers no attack or spell", () => {
  const { actions, combat, store } = setup();
  must(store.get(2n)).rawFields.set(UNIT_FIELDS.HEALTH.offset, 0);
  const definition = jest.spyOn(combat, "definition").mockReturnValue(spell());
  try {
    const frame = actions.observe(context);
    expect(frame.outcome).toBeUndefined();
    expect(frame.candidates.map((candidate) => candidate.id)).toEqual(["wait"]);
  } finally {
    definition.mockRestore();
  }
});

test("an unreachable target stops after the persistence threshold", () => {
  let time = 1000;
  const { actions, combat } = setup(() => time);
  const definition = jest.spyOn(combat, "definition").mockReturnValue(spell());
  try {
    combat.observePosition(2n, {
      mapId: 530,
      x: 50,
      y: 0,
      z: 0,
      orientation: 0,
    });
    let frame = actions.observe(context);
    expect(frame.outcome).toBeUndefined();
    expect(frame.candidates.map((candidate) => candidate.id)).toEqual([
      "wait",
      ...MOVE_IDS,
    ]);
    time = 5999;
    frame = actions.observe(context);
    expect(frame.outcome).toBeUndefined();
    time = 6000;
    frame = actions.observe(context);
    expect(frame.outcome).toEqual({
      status: "blocked",
      reason: "target_unreachable",
    });
    expect(frame.candidates.map((candidate) => candidate.id)).toEqual(["wait"]);
  } finally {
    definition.mockRestore();
  }
});

test("a target re-entering range resets the unreachable persistence threshold", () => {
  let time = 1000;
  const { actions, combat } = setup(() => time);
  const definition = jest.spyOn(combat, "definition").mockReturnValue(spell());
  try {
    combat.observePosition(2n, {
      mapId: 530,
      x: 50,
      y: 0,
      z: 0,
      orientation: 0,
    });
    expect(actions.observe(context).outcome).toBeUndefined();
    time = 3000;
    combat.observePosition(2n, {
      mapId: 530,
      x: 10,
      y: 0,
      z: 0,
      orientation: 0,
    });
    const frame = actions.observe(context);
    expect(frame.outcome).toBeUndefined();
    expect(
      frame.candidates.some((candidate) => candidate.id === "spell:17:target"),
    ).toBe(true);
    time = 4000;
    combat.observePosition(2n, {
      mapId: 530,
      x: 50,
      y: 0,
      z: 0,
      orientation: 0,
    });
    expect(actions.observe(context).outcome).toBeUndefined();
    time = 6000;
    expect(actions.observe(context).outcome).toBeUndefined();
    time = 9000;
    expect(actions.observe(context).outcome).toEqual({
      status: "blocked",
      reason: "target_unreachable",
    });
  } finally {
    definition.mockRestore();
  }
});

test("facing remains recoverable and does not stop as unreachable", () => {
  let time = 1000;
  const { actions, combat, control } = setup(() => time);
  const definition = jest.spyOn(combat, "definition").mockReturnValue(spell());
  try {
    control.observeSelf({
      position: { mapId: 530, x: 0, y: 0, z: 0, orientation: Math.PI },
      runSpeed: 7,
      runBackSpeed: 4,
    });
    let frame = actions.observe(context);
    expect(frame.outcome).toBeUndefined();
    expect(frame.candidates.map((c) => c.id)).toContain("face_target");
    time = 10_000;
    frame = actions.observe(context);
    expect(frame.outcome).toBeUndefined();
    expect(frame.candidates.map((c) => c.id)).toContain("face_target");
  } finally {
    definition.mockRestore();
  }
});

test("an attacking creature whose faction relation is unknown can be engaged", () => {
  const store = new EntityStore();
  const fields = new Map<number, number>([
    [UNIT_FIELDS.HEALTH.offset, 100],
    [UNIT_FIELDS.MAXHEALTH.offset, 100],
    [UNIT_FIELDS.BYTES_0.offset, 1],
    [0x7a, 0x28_01],
    [UNIT_FIELDS.POWER1.offset, 15],
    [UNIT_FIELDS.MAXPOWER1.offset, 1000],
    [UNIT_FIELDS.BASE_MANA.offset, 100],
  ]);
  store.create(1n, ObjectType.PLAYER, {
    health: 100,
    maxHealth: 100,
    factionTemplate: 1610,
    rawFields: fields,
  });
  store.create(2n, ObjectType.UNIT, {
    health: 100,
    maxHealth: 100,
    unitFlags: 0,
    target: 0n,
    factionTemplate: 7,
    rawFields: new Map([[UNIT_FIELDS.HEALTH.offset, 100]]),
  });
  const control = new ControlRuntime({
    send() {},
    now: () => 1000,
    ticks: () => 0,
    selfGuid: () => 1n,
    findHeight: () => undefined,
    isPathClear: () => false,
  });
  control.observeSelf({
    position: { mapId: 530, x: 0, y: 0, z: 0, orientation: 0 },
    runSpeed: 7,
    runBackSpeed: 4,
  });
  const combat = new CombatRuntime({
    send() {},
    now: () => 1000,
    selfGuid: () => 1n,
    selectedGuid: () => 2n,
    getEntity: (guid) => store.get(guid),
    selfPose: () => control.snapshot().pose,
  });
  combat.observePosition(2n, { mapId: 530, x: 10, y: 0, z: 0, orientation: 0 });
  combat.applyInitialSpells({ spells: [{ spellId: 17 }], cooldowns: [] });
  const factionsCatalog = {
    relation: () => "unknown" as const,
  } as unknown as FactionTemplateCatalog;
  const actions = new CombatActions({
    combat,
    control,
    entity: (guid) => store.get(guid),
    factions: () => factionsCatalog,
    now: () => 1000,
  });

  expect(() => actions.activate(context)).toThrow(
    "unverified_hostile_relation",
  );

  combat.applyAttackStart({ attacker: 2n, victim: 1n });

  expect(() => actions.activate(context)).not.toThrow();

  combat.applyAttackStop({ attacker: 2n, victim: 1n, dead: 0 });

  expect(() => actions.activate(context)).toThrow(
    "unverified_hostile_relation",
  );
});
