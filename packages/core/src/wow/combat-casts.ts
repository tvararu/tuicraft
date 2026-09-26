import type { CombatCast, CombatItem, CombatOutcome } from "#wow/combat";
import type { CooldownStore } from "#wow/cooldown-store";
import { buildUseItem } from "#wow/protocol/item";
import { GameOpcode } from "#wow/protocol/opcodes";
import {
  buildCancelCast,
  buildCastSpell,
  SpellCastResult,
  type SpellGo,
  type SpellStart,
} from "#wow/protocol/spell";
import { spellCastReason } from "#wow/protocol/spell-cast-result";

type CastDeps = {
  send: (opcode: number, body?: Uint8Array) => void;
  now: () => number;
  learned: ReadonlySet<number>;
  cooldowns: CooldownStore;
};

export class CombatCasts {
  private readonly deps: CastDeps;
  private castCount = 1;
  private pendingCast: CombatCast | undefined;
  private currentCast: CombatCast | undefined;
  private lastCast: CombatCast | undefined;

  constructor(deps: CastDeps) {
    this.deps = deps;
  }

  get pending(): CombatCast | undefined {
    return this.pendingCast;
  }

  get casting(): CombatCast | undefined {
    return this.currentCast;
  }

  hasUncancelled(): boolean {
    return Boolean(
      (this.currentCast && !this.currentCast.cancelRequested) ||
        (this.pendingCast && !this.pendingCast.cancelRequested),
    );
  }

  clear(): void {
    this.pendingCast = undefined;
    this.currentCast = undefined;
    this.lastCast = undefined;
  }

  send(spellId: number, targetGuid: bigint): CombatOutcome {
    if (!Number.isInteger(spellId) || spellId <= 0 || spellId > 0xff_ff_ff_ff)
      throw new Error("invalid_spell");
    if (targetGuid < 0n || targetGuid > 0xffffffffffffffffn)
      throw new Error("invalid_guid");
    if (this.pendingCast || this.currentCast)
      throw new Error("cast_in_progress");
    if (!this.deps.learned.has(spellId)) throw new Error("unknown_spell");
    const count = this.nextCount();
    this.deps.send(
      GameOpcode.CMSG_CAST_SPELL,
      buildCastSpell(count, spellId, targetGuid),
    );
    return this.track(spellId, targetGuid === 0n ? undefined : targetGuid, {
      count,
    });
  }

  sendItem(spellId: number, item: CombatItem): CombatOutcome {
    if (this.hasUncancelled()) throw new Error("cast_in_progress");
    this.pendingCast = undefined;
    this.currentCast = undefined;
    const count = this.nextCount();
    const { bag, slot, guid: itemGuid } = item;
    this.deps.send(
      GameOpcode.CMSG_USE_ITEM,
      buildUseItem({ bag, slot, castCount: count, spellId, itemGuid }),
    );
    return this.track(spellId, undefined, { count, item });
  }

  private nextCount(): number {
    const count = this.castCount;
    this.castCount = (this.castCount + 1) & 0xff || 1;
    return count;
  }

  private track(
    spellId: number,
    target: bigint | undefined,
    extra: { count: number; item?: CombatItem },
  ): CombatOutcome {
    const pending: CombatCast = {
      spellId,
      target,
      startedAt: this.deps.now(),
      durationMs: 0,
      source: "pending",
      ...extra,
    };
    this.pendingCast = pending;
    this.lastCast = pending;
    return {
      kind: "cast",
      status: "sent",
      spellId,
      target,
      at: this.deps.now(),
      ...(extra.item && { item: extra.item }),
    };
  }

  cancel(): CombatOutcome {
    const spellId = this.currentCast?.spellId ?? this.pendingCast?.spellId;
    if (spellId === undefined) throw new Error("not_casting");
    this.deps.send(GameOpcode.CMSG_CANCEL_CAST, buildCancelCast(spellId));
    if (this.currentCast) this.currentCast.cancelRequested = true;
    if (this.pendingCast) this.pendingCast.cancelRequested = true;
    return {
      kind: "cancel",
      status: "sent",
      spellId,
      at: this.deps.now(),
    };
  }

  start(packet: SpellStart): CombatOutcome | undefined {
    const matching =
      this.pendingCast?.spellId === packet.spellId &&
      this.pendingCast.count === packet.castCount;
    const cancelRequested = matching
      ? this.pendingCast?.cancelRequested
      : undefined;
    const item = matching ? this.pendingCast?.item : undefined;
    if (this.pendingCast && !matching) return undefined;
    this.pendingCast = undefined;
    this.currentCast = {
      cancelRequested,
      spellId: packet.spellId,
      target: packet.targets.objectGuid,
      startedAt: this.deps.now(),
      durationMs: packet.timer,
      source: "server",
      count: packet.castCount,
      ...(item && { item }),
    };
    this.lastCast = this.currentCast;
    this.deps.cooldowns.beginGlobal(packet.spellId);
    return {
      kind: "cast",
      status: "started",
      spellId: packet.spellId,
      target: packet.targets.objectGuid,
      at: this.deps.now(),
      ...(item && { item }),
    };
  }

  succeed(packet: SpellGo): CombatOutcome {
    const hadStart =
      this.currentCast?.spellId === packet.spellId &&
      this.currentCast.count === packet.extraCasts;
    const pending =
      this.pendingCast?.spellId === packet.spellId &&
      this.pendingCast.count === packet.extraCasts;
    const matched =
      (pending && this.pendingCast) || (hadStart && this.currentCast);
    const item = matched ? matched.item : undefined;
    if (pending) this.pendingCast = undefined;
    if (hadStart) this.currentCast = undefined;
    if (!hadStart) this.deps.cooldowns.beginGlobal(packet.spellId);
    this.deps.cooldowns.predict(packet.spellId);
    return {
      kind: "cast",
      hits: packet.hits,
      misses: packet.misses,
      status: "succeeded",
      spellId: packet.spellId,
      target: packet.targets.objectGuid,
      at: this.deps.now(),
      ...(item && { item }),
    };
  }

  fail(
    spellId: number,
    count: number,
    result: number,
    status: "failed" | "interrupted",
  ): CombatOutcome | undefined {
    const cast = this.lastCast;
    if (cast?.spellId !== spellId || cast.count !== count) return undefined;
    if (this.pendingCast === cast) this.pendingCast = undefined;
    if (this.currentCast === cast) this.currentCast = undefined;
    return {
      kind:
        cast.cancelRequested && result === SpellCastResult.INTERRUPTED
          ? "cancel"
          : "cast",
      status,
      spellId,
      result,
      reason: spellCastReason(result),
      at: this.deps.now(),
      ...(cast.item && { item: cast.item }),
    };
  }

  rejectItem(itemGuid: bigint, result: number): CombatOutcome | undefined {
    const cast = this.pendingCast;
    const item = cast?.item;
    if (!(cast && item && (itemGuid === item.guid || itemGuid === 0n)))
      return undefined;
    this.pendingCast = undefined;
    return {
      kind: "cast",
      status: "failed",
      spellId: cast.spellId,
      inventoryResult: result,
      at: this.deps.now(),
      item,
    };
  }

  delay(delayMs: number): boolean {
    if (!this.currentCast) return false;
    this.currentCast.durationMs += delayMs;
    return true;
  }
}
