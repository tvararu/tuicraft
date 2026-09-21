import { expect, jest, test } from "bun:test";
import { CombatActions } from "wow/combat-actions";
import { CombatRuntime } from "wow/combat";
import { ControlRuntime } from "wow/control";
import { EntityStore } from "wow/entity-store";
import { ObjectType, UNIT_FIELDS } from "wow/protocol/entity-fields";
import { PacketReader, PacketWriter } from "wow/protocol/packet";
import type { SpellDefinition } from "wow/spell-catalog";

const context = { targetGuid: 2n, instruction: "Defeat the selected creature" };

function spell(): SpellDefinition {
  return {
    id: 17,
    name: "Fixture spell",
    rank: "Rank 1",
    spellLevel: 1,
    baseLevel: 1,
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
      castTimePerLevel: 0,
      minCastTimeMs: 1000,
    },
    range: {
      id: 2,
      minHostile: 0,
      maxHostile: 30,
      minFriendly: 0,
      maxFriendly: 30,
      flags: 0,
    },
    duration: undefined,
    cooldown: {
      recoveryTimeMs: 0,
      category: 0,
      categoryRecoveryTimeMs: 0,
      startRecoveryCategory: 133,
      startRecoveryTimeMs: 1500,
    },
    schoolMask: 2,
    attributes: {
      raw: 0,
      ex: 0,
      ex2: 0,
      ex3: 0,
      ex4: 0,
      ex5: 0,
      ex6: 0,
      ex7: 0,
    },
    targets: {
      targets: 2,
      creatureType: 0,
      stances: 0,
      stancesNot: 0,
      facingCasterFlags: 1,
      requiresSpellFocus: 0,
    },
    interruptFlags: 0,
    equippedItem: { itemClass: -1, subClassMask: 0, inventoryTypeMask: 0 },
    reagents: [],
    effects: [
      {
        effect: 2,
        dieSides: 1,
        realPointsPerLevel: 1,
        basePoints: 10,
        mechanic: 0,
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

function setup(nowFn: () => number = () => 1000) {
  const store = new EntityStore();
  const fields = new Map<number, number>([
    [UNIT_FIELDS.HEALTH.offset, 100],
    [UNIT_FIELDS.MAXHEALTH.offset, 100],
    [UNIT_FIELDS.BYTES_0.offset, 1],
    [0x7a, 0x2801],
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
    unitFlags: 0x80000,
    target: 1n,
    rawFields: new Map([[UNIT_FIELDS.HEALTH.offset, 100]]),
  });
  const control = new ControlRuntime({
    send() {},
    now: nowFn,
    ticks: () => 0,
    guidLow: () => 1,
    guidHigh: () => 0,
    selfGuid: () => 1n,
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
  combat.observePosition(2n, { mapId: 530, x: 10, y: 0, z: 0, orientation: 0 });
  const w = new PacketWriter();
  w.uint8(0);
  w.uint16LE(1);
  w.uint32LE(17);
  w.uint16LE(0);
  w.uint16LE(0);
  combat.applyInitialSpells(new PacketReader(w.finish()));
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
  data.effects.push({ ...data.effects[0]!, effect: 64 });
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
  data.range!.flags = 1;
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
  data.attributes.raw = 0x10000;
  data.targets.stancesNot = 0x08000000;
  const definition = jest.spyOn(combat, "definition").mockReturnValue(data);
  try {
    expect(
      actions
        .observe(context)
        .candidates.some((candidate) => candidate.id === "spell:17:target"),
    ).toBe(true);
    fields.set(0x7a, 0x1c002801);
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
  data.attributes.raw = 0x10000;
  data.targets.stances = 0x80000000;
  data.targets.stancesNot = 0x08000000;
  const definition = jest.spyOn(combat, "definition").mockReturnValue(data);
  try {
    expect(() => actions.execute("spell:17:target", context)).toThrow(
      "action_no_longer_legal",
    );
    data.attributes.ex2 = 0x80000;
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
    expect(frame.candidates.map((candidate) => candidate.id)).toEqual(["wait"]);
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
  const { actions, combat, fields, store } = setup();
  fields.set(UNIT_FIELDS.COMBATREACH.offset, 0x3fc00000);
  store.get(2n)!.rawFields.set(UNIT_FIELDS.COMBATREACH.offset, 0x3fc00000);
  combat.observePosition(2n, {
    mapId: 530,
    x: -1,
    y: 0,
    z: 0,
    orientation: 0,
  });
  expect(actions.observe(context).outcome).toBeUndefined();
  actions.execute("face", context);
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
  store.get(2n)!.rawFields.set(UNIT_FIELDS.HEALTH.offset, 0);
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
    expect(frame.candidates.map((candidate) => candidate.id)).toEqual(["wait"]);
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
    let frame = actions.observe(context);
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
    expect(frame.candidates.map((c) => c.id)).toContain("face");
    time = 10000;
    frame = actions.observe(context);
    expect(frame.outcome).toBeUndefined();
    expect(frame.candidates.map((c) => c.id)).toContain("face");
  } finally {
    definition.mockRestore();
  }
});
