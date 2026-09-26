import type { InitialCooldown } from "#wow/protocol/spell";
import type { SpellDefinition } from "#wow/spell-catalog";

export type CombatCooldown = {
  spellId: number;
  remainingMs: number;
  until: number;
  source: "server" | "predicted";
};

type Entry = Pick<CombatCooldown, "until" | "source">;
type CooldownOf = (id: number) => SpellDefinition["cooldown"] | undefined;

export class CooldownStore {
  private readonly spells = new Map<number, Entry>();
  private readonly categories = new Map<number, Entry>();
  private globalUntil = 0;
  private readonly now: () => number;
  private readonly cooldownOf: CooldownOf;

  constructor(now: () => number, cooldownOf: CooldownOf) {
    this.now = now;
    this.cooldownOf = cooldownOf;
  }

  reset(cooldowns: InitialCooldown[]): void {
    this.clear();
    const now = this.now();
    for (const cd of cooldowns) {
      if (cd.cooldown > 0)
        this.spells.set(cd.spellId, server(now + cd.cooldown));
      if (cd.categoryCooldown > 0)
        this.categories.set(cd.category, server(now + cd.categoryCooldown));
    }
  }

  observe(spellId: number, ms: number): void {
    this.spells.set(spellId, server(this.now() + ms));
  }

  predict(id: number): void {
    const cd = this.cooldownOf(id);
    const now = this.now();
    if (cd?.recoveryTimeMs)
      this.spells.set(id, predicted(now + cd.recoveryTimeMs));
    if (cd?.categoryRecoveryTimeMs)
      this.categories.set(
        cd.category,
        predicted(now + cd.categoryRecoveryTimeMs),
      );
  }

  release(id: number): void {
    this.spells.delete(id);
    const category = this.cooldownOf(id)?.category;
    if (category) this.categories.delete(category);
  }

  beginGlobal(id: number): void {
    const time = this.cooldownOf(id)?.startRecoveryTimeMs ?? 0;
    this.globalUntil = Math.max(this.globalUntil, this.now() + time);
  }

  readyAt(id: number): number {
    const category = this.cooldownOf(id)?.category;
    return Math.max(
      this.globalUntil,
      this.spells.get(id)?.until ?? 0,
      category ? (this.categories.get(category)?.until ?? 0) : 0,
    );
  }

  list(learned: Set<number>): CombatCooldown[] {
    const now = this.now();
    const ids = [
      ...learned,
      ...[...this.spells.keys()].filter((id) => !learned.has(id)),
    ];
    return ids.flatMap((id) => this.entry(id, now) ?? []);
  }

  clear(): void {
    this.spells.clear();
    this.categories.clear();
  }

  private entry(spellId: number, now: number): CombatCooldown | undefined {
    const categoryId = this.cooldownOf(spellId)?.category;
    let best: Entry = { until: this.globalUntil, source: "predicted" };
    for (const cd of [
      this.spells.get(spellId),
      categoryId ? this.categories.get(categoryId) : undefined,
    ])
      if (cd && cd.until >= best.until) best = cd;
    if (best.until <= now) return undefined;
    const { until, source } = best;
    return { spellId, until, remainingMs: until - now, source };
  }
}

function server(until: number): Entry {
  return { until, source: "server" };
}

function predicted(until: number): Entry {
  return { until, source: "predicted" };
}
