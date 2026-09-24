import { describe, expect, test } from "bun:test";
import {
  formatCycleState,
  formatInventoryState,
  formatRecoveryState,
  formatRewardsState,
} from "ui/format-gameplay";
import { createMockHandle } from "test/mock-handle";
import type { CycleState } from "wow/encounter-cycle";
import type { RecoveryState } from "wow/recovery";
import type { InventoryState } from "wow/inventory";
import type { RewardsState } from "wow/rewards";

const handle = createMockHandle();
const TARGET = 0xf130003f220576e9n;

function cycle(overrides: Partial<CycleState>): string {
  return formatCycleState({
    ...handle.getCycleState(),
    phase: "stopped",
    startsUsed: 1,
    maxStarts: 1,
    ...overrides,
  }).join("\n");
}

function recovery(overrides: Partial<RecoveryState>): string {
  return formatRecoveryState({
    ...handle.getRecoveryState(),
    ...overrides,
  }).join("\n");
}

function inventory(overrides: Partial<InventoryState>): string {
  return formatInventoryState({
    ...handle.getInventoryState(),
    ...overrides,
  }).join("\n");
}

function rewards(overrides: Partial<RewardsState>): string {
  return formatRewardsState({
    ...handle.getRewardsState(),
    ...overrides,
  }).join("\n");
}

function killed(victim: bigint) {
  return {
    guid: TARGET,
    status: "done" as const,
    outcome: {
      status: "completed" as const,
      reason: "server_kill_credit",
      observation: {
        lastXp: { victim: `0x${victim.toString(16)}`, total: 84, kind: "kill" },
      },
    },
  };
}

describe("formatCycleState", () => {
  test("shows observed kill credit and coinage instead of loot intent", () => {
    const output = cycle({
      stopCause: "queue_exhausted",
      queue: [killed(TARGET)],
      lastLoot: {
        guid: "0xf130003f220576e9",
        slotsTaken: [],
        moneyTaken: 5,
        coinageBefore: 6174,
        coinageAfter: 6179,
      },
    });
    expect(output).toContain(
      "Target 0xf130003f220576e9: done (server_kill_credit), 84 XP",
    );
    expect(output).toContain("Coinage change: 6174 -> 6179");
    expect(output).toContain("Stop reason: queue_exhausted");
    expect(output).not.toContain("item gained");
  });

  test("does not attribute stale XP to another target", () => {
    const output = cycle({ queue: [killed(0xf130003f22000001n)] });
    expect(output).toContain("server_kill_credit");
    expect(output).not.toContain("84 XP");
  });

  test("does not report gained money without a coinage observation", () => {
    const output = cycle({
      queue: [],
      lastLoot: {
        guid: "0xa",
        slotsTaken: [0],
        moneyTaken: 10,
        coinageBefore: 6174,
        coinageAfter: undefined,
      },
    });
    expect(output).toContain("10 copper requested");
    expect(output).toContain("Coinage change: unknown");
    expect(output).toContain("Item slots requested: 0");
  });
});

describe("formatRecoveryState", () => {
  test("shows blockers without reading a pending request as resurrection", () => {
    const output = recovery({
      life: "ghost",
      health: 202,
      corpse: {
        status: "found",
        mapId: 530,
        corpseMapId: 530,
        position: { x: 0, y: 0, z: 0 },
        unknown: 0,
        observedAt: 1,
      },
      reclaim: {
        canRequest: false,
        readiness: "blocked",
        reason: "corpse_out_of_range",
        distance: 184.15,
        remainingMs: undefined,
        pose: undefined,
      },
      request: {
        action: "spirit-healer",
        guid: 1n,
        status: "unanswered",
        epoch: 2,
        requestedAt: 1,
      },
    });
    expect(output).toContain("Life: ghost");
    expect(output).toContain("Reclaim: blocked (corpse_out_of_range)");
    expect(output).toContain("Corpse distance: 184.15 yards");
    expect(output).toContain("Request: spirit-healer unanswered");
    expect(output).toContain("Reclaim request allowed: no");
  });
});

describe("formatRewardsState", () => {
  test("shows an unanswered opening without claiming a denial", () => {
    const output = rewards({
      loot: {
        phase: "opening",
        guid: TARGET,
        requestedAt: 1,
        invalidatedReason: undefined,
      },
      pending: {
        action: "open",
        guid: TARGET,
        status: "unanswered",
        requestedAt: 1,
      },
    });
    expect(output).toContain("Loot: opening");
    expect(output).toContain("Request: open unanswered");
    expect(output).not.toContain("denied");
  });

  test("labels offered slots that allow direct pickup", () => {
    const item = {
      displayId: 0,
      randomSuffix: 0,
      randomPropertyId: 0,
    };
    const output = rewards({
      loot: {
        phase: "open",
        guid: TARGET,
        lootType: 1,
        money: 10,
        openedAt: 1,
        invalidatedReason: undefined,
        items: [
          { ...item, slot: 0, itemId: 27668, count: 2, slotType: 0 },
          { ...item, slot: 1, itemId: 20772, count: 1, slotType: 2 },
        ],
      },
    });
    expect(output).toContain("Offer: 10 copper");
    expect(output).toContain("Slot 0: item 27668 x2 (pickup allowed)");
    expect(output).toContain("Slot 1: item 20772 x1 (no direct pickup)");
  });

  test("labels past loot and inventory errors without raw JSON", () => {
    const output = rewards({
      lastInventoryError: {
        packet: {
          kind: "error",
          result: 49,
          item1: 0n,
          item2: 0n,
          bagType: 0,
          detail: { kind: "none" },
        },
        inventoryFull: true,
        bagFull: false,
        observedAt: 1,
      },
      lastLootError: { guid: TARGET, error: 4, observedAt: 1 },
    });
    expect(output).toContain("Last inventory error: inventory full");
    expect(output).toContain("Last loot error code: 4");
    expect(output).not.toContain('{"packet"');
  });
});

describe("formatInventoryState", () => {
  test("shows item counts and keeps unknown values unknown", () => {
    const output = inventory({
      status: "partial",
      coinage: undefined,
      freeSlots: undefined,
      slots: [
        {
          bag: 20,
          slot: 16,
          region: "bag_item",
          status: "occupied",
          guid: 1n,
          item: {
            guid: 1n,
            entry: 27668,
            owner: undefined,
            contained: undefined,
            count: 12,
            flags: undefined,
            randomPropertyId: undefined,
            durability: undefined,
            maxDurability: undefined,
          },
        },
        { bag: 20, slot: 17, region: "bag_item", status: "unknown" },
      ],
    });
    expect(output).toContain("Inventory: partial (carried)");
    expect(output).toContain("Coinage: unknown");
    expect(output).toContain("Free slots: unknown");
    expect(output).toContain("Item 27668 x12 at bag 20 slot 16");
    expect(output).toContain("Unknown slots: 1");
  });
});
