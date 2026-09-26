import type { CombatState } from "#wow/combat";
import { separation } from "#wow/combat-actions-observation";
import type { TacticsFrame } from "#wow/tactics";

export const NO_PROGRESS_MS = 30_000;
const APPROACH_YARDS = 1;
const FAR = Number.POSITIVE_INFINITY;

type Baseline = { at: number; health: number; range: number | undefined };

export function approached(
  range: number | undefined,
  from: number | undefined,
): boolean {
  return (
    range !== undefined && from !== undefined && range <= from - APPROACH_YARDS
  );
}

export class ProgressWatch {
  private baseline: Baseline | undefined;

  reset(): void {
    this.baseline = undefined;
  }

  observe(state: CombatState, now: number): TacticsFrame["outcome"] {
    const health = state.target?.health ?? FAR;
    const range = separation(state);
    const last = this.baseline;
    if (!last) {
      this.baseline = { at: now, health, range };
      return undefined;
    }
    if (last.range === undefined) last.range = range;
    const damaged = health < last.health;
    if (damaged || approached(range, last.range)) {
      this.baseline = {
        at: now,
        health: Math.min(health, last.health),
        range:
          last.range === undefined
            ? undefined
            : Math.min(range ?? FAR, last.range),
      };
      return undefined;
    }
    if (now - last.at < NO_PROGRESS_MS) return undefined;
    return { status: "blocked", reason: "no_progress" };
  }
}
