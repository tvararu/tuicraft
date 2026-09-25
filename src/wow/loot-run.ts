import { messageOf } from "lib/errors";
import { cycleStop as stop, type CycleStop } from "wow/cycle-stop";
import type { CycleDeps, CycleLootRecord } from "wow/encounter-cycle";
import { fieldOf, type EntityEvent } from "wow/entity-store";
import type { EventWaiter } from "wow/event-waiter";
import { UNIT_FIELDS } from "wow/protocol/entity-fields";
import {
  NOT_DEAD,
  NOT_LOOTABLE,
  type RewardsEvent,
  type RewardsState,
} from "wow/rewards";

const LOOT_SETTLE_MS = 5000;

export type LootRun = Pick<CycleDeps, "rewards"> & {
  events: EventWaiter<RewardsEvent>;
  bodies: EventWaiter<EntityEvent>;
  signal: AbortSignal;
};

type Looted = { ok: true; record: CycleLootRecord | undefined } | CycleStop;
type Opened = { ok: true; state: RewardsState | undefined } | CycleStop;
type Corpse = "lootable" | "empty" | CycleStop;
type Taken = { ok: true; taken: boolean } | CycleStop;

export async function lootCorpse(run: LootRun, guid: bigint): Promise<Looted> {
  const opened = await openLoot(run, guid);
  if (!opened.ok) return opened;
  if (!opened.state) return { ok: true, record: undefined };
  const offer = opened.state.loot;
  if (offer.phase !== "open") return stop("loot_denied:unexpected_phase");
  const slotsTaken: number[] = [];
  for (const { slot } of offer.items) {
    const result = await take(run, () => run.rewards.take(slot), slot);
    if (!result.ok) return result;
    if (result.taken) slotsTaken.push(slot);
  }
  let moneyTaken = 0;
  if (offer.money > 0) {
    const result = await take(run, () => run.rewards.takeMoney());
    if (!result.ok) return result;
    if (result.taken) moneyTaken = offer.money;
  }
  const closed = await closeLoot(run);
  if (!closed.ok) return closed;
  const record = {
    guid: guid.toString(),
    slotsTaken,
    moneyTaken,
    coinageBefore: opened.state.inventory.coinage,
    coinageAfter: run.rewards.snapshot().inventory.coinage,
  };
  return { ok: true, record };
}

async function awaitCorpse(run: LootRun, guid: bigint): Promise<Corpse> {
  const first = tryOpen(run, guid);
  if (first !== NOT_DEAD) return first;
  const died = (event: EntityEvent) =>
    event.type === "disappear" ||
    fieldOf(event.entity, UNIT_FIELDS.HEALTH.offset) === 0;
  const event = await run.bodies.find(died, LOOT_SETTLE_MS, run.signal);
  if (!event) return stop("corpse_unconfirmed");
  if (event.type === "disappear") return "empty";
  const second = tryOpen(run, guid);
  return second === NOT_DEAD ? stop(`loot_denied:${NOT_DEAD}`) : second;
}

function tryOpen(run: LootRun, guid: bigint): Corpse | typeof NOT_DEAD {
  const refused = request(() => run.rewards.open(guid));
  if (!refused) return "lootable";
  if (refused.cause === `loot_denied:${NOT_LOOTABLE}`) return "empty";
  if (refused.cause === `loot_denied:${NOT_DEAD}`) return NOT_DEAD;
  return refused;
}

async function openLoot(run: LootRun, guid: bigint): Promise<Opened> {
  const corpse = await awaitCorpse(run, guid);
  if (corpse === "empty") return { ok: true, state: undefined };
  if (corpse !== "lootable") return corpse;
  for (;;) {
    const event = await run.events.next(LOOT_SETTLE_MS, run.signal);
    if (!event) return stop("loot_denied:timeout");
    if (event.type === "loot_opened") return { ok: true, state: event.state };
    if (event.type === "loot_error") return lootError(event);
    if (event.type === "loot_release_observed")
      return stop("loot_release_only_reconnect_required");
  }
}

async function take(
  run: LootRun,
  send: () => void,
  slot?: number,
): Promise<Taken> {
  const refused = request(send);
  if (refused) return refused;
  for (;;) {
    const event = await run.events.next(LOOT_SETTLE_MS, run.signal);
    if (!event) return stop("loot_denied:timeout");
    if (
      event.type === "inventory_error" &&
      event.state.lastInventoryError?.inventoryFull
    )
      return stop("loot_inventory_full");
    if (event.type === "loot_error") return lootError(event);
    if (slot === undefined) {
      if (event.type === "loot_money_cleared") return { ok: true, taken: true };
      continue;
    }
    if (event.type === "loot_removed" && removed(event.state, slot))
      return { ok: true, taken: true };
    if (event.type === "loot_release_observed")
      return { ok: true, taken: false };
  }
}

async function closeLoot(run: LootRun): Promise<{ ok: true } | CycleStop> {
  const refused = request(() => run.rewards.close());
  if (refused) return refused;
  for (;;) {
    const event = await run.events.next(LOOT_SETTLE_MS, run.signal);
    if (!event) break;
    if (event.type !== "loot_release_observed") continue;
    const { loot, lastRelease } = event.state;
    if (loot.phase === "closed" && lastRelease?.status === 1)
      return { ok: true };
    break;
  }
  return stop("loot_release_unconfirmed");
}

function removed(state: RewardsState, slot: number): boolean {
  const { loot } = state;
  if (loot.phase !== "open" && loot.phase !== "closing") return false;
  return !loot.items.some((item) => item.slot === slot);
}

function request(send: () => void): CycleStop | undefined {
  try {
    send();
  } catch (error) {
    return stop(`loot_denied:${messageOf(error, "loot_request_failed")}`);
  }
  return undefined;
}

function lootError(event: RewardsEvent): CycleStop {
  const error = event.state.lastLootError?.error;
  return stop(`loot_denied:${error === undefined ? "unknown" : String(error)}`);
}
