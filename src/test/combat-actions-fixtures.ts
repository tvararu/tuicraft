import { CombatRuntime } from "wow/combat";
import { CombatActions } from "wow/combat-actions";
import { ControlRuntime } from "wow/control";
import { EntityStore } from "wow/entity-store";
import { ObjectType, UNIT_FIELDS } from "wow/protocol/entity-fields";
import type { SpellDefinition } from "wow/spell-catalog";

export const context = {
  instruction: "Defeat the selected creature",
  targetGuid: 2n,
};
export const MOVE_IDS = [
  "move_forward",
  "move_backward",
  "strafe_left",
  "strafe_right",
  "stop_moving",
];

export function spell(): SpellDefinition {
  return {
    attributes: {
      ex: 0,
      ex2: 0,
      raw: 0,
    },
    auraRequirements: {
      casterAuraSpell: 0,
      casterAuraState: 0,
      casterAuraStateNot: 0,
      excludeCasterAuraSpell: 0,
      excludeTargetAuraSpell: 0,
      targetAuraSpell: 0,
      targetAuraState: 0,
      targetAuraStateNot: 0,
    },
    castTime: {
      castTimeMs: 1000,
      id: 1,
    },
    cooldown: {
      category: 0,
      categoryRecoveryTimeMs: 0,
      recoveryTimeMs: 0,
      startRecoveryTimeMs: 1500,
    },
    duration: undefined,
    effects: [
      {
        amplitude: 0,
        applyAura: 0,
        basePoints: 10,
        effect: 2,
        implicitTargetA: 6,
        implicitTargetB: 0,
        radius: undefined,
        realPointsPerLevel: 1,
      },
    ],
    equippedItem: { itemClass: -1 },
    id: 17,
    interruptFlags: 0,
    maxLevel: 0,
    name: "Fixture spell",
    power: {
      costPercentageOfBaseMana: 10,
      costPerLevel: 0,
      costPerSecond: 0,
      costPerSecondPerLevel: 0,
      costRaw: 0,
      type: 0,
    },
    range: {
      flags: 0,
      id: 2,
      maxHostile: 30,
      minHostile: 0,
    },
    rank: "Rank 1",
    reagents: [],
    targets: {
      creatureType: 0,
      requiresSpellFocus: 0,
      stances: 0,
      targets: 2,
    },
  };
}

export function standingRequiredSpell(): SpellDefinition {
  return {
    ...spell(),
    castTime: {
      castTimeMs: 1500,
      id: 3,
    },
    interruptFlags: 15,
  };
}

export function movementCompatibleSpell(): SpellDefinition {
  return {
    ...spell(),
    castTime: { castTimeMs: 0, id: 4 },
    interruptFlags: 8,
  };
}

export function setup(
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
    rawFields: new Map([[UNIT_FIELDS.HEALTH.offset, 100]]),
    target: 1n,
    unitFlags: 0x8_00_00,
  });
  const control = new ControlRuntime({
    findHeight: (_mapId, _x, _y, from) => from?.z,
    isPathClear: () => false,
    now: nowFn,
    selfGuid: () => 1n,
    send() {},
    ticks: () => 0,
  });
  control.observeSelf({
    position: { mapId: 530, orientation: 0, x: 0, y: 0, z: 0 },
    runBackSpeed: 4,
    runSpeed: 7,
  });
  const combat = new CombatRuntime({
    getEntity: (guid) => store.get(guid),
    now: nowFn,
    selectedGuid: () => 2n,
    selfGuid: () => 1n,
    selfPose: () => control.snapshot().pose,
    send() {},
  });
  if (options.observeTargetPosition ?? true)
    combat.observePosition(2n, {
      mapId: 530,
      orientation: 0,
      x: 10,
      y: 0,
      z: 0,
    });
  combat.applyInitialSpells({ cooldowns: [], spells: [{ spellId: 17 }] });
  const actions = new CombatActions({
    combat,
    control,
    entity: (guid) => store.get(guid),
    factions: () => undefined,
    now: nowFn,
  });
  actions.activate(context);
  return { actions, combat, control, fields, store };
}
