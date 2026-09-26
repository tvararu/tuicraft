import { Emitter, type Unsubscribe } from "lib/emitter";
import { AuraStore, type CombatAura } from "wow/aura-store";
import { CombatCasts } from "wow/combat-casts";
import { combatUnitOf } from "wow/combat-unit";
import type { ControlPose } from "wow/control";
import { type CombatCooldown, CooldownStore } from "wow/cooldown-store";
import { type EntityLookup, isUnit, type Position } from "wow/entity-store";
import {
  type CombatPose,
  MotionStore,
  type UnitMotion,
} from "wow/motion-store";
import type { AuraUpdate, AuraUpdateAll } from "wow/protocol/aura";
import {
  type AttackStart,
  type AttackStop,
  type AttackSwingError,
  buildAttackSwing,
  type XpGain,
} from "wow/protocol/combat";
import type { LevelUpInfo } from "wow/protocol/experience";
import type { InventoryChangeFailure } from "wow/protocol/inventory";
import type { CreateSpline, MonsterMove } from "wow/protocol/monster-move";
import { GameOpcode } from "wow/protocol/opcodes";
import type {
  CastFailed,
  CooldownNotice,
  InitialSpells,
  LearnedSpell,
  RemovedSpell,
  SpellCooldown,
  SpellDelayed,
  SpellFailure,
  SpellGo,
  SpellStart,
  SupersededSpell,
} from "wow/protocol/spell";
import type { SpellCatalog, SpellDefinition } from "wow/spell-catalog";

export type CombatItem = {
  entry: number;
  bag: number;
  slot: number;
  guid: bigint;
};

export type CombatCast = {
  spellId: number;
  target: bigint | undefined;
  startedAt: number;
  durationMs: number;
  source: "server" | "pending";
  count: number;
  cancelRequested?: boolean;
  item?: CombatItem;
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
  item?: CombatItem;
  inventoryResult?: number;
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
  lastLevelUp: (LevelUpInfo & { at: number }) | undefined;
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
  | "level_up"
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
  private readonly events = new Emitter<[CombatEvent]>();
  private readonly incomingAttackers = new Set<bigint>();
  private readonly learned = new Set<number>();
  private readonly cooldowns: CooldownStore;
  private readonly auras: AuraStore;
  private readonly motions: MotionStore;
  private readonly casts: CombatCasts;
  private pendingAttack: bigint | undefined;
  private attacking = false;
  private attackTarget: bigint | undefined;
  private lastOutcome: CombatOutcome | undefined;
  private lastXp: CombatXp | undefined;
  private lastLevelUp: CombatState["lastLevelUp"];

  constructor(deps: CombatDeps) {
    this.deps = deps;
    this.cooldowns = new CooldownStore(
      deps.now,
      (id) => this.definition(id)?.cooldown,
    );
    this.auras = new AuraStore(deps.now);
    this.motions = new MotionStore(deps.now);
    this.casts = new CombatCasts({
      send: deps.send,
      now: deps.now,
      learned: this.learned,
      cooldowns: this.cooldowns,
    });
  }

  onEvent(listener: (event: CombatEvent) => void): Unsubscribe {
    return this.events.subscribe(listener);
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
      casting: this.casts.casting ? { ...this.casts.casting } : undefined,
      pendingCast: this.casts.pending ? { ...this.casts.pending } : undefined,
      learned: [...this.learned],
      unknownLearned: [...this.learned].filter(
        (id) => !this.deps.catalog?.get(id),
      ),
      cooldowns: this.cooldowns.list(this.learned),
      auras: this.auras.forUnit(selfGuid),
      targetAuras: selected ? this.auras.forUnit(selected) : [],
      lastOutcome: this.lastOutcome,
      lastXp: this.lastXp,
      lastLevelUp: this.lastLevelUp,
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

  spellbook(): SpellDefinition[] {
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
    this.lastOutcome = this.casts.send(spellId, targetGuid);
    this.emit("cast_sent");
  }

  useItem(spellId: number, item: CombatItem): void {
    this.lastOutcome = this.casts.sendItem(spellId, item);
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
    this.lastOutcome = this.casts.cancel();
    this.emit("outcome");
  }

  stopAttack(): void {
    this.deps.send(GameOpcode.CMSG_ATTACKSTOP);
    this.pendingAttack = undefined;
    this.lastOutcome = { kind: "attack", status: "sent", at: this.deps.now() };
    this.emit("outcome");
  }

  halt(): void {
    if (this.casts.hasUncancelled()) this.cancelCast();
    if (this.attacking || this.pendingAttack !== undefined) this.stopAttack();
  }

  dispose(): void {
    this.events.clear();
    this.incomingAttackers.clear();
    this.motions.clear();
    this.auras.clear();
    this.learned.clear();
    this.cooldowns.clear();
    this.casts.clear();
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
    const outcome = this.casts.start(packet);
    if (!outcome) return;
    this.lastOutcome = outcome;
    this.emit("cast_started");
  }

  applySpellGo(packet: SpellGo): void {
    if (packet.caster !== this.deps.selfGuid()) return;
    this.lastOutcome = this.casts.succeed(packet);
    this.emit("cast_succeeded");
  }

  applyCastFailed(packet: CastFailed): void {
    const outcome = this.casts.fail(
      packet.spellId,
      packet.castCount,
      packet.result,
      "failed",
    );
    if (!outcome) return;
    this.lastOutcome = outcome;
    this.emit("cast_failed", `cast_failed:${packet.result}`);
  }

  applyInventoryFailure(packet: InventoryChangeFailure): void {
    if (packet.kind !== "error") return;
    const outcome = this.casts.rejectItem(packet.item1, packet.result);
    if (!outcome) return;
    this.lastOutcome = outcome;
    this.emit("cast_failed", `inventory_failed:${packet.result}`);
  }

  applySpellFailure(packet: SpellFailure): void {
    if (packet.caster !== this.deps.selfGuid()) return;
    const outcome = this.casts.fail(
      packet.spellId,
      packet.extraCasts,
      packet.result,
      "interrupted",
    );
    if (!outcome) return;
    this.lastOutcome = outcome;
    this.emit("cast_interrupted", `spell_failure:${packet.result}`);
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
    if (caster !== this.deps.selfGuid() || !this.casts.delay(delayMs)) return;
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

  applyLevelUp(packet: LevelUpInfo): void {
    this.lastLevelUp = { ...packet, at: this.deps.now() };
    this.emit("level_up");
  }

  applyMonsterMove(packet: MonsterMove, mapId: number): void {
    this.motions.monsterMove(packet, mapId);
  }

  private unitOf(
    guid: bigint,
    pose: CombatPose | undefined,
    entity = this.deps.getEntity(guid),
  ): CombatUnit {
    return combatUnitOf(
      { deps: this.deps, motions: this.motions },
      guid,
      pose,
      entity,
    );
  }

  private emit(type: CombatEventType, reason?: string): void {
    const event: CombatEvent = { type, state: this.snapshot() };
    if (reason !== undefined) event.reason = reason;
    this.events.emit(event);
  }
}
