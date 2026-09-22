import { test, expect, jest } from "bun:test";
import { EncounterCycleRuntime } from "wow/encounter-cycle";
import type { RewardsEvent, RewardsState } from "wow/rewards";
import type {
  RecoveryEvent,
  RecoveryReclaim,
  RecoveryState,
} from "wow/recovery";
import type { ControlPose, MovementDirection } from "wow/control";
import type { PlayerLife } from "wow/player-state";

function fakeTactics(
  outcomes: (string | Error)[],
  config: { deadOn?: number } = {},
) {
  let calls = 0;
  let lastCallIndex = -1;
  return {
    calls: () => calls,
    start: async (
      _ctx: { targetGuid: bigint; instruction: string },
      _s: AbortSignal,
    ) => {
      lastCallIndex = calls;
      const next = outcomes[calls++];
      if (next instanceof Error) throw next;
    },
    stop: (_r: string) => {},
    lastOutcome: () => ({ status: "completed" as const, reason: "killed" }),
    selfDead: () => lastCallIndex === config.deadOn,
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

type FakeCorpse =
  | { status: "unknown" }
  | { status: "absent" }
  | {
      status: "found";
      mapId: number;
      corpseMapId: number;
      position: { x: number; y: number; z: number };
    };

function fakeControl(
  config: { pose?: ControlPose; speed?: number; refuseMoves?: number } = {},
) {
  let pose: ControlPose | undefined = config.pose;
  const speed = config.speed ?? 7;
  let refusalsRemaining = config.refuseMoves ?? 0;
  const faced: number[] = [];
  const moves: { direction: MovementDirection; durationMs: number }[] = [];
  return {
    faced: () => faced,
    moves: () => moves,
    pose: (): ControlPose | undefined => (pose ? { ...pose } : undefined),
    face(orientation: number) {
      faced.push(orientation);
      if (pose) pose = { ...pose, orientation };
    },
    move(direction: MovementDirection, durationMs: number) {
      moves.push({ direction, durationMs });
      if (!pose) return;
      if (refusalsRemaining > 0) {
        refusalsRemaining--;
        return;
      }
      if (direction !== "forward") return;
      const traveled = (speed * durationMs) / 1000;
      pose = {
        ...pose,
        x: pose.x + Math.cos(pose.orientation) * traveled,
        y: pose.y + Math.sin(pose.orientation) * traveled,
      };
    },
  };
}

function fakeRecovery(config: {
  offerEpoch?: "current" | "stale" | "none";
  life: PlayerLife[];
  corpse?: FakeCorpse;
  pose?: () => ControlPose | undefined;
  now?: () => number;
  reclaimDelaySchedule?: Array<{ atMs: number; delayMs: number }>;
}) {
  let lifeIndex = 0;
  let snapshotCalls = 0;
  let answered = false;
  let responded: "unanswered" | "accept_requested" | "decline_requested" =
    "unanswered";
  const corpse: FakeCorpse = config.corpse ?? { status: "unknown" };
  let delay:
    | { delayMs: number; receivedAt: number; readyAt: number }
    | undefined;
  const now = config.now ?? (() => 0);
  const posefn = config.pose ?? (() => undefined);
  let listener: ((event: RecoveryEvent) => void) | undefined;

  function life(): PlayerLife {
    return config.life[Math.min(lifeIndex, config.life.length - 1)] ?? "dead";
  }

  function reclaimGate(): RecoveryReclaim {
    const pose = posefn();
    const remainingMs = delay ? Math.max(0, delay.readyAt - now()) : undefined;
    if (life() !== "ghost")
      return {
        canRequest: false,
        readiness: "blocked",
        reason: life() === "unknown" ? "life_unknown" : "not_ghost",
        distance: undefined,
        remainingMs,
        pose: pose ? { ...pose } : undefined,
      };
    if (corpse.status !== "found")
      return {
        canRequest: false,
        readiness: "blocked",
        reason: corpse.status === "absent" ? "corpse_absent" : "corpse_unknown",
        distance: undefined,
        remainingMs,
        pose: pose ? { ...pose } : undefined,
      };
    if (!pose)
      return {
        canRequest: false,
        readiness: "blocked",
        reason: "pose_unknown",
        distance: undefined,
        remainingMs,
        pose: undefined,
      };
    if (pose.mapId !== corpse.corpseMapId)
      return {
        canRequest: false,
        readiness: "blocked",
        reason: "corpse_map_mismatch",
        distance: undefined,
        remainingMs,
        pose: { ...pose },
      };
    const distance = Math.hypot(
      pose.x - corpse.position.x,
      pose.y - corpse.position.y,
      pose.z - corpse.position.z,
    );
    if (distance > 39)
      return {
        canRequest: false,
        readiness: "blocked",
        reason: "corpse_out_of_range",
        distance,
        remainingMs,
        pose: { ...pose },
      };
    if (remainingMs !== undefined && remainingMs > 0)
      return {
        canRequest: false,
        readiness: "blocked",
        reason: "reclaim_delay",
        distance,
        remainingMs,
        pose: { ...pose },
      };
    return {
      canRequest: true,
      readiness: remainingMs === undefined ? "unverified" : "ready",
      reason: undefined,
      distance,
      remainingMs,
      pose: { ...pose },
    };
  }

  function snapshot(): RecoveryState {
    snapshotCalls++;
    const epoch = config.offerEpoch === "stale" && snapshotCalls > 1 ? 2 : 1;
    return {
      life: life(),
      health: undefined,
      flags: undefined,
      selfGuid: 1n,
      epoch,
      corpse:
        corpse.status === "found"
          ? {
              ...corpse,
              position: { ...corpse.position },
              unknown: 0,
              observedAt: now(),
            }
          : corpse.status === "absent"
            ? { status: "absent", observedAt: now() }
            : { status: "unknown" },
      query: undefined,
      reclaimDelay: delay ? { ...delay } : undefined,
      reclaim: reclaimGate(),
      graveyard: undefined,
      resurrection:
        config.offerEpoch && config.offerEpoch !== "none"
          ? {
              guid: 99n,
              name: "Healer",
              reserved: 0,
              sickness: 0,
              delayMs: undefined,
              receivedAt: 0,
              readyAt: undefined,
              response: responded,
            }
          : undefined,
      request: undefined,
      disposed: false,
    };
  }

  function emit(type: RecoveryEvent["type"]): void {
    listener?.({ type, at: now(), state: snapshot() });
  }

  for (const entry of config.reclaimDelaySchedule ?? []) {
    if (entry.atMs <= 0) {
      delay = {
        delayMs: entry.delayMs,
        receivedAt: now(),
        readyAt: now() + entry.delayMs,
      };
      continue;
    }
    setTimeout(() => {
      delay = {
        delayMs: entry.delayMs,
        receivedAt: now(),
        readyAt: now() + entry.delayMs,
      };
      emit("reclaim_delay_observed");
    }, entry.atMs);
  }

  return {
    answered: () => answered,
    onEvent(cb: ((event: RecoveryEvent) => void) | undefined) {
      listener = cb;
    },
    snapshot,
    releaseSpirit() {
      lifeIndex++;
      emit("life_observed");
    },
    queryCorpse() {
      emit("corpse_observed");
    },
    reclaimCorpse() {
      lifeIndex++;
      emit("life_observed");
    },
    respondResurrection(accept: boolean) {
      answered = true;
      responded = accept ? "accept_requested" : "decline_requested";
      if (accept) {
        lifeIndex++;
        emit("life_observed");
      }
    },
  };
}

async function advanceUntilSettled(
  promise: Promise<unknown>,
  totalMs: number,
  options: { stepMs?: number; onTick?: (stepMs: number) => void } = {},
): Promise<void> {
  const stepMs = options.stepMs ?? 100;
  let settled = false;
  promise.finally(() => {
    settled = true;
  });
  for (let elapsed = 0; !settled && elapsed < totalMs; elapsed += stepMs) {
    await Promise.resolve();
    options.onTick?.(stepMs);
    jest.advanceTimersByTime(stepMs);
  }
  await promise;
}

test("lost target records cause and advances, loop stops at end of queue", async () => {
  const tactics = fakeTactics([new Error("target_unreachable")]);
  const loot = fakeLoot({});
  const runtime = new EncounterCycleRuntime({
    tactics,
    loot,
    recovery: fakeRecovery({ life: ["ghost"] }),
    control: fakeControl(),
    now: () => 0,
  });
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

test("blocked outcome skips without loot and advances", async () => {
  let starts = 0;
  const tactics = {
    start: async (
      _ctx: { targetGuid: bigint; instruction: string },
      _signal: AbortSignal,
    ) => {
      starts++;
    },
    stop: (_reason: string) => {},
    lastOutcome: () => ({ status: "blocked" as const, reason: "obstructed" }),
    selfDead: () => false,
  };
  const loot = fakeLoot({});
  const openedGuids: bigint[] = [];
  const innerOpen = loot.open;
  loot.open = (guid) => {
    openedGuids.push(guid);
    innerOpen(guid);
  };
  const runtime = new EncounterCycleRuntime({
    tactics,
    loot,
    recovery: fakeRecovery({ life: ["ghost"] }),
    control: fakeControl(),
    now: () => 0,
  });
  const events: string[] = [];
  runtime.onEvent((event) => events.push(event.type));
  await runtime.start({ guids: [1n, 2n], instruction: "fight", maxStarts: 5 });
  const state = runtime.snapshot();
  expect(state.queue[0]).toMatchObject({
    status: "skipped",
    cause: "obstructed",
  });
  expect(state.queue[1]).toMatchObject({
    status: "skipped",
    cause: "obstructed",
  });
  expect(starts).toBe(2);
  expect(openedGuids).toEqual([]);
  expect(events).toEqual(["started", "target_done", "target_done", "stopped"]);
  expect(state.lastLoot).toBeUndefined();
  expect(state.stopCause).toBe("queue_exhausted");
});

test("stops at max starts with cause", async () => {
  const tactics = fakeTactics([]);
  const loot = fakeLoot({});
  const runtime = new EncounterCycleRuntime({
    tactics,
    loot,
    recovery: fakeRecovery({ life: ["ghost"] }),
    control: fakeControl(),
    now: () => 0,
  });
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
  const runtime = new EncounterCycleRuntime({
    tactics,
    loot,
    recovery: fakeRecovery({ life: ["ghost"] }),
    control: fakeControl(),
    now: () => 0,
  });
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
    lastOutcome: () => ({ status: "completed" as const, reason: "killed" }),
    selfDead: () => false,
  };
  const loot = fakeLoot({});
  const runtime = new EncounterCycleRuntime({
    tactics,
    loot,
    recovery: fakeRecovery({ life: ["ghost"] }),
    control: fakeControl(),
    now: () => 0,
  });
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
    recovery: fakeRecovery({ life: ["ghost"] }),
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
  const runtime = new EncounterCycleRuntime({
    tactics: fakeTactics([]),
    loot,
    recovery: fakeRecovery({ life: ["ghost"] }),
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

test("denied offer stops with loot_denied cause", async () => {
  const loot = fakeLoot({ openError: 4 });
  const runtime = new EncounterCycleRuntime({
    tactics: fakeTactics([]),
    loot,
    recovery: fakeRecovery({ life: ["ghost"] }),
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
  const runtime = new EncounterCycleRuntime({
    tactics: fakeTactics([]),
    loot,
    recovery: fakeRecovery({ life: ["ghost"] }),
    control: fakeControl(),
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
    recovery: fakeRecovery({ life: ["ghost"] }),
    control: fakeControl(),
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
    recovery: fakeRecovery({ life: ["ghost"] }),
    control: fakeControl(),
    now: () => 0,
  });
  await runtime.start({ guids: [2n], instruction: "fight" });
  expect(runtime.snapshot().stopCause).toBe(
    "loot_release_only_reconnect_required",
  );
});

test("current resurrection offer is accepted and loop resumes", async () => {
  const recovery = fakeRecovery({
    offerEpoch: "current",
    life: ["ghost", "alive"],
  });
  const runtime = new EncounterCycleRuntime({
    tactics: fakeTactics([], { deadOn: 0 }),
    loot: fakeLoot({ items: [], money: 0 }),
    recovery,
    control: fakeControl(),
    now: () => 0,
  });
  await runtime.start({ guids: [1n, 2n], instruction: "fight" });
  expect(recovery.answered()).toBe(true);
  expect(runtime.snapshot()).toMatchObject({
    phase: "stopped",
    stopCause: "queue_exhausted",
  });
});

test("stale resurrection offer is ignored, corpse run proceeds", async () => {
  const control = fakeControl({
    pose: {
      mapId: 0,
      x: 0,
      y: 0,
      z: 0,
      orientation: 0,
      source: "predicted",
      updatedAt: 0,
    },
  });
  const recovery = fakeRecovery({
    offerEpoch: "stale",
    life: ["dead", "ghost", "alive"],
    corpse: {
      status: "found",
      mapId: 0,
      corpseMapId: 0,
      position: { x: 5, y: 0, z: 0 },
    },
    pose: () => control.pose(),
  });
  const runtime = new EncounterCycleRuntime({
    tactics: fakeTactics([], { deadOn: 0 }),
    loot: fakeLoot({ items: [], money: 0 }),
    recovery,
    control,
    now: () => 0,
  });
  await runtime.start({ guids: [1n, 2n], instruction: "fight" });
  expect(recovery.answered()).toBe(false);
  const state = runtime.snapshot();
  expect(state).toMatchObject({
    phase: "stopped",
    stopCause: "queue_exhausted",
  });
  expect(state.queue[0]).toMatchObject({ status: "skipped", cause: "died" });
  expect(state.queue[1]).toMatchObject({ status: "done" });
});

test("reclaim delay waits bounded then retries once", async () => {
  jest.useFakeTimers();
  try {
    let now = 0;
    const advance = (ms: number) => {
      now += ms;
    };
    const control = fakeControl({
      pose: {
        mapId: 0,
        x: 0,
        y: 0,
        z: 0,
        orientation: 0,
        source: "predicted",
        updatedAt: 0,
      },
    });
    const recovery = fakeRecovery({
      offerEpoch: "none",
      life: ["dead", "ghost", "alive"],
      corpse: {
        status: "found",
        mapId: 0,
        corpseMapId: 0,
        position: { x: 5, y: 0, z: 0 },
      },
      pose: () => control.pose(),
      now: () => now,
      reclaimDelaySchedule: [
        { atMs: 0, delayMs: 5000 },
        { atMs: 6000, delayMs: 6000 },
      ],
    });
    const runtime = new EncounterCycleRuntime({
      tactics: fakeTactics([], { deadOn: 0 }),
      loot: fakeLoot({ items: [], money: 0 }),
      recovery,
      control,
      now: () => now,
    });
    const started = runtime.start({ guids: [1n], instruction: "fight" });
    await advanceUntilSettled(started, 16000, { onTick: advance });
    expect(runtime.snapshot()).toMatchObject({
      phase: "stopped",
      stopCause: "queue_exhausted",
    });
  } finally {
    jest.useRealTimers();
  }
});

test("cross-map corpse stops with pose and range", async () => {
  const control = fakeControl({
    pose: {
      mapId: 0,
      x: 0,
      y: 0,
      z: 0,
      orientation: 0,
      source: "predicted",
      updatedAt: 0,
    },
  });
  const recovery = fakeRecovery({
    offerEpoch: "none",
    life: ["dead", "ghost"],
    corpse: {
      status: "found",
      mapId: 1,
      corpseMapId: 1,
      position: { x: 5, y: 0, z: 0 },
    },
    pose: () => control.pose(),
  });
  const runtime = new EncounterCycleRuntime({
    tactics: fakeTactics([], { deadOn: 0 }),
    loot: fakeLoot({ items: [], money: 0 }),
    recovery,
    control,
    now: () => 0,
  });
  await runtime.start({ guids: [1n], instruction: "fight" });
  const state = runtime.snapshot();
  expect(state.stopCause).toBe("corpse_out_of_range");
  expect(state.stopDetail).toMatchObject({
    pose: { mapId: 0, x: 0, y: 0, z: 0 },
  });
  expect(control.moves()).toEqual([]);
});

test("ground refusal retries once at fixed angle then stops", async () => {
  jest.useFakeTimers();
  try {
    const control = fakeControl({
      pose: {
        mapId: 0,
        x: 0,
        y: 0,
        z: 0,
        orientation: 0,
        source: "predicted",
        updatedAt: 0,
      },
      refuseMoves: 2,
    });
    const recovery = fakeRecovery({
      offerEpoch: "none",
      life: ["dead", "ghost"],
      corpse: {
        status: "found",
        mapId: 0,
        corpseMapId: 0,
        position: { x: 100, y: 0, z: 0 },
      },
      pose: () => control.pose(),
    });
    const runtime = new EncounterCycleRuntime({
      tactics: fakeTactics([], { deadOn: 0 }),
      loot: fakeLoot({ items: [], money: 0 }),
      recovery,
      control,
      now: () => 0,
    });
    const started = runtime.start({ guids: [1n], instruction: "fight" });
    await advanceUntilSettled(started, 8000);
    const state = runtime.snapshot();
    expect(state.stopCause).toBe("corpse_unreachable");
    expect(control.faced().length).toBe(2);
    expect(control.moves().length).toBe(2);
  } finally {
    jest.useRealTimers();
  }
});

test("reclaim restores life and resumes next target", async () => {
  jest.useFakeTimers();
  try {
    const control = fakeControl({
      pose: {
        mapId: 0,
        x: 0,
        y: 0,
        z: 0,
        orientation: 0,
        source: "predicted",
        updatedAt: 0,
      },
      speed: 7,
    });
    const recovery = fakeRecovery({
      offerEpoch: "none",
      life: ["dead", "ghost", "alive"],
      corpse: {
        status: "found",
        mapId: 0,
        corpseMapId: 0,
        position: { x: 20, y: 0, z: 0 },
      },
      pose: () => control.pose(),
    });
    const runtime = new EncounterCycleRuntime({
      tactics: fakeTactics([], { deadOn: 0 }),
      loot: fakeLoot({ items: [], money: 0 }),
      recovery,
      control,
      now: () => 0,
    });
    const started = runtime.start({ guids: [1n, 2n], instruction: "fight" });
    await advanceUntilSettled(started, 6000);
    const state = runtime.snapshot();
    expect(state).toMatchObject({
      phase: "stopped",
      stopCause: "queue_exhausted",
    });
    expect(state.queue[0]).toMatchObject({ status: "skipped", cause: "died" });
    expect(state.queue[1]).toMatchObject({ status: "done" });
  } finally {
    jest.useRealTimers();
  }
});

test("phase resets to fighting at the start of each target", async () => {
  const seen: string[] = [];
  let runtime!: EncounterCycleRuntime;
  const tactics = {
    start: async () => {
      seen.push(runtime.snapshot().phase);
    },
    stop: (_r: string) => {},
    lastOutcome: () => ({ status: "completed" as const, reason: "killed" }),
    selfDead: () => false,
  };
  runtime = new EncounterCycleRuntime({
    tactics,
    loot: fakeLoot({ items: [], money: 0, coinageBefore: 5, coinageAfter: 5 }),
    recovery: fakeRecovery({ life: ["ghost"] }),
    control: fakeControl(),
    now: () => 0,
  });
  await runtime.start({ guids: [1n, 2n], instruction: "fight" });
  expect(seen).toEqual(["fighting", "fighting"]);
  expect(runtime.snapshot()).toMatchObject({
    phase: "stopped",
    stopCause: "queue_exhausted",
  });
});

test("stale generation loot cleanup keeps the newer listener", async () => {
  jest.useFakeTimers();
  try {
    const emptyOpen = (): RewardsState => ({
      loot: {
        phase: "open",
        guid: 2n,
        lootType: 1,
        money: 0,
        items: [],
        openedAt: 0,
        invalidatedReason: undefined,
      },
      pending: undefined,
      inventory: {
        selfGuid: 1n,
        scope: "carried",
        status: "complete",
        coinage: 0,
        slots: [],
        bags: [],
        freeSlots: undefined,
        issues: [],
      },
      lastLootError: undefined,
      lastInventoryError: undefined,
      lastItemPush: undefined,
      lastMoneyNotice: undefined,
      lastRelease: undefined,
      disposed: false,
    });
    let listener: ((event: RewardsEvent) => void) | undefined;
    const loot = {
      open(_guid: bigint) {},
      take(_slot: number) {},
      takeMoney() {},
      close() {},
      onEvent(cb: ((event: RewardsEvent) => void) | undefined) {
        listener = cb;
      },
      snapshot(): RewardsState {
        return { ...emptyOpen(), loot: { phase: "closed" } };
      },
    };
    const runtime = new EncounterCycleRuntime({
      tactics: fakeTactics([]),
      loot,
      recovery: fakeRecovery({ life: ["ghost"] }),
      control: fakeControl(),
      now: () => 0,
    });
    const flush = async (rounds: number) => {
      for (let i = 0; i < rounds; i++) await Promise.resolve();
    };
    const tick = async (ms: number, stepMs = 250) => {
      for (let elapsed = 0; elapsed < ms; elapsed += stepMs) {
        await flush(5);
        jest.advanceTimersByTime(stepMs);
      }
      await flush(20);
    };
    const first = runtime.start({ guids: [1n], instruction: "a" });
    await flush(20);
    await tick(2500);
    const second = runtime.start({ guids: [2n], instruction: "b" });
    await flush(20);
    await tick(2500);
    listener?.({ type: "loot_opened", at: 0, state: emptyOpen() });
    await flush(20);
    await tick(5000);
    await Promise.all([first, second]);
    expect(runtime.snapshot()).toMatchObject({
      stopCause: "queue_exhausted",
      lastLoot: { slotsTaken: [], moneyTaken: 0 },
    });
  } finally {
    jest.useRealTimers();
  }
});
