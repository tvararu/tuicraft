import type { CombatOutcome } from "wow/combat";
import { SERVER_REJECTION, type TacticsOutcome } from "wow/tactics";

export const MAX_CONSECUTIVE_REJECTIONS = 3;

const SpellFailed = {
  AUTOTRACK_INTERRUPTED: 10,
  CONFUSED: 26,
  FLEEING: 34,
  INTERRUPTED: 40,
  INTERRUPTED_COMBAT: 41,
  LINE_OF_SIGHT: 47,
  MOVING: 51,
  NOT_INFRONT: 61,
  NOT_READY: 67,
  NOT_STANDING: 69,
  NO_POWER: 85,
  OUT_OF_RANGE: 97,
  PACIFIED: 98,
  SILENCED: 104,
  SPELL_IN_PROGRESS: 105,
  STUNNED: 108,
  TOO_CLOSE: 128,
  UNIT_NOT_INFRONT: 134,
  CANT_DO_THAT_RIGHT_NOW: 173,
} as const;

const RECOVERABLE_RESULTS: ReadonlySet<number> = new Set(
  Object.values(SpellFailed),
);
const FACING_RESULTS: ReadonlySet<number> = new Set([
  SpellFailed.NOT_INFRONT,
  SpellFailed.UNIT_NOT_INFRONT,
]);
const RECOVERABLE_ATTACK_ERRORS: ReadonlySet<string> = new Set([
  "bad_facing",
  "not_in_range",
]);

export type Rejection = {
  reason: string;
  recoverable: boolean;
  facing: boolean;
};

export function rejectionOf(outcome: CombatOutcome): Rejection | undefined {
  if (
    outcome.kind === "cast" &&
    (outcome.status === "failed" || outcome.status === "interrupted")
  ) {
    const result = outcome.result;
    return {
      reason: outcome.reason ?? "interrupted",
      recoverable:
        outcome.status === "interrupted" ||
        (result !== undefined && RECOVERABLE_RESULTS.has(result)),
      facing: result !== undefined && FACING_RESULTS.has(result),
    };
  }
  if (outcome.kind === "attack" && outcome.status === "failed") {
    const reason = outcome.error ?? "attack_failed";
    return {
      reason,
      recoverable: RECOVERABLE_ATTACK_ERRORS.has(reason),
      facing: reason === "bad_facing",
    };
  }
  return undefined;
}

function progressed(outcome: CombatOutcome): boolean {
  return (
    (outcome.kind === "cast" || outcome.kind === "attack") &&
    (outcome.status === "started" || outcome.status === "succeeded")
  );
}

export class RejectionTracker {
  private since = 0;
  private seenAt: number | undefined;
  private consecutive = 0;
  private last: Rejection | undefined;

  reset(since: number): void {
    this.since = since;
    this.seenAt = undefined;
    this.consecutive = 0;
    this.last = undefined;
  }

  track(outcome: CombatOutcome | undefined): void {
    if (!outcome || outcome.at < this.since || outcome.at === this.seenAt)
      return;
    const rejection = rejectionOf(outcome);
    if (rejection) {
      this.seenAt = outcome.at;
      this.consecutive += 1;
      this.last = rejection;
    } else if (progressed(outcome)) {
      this.seenAt = outcome.at;
      this.consecutive = 0;
      this.last = undefined;
    }
  }

  outcome(): TacticsOutcome | undefined {
    const last = this.last;
    if (!last) return undefined;
    if (last.recoverable && this.consecutive < MAX_CONSECUTIVE_REJECTIONS)
      return undefined;
    return {
      status: "blocked",
      reason: `${SERVER_REJECTION}${last.reason}`,
    };
  }

  facingRejected(): boolean {
    return this.last?.facing ?? false;
  }

  observation(): Record<string, unknown> {
    return {
      consecutive: this.consecutive,
      limit: MAX_CONSECUTIVE_REJECTIONS,
      last: this.last ? { ...this.last } : null,
    };
  }
}
