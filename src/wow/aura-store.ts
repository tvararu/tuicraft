import {
  AuraFlag,
  type AuraUpdate,
  type AuraUpdateAll,
} from "wow/protocol/aura";

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

type TrackedAura = CombatAura & { unit: bigint; receivedAt: number };

export class AuraStore {
  private readonly auras = new Map<string, TrackedAura>();
  private readonly now: () => number;

  constructor(now: () => number) {
    this.now = now;
  }

  apply(update: AuraUpdate): void {
    const key = `${update.unit}:${update.slot}`;
    if (update.removed) {
      this.auras.delete(key);
      return;
    }
    const { caster, removed: _removed, ...aura } = update;
    this.auras.set(key, {
      ...aura,
      caster:
        caster ?? (aura.flags & AuraFlag.NOT_CASTER ? aura.unit : undefined),
      duration: aura.duration,
      timeLeft: aura.timeLeft,
      receivedAt: this.now(),
    });
  }

  replace({ unit, auras }: AuraUpdateAll): void {
    this.forget(unit);
    for (const aura of auras) this.apply(aura);
  }

  forUnit(guid: bigint): CombatAura[] {
    const list: CombatAura[] = [];
    for (const aura of this.auras.values()) {
      if (aura.unit !== guid) continue;
      const timeLeft =
        aura.timeLeft === undefined
          ? undefined
          : Math.max(0, aura.timeLeft - (this.now() - aura.receivedAt));
      if (timeLeft === 0) continue;
      const { unit: _unit, receivedAt: _receivedAt, ...value } = aura;
      list.push({ ...value, timeLeft });
    }
    return list;
  }

  forget(guid: bigint): void {
    for (const [key, aura] of this.auras)
      if (aura.unit === guid) this.auras.delete(key);
  }

  clear(): void {
    this.auras.clear();
  }
}
