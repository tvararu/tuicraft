import { expect, test } from "bun:test";
import type { CombatState } from "wow/combat";
import { defendTarget } from "wow/combat-defense";
import type { Entity } from "wow/entity-store";
import { ObjectType, UnitFlag } from "wow/protocol/entity-fields";

const SELF = 1n;
const MOB = 2n;

function unit(guid: bigint, unitFlags: number, target = 0n): Entity {
  return {
    guid,
    objectType: ObjectType.UNIT,
    unitFlags,
    target,
  } as Entity;
}

function setup(over: {
  mobHealth: number;
  attackingSelf?: boolean;
  attacking?: boolean;
  mob?: Entity;
  selfFlags?: number;
}) {
  const sent: string[] = [];
  const entities = new Map<bigint, Entity>([
    [SELF, unit(SELF, over.selfFlags ?? UnitFlag.IN_COMBAT)],
    [MOB, over.mob ?? unit(MOB, UnitFlag.IN_COMBAT)],
  ]);
  const state = {
    self: { guid: SELF },
    target: { guid: MOB, health: over.mobHealth },
    attacking: over.attacking ?? false,
    attackTarget: over.attacking ? MOB : undefined,
    pendingAttack: undefined,
  } as unknown as CombatState;
  const defense = defendTarget(
    {
      combat: {
        snapshot: () => state,
        isAttackingSelf: () => over.attackingSelf ?? false,
        attack: (guid) => {
          sent.push(`attack:${guid}`);
        },
        halt: () => {
          sent.push("combat_halt");
        },
      },
      control: {
        setMode: (mode) => {
          sent.push(`mode:${mode}`);
        },
        halt: () => {
          sent.push("control_halt");
        },
      },
      entity: (guid) => entities.get(guid),
    },
    MOB,
  );
  return { defense, sent };
}

test("a live creature attacking the character gets auto-attack", () => {
  expect(setup({ mobHealth: 50, attackingSelf: true })).toEqual({
    defense: "auto_attack",
    sent: ["mode:none", "control_halt", "attack:2"],
  });
});

test("a creature targeting the character in combat counts as attacking", () => {
  const mob = unit(MOB, UnitFlag.IN_COMBAT, SELF);
  expect(setup({ mobHealth: 50, mob }).defense).toBe("auto_attack");
});

test("an existing swing on the target is kept without resending", () => {
  expect(
    setup({ mobHealth: 50, attackingSelf: true, attacking: true }).sent,
  ).toEqual(["mode:none", "control_halt"]);
});

test("without a live attacker the character is released and flagged", () => {
  expect(setup({ mobHealth: 0, attackingSelf: true })).toEqual({
    defense: "uncontrolled_in_combat",
    sent: ["mode:none", "control_halt", "combat_halt"],
  });
  expect(setup({ mobHealth: 50, selfFlags: 0 }).defense).toBe("none");
});
