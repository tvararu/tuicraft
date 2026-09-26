import {
  buildLootRoll,
  type LootAllPassed,
  type LootItem,
  type LootRollNotice,
  type LootRollWon,
  type LootStartRoll,
  ROLL_VOTES,
  type RollVote,
} from "#wow/protocol/loot";
import { GameOpcode } from "#wow/protocol/opcodes";

export type LootRollDeps = {
  send: (opcode: number, body?: Uint8Array) => void;
  now: () => number;
  selfGuid: () => bigint;
  lootGuid: () => bigint | undefined;
  changed: (type: LootRollEventType) => void;
};

export type LootRollEventType =
  | "loot_roll_started"
  | "loot_roll_requested"
  | "loot_roll_observed"
  | "loot_roll_won"
  | "loot_roll_all_passed";

export type RewardsRollVote = {
  player: bigint;
  choice: RollVote | "unknown";
  rolled: number | undefined;
  autoPass: boolean;
  observedAt: number;
};
export type RewardsRoll = {
  guid: bigint;
  corpseGuid: bigint | undefined;
  mapId: number;
  slot: number;
  itemId: number;
  count: number;
  randomSuffix: number;
  randomPropertyId: number;
  countdownMs: number;
  startedAt: number;
  expiresAt: number;
  remainingMs: number;
  allowed: RollVote[];
  choice: RollVote | undefined;
  votes: RewardsRollVote[];
};
export type RewardsRollResult = {
  guid: bigint;
  corpseGuid: bigint | undefined;
  slot: number;
  itemId: number;
  outcome: "won" | "all_passed";
  winner: bigint | undefined;
  rolled: number | undefined;
  winnerChoice: RollVote | "unknown" | undefined;
  myChoice: RollVote | undefined;
  mine: boolean;
  observedAt: number;
};
export type RewardsRolls = {
  pending: RewardsRoll[];
  last: RewardsRollResult | undefined;
};

export const ROLL_GRACE_MS = 30_000;
const ROLL_ONGOING = 1;
const PASSED = 128;

type Item = { guid: bigint; slot: number; itemId: number };

function voteName(code: number): RollVote | "unknown" {
  return ROLL_VOTES[code] ?? "unknown";
}

function noticeVote(notice: LootRollNotice): RewardsRollVote["choice"] {
  if (notice.rollNumber === 0 && notice.vote === 0) return "need";
  return voteName(notice.vote);
}

export class LootRolls {
  private rolls: Omit<RewardsRoll, "remainingMs">[] = [];
  private last: RewardsRollResult | undefined;
  private readonly deps: LootRollDeps;

  constructor(deps: LootRollDeps) {
    this.deps = deps;
  }

  snapshot(): RewardsRolls {
    this.prune();
    const now = this.deps.now();
    return {
      last: this.last ? { ...this.last } : undefined,
      pending: this.rolls.map((roll) => ({
        ...roll,
        allowed: [...roll.allowed],
        remainingMs: Math.max(0, roll.expiresAt - now),
        votes: roll.votes.map((vote) => ({ ...vote })),
      })),
    };
  }

  roll(target: bigint, slot: number, choice: RollVote): void {
    this.prune();
    const roll = this.rolls.find(
      (r) => r.slot === slot && (r.guid === target || r.corpseGuid === target),
    );
    if (!roll)
      throw new Error(
        "No pending loot roll for that GUID and slot; a corpse GUID only works once your loot window has shown the rolling item, otherwise use the roll guid",
      );
    if (roll.choice) throw new Error("Loot roll was already answered");
    if (!roll.allowed.includes(choice))
      throw new Error(`Roll type is not allowed: ${choice}`);
    this.deps.send(
      GameOpcode.CMSG_LOOT_ROLL,
      buildLootRoll(roll.guid, roll.slot, choice),
    );
    roll.choice = choice;
    this.deps.changed("loot_roll_requested");
  }

  receiveStart(start: LootStartRoll): void {
    this.prune();
    const startedAt = this.deps.now();
    this.rolls = this.rolls.filter((roll) => roll.guid !== start.guid);
    this.rolls.push({
      allowed: ROLL_VOTES.filter((_, bit) => start.voteMask & (1 << bit)),
      choice: undefined,
      corpseGuid: this.deps.lootGuid(),
      count: start.count,
      countdownMs: start.countdownMs,
      expiresAt: startedAt + start.countdownMs,
      guid: start.guid,
      itemId: start.itemId,
      mapId: start.mapId,
      randomPropertyId: start.randomPropertyId,
      randomSuffix: start.randomSuffix,
      slot: start.slot,
      startedAt,
      votes: [],
    });
    this.deps.changed("loot_roll_started");
  }

  receiveRoll(notice: LootRollNotice): void {
    const roll = this.find(notice);
    if (!roll) return;
    const choice = noticeVote(notice);
    roll.votes.push({
      autoPass: notice.autoPass,
      choice,
      observedAt: this.deps.now(),
      player: notice.player,
      rolled:
        notice.rollNumber > 0 && notice.rollNumber < PASSED
          ? notice.rollNumber
          : undefined,
    });
    if (notice.player === this.deps.selfGuid() && !roll.choice)
      roll.choice = choice === "unknown" ? undefined : choice;
    this.deps.changed("loot_roll_observed");
  }

  receiveWon(won: LootRollWon): void {
    const roll = this.find(won);
    this.last = {
      corpseGuid: roll?.corpseGuid,
      guid: roll?.guid ?? won.guid,
      itemId: won.itemId,
      mine: won.winner === this.deps.selfGuid(),
      myChoice: roll?.choice,
      observedAt: this.deps.now(),
      outcome: "won",
      rolled: won.rollNumber,
      slot: won.slot,
      winner: won.winner,
      winnerChoice: voteName(won.vote),
    };
    this.drop(roll);
    this.deps.changed("loot_roll_won");
  }

  receiveAllPassed(passed: LootAllPassed): void {
    const roll = this.find(passed);
    this.last = {
      corpseGuid: roll?.corpseGuid,
      guid: roll?.guid ?? passed.guid,
      itemId: passed.itemId,
      mine: false,
      myChoice: roll?.choice,
      observedAt: this.deps.now(),
      outcome: "all_passed",
      rolled: undefined,
      slot: passed.slot,
      winner: undefined,
      winnerChoice: undefined,
    };
    this.drop(roll);
    this.deps.changed("loot_roll_all_passed");
  }

  observeOffer(corpse: bigint, items: LootItem[]): void {
    for (const item of items) {
      if (item.slotType !== ROLL_ONGOING) continue;
      const roll = this.rolls.find(
        (r) =>
          r.corpseGuid === undefined &&
          r.slot === item.slot &&
          r.itemId === item.itemId,
      );
      if (roll) roll.corpseGuid = corpse;
    }
  }

  clear(): void {
    this.rolls = [];
    this.last = undefined;
  }

  private find({ guid, slot, itemId }: Item) {
    return this.rolls.find((roll) =>
      guid === 0n
        ? roll.slot === slot && roll.itemId === itemId
        : roll.guid === guid,
    );
  }

  private drop(roll: Omit<RewardsRoll, "remainingMs"> | undefined): void {
    if (roll) this.rolls = this.rolls.filter((r) => r !== roll);
  }

  private prune(): void {
    const now = this.deps.now();
    this.rolls = this.rolls.filter(
      (roll) => roll.expiresAt + ROLL_GRACE_MS > now,
    );
  }
}
