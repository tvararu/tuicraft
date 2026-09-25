import { expect, jest, test } from "bun:test";
import type {
  ControlEvent,
  ControlPose,
  ControlState,
  MovementDirection,
} from "wow/control";
import { type CycleDeps, EncounterCycleRuntime } from "wow/encounter-cycle";
import type { EntityEvent, UnitEntity } from "wow/entity-store";
import type { PlayerLife } from "wow/player-state";
import { ObjectType, UNIT_FIELDS } from "wow/protocol/entity-fields";
import type {
  RecoveryEvent,
  RecoveryReclaim,
  RecoveryState,
} from "wow/recovery";
import {
  NOT_DEAD,
  NOT_LOOTABLE,
  type RewardsEvent,
  type RewardsState,
} from "wow/rewards";

function fakeTactics(outcomes: (string | Error)[]) {
  let calls = 0;
  return {
    calls: () => calls,
    start: async (
      _ctx: { targetGuid: bigint; instruction: string },
      _s?: AbortSignal,
    ) => {
      const next = outcomes[calls++];
      if (next instanceof Error) throw next;
    },
    stop: (_r: string) => {},
    snapshot: () => ({
      lastOutcome: { status: "completed" as const, reason: "killed" },
    }),
  };
}

type FakeCorpseLoot = { dead: boolean; lootable: boolean };

function body(guid: bigint, health: number): EntityEvent {
  const entity: UnitEntity = {
    guid,
    objectType: ObjectType.UNIT,
    entry: 0,
    scale: 1,
    position: undefined,
    rawFields: new Map([[UNIT_FIELDS.HEALTH.offset, health]]),
    name: undefined,
    health,
    maxHealth: 10,
    level: 1,
    factionTemplate: 0,
    displayId: 0,
    npcFlags: 0,
    unitFlags: 0,
    target: 0n,
    race: 0,
    class_: 0,
    gender: 0,
    power: [],
    maxPower: [],
  };
  return { type: "update", entity, changed: ["health", "rawFields"] };
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
  deferClose?: boolean;
  deferTake?: boolean;
  corpse?: FakeCorpseLoot;
}) {
  const corpse = config.corpse ?? { dead: true, lootable: true };
  const attempted = Promise.withResolvers<void>();
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
  let lastRelease: RewardsState["lastRelease"];
  const closeRequested = Promise.withResolvers<void>();

  function lootWindow(): RewardsState["loot"] {
    if (phase === "open" || phase === "closing")
      return {
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
      };
    if (phase === "opening")
      return {
        phase: "opening",
        guid: 2n,
        requestedAt: 0,
        invalidatedReason: undefined,
      };
    return { phase: "closed" };
  }

  function state(): RewardsState {
    const loot = lootWindow();
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
      lastRelease,
      disposed: false,
    };
  }

  function emit(type: RewardsEvent["type"]): void {
    listener?.({ type, at: 0, state: state() });
  }
  function acknowledgeClose(): void {
    phase = "closed";
    lastRelease = { guid: 2n, status: 1, observedAt: 0 };
    emit("loot_release_observed");
  }

  return {
    taken: () => takenSlots,
    corpse,
    attempted: attempted.promise,
    closing: closeRequested.promise,
    acknowledgeClose,
    moneyTaken: () => moneyRequested,
    onEvent(callback: ((event: RewardsEvent) => void) | undefined) {
      listener = callback;
    },
    snapshot(): RewardsState {
      return state();
    },
    open(_guid: bigint): RewardsState {
      attempted.resolve();
      if (!corpse.dead) throw new Error(NOT_DEAD);
      if (!corpse.lootable) throw new Error(NOT_LOOTABLE);
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
      return state();
    },
    take(slot: number): RewardsState {
      if (config.takeError) throw new Error(config.takeError);
      takenSlots.push(slot);
      if (config.deferTake) return state();
      remainingItems.delete(slot);
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
      return state();
    },
    takeMoney(): RewardsState {
      moneyRequested = true;
      windowMoney = 0;
      queueMicrotask(() => {
        coinage = config.coinageAfter;
        emit("loot_money_cleared");
      });
      return state();
    },
    close(): RewardsState {
      phase = "closing";
      closeRequested.resolve();
      if (!config.deferClose) queueMicrotask(acknowledgeClose);
      return state();
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

function positionedReclaim(
  corpse: Extract<FakeCorpse, { status: "found" }>,
  pose: ControlPose,
  remainingMs: number | undefined,
): RecoveryReclaim {
  if (pose.mapId !== corpse.corpseMapId)
    return blockedReclaim("corpse_map_mismatch", remainingMs, pose);
  const distance = Math.hypot(
    pose.x - corpse.position.x,
    pose.y - corpse.position.y,
    pose.z - corpse.position.z,
  );
  if (distance > 39)
    return blockedReclaim("corpse_out_of_range", remainingMs, pose, distance);
  if (remainingMs !== undefined && remainingMs > 0)
    return blockedReclaim("reclaim_delay", remainingMs, pose, distance);
  return {
    canRequest: true,
    readiness: remainingMs === undefined ? "unverified" : "ready",
    reason: undefined,
    distance,
    remainingMs,
    pose: { ...pose },
  };
}

function fakeControl(
  config: {
    pose?: ControlPose;
    speed?: number;
    refuseMoves?: number;
    moveError?: string;
    stopReason?: string;
  } = {},
) {
  let pose: ControlPose | undefined = config.pose;
  const speed = config.speed ?? 7;
  let refusalsRemaining = config.refuseMoves ?? 0;
  const faced: number[] = [];
  const moves: { direction: MovementDirection; durationMs: number }[] = [];
  let listener: ((event: ControlEvent) => void) | undefined;
  const snapshot = () => ({ pose: pose ? { ...pose } : undefined, speed });
  const stopAfter = (ms: number, reason: string) =>
    setTimeout(() => {
      const state = snapshot() as ControlState;
      listener?.({ type: "movement_stopped", state, reason });
    }, ms);
  return {
    faced: () => faced,
    moves: () => moves,
    pose: (): ControlPose | undefined => (pose ? { ...pose } : undefined),
    onEvent(cb: ((event: ControlEvent) => void) | undefined) {
      listener = cb;
    },
    snapshot,
    face(orientation: number) {
      faced.push(orientation);
      if (pose) pose = { ...pose, orientation };
    },
    move(direction: MovementDirection, durationMs: number) {
      moves.push({ direction, durationMs });
      if (config.moveError) throw new Error(config.moveError);
      if (!pose) return;
      if (refusalsRemaining > 0) {
        refusalsRemaining--;
        stopAfter(100, "height_unresolved");
        return;
      }
      stopAfter(durationMs, config.stopReason ?? "lease");
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

function blockedReclaim(
  reason: RecoveryReclaim["reason"],
  remainingMs: number | undefined,
  pose: ControlPose | undefined,
  distance?: number,
): RecoveryReclaim {
  return {
    canRequest: false,
    readiness: "blocked",
    reason,
    distance,
    remainingMs,
    pose: pose ? { ...pose } : undefined,
  };
}

function fakeRecovery(config: {
  offer?: boolean;
  life: PlayerLife[];
  corpse?: FakeCorpse;
  pose?: () => ControlPose | undefined;
  now?: () => number;
  reclaimDelaySchedule?: Array<{ atMs: number; delayMs: number }>;
}) {
  let lifeIndex = 0;
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
      return blockedReclaim(
        life() === "unknown" ? "life_unknown" : "not_ghost",
        remainingMs,
        pose,
      );
    if (corpse.status !== "found")
      return blockedReclaim(
        corpse.status === "absent" ? "corpse_absent" : "corpse_unknown",
        remainingMs,
        pose,
      );
    if (!pose) return blockedReclaim("pose_unknown", remainingMs, pose);
    return positionedReclaim(corpse, pose, remainingMs);
  }

  function corpseSnapshot(): RecoveryState["corpse"] {
    if (corpse.status === "found")
      return {
        ...corpse,
        position: { ...corpse.position },
        unknown: 0,
        observedAt: now(),
      };
    if (corpse.status === "absent")
      return { status: "absent", observedAt: now() };
    return { status: "unknown" };
  }

  function snapshot(): RecoveryState {
    return {
      life: life(),
      health: undefined,
      flags: undefined,
      selfGuid: 1n,
      epoch: 1,
      corpse: corpseSnapshot(),
      query: undefined,
      reclaimDelay: delay ? { ...delay } : undefined,
      reclaim: reclaimGate(),
      graveyard: undefined,
      resurrection: config.offer
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
      return snapshot();
    },
    queryCorpse() {
      emit("corpse_observed");
      return snapshot();
    },
    reclaimCorpse() {
      lifeIndex++;
      emit("life_observed");
      return snapshot();
    },
    respondResurrection(accept: boolean) {
      answered = true;
      responded = accept ? "accept_requested" : "decline_requested";
      if (accept) {
        lifeIndex++;
        emit("life_observed");
      }
      return snapshot();
    },
  };
}

type Wired<E> = {
  onEvent: (callback: ((event: E) => void) | undefined) => void;
};

function makeCycle(
  deps: Omit<CycleDeps, "rewards"> & {
    loot: CycleDeps["rewards"] & Wired<RewardsEvent>;
    recovery: CycleDeps["recovery"] & Wired<RecoveryEvent>;
    control: CycleDeps["control"] & Wired<ControlEvent>;
  },
): EncounterCycleRuntime {
  const runtime = new EncounterCycleRuntime({ ...deps, rewards: deps.loot });
  deps.loot.onEvent((event) => runtime.observeRewards(event));
  deps.recovery.onEvent((event) => runtime.observeRecovery(event));
  deps.control.onEvent((event) => runtime.observeControl(event));
  return runtime;
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
  const runtime = makeCycle({
    tactics,
    loot,
    recovery: fakeRecovery({ life: ["alive"] }),
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
      _signal?: AbortSignal,
    ) => {
      starts++;
    },
    stop: (_reason: string) => {},
    snapshot: () => ({
      lastOutcome: { status: "blocked" as const, reason: "obstructed" },
    }),
  };
  const loot = fakeLoot({});
  const openedGuids: bigint[] = [];
  const innerOpen = loot.open;
  loot.open = (guid) => {
    openedGuids.push(guid);
    return innerOpen(guid);
  };
  const runtime = makeCycle({
    tactics,
    loot,
    recovery: fakeRecovery({ life: ["alive"] }),
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

test("stop alone ends the running fight", async () => {
  const stops: string[] = [];
  const fighting = Promise.withResolvers<void>();
  const tactics = {
    start: (
      _ctx: { targetGuid: bigint; instruction: string },
      signal?: AbortSignal,
    ) => {
      fighting.resolve();
      const ended = Promise.withResolvers<void>();
      signal?.addEventListener("abort", () => ended.resolve(), { once: true });
      return ended.promise;
    },
    stop: (reason: string) => {
      stops.push(reason);
    },
    snapshot: () => ({ lastOutcome: undefined }),
  };
  const runtime = makeCycle({
    tactics,
    loot: fakeLoot({}),
    recovery: fakeRecovery({ life: ["alive"] }),
    control: fakeControl(),
    now: () => 0,
  });
  const running = runtime.start({ guids: [1n, 2n], instruction: "fight" });
  await fighting.promise;
  runtime.stop("halt");
  await running;
  expect(stops).toEqual(["halt"]);
  expect(runtime.snapshot()).toMatchObject({
    active: false,
    stopCause: "halt",
    startsUsed: 1,
  });
});

test("a stop during loot_done emits nothing after stopped", async () => {
  const runtime = makeCycle({
    tactics: fakeTactics([]),
    loot: fakeLoot({ items: [], money: 0 }),
    recovery: fakeRecovery({ life: ["alive"] }),
    control: fakeControl(),
    now: () => 0,
  });
  const events: string[] = [];
  runtime.onEvent((event) => {
    events.push(event.type);
    if (event.type === "loot_done") runtime.stop("halt");
  });
  await runtime.start({ guids: [1n, 2n], instruction: "fight" });
  expect(events).toEqual(["started", "loot_done", "stopped"]);
  expect(runtime.snapshot()).toMatchObject({
    currentIndex: 0,
    stopCause: "halt",
  });
});

test("stops at max starts with cause", async () => {
  const tactics = fakeTactics([]);
  const loot = fakeLoot({});
  const runtime = makeCycle({
    tactics,
    loot,
    recovery: fakeRecovery({ life: ["alive"] }),
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
  const runtime = makeCycle({
    tactics,
    loot,
    recovery: fakeRecovery({ life: ["alive"] }),
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
    snapshot: () => ({
      lastOutcome: { status: "completed" as const, reason: "killed" },
    }),
  };
  const loot = fakeLoot({});
  const runtime = makeCycle({
    tactics,
    loot,
    recovery: fakeRecovery({ life: ["alive"] }),
    control: fakeControl(),
    now: () => 0,
  });
  const first = runtime.start({ guids: [1n], instruction: "a" });
  const second = runtime.start({ guids: [2n], instruction: "b" });
  release();
  await Promise.all([first, second]);
  expect(runtime.snapshot().queue.map((r) => r.guid)).toEqual([2n]);
  expect(tactics.calls).toBe(2);
});

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

test("current resurrection offer is accepted and the cycle stops resurrected", async () => {
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
  expect(runtime.snapshot()).toMatchObject({
    phase: "stopped",
    stopCause: "resurrected",
  });
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
    const runtime = makeCycle({
      tactics: fakeTactics([]),
      loot: fakeLoot({ items: [], money: 0 }),
      recovery,
      control,
      now: () => now,
    });
    const started = runtime.start({ guids: [1n], instruction: "fight" });
    await advanceUntilSettled(started, 16_000, { onTick: advance });
    expect(runtime.snapshot()).toMatchObject({
      phase: "stopped",
      stopCause: "reclaimed",
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
    life: ["dead", "ghost"],
    corpse: {
      status: "found",
      mapId: 1,
      corpseMapId: 1,
      position: { x: 5, y: 0, z: 0 },
    },
    pose: () => control.pose(),
  });
  const runtime = makeCycle({
    tactics: fakeTactics([]),
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

test("a refused corpse-run move stops with its reason", async () => {
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
      moveError: "movement_blocked",
    });
    const recovery = fakeRecovery({
      life: ["dead", "ghost"],
      corpse: {
        status: "found",
        mapId: 0,
        corpseMapId: 0,
        position: { x: 100, y: 0, z: 0 },
      },
      pose: () => control.pose(),
    });
    const runtime = makeCycle({
      tactics: fakeTactics([]),
      loot: fakeLoot({ items: [], money: 0 }),
      recovery,
      control,
      now: () => 0,
    });
    const started = runtime.start({ guids: [1n], instruction: "fight" });
    await advanceUntilSettled(started, 8000);
    expect(runtime.snapshot()).toMatchObject({
      stopCause: "corpse_unreachable",
      stopDetail: { error: "movement_blocked" },
    });
    expect(control.moves().length).toBe(1);
  } finally {
    jest.useRealTimers();
  }
});

function ghostRun(config: {
  corpseX: number;
  refuseMoves?: number;
  stopReason?: string;
}) {
  let now = 0;
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
    refuseMoves: config.refuseMoves,
    stopReason: config.stopReason,
  });
  const recovery = fakeRecovery({
    life: ["dead", "ghost", "alive"],
    corpse: {
      status: "found",
      mapId: 0,
      corpseMapId: 0,
      position: { x: config.corpseX, y: 0, z: 0 },
    },
    pose: () => control.pose(),
    now: () => now,
    reclaimDelaySchedule: [{ atMs: 0, delayMs: 30_000 }],
  });
  const runtime = makeCycle({
    tactics: fakeTactics([]),
    loot: fakeLoot({ items: [], money: 0 }),
    recovery,
    control,
    now: () => now,
  });
  const run = async (totalMs: number) => {
    const started = runtime.start({ guids: [1n, 2n], instruction: "fight" });
    await advanceUntilSettled(started, totalMs, {
      onTick: (ms) => {
        now += ms;
      },
    });
  };
  return { control, runtime, run };
}

test("legs walk the ghost into range, reclaim and stop reclaimed", async () => {
  jest.useFakeTimers();
  try {
    const { control, runtime, run } = ghostRun({ corpseX: 200 });
    await run(60_000);
    const state = runtime.snapshot();
    expect(state).toMatchObject({ phase: "stopped", stopCause: "reclaimed" });
    expect(state.queue[0]).toMatchObject({ status: "skipped", cause: "died" });
    expect(state.queue[1]).toMatchObject({ status: "queued" });
    const detail = state.stopDetail as { range: number; legs: number };
    expect(detail.range).toBeLessThanOrEqual(39);
    expect(detail.range).toBeGreaterThan(20);
    expect(detail.legs).toBe(control.moves().length);
    expect(detail.legs).toBeGreaterThan(1);
  } finally {
    jest.useRealTimers();
  }
});

test("a leg that does not move retries with a heading offset", async () => {
  jest.useFakeTimers();
  try {
    const { control, runtime, run } = ghostRun({
      corpseX: 100,
      refuseMoves: 1,
    });
    await run(60_000);
    expect(runtime.snapshot().stopCause).toBe("reclaimed");
    const [first, second, third] = control.faced();
    expect(first).toBe(0);
    expect(second).toBeCloseTo(0.3);
    expect(third).toBeGreaterThan(Math.PI);
  } finally {
    jest.useRealTimers();
  }
});

test("a blocked stop after progress keeps the direct heading", async () => {
  jest.useFakeTimers();
  try {
    const { control, runtime, run } = ghostRun({
      corpseX: 200,
      stopReason: "height_unresolved",
    });
    await run(60_000);
    expect(runtime.snapshot().stopCause).toBe("reclaimed");
    expect(control.faced().every((heading) => heading === 0)).toBe(true);
  } finally {
    jest.useRealTimers();
  }
});

test("stalled legs exhaust the offsets and stop unreachable", async () => {
  jest.useFakeTimers();
  try {
    const { control, runtime, run } = ghostRun({
      corpseX: 100,
      refuseMoves: 99,
    });
    await run(60_000);
    expect(runtime.snapshot()).toMatchObject({
      stopCause: "corpse_unreachable",
      stopDetail: { legs: 11, range: 100 },
    });
    expect(control.faced().length).toBe(11);
  } finally {
    jest.useRealTimers();
  }
});

test("the leg bound stops out of range with pose and range", async () => {
  jest.useFakeTimers();
  try {
    const { control, runtime, run } = ghostRun({ corpseX: 2000 });
    await run(200_000);
    const state = runtime.snapshot();
    expect(state).toMatchObject({
      stopCause: "corpse_out_of_range",
      stopDetail: { legs: 40 },
    });
    expect((state.stopDetail as { range: number }).range).toBeGreaterThan(39);
    expect(control.moves().length).toBe(40);
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
    snapshot: () => ({
      lastOutcome: { status: "completed" as const, reason: "killed" },
    }),
  };
  runtime = makeCycle({
    tactics,
    loot: fakeLoot({ items: [], money: 0, coinageBefore: 5, coinageAfter: 5 }),
    recovery: fakeRecovery({ life: ["alive"] }),
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
    const closed = (): RewardsState => ({
      ...emptyOpen(),
      loot: { phase: "closed" },
    });
    const loot = {
      open: (_guid: bigint) => closed(),
      take: (_slot: number) => closed(),
      takeMoney: () => closed(),
      close() {
        queueMicrotask(() =>
          listener?.({
            type: "loot_release_observed",
            at: 0,
            state: {
              ...emptyOpen(),
              loot: { phase: "closed" },
              lastRelease: { guid: 2n, status: 1, observedAt: 0 },
            },
          }),
        );
        return closed();
      },
      onEvent(cb: ((event: RewardsEvent) => void) | undefined) {
        listener = cb;
      },
      snapshot: closed,
    };
    const runtime = makeCycle({
      tactics: fakeTactics([]),
      loot,
      recovery: fakeRecovery({ life: ["alive"] }),
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
