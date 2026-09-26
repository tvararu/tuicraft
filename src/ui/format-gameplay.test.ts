import { describe, expect, test } from "bun:test";
import { createMockHandle } from "test/mock-handle";
import {
  formatCycleState,
  formatInventoryState,
  formatRecoveryState,
  formatRewardsState,
} from "ui/format-gameplay";
import type {
  CycleState,
  NamedInventoryState,
  NamedRewardsState,
  RecoveryState,
} from "wow";

const handle = createMockHandle();
const TARGET = 0xf130003f220576e9n;

function cycle(overrides: Partial<CycleState>): string {
  return formatCycleState({
    ...handle.getCycleState(),
    maxStarts: 1,
    phase: "stopped",
    startsUsed: 1,
    ...overrides,
  }).join("\n");
}

function recovery(overrides: Partial<RecoveryState>): string {
  return formatRecoveryState({
    ...handle.getRecoveryState(),
    ...overrides,
  }).join("\n");
}

function inventory(overrides: Partial<NamedInventoryState>): string {
  return formatInventoryState({
    ...handle.getInventoryState(),
    ...overrides,
  }).join("\n");
}

function rewards(overrides: Partial<NamedRewardsState>): string {
  return formatRewardsState({
    ...handle.getRewardsState(),
    ...overrides,
  }).join("\n");
}

function killed(victim: bigint) {
  return {
    guid: TARGET,
    outcome: {
      observation: {
        lastXp: { kind: "kill", total: 84, victim: `0x${victim.toString(16)}` },
      },
      reason: "server_kill_credit",
      status: "completed" as const,
    },
    status: "done" as const,
  };
}

describe("formatCycleState", () => {
  test("shows observed kill credit and coinage instead of loot intent", () => {
    const output = cycle({
      lastLoot: {
        coinageAfter: 6179,
        coinageBefore: 6174,
        guid: "0xf130003f220576e9",
        moneyTaken: 5,
        slotsTaken: [],
      },
      queue: [killed(TARGET)],
      stopCause: "queue_exhausted",
    });
    expect(output).toContain(
      "Target 0xf130003f220576e9: done (server_kill_credit), 84 XP",
    );
    expect(output).toContain("Coinage change: 6174 -> 6179");
    expect(output).toContain("Stop reason: queue_exhausted");
    expect(output).not.toContain("item gained");
  });

  test("names the cause of a Jev stop next to the stop reason", () => {
    const output = cycle({
      stopCause: "jev_unavailable",
      stopDetail: { reason: "HTTP 402 billing_error" },
    });
    expect(output).toContain(
      "Stop reason: jev_unavailable (HTTP 402 billing_error)",
    );
  });

  test("marks a kill that left no loot", () => {
    const output = cycle({ queue: [{ ...killed(TARGET), loot: "none" }] });
    expect(output).toContain(
      "Target 0xf130003f220576e9: done (server_kill_credit), 84 XP, no loot",
    );
  });

  test("does not attribute stale XP to another target", () => {
    const output = cycle({ queue: [killed(0xf130003f22000001n)] });
    expect(output).toContain("server_kill_credit");
    expect(output).not.toContain("84 XP");
  });

  test("does not report gained money without a coinage observation", () => {
    const output = cycle({
      lastLoot: {
        coinageAfter: undefined,
        coinageBefore: 6174,
        guid: "0xa",
        moneyTaken: 10,
        slotsTaken: [0],
      },
      queue: [],
    });
    expect(output).toContain("10 copper requested");
    expect(output).toContain("Coinage change: unknown");
    expect(output).toContain("Item slots requested: 0");
  });
});

describe("formatRecoveryState", () => {
  test("shows an observed spirit-healer confirmation", () => {
    const output = recovery({
      life: "ghost",
      spiritHealerConfirm: { guid: 0xf13000195b0009f1n, receivedAt: 1 },
    });
    expect(output).toContain("Spirit healer confirm: 0xf13000195b0009f1");
  });

  test("shows blockers without reading a pending request as resurrection", () => {
    const output = recovery({
      corpse: {
        corpseMapId: 530,
        mapId: 530,
        observedAt: 1,
        position: { x: 0, y: 0, z: 0 },
        status: "found",
        unknown: 0,
      },
      health: 202,
      life: "ghost",
      reclaim: {
        canRequest: false,
        distance: 184.15,
        pose: undefined,
        readiness: "blocked",
        reason: "corpse_out_of_range",
        remainingMs: undefined,
      },
      request: {
        action: "spirit-healer",
        epoch: 2,
        guid: 1n,
        requestedAt: 1,
        status: "unanswered",
      },
    });
    expect(output).toContain("Life: ghost");
    expect(output).toContain("Reclaim: blocked (corpse_out_of_range)");
    expect(output).toContain("Corpse distance: 184.15 yards");
    expect(output).toContain("Request: spirit-healer unanswered");
    expect(output).toContain("Reclaim request allowed: no");
    expect(output).toContain("Resurrection offer: none");
  });

  test("shows a pending resurrection offer with its readiness", () => {
    const offer = {
      delayMs: 0,
      guid: 0xa47n,
      name: "Fgklhcnkmic",
      readyAt: 2000,
      receivedAt: 1000,
      reserved: 0,
      response: "unanswered" as const,
      sickness: 0,
    };
    const lines = (overrides: Partial<RecoveryState>, now: number) =>
      formatRecoveryState(
        { ...handle.getRecoveryState(), life: "dead", ...overrides },
        now,
      ).join("\n");
    expect(lines({ resurrection: offer }, 2500)).toContain(
      "Resurrection offer: Fgklhcnkmic (0xa47), accept or decline with tuicraft resurrect accept|decline\nResurrection accept allowed: yes",
    );
    expect(lines({ resurrection: offer }, 1500)).toContain(
      "Resurrection accept allowed: no (wait 500 ms)",
    );
    const answered = lines(
      { resurrection: { ...offer, name: "", response: "accept_requested" } },
      2500,
    );
    expect(answered).toContain(
      "Resurrection offer: unknown caster 0xa47, accept requested",
    );
    expect(answered).toContain("Resurrection accept allowed: no (answered)");
  });
});

describe("formatRewardsState", () => {
  test("shows an unanswered opening without claiming a denial", () => {
    const output = rewards({
      loot: {
        guid: TARGET,
        invalidatedReason: undefined,
        phase: "opening",
        requestedAt: 1,
      },
      pending: {
        action: "open",
        guid: TARGET,
        requestedAt: 1,
        status: "unanswered",
      },
    });
    expect(output).toContain("Loot: opening");
    expect(output).toContain("Request: open unanswered");
    expect(output).not.toContain("denied");
  });

  test("says why the last open failed", () => {
    const output = rewards({
      lastOpenFailure: { guid: 0xabcn, observedAt: 1, reason: "release_only" },
      loot: { phase: "closed" },
    });
    expect(output).toContain(
      "Last open failed: the server answered with a release only (0xabc)",
    );
  });

  test("names answered offers and labels slots that allow pickup", () => {
    const item = {
      displayId: 0,
      randomPropertyId: 0,
      randomSuffix: 0,
    };
    const output = rewards({
      loot: {
        guid: TARGET,
        invalidatedReason: undefined,
        items: [
          {
            ...item,
            count: 2,
            itemId: 27_668,
            name: "Lynx Meat",
            quality: 1,
            slot: 0,
            slotType: 0,
          },
          {
            ...item,
            count: 1,
            itemId: 20_772,
            name: null,
            quality: null,
            slot: 1,
            slotType: 2,
          },
        ],
        lootType: 1,
        money: 10,
        openedAt: 1,
        phase: "open",
      },
    });
    expect(output).toContain("Offer: 10 copper");
    expect(output).toContain(
      "Slot 0: item 27668 Lynx Meat x2 (pickup allowed)",
    );
    expect(output).toContain("Slot 1: item 20772 x1 (no direct pickup)");
  });

  test("labels past loot and inventory errors without raw JSON", () => {
    const output = rewards({
      lastInventoryError: {
        bagFull: false,
        inventoryFull: true,
        observedAt: 1,
        packet: {
          bagType: 0,
          detail: { kind: "none" },
          item1: 0n,
          item2: 0n,
          kind: "error",
          result: 49,
        },
      },
      lastLootError: { error: 4, guid: TARGET, observedAt: 1 },
    });
    expect(output).toContain("Last inventory error: inventory full");
    expect(output).toContain("Last loot error code: 4");
    expect(output).not.toContain('{"packet"');
  });
});

describe("formatInventoryState", () => {
  test("names answered items and keeps unanswered ones by entry", () => {
    const unanswered = {
      contained: undefined,
      durability: undefined,
      flags: undefined,
      maxDurability: undefined,
      name: null,
      owner: undefined,
      quality: null,
      randomPropertyId: undefined,
    };
    const output = inventory({
      coinage: undefined,
      freeSlots: undefined,
      slots: [
        {
          bag: 20,
          guid: 1n,
          item: {
            contained: undefined,
            count: 12,
            durability: undefined,
            entry: 27_668,
            flags: undefined,
            guid: 1n,
            maxDurability: undefined,
            name: "Lynx Meat",
            owner: undefined,
            quality: 1,
            randomPropertyId: undefined,
          },
          region: "bag_item",
          slot: 16,
          status: "occupied",
        },
        { bag: 20, region: "bag_item", slot: 17, status: "unknown" },
        {
          bag: 20,
          guid: 2n,
          item: { ...unanswered, count: 1, entry: 4775, guid: 2n },
          region: "bag_item",
          slot: 18,
          status: "occupied",
        },
      ],
      status: "partial",
    });
    expect(output).toContain("Inventory: partial (carried)");
    expect(output).toContain("Coinage: unknown");
    expect(output).toContain("Free slots: unknown");
    expect(output).toContain("Item 27668 Lynx Meat x12 at bag 20 slot 16");
    expect(output).toContain("Item 4775 x1 at bag 20 slot 18");
    expect(output).toContain("Unknown slots: 1");
  });
});
