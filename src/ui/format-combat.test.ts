import { describe, expect, test } from "bun:test";
import { createMockHandle } from "test/mock-handle";
import {
  formatCombatState,
  formatFightOutcome,
  formatTacticsState,
} from "ui/format-combat";
import type { CombatState, CombatUnit, TacticsState } from "wow";

const TARGET = 0xf130003d2307401fn;
const RUN = "7f0b6c1e-1111-4222-8333-944445555666";

function observation(overrides: Record<string, unknown>) {
  return {
    lastOutcome: { at: 9, kind: "cast", spellId: 585, status: "succeeded" },
    lastXp: { at: 9, kind: "kill", total: 60, victim: "0xf130003d2307401f" },
    self: {
      guid: "0xa3a",
      health: 206,
      level: 10,
      maxHealth: 217,
      maxPower: 607,
      name: "Fgklhchpmoh",
      power: 412,
      powerType: 0,
    },
    target: {
      guid: "0xf130003d2307401f",
      health: 0,
      level: 6,
      maxHealth: 120,
      name: "Springpaw Stalker",
    },
    unavailable: [
      { id: "spell:17:self", reason: "unknown_metadata" },
      { id: "spell:139:self", reason: "unknown_metadata" },
    ],
    ...overrides,
  };
}

function tactics(overrides: Partial<TacticsState>): TacticsState {
  return {
    instruction: "defeat the selected target while keeping the character alive",
    lastDecision: undefined,
    lastDiscardReason: undefined,
    lastOutcome: undefined,
    lastRequest: undefined,
    lastResult: undefined,
    runId: RUN,
    status: "idle",
    targetGuid: TARGET,
    timeouts: { consecutive: 0, limit: 3, total: 0 },
    ...overrides,
  };
}

describe("formatTacticsState", () => {
  test("summarises a completed run in a few lines", () => {
    const state = tactics({
      lastOutcome: {
        observation: observation({}),
        reason: "server_kill_credit",
        status: "completed",
      },
      lastStopReason: "completed",
    });
    expect(formatTacticsState(state)).toEqual([
      "Tactics: idle",
      `Run: ${RUN}`,
      "Target: Springpaw Stalker 0xf130003d2307401f, level 6, health 0/120",
      "Outcome: completed (server_kill_credit)",
      "Stop reason: completed",
      "Self: health 206/217, mana 412/607",
      "Last XP: 60 (kill 0xf130003d2307401f)",
      "Last action: cast 585 succeeded",
      "Unavailable actions: 2",
    ]);
    expect(formatFightOutcome(state)).toBe(
      "completed: server_kill_credit, XP 60",
    );
  });

  test("falls back to the last request when a failure carries no observation", () => {
    const state = tactics({
      defense: "auto_attack",
      lastDiscardReason: "jev_timeout",
      lastOutcome: { reason: "jev_timeout", status: "failed" },
      lastRequest: {
        candidates: [],
        framing: "none",
        instruction: "",
        observation: observation({ lastOutcome: null, lastXp: null }),
        sentAtMs: 1,
      },
      lastStopReason: "failed",
      timeouts: { consecutive: 3, limit: 3, total: 4 },
    });
    const output = formatTacticsState(state);
    expect(output).toContain("Outcome: failed (jev_timeout)");
    expect(output).toContain("Jev timeouts: 3 in a row of 3, 4 total");
    expect(output).toContain("Defense: auto_attack");
    expect(output).toContain("Last XP: none");
    expect(output).toContain("Last action: none");
    expect(output).toContain("Last discard: jev_timeout");
    expect(output).toContain("Self: health 206/217, mana 412/607");
    expect(formatFightOutcome(state)).toBe("failed: jev_timeout");
  });

  test("reports self death with the observed end state", () => {
    const self = {
      guid: "0xa3a",
      health: 0,
      maxHealth: 217,
      maxPower: 607,
      power: 30,
      powerType: 0,
    };
    const state = tactics({
      lastOutcome: {
        observation: observation({ lastXp: null, self }),
        reason: "self_dead",
        status: "failed",
      },
      lastStopReason: "failed",
    });
    const output = formatTacticsState(state);
    expect(output).toContain("Outcome: failed (self_dead)");
    expect(output).toContain("Self: health 0/217, mana 30/607");
    expect(formatFightOutcome(state)).toBe("failed: self_dead");
  });

  test("names a run stopped without an outcome and an idle loop", () => {
    const stopped = tactics({ lastStopReason: "self_dead" });
    expect(formatFightOutcome(stopped)).toBe("stopped: self_dead");
    expect(formatFightOutcome(tactics({ status: "active" }))).toBe(
      "stopped: replaced",
    );
    expect(
      formatFightOutcome(
        tactics({
          lastOutcome: { reason: "server_kill_credit", status: "completed" },
        }),
        "an-earlier-run",
      ),
    ).toBe("stopped: replaced");
    expect(
      formatTacticsState(tactics({ runId: undefined, targetGuid: undefined })),
    ).toEqual([
      "Tactics: idle",
      "Run: none",
      "Outcome: none",
      "Last XP: none",
      "Last action: none",
    ]);
  });

  test("keeps XP for another victim out of the fight line", () => {
    const state = tactics({
      lastOutcome: {
        observation: observation({
          lastXp: { at: 1, kind: "kill", total: 40, victim: "0xf1" },
        }),
        reason: "target_dead_without_server_credit",
        status: "blocked",
      },
    });
    expect(formatFightOutcome(state)).toBe(
      "blocked: target_dead_without_server_credit",
    );
  });
});

describe("formatCombatState", () => {
  const base = createMockHandle().getCombatState();
  const unit = (overrides: Partial<CombatUnit>): CombatUnit => ({
    ...base.self,
    baseMana: undefined,
    health: 217,
    level: 10,
    maxHealth: 217,
    maxPower: 607,
    name: "Fgklhchpmoh",
    power: 607,
    powerType: 0,
    ...overrides,
  });

  test("summarises vitals, target and spell resolution", () => {
    const state: CombatState = {
      ...base,
      attacking: true,
      attackTarget: TARGET,
      auras: [
        {
          caster: 0xa3an,
          duration: undefined,
          flags: 0,
          level: 10,
          slot: 0,
          spellId: 1243,
          stacks: 1,
          timeLeft: undefined,
        },
      ],
      cooldowns: [
        { remainingMs: 4200, source: "server", spellId: 8092, until: 1 },
      ],
      lastXp: { at: 1, kind: "kill", total: 60, victim: TARGET },
      learned: [585, 589, 8092],
      self: unit({ guid: 0xa3an }),
      target: unit({
        guid: TARGET,
        health: 40,
        level: 6,
        maxHealth: 120,
        name: "Springpaw Stalker",
      }),
      unknownLearned: [589, 8092],
    };
    expect(formatCombatState(state)).toEqual([
      "Self: Fgklhchpmoh, level 10, health 217/217, mana 607/607",
      "Attacking: yes 0xf130003d2307401f",
      "Target: Springpaw Stalker 0xf130003d2307401f, level 6, health 40/120",
      "Auras: 1243",
      "Cooldowns: 8092 (4200 ms)",
      "Last XP: 60 (kill 0xf130003d2307401f)",
      "Last action: none",
      "Spells: 3 learned, 2 unresolved (run tuicraft spells to resolve)",
    ]);
  });

  test("shows an idle unknown self without a target", () => {
    const output = formatCombatState(base);
    expect(output).toContain("Attacking: no");
    expect(output).toContain("Target: none");
    expect(output).toContain("Auras: none");
    expect(output).toContain("Cooldowns: none");
    expect(output).toContain("Last XP: none");
    expect(output).toContain("Spells: 0 learned, 0 unresolved");
  });
});
