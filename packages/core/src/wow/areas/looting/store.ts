import { Emitter, type Unsubscribe } from "#lib/emitter";
import type { LootList, LootMasterList } from "#wow/areas/looting/protocol";
import type { LootRemoved, LootResponse } from "#wow/protocol/loot";
import type { RewardsStore } from "#wow/rewards-store";
import type { CoreStores, SessionDeps } from "#wow/session-stores";

export const LOOT_OWNER_LIMIT = 64;

export type LootMine = "yes" | "no" | "unknown";
export type LootOwner = { master: bigint; looter: bigint; mine: LootMine };
export type LootingState = {
  owners: ReadonlyMap<bigint, LootOwner>;
  masterCandidates: ReadonlyMap<bigint, readonly bigint[]>;
  passOnLoot: boolean;
};
export type LootingEvent =
  | {
      type: "loot_owner";
      creature: bigint;
      master: bigint;
      looter: bigint;
      mine: LootMine;
    }
  | { type: "master_loot_candidates"; candidates: readonly bigint[] }
  | { type: "loot_removed"; slot: number }
  | { type: "loot_error"; guid: bigint; error: number };

function mineOf(packet: LootList, self: bigint): LootMine {
  const { master, looter } = packet;
  if (self !== 0n && (master === self || looter === self)) return "yes";
  return master === 0n && looter === 0n ? "unknown" : "no";
}

export class LootingStore {
  private readonly events = new Emitter<[LootingEvent]>();
  private readonly owners = new Map<bigint, LootOwner>();
  private readonly candidates = new Map<bigint, readonly bigint[]>();
  private readonly rewards: RewardsStore;
  private pending: readonly bigint[] = [];
  private pendingFor: bigint | undefined;
  private readonly selfGuid: () => bigint;
  private passOnLoot = false;

  constructor(deps: SessionDeps, core: CoreStores) {
    this.rewards = core.rewards;
    this.selfGuid = deps.selfGuid;
  }

  snapshot(): LootingState {
    return {
      owners: new Map(
        [...this.owners].map(([creature, owner]) => [creature, { ...owner }]),
      ),
      masterCandidates: new Map(
        [...this.candidates].map(([creature, guids]) => [creature, [...guids]]),
      ),
      passOnLoot: this.passOnLoot,
    };
  }

  onEvent(cb: (event: LootingEvent) => void): Unsubscribe {
    return this.events.subscribe(cb);
  }

  receiveLootList(packet: LootList): void {
    const owner: LootOwner = {
      master: packet.master,
      looter: packet.looter,
      mine: mineOf(packet, this.selfGuid()),
    };
    this.owners.delete(packet.creature);
    this.owners.set(packet.creature, owner);
    for (const oldest of this.owners.keys()) {
      if (this.owners.size <= LOOT_OWNER_LIMIT) break;
      this.owners.delete(oldest);
    }
    this.events.emit({
      type: "loot_owner",
      creature: packet.creature,
      ...owner,
    });
  }

  receiveMasterList(packet: LootMasterList): void {
    const loot = this.rewards.loot;
    if (loot.phase === "opening") this.pendingFor = loot.guid;
    this.pending = [...packet.candidates];
    this.events.emit({
      type: "master_loot_candidates",
      candidates: [...packet.candidates],
    });
  }

  receiveLooted(response: LootResponse): void {
    if (response.kind !== "loot") return;
    if (this.pending.length === 0) return;
    const creature =
      this.pendingFor === undefined || this.pendingFor === response.guid
        ? response.guid
        : this.pendingFor;
    this.candidates.delete(creature);
    this.candidates.set(creature, [...this.pending]);
    this.pending = [];
    this.pendingFor = undefined;
    for (const oldest of this.candidates.keys()) {
      if (this.candidates.size <= LOOT_OWNER_LIMIT) break;
      this.candidates.delete(oldest);
    }
  }

  candidatesFor(creature: bigint): readonly bigint[] {
    return this.candidates.get(creature) ?? [];
  }

  receiveLootRemoved(packet: LootRemoved): void {
    this.events.emit({ type: "loot_removed", slot: packet.slot });
  }

  receiveLootError(response: LootResponse): void {
    if (response.kind !== "error" || response.lootType !== 0) return;
    this.events.emit({
      type: "loot_error",
      guid: response.guid,
      error: response.error,
    });
  }

  forget(creature: bigint): void {
    this.owners.delete(creature);
  }

  setPassOnLoot(pass: boolean): void {
    this.passOnLoot = pass;
  }

  dispose(): void {
    this.events.clear();
    this.owners.clear();
    this.candidates.clear();
    this.pending = [];
  }
}
