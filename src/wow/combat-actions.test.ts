import { expect, jest, test } from "bun:test";
import { must } from "test/must";
import { CombatRuntime } from "wow/combat";
import { CombatActions } from "wow/combat-actions";
import { ControlRuntime } from "wow/control";
import { EntityStore } from "wow/entity-store";
import type { FactionTemplateCatalog } from "wow/faction-template";
import { ObjectType, UNIT_FIELDS } from "wow/protocol/entity-fields";
import type { SpellDefinition } from "wow/spell-catalog";

const context = { targetGuid: 2n, instruction: "Defeat the selected creature" };
const MOVE_IDS = [
  "move_forward",
  "move_backward",
  "strafe_left",
  "strafe_right",
  "stop_moving",
];

function spell(): SpellDefinition {
  return {
    id: 17,
    name: "Fixture spell",
    rank: "Rank 1",
    maxLevel: 0,
    power: {
      type: 0,
      costRaw: 0,
      costPerLevel: 0,
      costPerSecond: 0,
      costPerSecondPerLevel: 0,
      costPercentageOfBaseMana: 10,
    },
    castTime: {
      id: 1,
      castTimeMs: 1000,
    },
    range: {
      id: 2,
      minHostile: 0,
      maxHostile: 30,
      flags: 0,
    },
    duration: undefined,
    cooldown: {
      recoveryTimeMs: 0,
      category: 0,
      categoryRecoveryTimeMs: 0,
      startRecoveryTimeMs: 1500,
    },
    attributes: {
      raw: 0,
      ex: 0,
      ex2: 0,
    },
    targets: {
      targets: 2,
      creatureType: 0,
      stances: 0,
      requiresSpellFocus: 0,
    },
    interruptFlags: 0,
    equippedItem: { itemClass: -1 },
    reagents: [],
    effects: [
      {
        effect: 2,
        realPointsPerLevel: 1,
        basePoints: 10,
        implicitTargetA: 6,
        implicitTargetB: 0,
        applyAura: 0,
        amplitude: 0,
        radius: undefined,
      },
    ],
    auraRequirements: {
      casterAuraState: 0,
      targetAuraState: 0,
      casterAuraStateNot: 0,
      targetAuraStateNot: 0,
      casterAuraSpell: 0,
      targetAuraSpell: 0,
      excludeCasterAuraSpell: 0,
      excludeTargetAuraSpell: 0,
    },
  };
}

function standingRequiredSpell(): SpellDefinition {
  return {
    ...spell(),
    castTime: {
      id: 3,
      castTimeMs: 1500,
    },
    interruptFlags: 15,
  };
}

function movementCompatibleSpell(): SpellDefinition {
  return {
    ...spell(),
    castTime: { id: 4, castTimeMs: 0 },
    interruptFlags: 8,
  };
}

function setup(
  nowFn: () => number = () => 1000,
  options: { observeTargetPosition?: boolean } = {},
) {
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
    rawFields: fields,
  });
  store.create(2n, ObjectType.UNIT, {
    health: 100,
    maxHealth: 100,
    unitFlags: 0x8_00_00,
    target: 1n,
    rawFields: new Map([[UNIT_FIELDS.HEALTH.offset, 100]]),
  });
  const control = new ControlRuntime({
    send() {},
    now: nowFn,
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
    now: nowFn,
    selfGuid: () => 1n,
    selectedGuid: () => 2n,
    getEntity: (guid) => store.get(guid),
    selfPose: () => control.snapshot().pose,
  });
  if (options.observeTargetPosition ?? true)
    combat.observePosition(2n, {
      mapId: 530,
      x: 10,
      y: 0,
      z: 0,
      orientation: 0,
    });
  combat.applyInitialSpells({ spells: [{ spellId: 17 }], cooldowns: [] });
  const actions = new CombatActions({
    combat,
    control,
    entity: (guid) => store.get(guid),
    factions: () => undefined,
    now: nowFn,
  });
  actions.activate(context);
  return { store, control, combat, actions, fields };
}

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

test("an attacking creature whose faction relation is not verified as hostile can be engaged", () => {
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
    relation: () => "neutral" as const,
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
