import { test, expect } from "bun:test";
import { EncounterCycleRuntime } from "wow/encounter-cycle";
import type { RewardsEvent, RewardsState } from "wow/rewards";

function fakeTactics(outcomes: (string | Error)[]) {
  let calls = 0;
  return {
    calls: () => calls,
    start: async (
      _ctx: { targetGuid: bigint; instruction: string },
      _s: AbortSignal,
    ) => {
      const next = outcomes[calls++];
      if (next instanceof Error) throw next;
    },
    stop: (_r: string) => {},
    lastOutcome: () => undefined,
    selfDead: () => false,
  };
}

function fakeLoot(config: {
  items?: number[];
  money?: number;
  coinageBefore?: number;
  coinageAfter?: number;
  openError?: number;
  takeError?: string;
  inventoryFull?: boolean;
  releaseOnly?: boolean;
}) {
  const offeredSlots = config.items ?? [];
  const takenSlots: number[] = [];
  let moneyRequested = false;
  let coinage = config.coinageBefore;
  let phase: "closed" | "opening" | "open" | "closing" = "closed";
  let windowMoney = config.money ?? 0;
  const remainingItems = new Set(offeredSlots);
  let lastLootError: RewardsState["lastLootError"];
  let lastInventoryError: RewardsState["lastInventoryError"];
  let listener: ((event: RewardsEvent) => void) | undefined;

  function state(): RewardsState {
    const loot: RewardsState["loot"] =
      phase === "open" || phase === "closing"
        ? {
            phase,
            guid: 2n,
            lootType: 1,
            money: windowMoney,
            items: [...remainingItems].map((slot) => ({
              slot,
              itemId: 1000 + slot,
              count: 1,
              displayId: 0,
              randomSuffix: 0,
              randomPropertyId: 0,
              slotType: 0,
            })),
            openedAt: 0,
            invalidatedReason: undefined,
          }
        : phase === "opening"
          ? {
              phase: "opening",
              guid: 2n,
              requestedAt: 0,
              invalidatedReason: undefined,
            }
          : { phase: "closed" };
    return {
      loot,
      pending: undefined,
      inventory: {
        selfGuid: 1n,
        scope: "carried",
        status: "complete",
        coinage,
        slots: [],
        bags: [],
        freeSlots: undefined,
        issues: [],
      },
      lastLootError,
      lastInventoryError,
      lastItemPush: undefined,
      lastMoneyNotice: undefined,
      lastRelease: undefined,
      disposed: false,
    };
  }

  function emit(type: RewardsEvent["type"]): void {
    listener?.({ type, at: 0, state: state() });
  }

  return {
    taken: () => takenSlots,
    moneyTaken: () => moneyRequested,
    onEvent(callback: ((event: RewardsEvent) => void) | undefined) {
      listener = callback;
    },
    snapshot(): RewardsState {
      return state();
    },
    open(_guid: bigint) {
      phase = "opening";
      queueMicrotask(() => {
        if (config.releaseOnly) {
          emit("loot_release_observed");
          return;
        }
        if (config.openError !== undefined) {
          lastLootError = { guid: 2n, error: config.openError, observedAt: 0 };
          phase = "closed";
          emit("loot_error");
          return;
        }
        phase = "open";
        emit("loot_opened");
      });
    },
    take(slot: number) {
      if (config.takeError) throw new Error(config.takeError);
      remainingItems.delete(slot);
      takenSlots.push(slot);
      queueMicrotask(() => {
        if (config.inventoryFull) {
          lastInventoryError = {
            packet: {
              kind: "error",
              result: 50,
              item1: 0n,
              item2: 0n,
              bagType: 0,
              detail: { kind: "none" },
            },
            inventoryFull: true,
            bagFull: false,
            observedAt: 0,
          };
          emit("inventory_error");
          return;
        }
        emit("loot_removed");
      });
    },
    takeMoney() {
      moneyRequested = true;
      windowMoney = 0;
      queueMicrotask(() => {
        coinage = config.coinageAfter;
        emit("loot_money_cleared");
      });
    },
    close() {
      phase = "closed";
    },
  };
}

test("lost target records cause and advances, loop stops at end of queue", async () => {
  const tactics = fakeTactics([new Error("target_unreachable")]);
  const loot = fakeLoot({});
  const runtime = new EncounterCycleRuntime({ tactics, loot, now: () => 0 });
  const events: string[] = [];
  runtime.onEvent((e) => events.push(e.type));
  await runtime.start({ guids: [1n, 2n], instruction: "fight", maxStarts: 5 });
  const state = runtime.snapshot();
  expect(state.queue[0]).toMatchObject({
    status: "skipped",
    cause: "target_unreachable",
  });
  expect(tactics.calls()).toBe(2);
  expect(state.phase).toBe("stopped");
  expect(events).toEqual([
    "started",
    "target_done",
    "loot_done",
    "target_done",
    "stopped",
  ]);
});

test("stops at max starts with cause", async () => {
  const tactics = fakeTactics([]);
  const loot = fakeLoot({});
  const runtime = new EncounterCycleRuntime({ tactics, loot, now: () => 0 });
  await runtime.start({
    guids: [1n, 2n, 3n],
    instruction: "fight",
    maxStarts: 2,
  });
  expect(runtime.snapshot()).toMatchObject({
    stopCause: "max_starts_reached",
    startsUsed: 2,
  });
});

test("empty queue and bad max throw", async () => {
  const tactics = fakeTactics([]);
  const loot = fakeLoot({});
  const runtime = new EncounterCycleRuntime({ tactics, loot, now: () => 0 });
  await expect(
    runtime.start({ guids: [], instruction: "fight" }),
  ).rejects.toThrow("cycle_empty_queue");
  await expect(
    runtime.start({ guids: [1n], instruction: "fight", maxStarts: 0 }),
  ).rejects.toThrow("cycle_invalid_max");
});

test("second start replaces the first", async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const tactics = {
    calls: 0,
    start: async () => {
      tactics.calls++;
      await gate;
    },
    stop: (_r: string) => {},
    lastOutcome: () => undefined,
    selfDead: () => false,
  };
  const loot = fakeLoot({});
  const runtime = new EncounterCycleRuntime({ tactics, loot, now: () => 0 });
  const first = runtime.start({ guids: [1n], instruction: "a" });
  await Bun.sleep(0);
  const second = runtime.start({ guids: [2n], instruction: "b" });
  release();
  await Promise.all([first, second]);
  expect(runtime.snapshot().queue.map((r) => r.guid)).toEqual([2n]);
});

test("loot takes every slot plus money and records deltas", async () => {
  const loot = fakeLoot({
    items: [4, 7],
    money: 9,
    coinageBefore: 10,
    coinageAfter: 19,
  });
  const runtime = new EncounterCycleRuntime({
    tactics: fakeTactics([]),
    loot,
    now: () => 0,
  });
  await runtime.start({ guids: [2n], instruction: "fight" });
  expect(loot.taken()).toEqual([4, 7]);
  expect(loot.moneyTaken()).toBe(true);
  expect(runtime.snapshot().lastLoot).toMatchObject({
    slotsTaken: [4, 7],
    moneyTaken: 9,
    coinageBefore: 10,
    coinageAfter: 19,
  });
});

test("empty offer closes and advances without stopping", async () => {
  const loot = fakeLoot({
    items: [],
    money: 0,
    coinageBefore: 5,
    coinageAfter: 5,
  });
  const runtime = new EncounterCycleRuntime({
    tactics: fakeTactics([]),
    loot,
    now: () => 0,
  });
  await runtime.start({ guids: [2n], instruction: "fight" });
  expect(loot.taken()).toEqual([]);
  expect(loot.moneyTaken()).toBe(false);
  expect(runtime.snapshot()).toMatchObject({
    stopCause: "queue_exhausted",
    lastLoot: {
      slotsTaken: [],
      moneyTaken: 0,
      coinageBefore: 5,
      coinageAfter: 5,
    },
  });
});

test("denied offer stops with loot_denied cause", async () => {
  const loot = fakeLoot({ openError: 4 });
  const runtime = new EncounterCycleRuntime({
    tactics: fakeTactics([]),
    loot,
    now: () => 0,
  });
  await runtime.start({ guids: [2n], instruction: "fight" });
  expect(runtime.snapshot()).toMatchObject({
    phase: "stopped",
    stopCause: "loot_denied:4",
  });
});

test("refused take stops with cause", async () => {
  const loot = fakeLoot({ items: [4], takeError: "loot slot refused" });
  const runtime = new EncounterCycleRuntime({
    tactics: fakeTactics([]),
    loot,
    now: () => 0,
  });
  await runtime.start({ guids: [2n], instruction: "fight" });
  expect(loot.taken()).toEqual([]);
  expect(runtime.snapshot().stopCause).toBe("loot_denied:loot slot refused");
});

test("full inventory stops with loot_inventory_full", async () => {
  const loot = fakeLoot({ items: [4, 7], inventoryFull: true });
  const runtime = new EncounterCycleRuntime({
    tactics: fakeTactics([]),
    loot,
    now: () => 0,
  });
  await runtime.start({ guids: [2n], instruction: "fight" });
  expect(runtime.snapshot().stopCause).toBe("loot_inventory_full");
});

test("release-only denial stops with reconnect cause", async () => {
  const loot = fakeLoot({ releaseOnly: true });
  const runtime = new EncounterCycleRuntime({
    tactics: fakeTactics([]),
    loot,
    now: () => 0,
  });
  await runtime.start({ guids: [2n], instruction: "fight" });
  expect(runtime.snapshot().stopCause).toBe(
    "loot_release_only_reconnect_required",
  );
});
