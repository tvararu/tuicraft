import type { CombatState } from "#wow/combat";
import type { SpellDefinition, SpellEffect } from "#wow/spell-catalog";

const MOVEMENT_INTERRUPT_FLAG = 0x1;
const AUTO_REPEAT_ATTRIBUTE_EX2 = 0x20;
const AURAS = new Set([3, 8, 13, 22, 29, 69, 85]);

export function requiresStanding(spell: SpellDefinition): boolean {
  if (spell.attributes.ex2 & AUTO_REPEAT_ATTRIBUTE_EX2) return true;
  const castTimeMs = spell.castTime?.castTimeMs;
  return (
    castTimeMs !== undefined &&
    castTimeMs > 0 &&
    (spell.interruptFlags & MOVEMENT_INTERRUPT_FLAG) !== 0
  );
}

export function unsupportedSpell(
  spell: SpellDefinition,
  form: number | undefined,
): string | undefined {
  if (spell.attributes.raw & (0x40 | 0x10 | 0x2_00))
    return "unsupported_spell_attribute";
  if (spell.attributes.ex & (0x2 | 0x4 | 0x40))
    return "unsupported_channel_or_power";
  if (spell.equippedItem.itemClass !== -1 || spell.reagents.length > 0)
    return "unsupported_item_requirement";
  if (form === undefined) return "unobserved_shapeshift_form";
  if (form !== 0) return "unsupported_shapeshift_form";
  if (spell.targets.stances && !(spell.attributes.ex2 & 0x8_00_00))
    return "required_shapeshift_form";
  if (
    spell.targets.creatureType ||
    spell.targets.requiresSpellFocus ||
    spell.targets.targets & ~2
  )
    return "unsupported_target_requirement";
  if (!spell.castTime) return "unknown_cast_time";
  return unsupportedMechanics(spell);
}

function unsupportedMechanics(spell: SpellDefinition): string | undefined {
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
  if (effects.length === 0) return "unsupported_empty_effects";
  for (const effect of effects) {
    const reason = unsupportedEffect(effect);
    if (reason) return reason;
  }
  return undefined;
}

function unsupportedEffect(effect: SpellEffect): string | undefined {
  if (![2, 6, 10].includes(effect.effect))
    return `unsupported_effect:${effect.effect}`;
  if (effect.effect === 6 && !AURAS.has(effect.applyAura))
    return `unsupported_aura:${effect.applyAura}`;
  if (effect.implicitTargetA === 0 && effect.implicitTargetB === 0)
    return "unspecified_effect_target";
  if (
    !(
      [0, 1, 6, 21].includes(effect.implicitTargetA) &&
      [0, 1, 6, 21].includes(effect.implicitTargetB)
    )
  )
    return "unsupported_implicit_target";
  if (effect.radius && effect.radius.max > 0) return "unsupported_area_effect";
  return undefined;
}

function effectKind(effect: number): string {
  if (effect === 2) return "damage";
  if (effect === 10) return "healing";
  return "aura";
}

export function manaReason(
  spell: SpellDefinition,
  state: CombatState,
): string | undefined {
  if (state.self.powerType !== 0 || state.self.power === undefined)
    return "unobserved_mana";
  const percentage = spell.power.costPercentageOfBaseMana;
  if (percentage && state.self.baseMana === undefined)
    return "unobserved_base_mana";
  const cost =
    spell.power.costRaw +
    Math.floor(((state.self.baseMana ?? 0) * percentage) / 100);
  if (state.self.power < cost) return "insufficient_mana";
  return undefined;
}

export function auraReason(
  spell: SpellDefinition,
  state: CombatState,
  hostile: boolean,
): string | undefined {
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
  return undefined;
}

export function describeSpell(spell: SpellDefinition, self: boolean): string {
  const effects = spell.effects
    .filter((effect) => effect.effect !== 0)
    .map((effect) => ({
      kind: effectKind(effect.effect),
      effect: effect.effect,
      aura: effect.applyAura,
      base: effect.basePoints + 1,
      perLevel: effect.realPointsPerLevel,
      intervalMs: effect.amplitude,
    }));
  return `Request ${spell.name} ${spell.rank} on ${self ? "self" : "selected creature"}; mana ${spell.power.costRaw} + ${spell.power.costPercentageOfBaseMana}% base mana; cast ${spell.castTime?.castTimeMs}ms; duration ${spell.duration?.durationMs ?? "unknown"}ms; DBC base effects (server applies scaling/modifiers) ${JSON.stringify(effects)}`;
}
