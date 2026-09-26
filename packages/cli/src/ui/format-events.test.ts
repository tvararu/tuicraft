import { describe, expect, test } from "bun:test";
import type {
  CombatEvent,
  CombatState,
  ControlEvent,
  RewardsEvent,
  RewardsState,
} from "@tuicraft/core";
import { createMockHandle } from "@tuicraft/core/test-support/mock-handle";
import { formatControlEvent } from "#ui/format-control";
import {
  formatCombatEventText,
  formatRewardsEventText,
  formatTacticsEventText,
} from "#ui/format-events";

const handle = createMockHandle();
const VICTIM = 0xf130003d2307401fn;

function combat(
  type: CombatEvent["type"],
  state: Partial<CombatState>,
  spellName?: string,
): string {
  const event: CombatEvent = {
    state: { ...handle.getCombatState(), ...state },
    type,
  };
  if (spellName) event.spellName = spellName;
  return formatCombatEventText(event);
}

function rewards(type: RewardsEvent["type"], state: Partial<RewardsState>) {
  return formatRewardsEventText({
    at: 1,
    state: { ...handle.getRewardsState(), ...state },
    type,
  });
}

describe("human combat event lines", () => {
  test("xp carries the amount and its source", () => {
    const kill = { at: 1, kind: "kill" as const, total: 40, victim: VICTIM };
    expect(combat("xp", { lastXp: kill })).toBe(
      "[combat] +40 XP (kill 0xf130003d2307401f)",
    );
    expect(
      combat("xp", { lastXp: { ...kill, kind: "other", total: 55 } }),
    ).toBe("[combat] +55 XP (other)");
  });

  test("failed and interrupted casts name the spell and the reason", () => {
    const failed = {
      at: 1,
      kind: "cast" as const,
      reason: "out_of_range",
      result: 97,
      spellId: 591,
      status: "failed" as const,
    };
    expect(combat("cast_failed", { lastOutcome: failed }, "Smite")).toBe(
      "[combat] Smite (591) failed: out of range",
    );
    expect(
      combat("cast_interrupted", {
        lastOutcome: {
          ...failed,
          reason: "interrupted",
          result: 40,
          status: "interrupted",
        },
      }),
    ).toBe("[combat] spell 591 interrupted: interrupted");
    expect(
      combat("cast_failed", { lastOutcome: { ...failed, reason: undefined } }),
    ).toBe("[combat] spell 591 failed: unknown reason");
  });

  test("cast progress lines name the spell", () => {
    const sent = {
      at: 1,
      kind: "cast" as const,
      spellId: 585,
      status: "sent" as const,
    };
    expect(combat("cast_started", { lastOutcome: sent }, "Smite")).toBe(
      "[combat] Smite (585) started",
    );
    expect(combat("cast_succeeded", { lastOutcome: sent })).toBe(
      "[combat] spell 585 succeeded",
    );
  });

  test("aura lines list the current self auras", () => {
    const aura = {
      caster: undefined,
      duration: undefined,
      flags: 0,
      level: 1,
      slot: 0,
      stacks: 1,
      timeLeft: undefined,
    };
    expect(
      combat("aura", {
        auras: [
          { ...aura, spellId: 17 },
          { ...aura, slot: 1, spellId: 6788 },
        ],
      }),
    ).toBe("[combat] auras: 17, 6788");
    expect(combat("aura", { auras: [] })).toBe("[combat] auras: none");
  });
});

describe("human rewards event lines", () => {
  test("money notices give the amount and whether it was a share", () => {
    expect(
      rewards("money_notice", {
        lastMoneyNotice: { alone: false, money: 6, observedAt: 1 },
      }),
    ).toBe("[rewards] share of loot: 6 copper");
    expect(
      rewards("money_notice", {
        lastMoneyNotice: { alone: true, money: 14, observedAt: 1 },
      }),
    ).toBe("[rewards] looted 14 copper");
  });

  test("item pushes give the item and count", () => {
    expect(
      rewards("item_push", {
        lastItemPush: {
          bagSlot: 255,
          count: 2,
          created: 0,
          guid: 1n,
          itemId: 6889,
          observedAt: 1,
          randomPropertyId: 0,
          randomSuffix: 0,
          received: 0,
          showInChat: 1,
          slot: 30,
          totalCount: 5,
        },
      }),
    ).toBe("[rewards] received item 6889 x2 (now 5)");
  });

  test("an opened window lists money and offered items", () => {
    const item = { displayId: 0, randomPropertyId: 0, randomSuffix: 0 };
    expect(
      rewards("loot_opened", {
        loot: {
          guid: VICTIM,
          invalidatedReason: undefined,
          items: [
            { ...item, count: 1, itemId: 4775, slot: 0, slotType: 0 },
            { ...item, count: 2, itemId: 6889, slot: 1, slotType: 0 },
          ],
          lootType: 1,
          money: 12,
          openedAt: 1,
          phase: "open",
        },
      }),
    ).toBe(
      "[rewards] loot opened: 12 copper, slot 0 item 4775 x1, slot 1 item 6889 x2",
    );
  });
});

describe("condensed machinery lines", () => {
  test("per-step tactics lines are left out of human output", () => {
    const base = { runId: "r" };
    expect(
      formatTacticsEventText({
        ...base,
        actionId: "wait",
        ageMs: 3,
        type: "applied",
      }),
    ).toBeUndefined();
    expect(
      formatTacticsEventText({ ...base, type: "activated" }),
    ).toBeUndefined();
    expect(
      formatTacticsEventText({
        ...base,
        reason: "server_kill_credit",
        status: "completed",
        type: "outcome",
      }),
    ).toBe("[tactics] outcome completed: server_kill_credit");
  });

  test("predicted movement steps are hidden while stops with causes stay", () => {
    const state = handle.getControlState();
    const pose = {
      mapId: 530,
      orientation: 0,
      source: "predicted" as const,
      updatedAt: 1,
      x: 0,
      y: 0,
      z: 0,
    };
    const event = (type: ControlEvent["type"], reason?: string) =>
      formatControlEvent({ reason, state: { ...state, pose }, type });
    expect(event("movement_started")).toBeUndefined();
    expect(event("facing_changed")).toBeUndefined();
    expect(event("movement_stopped", "lease")).toBeUndefined();
    expect(event("movement_stopped", "halt")).toBe(
      "[control] movement_stopped predicted halt",
    );
    expect(event("control_error", "height_unresolved")).toBe(
      "[control] control_error predicted height_unresolved",
    );
  });
});
