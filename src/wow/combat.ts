import { GameOpcode } from "wow/protocol/opcodes";
import {
  buildAttackSwing,
  type AttackStart,
  type AttackSwingError,
  type AttackStop,
  type XpGain,
} from "wow/protocol/combat";
import type { AuraUpdate, AuraUpdateAll } from "wow/protocol/aura";
import { AuraStore, type CombatAura } from "wow/aura-store";
import { CooldownStore, type CombatCooldown } from "wow/cooldown-store";
import {
  MotionStore,
  type CombatPose,
  type UnitMotion,
} from "wow/motion-store";
import {
  buildCancelCast,
  buildCastSpell,
  SpellCastResult,
  type CastFailed,
  type CooldownNotice,
  type InitialSpells,
  type LearnedSpell,
  type RemovedSpell,
  type SpellCooldown,
  type SpellDelayed,
  type SpellFailure,
  type SpellGo,
  type SpellStart,
  type SupersededSpell,
} from "wow/protocol/spell";
import type { CreateSpline, MonsterMove } from "wow/protocol/monster-move";
import type { SpellCatalog, SpellDefinition } from "wow/spell-catalog";
import type { ControlPose } from "wow/control";
import { UNIT_FIELDS } from "wow/protocol/entity-fields";
import {
  fieldOf,
  isUnit,
  type EntityLookup,
  type Position,
} from "wow/entity-store";

export type CombatCast = {
  spellId: number;
  target: bigint | undefined;
  startedAt: number;
  durationMs: number;
  source: "server" | "pending";
  count: number;
  cancelRequested?: boolean;
};

export type CombatOutcome = {
  kind: "cast" | "attack" | "cancel";
  status: "sent" | "started" | "succeeded" | "failed" | "interrupted";
  spellId?: number;
  target?: bigint;
  result?: number;
  error?: AttackSwingError;
  at: number;
  hits?: bigint[];
  misses?: { guid: bigint; reason: number; reflect?: number }[];
};

export type CombatXp = {
  victim: bigint;
  total: number;
  kind: "kill" | "other";
  at: number;
};

export type CombatUnit = {
  guid: bigint;
  name: string | undefined;
  health: number | undefined;
  maxHealth: number | undefined;
  power: number | undefined;
  maxPower: number | undefined;
  powerType: number | undefined;
  baseMana: number | undefined;
  level: number | undefined;
  shapeshiftForm?: number;
  pose: CombatPose | undefined;
  serverPose: CombatPose | undefined;
  motion: UnitMotion | undefined;
};

export type CombatState = {
  self: CombatUnit;
  target: CombatUnit | undefined;
  selectedGuid: bigint | undefined;
  attacking: boolean;
  pendingAttack: bigint | undefined;
  attackTarget: bigint | undefined;
  casting: CombatCast | undefined;
  pendingCast: CombatCast | undefined;
  learned: number[];
  unknownLearned: number[];
  cooldowns: CombatCooldown[];
  auras: CombatAura[];
  targetAuras: CombatAura[];
  lastOutcome: CombatOutcome | undefined;
  lastXp: CombatXp | undefined;
};

export type CombatEventType =
  | "spellbook"
  | "cast_sent"
  | "cast_started"
  | "cast_succeeded"
  | "cast_failed"
  | "cast_interrupted"
  | "attack_started"
  | "attack_stopped"
  | "aura"
  | "xp"
  | "learned"
  | "outcome";

export type CombatEvent = {
  type: CombatEventType;
  state: CombatState;
  reason?: string;
};

export type CombatDeps = {
  send: (opcode: number, body?: Uint8Array) => void;
  now: () => number;
  selfGuid: () => bigint;
  selectedGuid: () => bigint | undefined;
  getEntity: EntityLookup;
  selfPose: () => ControlPose | undefined;
  selfServerPose?: () => ControlPose | undefined;
  catalog?: SpellCatalog;
};

export class CombatRuntime {
  private readonly deps: CombatDeps;
  private listener: ((event: CombatEvent) => void) | undefined;
  private readonly incomingAttackers = new Set<bigint>();
  private readonly learned = new Set<number>();
  private readonly cooldowns: CooldownStore;
  private readonly auras: AuraStore;
  private readonly motions: MotionStore;
  private pendingAttack: bigint | undefined;
  private castCount = 1;
  private pending: CombatCast | undefined;
  private casting: CombatCast | undefined;
  private lastCast: CombatCast | undefined;
  private attacking = false;
  private attackTarget: bigint | undefined;
  private lastOutcome: CombatOutcome | undefined;
  private lastXp: CombatXp | undefined;

  constructor(deps: CombatDeps) {
    this.deps = deps;
    this.cooldowns = new CooldownStore(
      deps.now,
      (id) => this.definition(id)?.cooldown,
    );
    this.auras = new AuraStore(deps.now);
    this.motions = new MotionStore(deps.now);
  }

  onEvent(cb: ((event: CombatEvent) => void) | undefined): void {
    this.listener = cb;
  }

  isAttackingSelf(guid: bigint): boolean {
    if (!this.incomingAttackers.has(guid)) return false;
    const entity = this.deps.getEntity(guid);
    return !(isUnit(entity) && entity.health === 0);
  }

  snapshot(selected = this.deps.selectedGuid()): CombatState {
    const selfGuid = this.deps.selfGuid();
    return {
      self: this.unitOf(selfGuid, this.deps.selfPose()),
      target: selected
        ? this.unitOf(selected, this.motions.pose(selected))
        : undefined,
      selectedGuid: selected,
      attacking: this.attacking,
      pendingAttack: this.pendingAttack,
      attackTarget: this.attackTarget,
      casting: this.casting ? { ...this.casting } : undefined,
      pendingCast: this.pending ? { ...this.pending } : undefined,
      learned: [...this.learned],
      unknownLearned: [...this.learned].filter(
        (id) => !this.deps.catalog?.get(id),
      ),
      cooldowns: this.cooldowns.list(this.learned),
      auras: this.auras.forUnit(selfGuid),
      targetAuras: selected ? this.auras.forUnit(selected) : [],
      lastOutcome: this.lastOutcome,
      lastXp: this.lastXp,
    };
  }

  unit(guid: bigint): CombatUnit | undefined {
    const entity = this.deps.getEntity(guid);
    if (!isUnit(entity)) return undefined;
    const pose =
      guid === this.deps.selfGuid()
        ? this.deps.selfPose()
        : this.motions.pose(guid);
    return this.unitOf(guid, pose, entity);
  }

  setCatalog(catalog: SpellCatalog): void {
    this.deps.catalog = catalog;
  }

  definition(id: number): SpellDefinition | undefined {
    return this.deps.catalog?.get(id);
  }

  readyAt(id: number): number {
    return this.cooldowns.readyAt(id);
  }

  async spellbook(): Promise<SpellDefinition[]> {
    const catalog = this.deps.catalog;
    if (!catalog) throw new Error("missing_spell_data");
    const defs: SpellDefinition[] = [];
    for (const id of this.learned) {
      const def = catalog.get(id);
      if (def) defs.push(def);
    }
    return defs;
  }

  cast(spellId: number, targetGuid: bigint): void {
    if (!Number.isInteger(spellId) || spellId <= 0 || spellId > 0xffffffff)
      throw new Error("invalid_spell");
    if (targetGuid < 0n || targetGuid > 0xffffffffffffffffn)
      throw new Error("invalid_guid");
    if (this.pending || this.casting) throw new Error("cast_in_progress");
    if (!this.learned.has(spellId)) throw new Error("unknown_spell");
    const count = this.castCount;
    this.castCount = (this.castCount + 1) & 0xff || 1;
    this.deps.send(
      GameOpcode.CMSG_CAST_SPELL,
      buildCastSpell(count, spellId, targetGuid),
    );
    this.pending = {
      spellId,
      target: targetGuid === 0n ? undefined : targetGuid,
      startedAt: this.deps.now(),
      durationMs: 0,
      source: "pending",
      count,
    };
    this.lastCast = this.pending;
    this.lastOutcome = {
      kind: "cast",
      status: "sent",
      spellId,
      target: this.pending.target,
      at: this.deps.now(),
    };
    this.emit("cast_sent");
  }

  attack(targetGuid: bigint): void {
    if (targetGuid <= 0n || targetGuid > 0xffffffffffffffffn)
      throw new Error("invalid_guid");
    this.deps.send(GameOpcode.CMSG_ATTACKSWING, buildAttackSwing(targetGuid));
    this.pendingAttack = targetGuid;
    this.lastOutcome = {
      kind: "attack",
      status: "sent",
      target: targetGuid,
      at: this.deps.now(),
    };
    this.emit("outcome");
  }

  cancelCast(): void {
    const spellId = this.casting?.spellId ?? this.pending?.spellId;
    if (spellId === undefined) throw new Error("not_casting");
    this.deps.send(GameOpcode.CMSG_CANCEL_CAST, buildCancelCast(spellId));
    if (this.casting) this.casting.cancelRequested = true;
    if (this.pending) this.pending.cancelRequested = true;
    this.lastOutcome = {
      kind: "cancel",
      status: "sent",
      spellId,
      at: this.deps.now(),
    };
    this.emit("outcome");
  }

  stopAttack(): void {
    this.deps.send(GameOpcode.CMSG_ATTACKSTOP);
    this.pendingAttack = undefined;
    this.lastOutcome = { kind: "attack", status: "sent", at: this.deps.now() };
    this.emit("outcome");
  }

  halt(): void {
    if (
      (this.casting && !this.casting.cancelRequested) ||
      (this.pending && !this.pending.cancelRequested)
    )
      this.cancelCast();
    if (this.attacking || this.pendingAttack !== undefined) this.stopAttack();
  }

  dispose(): void {
    this.listener = undefined;
    this.incomingAttackers.clear();
    this.motions.clear();
    this.auras.clear();
    this.learned.clear();
    this.cooldowns.clear();
    this.pending = undefined;
    this.casting = undefined;
    this.lastCast = undefined;
    this.pendingAttack = undefined;
    this.attacking = false;
    this.attackTarget = undefined;
  }

  forget(guid: bigint): void {
    this.incomingAttackers.delete(guid);
    this.motions.forget(guid);
    this.auras.forget(guid);
  }

  observePosition(
    guid: bigint,
    position: Position,
    spline?: CreateSpline,
  ): void {
    this.motions.observe(guid, position, spline);
  }

  applyInitialSpells(packet: InitialSpells): void {
    this.learned.clear();
    for (const spell of packet.spells) this.learned.add(spell.spellId);
    this.cooldowns.reset(packet.cooldowns);
    this.emit("spellbook");
  }

  applyLearned({ spellId }: LearnedSpell): void {
    this.learned.add(spellId);
    this.emit("learned");
  }

  applyRemoved({ spellId }: RemovedSpell): void {
    this.learned.delete(spellId);
    this.emit("learned");
  }

  applySuperseded({ superseded, learned }: SupersededSpell): void {
    this.learned.delete(superseded);
    this.learned.add(learned);
    this.emit("learned");
  }

  applySpellStart(packet: SpellStart): void {
    if (packet.caster !== this.deps.selfGuid()) return;
    const matching =
      this.pending?.spellId === packet.spellId &&
      this.pending.count === packet.castCount;
    const cancelRequested = matching
      ? this.pending?.cancelRequested
      : undefined;
    if (this.pending && !matching) return;
    this.pending = undefined;
    this.casting = {
      cancelRequested,
      spellId: packet.spellId,
      target: packet.targets.objectGuid,
      startedAt: this.deps.now(),
      durationMs: packet.timer,
      source: "server",
      count: packet.castCount,
    };
    this.lastCast = this.casting;
    this.cooldowns.beginGlobal(packet.spellId);
    this.lastOutcome = {
      kind: "cast",
      status: "started",
      spellId: packet.spellId,
      target: packet.targets.objectGuid,
      at: this.deps.now(),
    };
    this.emit("cast_started");
  }

  applySpellGo(packet: SpellGo): void {
    if (packet.caster !== this.deps.selfGuid()) return;
    const hadStart =
      this.casting?.spellId === packet.spellId &&
      this.casting.count === packet.extraCasts;
    if (
      this.pending?.spellId === packet.spellId &&
      this.pending.count === packet.extraCasts
    )
      this.pending = undefined;
    if (hadStart) this.casting = undefined;
    if (!hadStart) this.cooldowns.beginGlobal(packet.spellId);
    this.cooldowns.predict(packet.spellId);
    this.lastOutcome = {
      kind: "cast",
      hits: packet.hits,
      misses: packet.misses,
      status: "succeeded",
      spellId: packet.spellId,
      target: packet.targets.objectGuid,
      at: this.deps.now(),
    };
    this.emit("cast_succeeded");
  }

  applyCastFailed(packet: CastFailed): void {
    this.recordCastFailure(
      packet.spellId,
      packet.castCount,
      packet.result,
      "failed",
    );
  }

  applySpellFailure(packet: SpellFailure): void {
    if (packet.caster !== this.deps.selfGuid()) return;
    this.recordCastFailure(
      packet.spellId,
      packet.extraCasts,
      packet.result,
      "interrupted",
    );
  }

  private recordCastFailure(
    spellId: number,
    count: number,
    result: number,
    status: "failed" | "interrupted",
  ): void {
    const cast = this.lastCast;
    if (cast?.spellId !== spellId || cast.count !== count) return;
    if (this.pending === cast) this.pending = undefined;
    if (this.casting === cast) this.casting = undefined;
    this.lastOutcome = {
      kind:
        cast.cancelRequested && result === SpellCastResult.INTERRUPTED
          ? "cancel"
          : "cast",
      status,
      spellId,
      result,
      at: this.deps.now(),
    };
    if (status === "interrupted")
      this.emit("cast_interrupted", `spell_failure:${result}`);
    else this.emit("cast_failed", `cast_failed:${result}`);
  }

  applyCooldown(packet: SpellCooldown): void {
    if (packet.guid !== this.deps.selfGuid()) return;
    for (const cd of packet.cooldowns)
      this.cooldowns.observe(cd.spellId, cd.time);
  }

  applyClearCooldown({ spellId, guid }: CooldownNotice): void {
    if (guid !== this.deps.selfGuid()) return;
    this.cooldowns.release(spellId);
    this.emit("outcome", "cooldown_cleared");
  }

  applyCooldownEvent({ spellId, guid }: CooldownNotice): void {
    if (guid !== this.deps.selfGuid()) return;
    this.cooldowns.predict(spellId);
    this.emit("outcome", "cooldown_event");
  }

  applySpellDelayed({ caster, delayMs }: SpellDelayed): void {
    if (caster !== this.deps.selfGuid() || !this.casting) return;
    this.casting.durationMs += delayMs;
    this.emit("cast_started", "cast_delayed");
  }

  applyAttackError(error: AttackSwingError): void {
    this.lastOutcome = {
      kind: "attack",
      status: "failed",
      target: this.attackTarget ?? this.pendingAttack,
      error,
      at: this.deps.now(),
    };
    this.pendingAttack = undefined;
    this.emit("outcome", `attack_failed:${error}`);
  }

  applyCancelCombat(): void {
    this.pendingAttack = undefined;
    this.attacking = false;
    this.attackTarget = undefined;
    this.lastOutcome = {
      kind: "attack",
      status: "interrupted",
      at: this.deps.now(),
    };
    this.emit("attack_stopped");
  }

  applyAttackStart(packet: AttackStart): void {
    if (packet.attacker === this.deps.selfGuid()) {
      this.pendingAttack = undefined;
      this.attacking = true;
      this.attackTarget = packet.victim;
      this.lastOutcome = {
        kind: "attack",
        status: "started",
        target: packet.victim,
        at: this.deps.now(),
      };
      this.emit("attack_started");
    } else if (packet.victim === this.deps.selfGuid()) {
      this.incomingAttackers.add(packet.attacker);
    }
  }

  applyAttackStop(packet: AttackStop): void {
    if (packet.attacker === this.deps.selfGuid()) {
      this.pendingAttack = undefined;
      this.attacking = false;
      this.attackTarget = undefined;
      this.lastOutcome = {
        kind: "attack",
        status: packet.dead ? "succeeded" : "interrupted",
        target: packet.victim,
        at: this.deps.now(),
      };
      this.emit("attack_stopped");
    } else if (this.incomingAttackers.has(packet.attacker)) {
      this.incomingAttackers.delete(packet.attacker);
    }
  }

  applyAura(update: AuraUpdate): void {
    this.auras.apply(update);
    this.emit("aura");
  }

  applyAuraAll(update: AuraUpdateAll): void {
    this.auras.replace(update);
    this.emit("aura");
  }

  applyXp(packet: XpGain): void {
    this.lastXp = {
      victim: packet.victim,
      total: packet.total,
      kind: packet.kind,
      at: this.deps.now(),
    };
    this.emit("xp");
  }

  applyMonsterMove(packet: MonsterMove, mapId: number): void {
    this.motions.monsterMove(packet, mapId);
  }

  private unitOf(
    guid: bigint,
    pose: CombatPose | undefined,
    entity = this.deps.getEntity(guid),
  ): CombatUnit {
    const unit = isUnit(entity) ? entity : undefined;
    const bytes = fieldOf(unit, UNIT_FIELDS.BYTES_0.offset);
    const powerType = bytes === undefined ? undefined : bytes >>> 24;
    const formBytes = fieldOf(unit, UNIT_FIELDS.BYTES_2.offset);
    return {
      guid,
      name: entity?.name,
      health: fieldOf(unit, UNIT_FIELDS.HEALTH.offset),
      maxHealth: fieldOf(unit, UNIT_FIELDS.MAXHEALTH.offset),
      power:
        powerType === undefined || powerType > 6
          ? undefined
          : fieldOf(unit, UNIT_FIELDS.POWER1.offset + powerType),
      maxPower:
        powerType === undefined || powerType > 6
          ? undefined
          : fieldOf(unit, UNIT_FIELDS.MAXPOWER1.offset + powerType),
      powerType,
      baseMana: fieldOf(unit, UNIT_FIELDS.BASE_MANA.offset),
      shapeshiftForm: formBytes === undefined ? undefined : formBytes >>> 24,
      level: fieldOf(unit, UNIT_FIELDS.LEVEL.offset),
      pose,
      motion: this.motions.motion(guid),
      serverPose: this.serverPoseOf(guid, pose),
    };
  }

  private serverPoseOf(
    guid: bigint,
    pose: CombatPose | undefined,
  ): CombatPose | undefined {
    if (guid === this.deps.selfGuid()) {
      const self = this.deps.selfServerPose?.();
      if (self) return { ...self };
      return pose?.source === "server" ? { ...pose } : undefined;
    }
    return this.motions.serverPose(guid);
  }

  private emit(type: CombatEventType, reason?: string): void {
    const event: CombatEvent = { type, state: this.snapshot() };
    if (reason !== undefined) event.reason = reason;
    this.listener?.(event);
  }
}
