import { jest } from "bun:test";
import { Emitter, type Unsubscribe } from "lib/emitter";
import type {
  ControlEvent,
  ControlPose,
  ControlState,
  MovementDirection,
} from "wow/control";
import { type CycleDeps, EncounterCycleRuntime } from "wow/encounter-cycle";
import type { EntityEvent, UnitEntity } from "wow/entity-store";
import { ObjectType, UNIT_FIELDS } from "wow/protocol/entity-fields";
import type { RecoveryEvent } from "wow/recovery";
import {
  NOT_DEAD,
  NOT_LOOTABLE,
  type RewardsEvent,
  type RewardsState,
} from "wow/rewards";

export function fakeTactics(outcomes: (string | Error)[]) {
  let calls = 0;
  return {
    calls: () => calls,
    snapshot: () => ({
      lastOutcome: { reason: "killed", status: "completed" as const },
    }),
    start: async (
      _ctx: { targetGuid: bigint; instruction: string },
      _s?: AbortSignal,
    ) => {
      const next = outcomes[calls++];
      if (next instanceof Error) throw next;
    },
    stop: (_r: string) => {},
  };
}

export type FakeCorpseLoot = { dead: boolean; lootable: boolean };

export function body(guid: bigint, health: number): EntityEvent {
  const entity: UnitEntity = {
    class_: 0,
    displayId: 0,
    entry: 0,
    factionTemplate: 0,
    gender: 0,
    guid,
    health,
    level: 1,
    maxHealth: 10,
    maxPower: [],
    name: undefined,
    npcFlags: 0,
    objectType: ObjectType.UNIT,
    position: undefined,
    power: [],
    race: 0,
    rawFields: new Map([[UNIT_FIELDS.HEALTH.offset, health]]),
    scale: 1,
    target: 0n,
    unitFlags: 0,
  };
  return { changed: ["health", "rawFields"], entity, type: "update" };
}

export function fakeLoot(config: {
  items?: number[];
  money?: number;
  coinageBefore?: number;
  coinageAfter?: number;
  openError?: number;
  takeError?: string;
  inventoryFull?: boolean;
  openFailure?: string;
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
  const listeners = new Emitter<[RewardsEvent]>();
  let lastRelease: RewardsState["lastRelease"];
  let lastOpenFailure: RewardsState["lastOpenFailure"];
  const closeRequested = Promise.withResolvers<void>();

  function lootWindow(): RewardsState["loot"] {
    if (phase === "open" || phase === "closing")
      return {
        guid: 2n,
        invalidatedReason: undefined,
        items: [...remainingItems].map((slot) => ({
          count: 1,
          displayId: 0,
          itemId: 1000 + slot,
          randomPropertyId: 0,
          randomSuffix: 0,
          slot,
          slotType: 0,
        })),
        lootType: 1,
        money: windowMoney,
        openedAt: 0,
        phase,
      };
    if (phase === "opening")
      return {
        guid: 2n,
        invalidatedReason: undefined,
        phase: "opening",
        requestedAt: 0,
      };
    return { phase: "closed" };
  }

  function state(): RewardsState {
    const loot = lootWindow();
    return {
      disposed: false,
      inventory: {
        bags: [],
        coinage,
        freeSlots: undefined,
        issues: [],
        scope: "carried",
        selfGuid: 1n,
        slots: [],
        status: "complete",
      },
      lastInventoryError,
      lastItemPush: undefined,
      lastLootError,
      lastMoneyNotice: undefined,
      lastOpenFailure,
      lastRelease,
      loot,
      pending: undefined,
      rolls: { last: undefined, pending: [] },
    };
  }

  function emit(type: RewardsEvent["type"]): void {
    listeners.emit({ at: 0, state: state(), type });
  }
  function acknowledgeClose(): void {
    phase = "closed";
    lastRelease = { guid: 2n, observedAt: 0, status: 1 };
    emit("loot_release_observed");
  }

  return {
    acknowledgeClose,
    attempted: attempted.promise,
    close(): RewardsState {
      phase = "closing";
      closeRequested.resolve();
      if (!config.deferClose) queueMicrotask(acknowledgeClose);
      return state();
    },
    closing: closeRequested.promise,
    corpse,
    moneyTaken: () => moneyRequested,
    onEvent(callback: (event: RewardsEvent) => void) {
      return listeners.subscribe(callback);
    },
    open(_guid: bigint): RewardsState {
      attempted.resolve();
      if (!corpse.dead) throw new Error(NOT_DEAD);
      if (!corpse.lootable) throw new Error(NOT_LOOTABLE);
      phase = "opening";
      queueMicrotask(() => {
        if (config.openFailure !== undefined) {
          emit("loot_release_observed");
          phase = "closed";
          lastOpenFailure = {
            guid: 2n,
            observedAt: 0,
            reason: config.openFailure,
          };
          emit("loot_open_failed");
          return;
        }
        if (config.openError !== undefined) {
          lastLootError = { error: config.openError, guid: 2n, observedAt: 0 };
          phase = "closed";
          emit("loot_error");
          return;
        }
        phase = "open";
        emit("loot_opened");
      });
      return state();
    },
    snapshot(): RewardsState {
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
            bagFull: false,
            inventoryFull: true,
            observedAt: 0,
            packet: {
              bagType: 0,
              detail: { kind: "none" },
              item1: 0n,
              item2: 0n,
              kind: "error",
              result: 50,
            },
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
    taken: () => takenSlots,
  };
}

export function fakeControl(
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
  const listeners = new Emitter<[ControlEvent]>();
  const snapshot = () => ({ pose: pose ? { ...pose } : undefined, speed });
  const stopAfter = (ms: number, reason: string) =>
    setTimeout(() => {
      const state = snapshot() as ControlState;
      listeners.emit({ reason, state, type: "movement_stopped" });
    }, ms);
  return {
    face(orientation: number) {
      faced.push(orientation);
      if (pose) pose = { ...pose, orientation };
    },
    faced: () => faced,
    move(direction: MovementDirection, durationMs: number) {
      moves.push({ direction, durationMs });
      if (config.moveError) throw new Error(config.moveError);
      if (!pose) return;
      if (refusalsRemaining > 0) {
        refusalsRemaining--;
        throw new Error("height_unresolved");
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
    moves: () => moves,
    onEvent(cb: (event: ControlEvent) => void) {
      return listeners.subscribe(cb);
    },
    pose: (): ControlPose | undefined => (pose ? { ...pose } : undefined),
    snapshot,
  };
}

export type Wired<E> = {
  onEvent: (callback: (event: E) => void) => Unsubscribe;
};

export function makeCycle(
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

export async function advanceUntilSettled(
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
