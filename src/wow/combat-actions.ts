import type { CombatRuntime, CombatState, CombatUnit } from "wow/combat";
import type { ControlRuntime } from "wow/control";
import type { Entity } from "wow/entity-store";
import type { SpellDefinition } from "wow/spell-catalog";
import type { FactionTemplateCatalog } from "wow/faction-template";
import type {
  TacticsContext,
  TacticsFrame,
  TacticsCandidate,
} from "wow/tactics";
import { ObjectType, UNIT_FIELDS } from "wow/protocol/entity-fields";

type ActionDeps = {
  combat: CombatRuntime;
  control: ControlRuntime;
  entity: (guid: bigint) => Entity | undefined;
  factions: () => FactionTemplateCatalog | undefined;
  now: () => number;
};

type SpellAction = {
  spell?: SpellDefinition;
  target: bigint;
  id: string;
  reason?: string;
  supported: boolean;
};
const WAIT = {
  id: "wait",
  description: "Wait for current server state without starting another action",
};
const TARGET_BLOCK = 0x2 | 0x8 | 0x80 | 0x100 | 0x10000 | 0x100000 | 0x2000000;
const SELF_BLOCK = 0x1 | 0x40000 | 0x100000 | 0x400000 | 0x800000;
const AURAS = new Set([3, 8, 13, 22, 29, 69, 85]);

export class CombatActions {
  private readonly deps: ActionDeps;
  private startedAt = 0;
  private deadAt: number | undefined;

  constructor(deps: ActionDeps) {
    this.deps = deps;
  }

  activate(context: TacticsContext): void {
    const state = this.deps.combat.snapshot(context.targetGuid);
    const reason = this.targetReason(context.targetGuid, state);
    if (reason) throw new Error(reason);
    this.startedAt = this.deps.now();
    this.deadAt = undefined;
    this.deps.control.halt();
    this.deps.combat.halt();
    this.deps.control.setMode("jev");
    this.deps.control.selectTarget(context.targetGuid);
  }

  observe(context: TacticsContext): TacticsFrame {
    const state = this.deps.combat.snapshot(context.targetGuid);
    const spells = state.learned.map((id) =>
      this.spellAction(id, context, state),
    );
    const outcome = this.outcome(context, state, spells);
    const candidates: TacticsCandidate[] = [WAIT];
    if (!outcome) this.addCandidates(candidates, spells, state);
    return {
      observation: {
        self: unitObservation(state.self),
        target: state.target ? unitObservation(state.target) : null,
        casting: state.casting
          ? { ...state.casting, target: hex(state.casting.target) }
          : null,
        pendingCast: state.pendingCast
          ? { ...state.pendingCast, target: hex(state.pendingCast.target) }
          : null,
        attacking: state.attacking,
        attackTarget: hex(state.attackTarget),
        pendingAttack: hex(state.pendingAttack),
        auras: state.auras.map(auraObservation),
        targetAuras: state.targetAuras.map(auraObservation),
        cooldowns: state.cooldowns,
        unknownLearned: state.unknownLearned,
        unavailable: spells
          .filter((action) => action.reason)
          .map((action) => ({ id: action.id, reason: action.reason })),
        lastOutcome: state.lastOutcome
          ? {
              kind: state.lastOutcome.kind,
              status: state.lastOutcome.status,
              spellId: state.lastOutcome.spellId,
              result: state.lastOutcome.result,
              at: state.lastOutcome.at,
            }
          : null,
        lastXp: state.lastXp
          ? { ...state.lastXp, victim: hex(state.lastXp.victim) }
          : null,
        navigation: this.deps.control.navigationState(),
      },
      candidates,
      outcome,
    };
  }

  execute(id: string, context: TacticsContext): void {
    const frame = this.observe(context);
    if (
      frame.outcome ||
      !frame.candidates.some((candidate) => candidate.id === id)
    )
      throw new Error("action_no_longer_legal");
    if (id === "wait") return;
    if (id === "cancel") {
      this.deps.combat.cancelCast();
      return;
    }
    if (id === "attack") {
      this.deps.combat.attack(context.targetGuid);
      return;
    }
    if (id === "stop_attack") {
      this.deps.combat.stopAttack();
      return;
    }
    const state = this.deps.combat.snapshot(context.targetGuid);
    if (id === "face") {
      const from = state.self.pose!;
      const to = state.target!.pose!;
      this.deps.control.face(Math.atan2(to.y - from.y, to.x - from.x));
      return;
    }
    const action = state.learned
      .map((spellId) => this.spellAction(spellId, context, state))
      .find((entry) => entry.id === id && !entry.reason);
    if (!action?.spell) throw new Error("action_no_longer_legal");
    this.deps.combat.cast(action.spell.id, action.target);
  }

  private addCandidates(
    candidates: TacticsCandidate[],
    spells: readonly SpellAction[],
    state: CombatState,
  ): void {
    if (state.target?.health === 0) return;
    if (state.casting?.cancelRequested || state.pendingCast?.cancelRequested)
      return;
    if (state.casting || state.pendingCast) {
      candidates.push({
        id: "cancel",
        description: "Request cancellation of the current cast",
      });
      return;
    }
    if (this.deps.control.snapshot().moving) return;
    for (const action of spells)
      if (action.spell && !action.reason)
        candidates.push({
          id: action.id,
          description: describeSpell(
            action.spell,
            action.target === state.self.guid,
          ),
        });
    if (state.attacking || state.pendingAttack)
      candidates.push({ id: "stop_attack", description: "Stop autoattack" });
    else if (this.inMelee(state) && facing(state))
      candidates.push({
        id: "attack",
        description: "Start melee autoattack against the selected creature",
      });
    if (
      state.self.pose &&
      state.target?.pose &&
      !facing(state) &&
      this.deps.control.snapshot().movementAllowed
    )
      candidates.push({
        id: "face",
        description:
          "Turn to face the selected creature at its current observed or predicted position",
      });
  }

  private spellAction(
    id: number,
    context: TacticsContext,
    state: CombatState,
  ): SpellAction {
    const spell = this.deps.combat.definition(id);
    const hostile =
      spell?.effects.some(
        (effect) =>
          effect.implicitTargetA === 6 || effect.implicitTargetB === 6,
      ) ?? false;
    const target = hostile ? context.targetGuid : state.self.guid;
    const actionId = `spell:${id}:${hostile ? "target" : "self"}`;
    if (!spell)
      return {
        id: actionId,
        target,
        reason: "unknown_metadata",
        supported: false,
      };
    const unsupported =
      unsupportedSpell(spell, state.self.shapeshiftForm) ??
      (hostile && (!spell.range || spell.range.flags !== 0)
        ? "unsupported_range"
        : undefined);
    const reason = unsupported ?? this.spellReason(spell, state, hostile);
    return { id: actionId, spell, target, reason, supported: !unsupported };
  }

  private spellReason(
    spell: SpellDefinition,
    state: CombatState,
    hostile: boolean,
  ): string | undefined {
    if (this.deps.combat.readyAt(spell.id) > this.deps.now()) return "cooldown";
    if (state.self.powerType !== 0 || state.self.power === undefined)
      return "unobserved_mana";
    const percentage = spell.power.costPercentageOfBaseMana;
    if (percentage && state.self.baseMana === undefined)
      return "unobserved_base_mana";
    const cost =
      spell.power.costRaw +
      Math.floor(((state.self.baseMana ?? 0) * percentage) / 100);
    if (state.self.power < cost) return "insufficient_mana";
    const target = hostile ? state.target : state.self;
    const auras = hostile ? state.targetAuras : state.auras;
    const req = spell.auraRequirements;
    if (
      req.casterAuraSpell &&
      !state.auras.some((aura) => aura.spellId === req.casterAuraSpell)
    )
      return "caster_aura_required";
    if (
      req.targetAuraSpell &&
      !auras.some((aura) => aura.spellId === req.targetAuraSpell)
    )
      return "target_aura_required";
    if (
      req.excludeCasterAuraSpell &&
      state.auras.some((aura) => aura.spellId === req.excludeCasterAuraSpell)
    )
      return "caster_aura_excluded";
    if (
      req.excludeTargetAuraSpell &&
      auras.some((aura) => aura.spellId === req.excludeTargetAuraSpell)
    )
      return "target_aura_excluded";
    if (
      spell.effects.some((effect) => effect.effect === 6) &&
      auras.some((aura) => aura.spellId === spell.id)
    )
      return "aura_already_present";
    if (
      !hostile &&
      spell.effects.some(
        (effect) => effect.effect === 10 || effect.applyAura === 8,
      ) &&
      (target?.health === undefined ||
        target.maxHealth === undefined ||
        target.health >= target.maxHealth)
    )
      return "no_observed_healing_needed";
    if (!hostile) return undefined;
    const distance = separation(state);
    if (distance === undefined) return "unobserved_range";
    const range = spell.range!;
    if (distance < range.minHostile || distance > range.maxHostile)
      return "out_of_range";
    if (!facing(state)) return "not_facing";
    return undefined;
  }

  private outcome(
    context: TacticsContext,
    state: CombatState,
    spells: readonly SpellAction[],
  ): TacticsFrame["outcome"] {
    if (
      state.lastXp?.kind === "kill" &&
      state.lastXp.victim === context.targetGuid &&
      state.lastXp.at >= this.startedAt
    )
      return { status: "completed", reason: "server_kill_credit" };
    if (state.self.health === 0)
      return { status: "failed", reason: "self_dead" };
    const last = state.lastOutcome;
    if (
      last &&
      last.at >= this.startedAt &&
      (last.status === "failed" || last.status === "interrupted") &&
      (last.kind === "cast" ||
        (last.kind === "attack" && last.status === "failed"))
    )
      return {
        status: "blocked",
        reason: `server_action_rejected:${last.result ?? "interrupted"}`,
      };
    const now = this.deps.now();
    if (state.pendingCast && now - state.pendingCast.startedAt > 5000)
      return { status: "failed", reason: "cast_response_timeout" };
    if (
      state.casting &&
      now - state.casting.startedAt > state.casting.durationMs + 5000
    )
      return { status: "failed", reason: "cast_completion_timeout" };
    if (state.target?.health === 0) {
      this.deadAt ??= now;
      if (now - this.deadAt > 5000)
        return {
          status: "blocked",
          reason: "target_dead_without_server_credit",
        };
      return undefined;
    }
    const reason = this.targetReason(context.targetGuid, state);
    if (reason) return { status: "blocked", reason };
    const control = this.deps.control.snapshot();
    if (
      control.blockedReason &&
      !["rooted", "disable_move"].includes(control.blockedReason)
    )
      return { status: "blocked", reason: control.blockedReason };
    if (
      !state.pendingCast &&
      !state.casting &&
      !state.pendingAttack &&
      !state.attacking &&
      !this.inMelee(state) &&
      !spells.some((action) => action.supported)
    )
      return { status: "blocked", reason: "no_supported_combat_actions" };
    return undefined;
  }

  private targetReason(guid: bigint, state: CombatState): string | undefined {
    const target = this.deps.entity(guid);
    const self = this.deps.entity(state.self.guid);
    if (
      !target ||
      target.objectType !== ObjectType.UNIT ||
      !("unitFlags" in target)
    )
      return "target_not_pve_creature";
    if (!self || !("unitFlags" in self) || state.self.health === undefined)
      return "self_unobserved";
    if (state.target?.health === undefined) return "target_vitals_unobserved";
    if (state.target.health === 0) return "target_dead";
    if (target.unitFlags & TARGET_BLOCK) return "target_not_attackable";
    if (self.unitFlags & SELF_BLOCK) return "self_cannot_act";
    if (target.target === state.self.guid && target.unitFlags & 0x80000)
      return undefined;
    const factions = this.deps.factions();
    if (
      !factions ||
      factions.relation(self.factionTemplate, target.factionTemplate) !==
        "hostile" ||
      factions.relation(target.factionTemplate, self.factionTemplate) ===
        "friendly"
    )
      return "unverified_hostile_relation";
    return undefined;
  }

  private inMelee(state: CombatState): boolean {
    const self = this.deps.entity(state.self.guid);
    const target = state.target && this.deps.entity(state.target.guid);
    const a = fieldFloat(self, UNIT_FIELDS.COMBATREACH.offset);
    const b = fieldFloat(target, UNIT_FIELDS.COMBATREACH.offset);
    const distance = separation(state);
    if (a === undefined || b === undefined || distance === undefined)
      return false;
    return distance <= Math.max(5, a + b + 4 / 3);
  }
}

function unsupportedSpell(
  spell: SpellDefinition,
  form: number | undefined,
): string | undefined {
  if (spell.attributes.raw & (0x40 | 0x10 | 0x200))
    return "unsupported_spell_attribute";
  if (spell.attributes.ex & (0x2 | 0x4 | 0x40))
    return "unsupported_channel_or_power";
  if (spell.equippedItem.itemClass !== -1 || spell.reagents.length)
    return "unsupported_item_requirement";
  if (form === undefined) return "unobserved_shapeshift_form";
  if (form !== 0) return "unsupported_shapeshift_form";
  if (spell.targets.stances && !(spell.attributes.ex2 & 0x80000))
    return "required_shapeshift_form";
  if (
    spell.targets.creatureType ||
    spell.targets.requiresSpellFocus ||
    spell.targets.targets & ~2
  )
    return "unsupported_target_requirement";
  if (!spell.castTime) return "unknown_cast_time";
  if (
    spell.power.type !== 0 ||
    spell.power.costPerSecond ||
    spell.power.costPerSecondPerLevel ||
    spell.power.costPerLevel
  )
    return "unsupported_power_mechanics";
  const req = spell.auraRequirements;
  if (
    req.casterAuraState ||
    req.targetAuraState ||
    req.casterAuraStateNot ||
    req.targetAuraStateNot
  )
    return "unsupported_aura_state";
  const effects = spell.effects.filter((effect) => effect.effect !== 0);
  if (!effects.length) return "unsupported_empty_effects";
  for (const effect of effects) {
    if (![2, 6, 10].includes(effect.effect))
      return `unsupported_effect:${effect.effect}`;
    if (effect.effect === 6 && !AURAS.has(effect.applyAura))
      return `unsupported_aura:${effect.applyAura}`;
    if (effect.implicitTargetA === 0 && effect.implicitTargetB === 0)
      return "unspecified_effect_target";
    if (
      ![0, 1, 6, 21].includes(effect.implicitTargetA) ||
      ![0, 1, 6, 21].includes(effect.implicitTargetB)
    )
      return "unsupported_implicit_target";
    if (effect.radius && effect.radius.max > 0)
      return "unsupported_area_effect";
  }
  return undefined;
}

function describeSpell(spell: SpellDefinition, self: boolean): string {
  const effects = spell.effects
    .filter((effect) => effect.effect !== 0)
    .map((effect) => ({
      kind:
        effect.effect === 2
          ? "damage"
          : effect.effect === 10
            ? "healing"
            : "aura",
      effect: effect.effect,
      aura: effect.applyAura,
      base: effect.basePoints + 1,
      perLevel: effect.realPointsPerLevel,
      intervalMs: effect.amplitude,
    }));
  return `Request ${spell.name} ${spell.rank} on ${self ? "self" : "selected creature"}; mana ${spell.power.costRaw} + ${spell.power.costPercentageOfBaseMana}% base mana; cast ${spell.castTime?.castTimeMs}ms; duration ${spell.duration?.durationMs ?? "unknown"}ms; DBC base effects (server applies scaling/modifiers) ${JSON.stringify(effects)}`;
}

function fieldFloat(
  entity: Entity | undefined,
  offset: number,
): number | undefined {
  const raw = entity?.rawFields.get(offset);
  if (raw === undefined) return undefined;
  const view = new DataView(new ArrayBuffer(4));
  view.setUint32(0, raw, true);
  return view.getFloat32(0, true);
}

function separation(state: CombatState): number | undefined {
  const a = state.self.pose;
  const b = state.target?.pose;
  if (!a || !b || a.mapId !== b.mapId) return undefined;
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function facing(state: CombatState): boolean {
  const a = state.self.pose;
  const b = state.target?.pose;
  if (!a || !b || a.orientation === undefined) return false;
  const angle = Math.atan2(b.y - a.y, b.x - a.x) - a.orientation;
  return Math.cos(angle) >= 0;
}

function hex(guid: bigint | undefined): string | undefined {
  return guid === undefined ? undefined : `0x${guid.toString(16)}`;
}

function unitObservation(unit: CombatUnit): Record<string, unknown> {
  return { ...unit, guid: hex(unit.guid) };
}

function auraObservation(
  aura: CombatState["auras"][number],
): Record<string, unknown> {
  return { ...aura, caster: hex(aura.caster) };
}
