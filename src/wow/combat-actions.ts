import type { CombatRuntime, CombatState } from "wow/combat";
import {
  MOVE_CANDIDATES,
  MOVE_DIRECTION_BY_ID,
  MOVE_LEASE_MS,
  STOP_MOVING,
  WAIT,
} from "wow/combat-actions-movement";
import {
  auraObservation,
  facing,
  hex,
  outcomeObservation,
  separation,
  timeoutOutcome,
  unitObservation,
} from "wow/combat-actions-observation";
import {
  auraReason,
  describeSpell,
  manaReason,
  requiresStanding,
  unsupportedSpell,
} from "wow/combat-actions-spells";
import { targetReason, targetRelation } from "wow/combat-actions-target";
import { approached, ProgressWatch } from "wow/combat-progress";
import { RejectionTracker } from "wow/combat-rejections";
import type { ControlRuntime } from "wow/control";
import { type EntityLookup, isUnit } from "wow/entity-store";
import type { FactionTemplateCatalog } from "wow/faction-template";
import { bearing } from "wow/geometry";
import type { JevCandidate } from "wow/jev";
import type { SpellDefinition } from "wow/spell-catalog";
import type { TacticsContext, TacticsFrame } from "wow/tactics";

type ActionDeps = {
  combat: CombatRuntime;
  control: ControlRuntime;
  entity: EntityLookup;
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
const UNREACHABLE_TIMEOUT_MS = 5000;

export class CombatActions {
  private readonly deps: ActionDeps;
  private startedAt = 0;
  private deadAt: number | undefined;
  private unreachable: { at: number; range: number | undefined } | undefined;
  private readonly progress = new ProgressWatch();
  private readonly rejections = new RejectionTracker();

  constructor(deps: ActionDeps) {
    this.deps = deps;
  }

  activate(context: TacticsContext): void {
    const state = this.deps.combat.snapshot(context.targetGuid);
    const reason = targetReason(this.deps, context.targetGuid, state);
    if (reason) throw new Error(reason);
    this.startedAt = this.deps.now();
    this.deadAt = undefined;
    this.unreachable = undefined;
    this.progress.reset();
    this.rejections.reset(this.startedAt);
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
    const candidates: JevCandidate[] = [WAIT];
    if (!outcome) this.addCandidates(candidates, spells, state);
    return {
      observation: {
        self: unitObservation(state.self),
        target: state.target ? unitObservation(state.target) : null,
        targetRelation: targetRelation(
          this.deps,
          context.targetGuid,
          state.self.guid,
        ),
        separation: separation(state) ?? null,
        facingTarget: facing(state),
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
          ? outcomeObservation(state.lastOutcome)
          : null,
        lastXp: state.lastXp
          ? { ...state.lastXp, victim: hex(state.lastXp.victim) }
          : null,
        navigation: this.deps.control.navigationState(),
        rejections: this.rejections.observation(),
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
    if (id === "wait") {
      const control = this.deps.control.snapshot();
      if (control.moving && control.direction)
        this.deps.control.move(control.direction, MOVE_LEASE_MS);
      return;
    }
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
    if (id === "stop_moving") {
      this.deps.control.halt();
      return;
    }
    const direction = MOVE_DIRECTION_BY_ID[id];
    if (direction) {
      this.deps.control.move(direction, MOVE_LEASE_MS);
      return;
    }
    this.executeTargeted(id, context);
  }

  private executeTargeted(id: string, context: TacticsContext): void {
    const state = this.deps.combat.snapshot(context.targetGuid);
    if (id === "face_target") {
      const from = state.self.pose;
      const to = state.target?.pose;
      if (!(from && to)) throw new Error("face_target_pose_unobserved");
      this.deps.control.face(bearing(from, to));
      return;
    }
    const action = state.learned
      .map((spellId) => this.spellAction(spellId, context, state))
      .find((entry) => entry.id === id && !entry.reason);
    if (!action?.spell) throw new Error("action_no_longer_legal");
    if (this.deps.control.snapshot().moving && requiresStanding(action.spell))
      this.deps.control.halt();
    this.deps.combat.cast(action.spell.id, action.target);
  }

  private addCandidates(
    candidates: JevCandidate[],
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
    if (this.deps.control.snapshot().movementAllowed) {
      for (const move of MOVE_CANDIDATES)
        candidates.push({ id: move.id, description: move.description });
      candidates.push(STOP_MOVING);
    }
    for (const action of spells)
      if (action.spell && !action.reason)
        candidates.push({
          id: action.id,
          description: describeSpell(
            action.spell,
            action.target === state.self.guid,
          ),
        });
    this.addEngageCandidates(candidates, state);
  }

  private addEngageCandidates(
    candidates: JevCandidate[],
    state: CombatState,
  ): void {
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
      (!facing(state) || this.rejections.facingRejected()) &&
      this.deps.control.snapshot().movementAllowed
    )
      candidates.push({
        id: "face_target",
        description: this.rejections.facingRejected()
          ? "Turn to face the selected creature; the server rejected the last action because it was not in front"
          : "Turn to face the selected creature at its current observed or predicted position",
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
      (hostile && spell.range?.flags !== 0 ? "unsupported_range" : undefined);
    const reason = unsupported ?? this.spellReason(spell, state, hostile);
    return { id: actionId, spell, target, reason, supported: !unsupported };
  }

  private spellReason(
    spell: SpellDefinition,
    state: CombatState,
    hostile: boolean,
  ): string | undefined {
    if (this.deps.combat.readyAt(spell.id) > this.deps.now()) return "cooldown";
    const reason =
      manaReason(spell, state) ?? auraReason(spell, state, hostile);
    if (reason) return reason;
    const target = hostile ? state.target : state.self;
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
    const range = spell.range;
    if (range === undefined)
      throw new Error("hostile spell is missing range metadata");
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
    const observed = this.observedOutcome(context, state);
    if (observed) return observed;
    const now = this.deps.now();
    const timedOut = timeoutOutcome(state, now);
    if (timedOut) return timedOut;
    if (state.target?.health === 0) {
      this.deadAt ??= now;
      if (now - this.deadAt > 5000)
        return {
          status: "blocked",
          reason: "target_dead_without_server_credit",
        };
      return undefined;
    }
    const reason = targetReason(this.deps, context.targetGuid, state);
    if (reason) return { status: "blocked", reason };
    const control = this.deps.control.snapshot();
    if (
      control.blockedReason &&
      !["rooted", "disable_move"].includes(control.blockedReason)
    )
      return { status: "blocked", reason: control.blockedReason };
    return (
      this.reachOutcome(context, state, spells, now) ??
      this.progress.observe(state, now)
    );
  }

  private observedOutcome(
    context: TacticsContext,
    state: CombatState,
  ): TacticsFrame["outcome"] {
    if (
      state.lastXp?.kind === "kill" &&
      state.lastXp.victim === context.targetGuid &&
      state.lastXp.at >= this.startedAt
    )
      return { status: "completed", reason: "server_kill_credit" };
    if (state.self.health === 0)
      return { status: "failed", reason: "self_dead" };
    this.rejections.track(state.lastOutcome);
    return this.rejections.outcome();
  }

  private reachOutcome(
    context: TacticsContext,
    state: CombatState,
    spells: readonly SpellAction[],
    now: number,
  ): TacticsFrame["outcome"] {
    if (
      !(
        state.pendingCast ||
        state.casting ||
        state.pendingAttack ||
        state.attacking ||
        this.inMelee(state) ||
        spells.some((action) => action.supported)
      )
    )
      return { status: "blocked", reason: "no_supported_combat_actions" };
    if (this.targetReachable(context, state, spells)) {
      this.unreachable = undefined;
      return undefined;
    }
    const range = separation(state);
    const last = this.unreachable;
    if (!last || approached(range, last.range)) {
      this.unreachable = { at: now, range };
      return undefined;
    }
    last.range ??= range;
    if (now - last.at >= UNREACHABLE_TIMEOUT_MS)
      return { status: "blocked", reason: "target_unreachable" };
    return undefined;
  }

  private targetReachable(
    context: TacticsContext,
    state: CombatState,
    spells: readonly SpellAction[],
  ): boolean {
    if (
      state.pendingCast ||
      state.casting ||
      state.pendingAttack ||
      state.attacking ||
      this.inMelee(state)
    )
      return true;
    const distance = separation(state);
    for (const action of spells) {
      if (
        action.target !== context.targetGuid ||
        !action.supported ||
        !action.spell
      )
        continue;
      if (!action.reason || action.reason === "not_facing") return true;
      const range = action.spell.range;
      if (
        range &&
        distance !== undefined &&
        distance >= range.minHostile &&
        distance <= range.maxHostile &&
        [
          "cooldown",
          "insufficient_mana",
          "aura_already_present",
          "caster_aura_required",
          "target_aura_required",
        ].includes(action.reason)
      )
        return true;
    }
    return false;
  }

  private inMelee(state: CombatState): boolean {
    const self = this.deps.entity(state.self.guid);
    const target = state.target && this.deps.entity(state.target.guid);
    const a = isUnit(self) ? self.combatReach : undefined;
    const b = isUnit(target) ? target.combatReach : undefined;
    const distance = separation(state);
    if (a === undefined || b === undefined || distance === undefined)
      return false;
    return distance <= Math.max(5, a + b + 4 / 3);
  }
}
