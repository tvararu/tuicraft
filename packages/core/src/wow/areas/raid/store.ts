import type { Unsubscribe } from "#lib/emitter";
import type { RaidGroup } from "#wow/areas/raid/protocol";
import type { RaidTargetUpdate } from "#wow/areas/raid/protocol-marks";
import type { SummonRequest } from "#wow/areas/raid/protocol-summon";
import {
  type RaidEvent,
  type RaidState,
  RaidStore,
} from "#wow/areas/raid/store-roster";
import { commandResultEvent } from "#wow/areas/raid/store-structure";
import type { ZoneNames } from "#wow/areas/raid/zone-names";
import type { PartyCommandResult } from "#wow/protocol/group";
import type { PartyMemberStats } from "#wow/protocol/group-stats";

export class RaidAreaStore {
  private readonly inner: RaidStore;
  private readonly now: () => number;

  constructor(
    now: () => number = () => Date.now(),
    selfGuid: () => bigint = () => 0n,
  ) {
    this.inner = new RaidStore(selfGuid);
    this.now = now;
  }

  snapshot(): RaidState {
    return this.inner.snapshot();
  }

  onEvent(cb: (event: RaidEvent) => void): Unsubscribe {
    return this.inner.onEvent(cb);
  }

  receiveList(packet: RaidGroup, counter: number): void {
    this.inner.receiveList(packet, counter);
  }

  receiveInviteBlocked(name: string): void {
    this.inner.receiveInviteBlocked(name);
  }

  receiveCommandResult(parsed: PartyCommandResult): void {
    this.inner.receiveCommandResult(commandResultEvent(parsed));
  }

  receiveStats(stats: PartyMemberStats): void {
    this.inner.receiveStats(stats, this.now());
  }

  receiveReadyStart(initiator: bigint): void {
    this.inner.receiveReadyStart(initiator, this.now());
  }

  receiveReadyConfirm(guid: bigint, ready: boolean): void {
    this.inner.receiveReadyConfirm(guid, ready);
  }

  receiveReadyFinished(): void {
    this.inner.receiveReadyFinished(this.now());
  }

  noteOwnReadyAnswer(ready: boolean): void {
    this.inner.noteOwnReadyAnswer(ready);
  }

  receiveTarget(update: RaidTargetUpdate): void {
    this.inner.receiveTarget(update);
  }

  receivePing(who: bigint, x: number, y: number): void {
    this.inner.receivePing(who, x, y);
  }

  receiveSummon(packet: SummonRequest): void {
    this.inner.receiveSummon(packet, this.now());
  }

  expireSummon(expiresAt: number): void {
    this.inner.expireSummon(expiresAt);
  }

  clearSummon(): void {
    this.inner.clearSummon();
  }

  setZoneNames(zones: ZoneNames): void {
    this.inner.setZoneNames(zones);
  }

  dispose(): void {
    this.inner.dispose();
  }
}
