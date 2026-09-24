import { GameOpcode } from "wow/protocol/opcodes";
import type { PacketReader } from "wow/protocol/packet";
import {
  buildAttackSwing,
  buildCancelCast,
  buildCastSpell,
  parseAttackStart,
  parseAttackStop,
  parseAuraUpdate,
  parseAuraUpdateAll,
  parseSpellDelayed,
  parseCastFailed,
  parseInitialSpells,
  parseLearnedSpell,
  parseRemovedSpell,
  parseSpellCooldown,
  parseSpellFailure,
  parseSpellGo,
  parseSpellStart,
  parseSupersededSpell,
  parseXpGain,
  type AuraUpdate,
} from "wow/protocol/combat";
import {
  parseMonsterMove,
  sampleSplinePosition,
  type SplineTrajectory,
  type CreateSpline,
} from "wow/protocol/monster-move";
import type { SpellCatalog, SpellDefinition } from "wow/spell-catalog";
import type { ControlPose } from "wow/control";
import { ObjectType, UNIT_FIELDS } from "wow/protocol/entity-fields";
import type { Entity, UnitEntity, Position } from "wow/entity-store";

export type CombatCast = {
  spellId: number;
  target: bigint | undefined;
  startedAt: number;
  durationMs: number;
  source: "server" | "pending";
  count: number;
  cancelRequested?: boolean;
};

export type CombatCooldown = {
  spellId: number;
  remainingMs: number;
  until: number;
  source: "server" | "predicted";
};

export type CombatAura = {
  slot: number;
  spellId: number;
  caster: bigint | undefined;
  stacks: number;
  duration: number | undefined;
  timeLeft: number | undefined;
  flags: number;
  level: number;
};

export type CombatOutcome = {
  kind: "cast" | "attack" | "cancel";
  status: "sent" | "started" | "succeeded" | "failed" | "interrupted";
  spellId?: number;
  target?: bigint;
  result?: number;
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

export type CombatPose = Omit<ControlPose, "orientation"> & {
  orientation: number | undefined;
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
  motion:
    | {
        kind: "spline" | "stationary";
        observedAt: number;
        unsupportedReason?: string;
      }
    | undefined;
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
  getEntity: (guid: bigint) => Entity | undefined;
  selfPose: () => ControlPose | undefined;
  selfServerPose?: () => ControlPose | undefined;
  catalog?: SpellCatalog;
};

type TrackedAura = CombatAura & { unit: bigint; receivedAt: number };

const SPELL_FAILED_INTERRUPTED = 40;

export class CombatRuntime {
  private readonly deps: CombatDeps;
  private listener: ((event: CombatEvent) => void) | undefined;
  private readonly incomingAttackers = new Set<bigint>();
  private readonly learned = new Set<number>();
  private readonly cooldowns = new Map<
    number,
    { until: number; source: "server" | "predicted" }
  >();
  private readonly categories = new Map<
    number,
    { until: number; source: "server" | "predicted" }
  >();
  private globalUntil = 0;
  private pendingAttack: bigint | undefined;
  private readonly auras = new Map<string, TrackedAura>();
  private readonly motions = new Map<
    bigint,
    {
      observed: CombatPose;
      trajectory?: SplineTrajectory;
      startedAt: number;
      unsupportedReason?: string;
    }
  >();
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
  }

  onEvent(cb: ((event: CombatEvent) => void) | undefined): void {
    this.listener = cb;
  }

  isAttackingSelf(guid: bigint): boolean {
    if (!this.incomingAttackers.has(guid)) return false;
    const entity = this.deps.getEntity(guid);
    if (entity && "health" in entity && entity.health === 0) {
      this.incomingAttackers.delete(guid);
      return false;
    }
    return true;
  }

  snapshot(selected = this.deps.selectedGuid()): CombatState {
    const selfGuid = this.deps.selfGuid();
    const now = this.deps.now();
    return {
      self: this.unitOf(selfGuid, this.deps.selfPose()),
      target: selected
        ? this.unitOf(selected, this.poseOf(selected))
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
      cooldowns: this.cooldownList(now),
      auras: this.aurasFor(selfGuid),
      targetAuras: selected ? this.aurasFor(selected) : [],
      lastOutcome: this.lastOutcome,
      lastXp: this.lastXp,
    };
  }

  unit(guid: bigint): CombatUnit | undefined {
    const entity = this.deps.getEntity(guid);
    if (!isUnit(entity)) return undefined;
    const pose =
      guid === this.deps.selfGuid() ? this.deps.selfPose() : this.poseOf(guid);
    return this.unitOf(guid, pose, entity);
  }

  setCatalog(catalog: SpellCatalog): void {
    this.deps.catalog = catalog;
  }

  definition(id: number): SpellDefinition | undefined {
    return this.deps.catalog?.get(id);
  }

  readyAt(id: number): number {
    const category = this.definition(id)?.cooldown.category;
    return Math.max(
      this.globalUntil,
      this.cooldowns.get(id)?.until ?? 0,
      category ? (this.categories.get(category)?.until ?? 0) : 0,
    );
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
    this.categories.clear();
    this.pending = undefined;
    this.casting = undefined;
    this.lastCast = undefined;
    this.pendingAttack = undefined;
    this.attacking = false;
    this.attackTarget = undefined;
  }

  forget(guid: bigint): void {
    this.incomingAttackers.delete(guid);
    this.motions.delete(guid);
    for (const [key, aura] of this.auras)
      if (aura.unit === guid) this.auras.delete(key);
  }

  observePosition(
    guid: bigint,
    position: Position,
    spline?: CreateSpline,
  ): void {
    const now = this.deps.now();
    const cyclic = spline ? (spline.flags & 0x00080000) !== 0 : false;
    const first = spline?.points[0];
    const second = spline?.points[1];
    const trajectory: SplineTrajectory | undefined = spline
      ? {
          points: spline.points.slice(1, cyclic ? -2 : -1),
          duration: spline.duration,
          flags: spline.flags,
          cyclic,
          interpolation: spline.mode === 1 ? "catmullrom" : "linear",
          orientation:
            first && second
              ? Math.atan2(second.y - first.y, second.x - first.x)
              : position.orientation,
        }
      : undefined;
    this.motions.set(guid, {
      observed: { ...position, source: "server", updatedAt: now },
      trajectory,
      startedAt: now - (spline?.elapsed ?? 0),
      unsupportedReason:
        spline && spline.mode !== 0 && spline.mode !== 1
          ? "unsupported_spline_mode"
          : undefined,
    });
    this.checkMotion(guid);
  }

  applyInitialSpells(r: PacketReader): void {
    const packet = parseInitialSpells(r);
    this.learned.clear();
    for (const spell of packet.spells) this.learned.add(spell.spellId);
    const now = this.deps.now();
    this.cooldowns.clear();
    this.categories.clear();
    for (const cd of packet.cooldowns) {
      if (cd.cooldown > 0)
        this.cooldowns.set(cd.spellId, {
          until: now + cd.cooldown,
          source: "server",
        });
      if (cd.categoryCooldown > 0)
        this.categories.set(cd.category, {
          until: now + cd.categoryCooldown,
          source: "server",
        });
    }
    this.emit("spellbook");
  }

  applyLearned(r: PacketReader): void {
    const packet = parseLearnedSpell(r);
    this.learned.add(packet.spellId);
    this.emit("learned");
  }

  applyRemoved(r: PacketReader): void {
    const packet = parseRemovedSpell(r);
    this.learned.delete(packet.spellId);
    this.emit("learned");
  }

  applySuperseded(r: PacketReader): void {
    const packet = parseSupersededSpell(r);
    this.learned.delete(packet.superseded);
    this.learned.add(packet.learned);
    this.emit("learned");
  }

  applySpellStart(r: PacketReader): void {
    const packet = parseSpellStart(r);
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
    this.beginGlobalCooldown(packet.spellId);
    this.lastOutcome = {
      kind: "cast",
      status: "started",
      spellId: packet.spellId,
      target: packet.targets.objectGuid,
      at: this.deps.now(),
    };
    this.emit("cast_started");
  }

  applySpellGo(r: PacketReader): void {
    const packet = parseSpellGo(r);
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
    if (!hadStart) this.beginGlobalCooldown(packet.spellId);
    const cd = this.definition(packet.spellId)?.cooldown;
    if (cd?.recoveryTimeMs)
      this.cooldowns.set(packet.spellId, {
        until: this.deps.now() + cd.recoveryTimeMs,
        source: "predicted",
      });
    if (cd?.categoryRecoveryTimeMs)
      this.categories.set(cd.category, {
        until: this.deps.now() + cd.categoryRecoveryTimeMs,
        source: "predicted",
      });
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

  applyCastFailed(r: PacketReader): void {
    const packet = parseCastFailed(r);
    this.recordCastFailure(
      packet.spellId,
      packet.castCount,
      packet.result,
      "failed",
    );
  }

  applySpellFailure(r: PacketReader): void {
    const packet = parseSpellFailure(r);
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
        cast.cancelRequested && result === SPELL_FAILED_INTERRUPTED
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

  applyCooldown(r: PacketReader): void {
    const packet = parseSpellCooldown(r);
    if (packet.guid !== this.deps.selfGuid()) return;
    const now = this.deps.now();
    for (const cd of packet.cooldowns)
      this.cooldowns.set(cd.spellId, {
        until: now + cd.time,
        source: "server",
      });
  }

  applyClearCooldown(r: PacketReader): void {
    const id = r.uint32LE();
    if (r.uint64LE() !== this.deps.selfGuid()) return;
    this.cooldowns.delete(id);
    const category = this.definition(id)?.cooldown.category;
    if (category) this.categories.delete(category);
    this.emit("outcome", "cooldown_cleared");
  }

  applyCooldownEvent(r: PacketReader): void {
    const id = r.uint32LE();
    if (r.uint64LE() !== this.deps.selfGuid()) return;
    const cd = this.definition(id)?.cooldown;
    if (cd?.recoveryTimeMs)
      this.cooldowns.set(id, {
        until: this.deps.now() + cd.recoveryTimeMs,
        source: "predicted",
      });
    if (cd?.categoryRecoveryTimeMs)
      this.categories.set(cd.category, {
        until: this.deps.now() + cd.categoryRecoveryTimeMs,
        source: "predicted",
      });
    this.emit("outcome", "cooldown_event");
  }

  applySpellDelayed(r: PacketReader): void {
    const { caster, delayMs } = parseSpellDelayed(r);
    if (caster !== this.deps.selfGuid() || !this.casting) return;
    this.casting.durationMs += delayMs;
    this.emit("cast_started", "cast_delayed");
  }

  applyAttackError(result: number): void {
    this.lastOutcome = {
      kind: "attack",
      status: "failed",
      target: this.attackTarget ?? this.pendingAttack,
      result,
      at: this.deps.now(),
    };
    this.pendingAttack = undefined;
    this.emit("outcome", `attack_failed:${result}`);
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

  applyAttackStart(r: PacketReader): void {
    const packet = parseAttackStart(r);
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

  applyAttackStop(r: PacketReader): void {
    const packet = parseAttackStop(r);
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

  applyAura(r: PacketReader): void {
    this.storeAura(parseAuraUpdate(r));
    this.emit("aura");
  }

  applyAuraAll(r: PacketReader): void {
    const { unit, auras } = parseAuraUpdateAll(r);
    for (const [key, aura] of this.auras)
      if (aura.unit === unit) this.auras.delete(key);
    for (const aura of auras) this.storeAura(aura);
    this.emit("aura");
  }

  applyXp(r: PacketReader): void {
    const packet = parseXpGain(r);
    this.lastXp = {
      victim: packet.victim,
      total: packet.total,
      kind: packet.kind,
      at: this.deps.now(),
    };
    this.emit("xp");
  }

  applyMonsterMove(r: PacketReader, mapId: number): void {
    const packet = parseMonsterMove(r);
    const now = this.deps.now();
    const observed: CombatPose = {
      mapId,
      x: packet.start.x,
      y: packet.start.y,
      z: packet.start.z,
      orientation: undefined,
      source: "server",
      updatedAt: now,
    };
    if (packet.kind === "stop") {
      this.motions.set(packet.guid, { observed, startedAt: now });
      return;
    }
    this.motions.set(packet.guid, {
      observed,
      trajectory: {
        points: packet.points,
        duration: packet.duration,
        interpolation: packet.interpolation,
        cyclic: packet.cyclic,
        flags: packet.flags,
        orientation: observed.orientation,
      },
      startedAt: now,
      unsupportedReason:
        packet.interpolation === "catmullrom" && !packet.cyclic
          ? "unknown_launch_orientation"
          : undefined,
    });
    this.checkMotion(packet.guid);
  }

  private storeAura(update: AuraUpdate): void {
    const key = `${update.unit}:${update.slot}`;
    if (update.removed) {
      this.auras.delete(key);
      return;
    }
    this.auras.set(key, {
      unit: update.unit,
      receivedAt: this.deps.now(),
      slot: update.slot,
      spellId: update.spellId,
      caster:
        update.caster ??
        ((update.flags & 0x08) !== 0 ? update.unit : undefined),
      stacks: update.stacks,
      duration: update.duration,
      timeLeft: update.timeLeft,
      flags: update.flags,
      level: update.level,
    });
  }

  private aurasFor(guid: bigint): CombatAura[] {
    const list: CombatAura[] = [];
    for (const aura of this.auras.values()) {
      if (aura.unit !== guid) continue;
      const timeLeft =
        aura.timeLeft === undefined
          ? undefined
          : Math.max(0, aura.timeLeft - (this.deps.now() - aura.receivedAt));
      if (timeLeft === 0) continue;
      const { unit: _unit, receivedAt: _receivedAt, ...value } = aura;
      list.push({ ...value, timeLeft });
    }
    return list;
  }

  private cooldownList(now: number): CombatCooldown[] {
    const list: CombatCooldown[] = [];
    for (const spellId of this.learned) this.appendCooldown(list, spellId, now);
    for (const spellId of this.cooldowns.keys())
      if (!this.learned.has(spellId)) this.appendCooldown(list, spellId, now);
    return list;
  }

  private appendCooldown(
    list: CombatCooldown[],
    spellId: number,
    now: number,
  ): void {
    const cd = this.cooldowns.get(spellId);
    const categoryId = this.definition(spellId)?.cooldown.category;
    const category = categoryId ? this.categories.get(categoryId) : undefined;
    let until = this.globalUntil;
    let source: CombatCooldown["source"] = "predicted";
    if (cd && cd.until >= until) {
      until = cd.until;
      source = cd.source;
    }
    if (category && category.until >= until) {
      until = category.until;
      source = category.source;
    }
    if (until > now)
      list.push({ spellId, until, remainingMs: until - now, source });
  }

  private unitOf(
    guid: bigint,
    pose: CombatPose | undefined,
    entity = this.deps.getEntity(guid),
  ): CombatUnit {
    const unit = isUnit(entity) ? entity : undefined;
    const bytes = observedPublicField(unit, UNIT_FIELDS.BYTES_0.offset);
    const powerType = bytes === undefined ? undefined : bytes >>> 24;
    const formBytes = observedPublicField(unit, UNIT_FIELDS.BYTES_2.offset);
    return {
      guid,
      name: entity?.name,
      health: observedPublicField(unit, UNIT_FIELDS.HEALTH.offset),
      maxHealth: observedPublicField(unit, UNIT_FIELDS.MAXHEALTH.offset),
      power:
        powerType === undefined || powerType > 6
          ? undefined
          : observedPublicField(unit, UNIT_FIELDS.POWER1.offset + powerType),
      maxPower:
        powerType === undefined || powerType > 6
          ? undefined
          : observedPublicField(unit, UNIT_FIELDS.MAXPOWER1.offset + powerType),
      powerType,
      baseMana: observedPublicField(unit, UNIT_FIELDS.BASE_MANA.offset),
      shapeshiftForm: formBytes === undefined ? undefined : formBytes >>> 24,
      level: observedPublicField(unit, UNIT_FIELDS.LEVEL.offset),
      pose,
      motion: this.motionOf(guid),
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
    const observed = this.motions.get(guid)?.observed;
    return observed ? { ...observed } : undefined;
  }

  private checkMotion(guid: bigint): void {
    const motion = this.motions.get(guid);
    if (!motion?.trajectory || motion.unsupportedReason) return;
    const sample = sampleSplinePosition(motion.trajectory, 0);
    if (!sample.supported) motion.unsupportedReason = sample.reason;
  }

  private motionOf(guid: bigint): CombatUnit["motion"] {
    const motion = this.motions.get(guid);
    if (!motion) return undefined;
    const unsupportedReason = motion.unsupportedReason;
    return {
      kind: motion.trajectory ? "spline" : "stationary",
      observedAt: motion.observed.updatedAt,
      unsupportedReason,
    };
  }

  private poseOf(guid: bigint): CombatPose | undefined {
    const motion = this.motions.get(guid);
    if (motion?.unsupportedReason) return undefined;
    if (motion?.trajectory) {
      const sample = sampleSplinePosition(
        motion.trajectory,
        this.deps.now() - motion.startedAt,
      );
      if (sample.supported) {
        return {
          mapId: motion.observed.mapId,
          x: sample.x,
          y: sample.y,
          z: sample.z,
          orientation: motion.observed.orientation,
          source: "predicted",
          updatedAt: this.deps.now(),
        };
      }
      return undefined;
    }
    if (motion) return { ...motion.observed };
    return undefined;
  }

  private beginGlobalCooldown(id: number): void {
    const time = this.definition(id)?.cooldown.startRecoveryTimeMs ?? 0;
    this.globalUntil = Math.max(this.globalUntil, this.deps.now() + time);
  }

  private emit(type: CombatEventType, reason?: string): void {
    const event: CombatEvent = { type, state: this.snapshot() };
    if (reason !== undefined) event.reason = reason;
    this.listener?.(event);
  }
}

function isUnit(entity: Entity | undefined): entity is UnitEntity {
  return (
    entity !== undefined &&
    (entity.objectType === ObjectType.UNIT ||
      entity.objectType === ObjectType.PLAYER)
  );
}

function observedPublicField(
  unit: UnitEntity | undefined,
  offset: number,
): number | undefined {
  return unit?.rawFields.get(offset) ?? (unit?.createComplete ? 0 : undefined);
}
