import { expect, jest, test } from "bun:test";
import { fakeRecovery } from "test/cycle-recovery-fixtures";
import {
  advanceUntilSettled,
  body,
  fakeControl,
  fakeLoot,
  fakeTactics,
  makeCycle,
} from "test/encounter-cycle-fixtures";

test("loot takes every slot plus money and records deltas", async () => {
  const loot = fakeLoot({
    items: [4, 7],
    money: 9,
    coinageBefore: 10,
    coinageAfter: 19,
  });
  const runtime = makeCycle({
    tactics: fakeTactics([]),
    loot,
    recovery: fakeRecovery({ life: ["alive"] }),
    control: fakeControl(),
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
  const runtime = makeCycle({
    tactics: fakeTactics([]),
    loot,
    recovery: fakeRecovery({ life: ["alive"] }),
    control: fakeControl(),
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

test("cycle waits for the loot release before completing", async () => {
  const loot = fakeLoot({ items: [4], deferClose: true });
  const runtime = makeCycle({
    tactics: fakeTactics([]),
    loot,
    recovery: fakeRecovery({ life: ["alive"] }),
    control: fakeControl(),
    now: () => 0,
  });
  const running = runtime.start({ guids: [2n], instruction: "fight" });
  await loot.closing;
  expect(runtime.snapshot()).toMatchObject({
    active: true,
    phase: "looting",
    currentIndex: 0,
  });
  expect(runtime.snapshot().lastLoot).toBeUndefined();
  loot.acknowledgeClose();
  await running;
  expect(runtime.snapshot()).toMatchObject({
    stopCause: "queue_exhausted",
    lastLoot: { slotsTaken: [4] },
  });
});

test("unanswered loot take stops rather than reporting success", async () => {
  jest.useFakeTimers();
  try {
    const runtime = makeCycle({
      tactics: fakeTactics([]),
      loot: fakeLoot({ items: [4], deferTake: true }),
      recovery: fakeRecovery({ life: ["alive"] }),
      control: fakeControl(),
      now: () => 0,
    });
    const running = runtime.start({ guids: [2n], instruction: "fight" });
    await advanceUntilSettled(running, 6000);
    expect(runtime.snapshot()).toMatchObject({
      phase: "stopped",
      stopCause: "loot_denied:timeout",
    });
    expect(runtime.snapshot().lastLoot).toBeUndefined();
  } finally {
    jest.useRealTimers();
  }
});
test("loot waits for the corpse health update after kill credit", async () => {
  const loot = fakeLoot({
    items: [4],
    corpse: { dead: false, lootable: true },
  });
  const runtime = makeCycle({
    tactics: fakeTactics([]),
    loot,
    recovery: fakeRecovery({ life: ["alive"] }),
    control: fakeControl(),
    now: () => 0,
  });
  const running = runtime.start({ guids: [2n], instruction: "fight" });
  await loot.attempted;
  runtime.observeEntity(body(9n, 0));
  runtime.observeEntity(body(2n, 3));
  expect(loot.taken()).toEqual([]);
  loot.corpse.dead = true;
  runtime.observeEntity(body(2n, 0));
  await running;
  expect(loot.taken()).toEqual([4]);
  expect(runtime.snapshot().stopCause).toBe("queue_exhausted");
  expect(runtime.snapshot().queue[0]?.loot).toBe("looted");
});

test("a dead creature with no loot is recorded and the cycle continues", async () => {
  const tactics = fakeTactics([]);
  const loot = fakeLoot({ corpse: { dead: true, lootable: false } });
  const runtime = makeCycle({
    tactics,
    loot,
    recovery: fakeRecovery({ life: ["alive"] }),
    control: fakeControl(),
    now: () => 0,
  });
  await runtime.start({ guids: [2n, 3n], instruction: "fight" });
  expect(tactics.calls()).toBe(2);
  expect(runtime.snapshot()).toMatchObject({
    stopCause: "queue_exhausted",
    lastLoot: undefined,
    queue: [
      { guid: 2n, status: "done", loot: "none" },
      { guid: 3n, status: "done", loot: "none" },
    ],
  });
});

test("a corpse that despawns before its death update counts as no loot", async () => {
  const loot = fakeLoot({
    items: [4],
    corpse: { dead: false, lootable: true },
  });
  const runtime = makeCycle({
    tactics: fakeTactics([]),
    loot,
    recovery: fakeRecovery({ life: ["alive"] }),
    control: fakeControl(),
    now: () => 0,
  });
  const running = runtime.start({ guids: [2n], instruction: "fight" });
  await loot.attempted;
  runtime.observeEntity({ type: "disappear", guid: 2n });
  await running;
  expect(loot.taken()).toEqual([]);
  expect(runtime.snapshot()).toMatchObject({
    stopCause: "queue_exhausted",
    queue: [{ status: "done", loot: "none" }],
  });
});

test("a corpse never seen dying stops the cycle after the settle time", async () => {
  jest.useFakeTimers();
  try {
    const loot = fakeLoot({
      items: [4],
      corpse: { dead: false, lootable: true },
    });
    const runtime = makeCycle({
      tactics: fakeTactics([]),
      loot,
      recovery: fakeRecovery({ life: ["alive"] }),
      control: fakeControl(),
      now: () => 0,
    });
    const running = runtime.start({ guids: [2n], instruction: "fight" });
    await advanceUntilSettled(running, 7000);
    expect(loot.taken()).toEqual([]);
    expect(runtime.snapshot().stopCause).toBe("target_death_unconfirmed");
  } finally {
    jest.useRealTimers();
  }
});

test("second take waits for first confirmation instead of racing", async () => {
  const order: string[] = [];
  const loot = fakeLoot({ items: [4, 7] });
  const innerTake = loot.take.bind(loot);
  loot.take = (slot: number) => {
    order.push(`take:${slot}`);
    return innerTake(slot);
  };
  const runtime = makeCycle({
    tactics: fakeTactics([]),
    loot,
    recovery: fakeRecovery({ life: ["alive"] }),
    control: fakeControl(),
    now: () => 0,
  });
  await runtime.start({ guids: [2n], instruction: "fight" });
  expect(order).toEqual(["take:4", "take:7"]);
  expect(loot.taken()).toEqual([4, 7]);
  expect(runtime.snapshot()).toMatchObject({
    stopCause: "queue_exhausted",
    lastLoot: { slotsTaken: [4, 7] },
  });
});

test("denied offer stops with loot_denied cause", async () => {
  const loot = fakeLoot({ openError: 4 });
  const runtime = makeCycle({
    tactics: fakeTactics([]),
    loot,
    recovery: fakeRecovery({ life: ["alive"] }),
    control: fakeControl(),
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
  const runtime = makeCycle({
    tactics: fakeTactics([]),
    loot,
    recovery: fakeRecovery({ life: ["alive"] }),
    control: fakeControl(),
    now: () => 0,
  });
  await runtime.start({ guids: [2n], instruction: "fight" });
  expect(loot.taken()).toEqual([]);
  expect(runtime.snapshot().stopCause).toBe("loot_denied:loot slot refused");
});

test("full inventory stops with loot_inventory_full", async () => {
  const loot = fakeLoot({ items: [4, 7], inventoryFull: true });
  const runtime = makeCycle({
    tactics: fakeTactics([]),
    loot,
    recovery: fakeRecovery({ life: ["alive"] }),
    control: fakeControl(),
    now: () => 0,
  });
  await runtime.start({ guids: [2n], instruction: "fight" });
  expect(runtime.snapshot().stopCause).toBe("loot_inventory_full");
});

test("release-only denial stops with reconnect cause", async () => {
  const loot = fakeLoot({ releaseOnly: true });
  const runtime = makeCycle({
    tactics: fakeTactics([]),
    loot,
    recovery: fakeRecovery({ life: ["alive"] }),
    control: fakeControl(),
    now: () => 0,
  });
  await runtime.start({ guids: [2n], instruction: "fight" });
  expect(runtime.snapshot().stopCause).toBe(
    "loot_release_only_reconnect_required",
  );
});

test("current resurrection offer is accepted and the cycle continues", async () => {
  const recovery = fakeRecovery({
    offer: true,
    life: ["ghost", "alive"],
  });
  const runtime = makeCycle({
    tactics: fakeTactics([]),
    loot: fakeLoot({ items: [], money: 0 }),
    recovery,
    control: fakeControl(),
    now: () => 0,
  });
  await runtime.start({ guids: [1n, 2n], instruction: "fight" });
  expect(recovery.answered()).toBe(true);
  const state = runtime.snapshot();
  expect(state).toMatchObject({
    phase: "stopped",
    stopCause: "queue_exhausted",
    lastRecovery: { outcome: "resurrected" },
  });
  expect(state.queue.map((record) => record.status)).toEqual(["done", "done"]);
});
