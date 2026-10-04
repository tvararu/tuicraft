import { Emitter, type Unsubscribe } from "#lib/emitter";
import {
  RAID_ASSISTANT_FLAG,
  RAID_MAIN_ASSIST_FLAG,
  RAID_MAIN_TANK_FLAG,
  type RaidGroup,
} from "#wow/areas/raid/protocol";
import type { RaidTargetUpdate } from "#wow/areas/raid/protocol-marks";
import type { SummonRequest } from "#wow/areas/raid/protocol-summon";
import { MarkStore, type MarksEvent } from "#wow/areas/raid/store-marks";
import {
  type ReadyCheck,
  type ReadyEvent,
  ReadyStore,
} from "#wow/areas/raid/store-ready";
import {
  type MemberStats,
  mergeMemberStats,
  type StatsEvent,
  statsTransitions,
} from "#wow/areas/raid/store-stats";
import type { CommandResultEvent } from "#wow/areas/raid/store-structure";
import {
  type Summon,
  type SummonEvent,
  SummonStore,
} from "#wow/areas/raid/store-summon";
import type { ZoneNames } from "#wow/areas/raid/zone-names";
import type { PartyMemberStats } from "#wow/protocol/group-stats";
export type RaidChange =
  | { kind: "converted" }
  | { kind: "subgroup"; name?: string; self?: true; from: number; to: number }
  | {
      kind: "flag";
      name?: string;
      self?: true;
      flag: "assistant" | "main_tank" | "main_assist";
      on: boolean;
    }
  | { kind: "loot" }
  | { kind: "difficulty" }
  | { kind: "joined"; name: string }
  | { kind: "left"; name: string }
  | { kind: "leader"; name?: string; self?: true }
  | { kind: "disbanded" };

export type RaidEvent =
  | { type: "group_list"; group: RaidGroup; changes: readonly RaidChange[] }
  | { type: "invite_blocked"; name: string }
  | { type: "disbanded" }
  | StatsEvent
  | ReadyEvent
  | MarksEvent
  | SummonEvent
  | CommandResultEvent;

export type RaidState = {
  group: RaidGroup | undefined;
  stats: ReadonlyMap<bigint, MemberStats>;
  readyCheck?: ReadyCheck | undefined;
  marks: readonly bigint[];
  summon?: Summon | undefined;
};

const FLAG_NAMES = [
  [RAID_ASSISTANT_FLAG, "assistant"],
  [RAID_MAIN_TANK_FLAG, "main_tank"],
  [RAID_MAIN_ASSIST_FLAG, "main_assist"],
] as const;

function sameLoot(a: RaidGroup["loot"], b: RaidGroup["loot"]): boolean {
  return (
    a?.method === b?.method &&
    a?.master === b?.master &&
    a?.threshold === b?.threshold
  );
}

function sameDifficulty(
  a: RaidGroup["difficulty"],
  b: RaidGroup["difficulty"],
): boolean {
  return (
    a?.dungeon === b?.dungeon && a?.raid === b?.raid && a?.heroic === b?.heroic
  );
}

type Member = RaidGroup["members"][number];

function converted(before: RaidGroup | undefined, after: RaidGroup): boolean {
  return (
    before !== undefined &&
    (before.kind !== after.kind ||
      before.battleground !== after.battleground ||
      before.dungeonFinder?.status !== after.dungeonFinder?.status ||
      before.dungeonFinder?.dungeonId !== after.dungeonFinder?.dungeonId)
  );
}

function selfChanges(
  before: RaidGroup["self"],
  after: RaidGroup["self"],
): RaidChange[] {
  const changes: RaidChange[] = [];
  if (before.subgroup !== after.subgroup)
    changes.push({
      from: before.subgroup,
      kind: "subgroup",
      self: true,
      to: after.subgroup,
    });
  for (const [bit, flag] of FLAG_NAMES)
    if ((before.flags & bit) !== (after.flags & bit))
      changes.push({
        flag,
        kind: "flag",
        on: (after.flags & bit) !== 0,
        self: true,
      });
  return changes;
}

function rosterChanges(
  previous: Member | undefined,
  member: Member,
): RaidChange[] {
  if (!previous) return [{ kind: "joined", name: member.name }];
  const changes: RaidChange[] = [];
  if (previous.subgroup !== member.subgroup)
    changes.push({
      from: previous.subgroup,
      kind: "subgroup",
      name: member.name,
      to: member.subgroup,
    });
  for (const [bit, flag] of FLAG_NAMES)
    if ((previous.flags & bit) !== (member.flags & bit))
      changes.push({
        flag,
        kind: "flag",
        name: member.name,
        on: (member.flags & bit) !== 0,
      });
  return changes;
}

function leaderChange(
  before: RaidGroup | undefined,
  after: RaidGroup,
): RaidChange | undefined {
  if (!before || before.leader === after.leader) return undefined;
  const leader = after.members.find((member) => member.guid === after.leader);
  if (leader) return { kind: "leader", name: leader.name };
  return after.leader === 0n ? undefined : { kind: "leader", self: true };
}

function flagChanges(
  before: RaidGroup | undefined,
  after: RaidGroup,
): RaidChange[] {
  const changes: RaidChange[] = [];
  if (converted(before, after)) changes.push({ kind: "converted" });
  if (before) changes.push(...selfChanges(before.self, after.self));
  const old = new Map(
    (before?.members ?? []).map((member) => [member.guid, member]),
  );
  for (const member of after.members)
    changes.push(...rosterChanges(old.get(member.guid), member));
  const guids = new Set(after.members.map((member) => member.guid));
  for (const member of before?.members ?? [])
    if (!guids.has(member.guid))
      changes.push({ kind: "left", name: member.name });
  const leader = leaderChange(before, after);
  if (leader) changes.push(leader);
  return changes;
}

export class RaidStore {
  private readonly events = new Emitter<[RaidEvent]>();
  private group: RaidGroup | undefined;
  private readonly ready: ReadyStore;
  private readonly markStore = new MarkStore();
  private readonly summons = new SummonStore();
  private readonly selfGuid: () => bigint;
  private readonly stats = new Map<bigint, MemberStats>();
  private zones: ZoneNames | undefined;
  private counter = 0;

  constructor(selfGuid: () => bigint = () => 0n) {
    this.ready = new ReadyStore();
    this.selfGuid = selfGuid;
  }

  snapshot(): RaidState {
    return {
      group: this.group,
      marks: this.markStore.current(),
      readyCheck: this.ready.current(),
      stats: this.stats,
      summon: this.summons.current(),
    };
  }

  onEvent(cb: (event: RaidEvent) => void): Unsubscribe {
    return this.events.subscribe(cb);
  }

  private pruneStats(group: RaidGroup | undefined): void {
    const guids = new Set(group?.members.map((member) => member.guid));
    for (const guid of [...this.stats.keys()])
      if (!guids.has(guid)) this.stats.delete(guid);
  }

  receiveList(packet: RaidGroup, counter: number): void {
    const current = this.group;
    if (current !== undefined && packet.groupGuid !== current.groupGuid) {
      if (packet.members.length === 0) return;
    } else if (counter <= this.counter && current !== undefined) return;
    this.counter = counter;
    if (packet.members.length === 0) {
      if (this.group !== undefined) {
        this.group = undefined;
        this.ready.clear();
        this.markStore.clear();
        this.pruneStats(undefined);
        this.events.emit({ type: "disbanded" });
      }
      return;
    }
    const before = this.group;
    if (before && before.groupGuid !== packet.groupGuid) this.markStore.clear();
    this.group = packet;
    this.pruneStats(packet);
    const changes = flagChanges(before, packet);
    if (before && !sameLoot(before.loot, packet.loot))
      changes.push({ kind: "loot" });
    if (before && !sameDifficulty(before.difficulty, packet.difficulty))
      changes.push({ kind: "difficulty" });
    this.events.emit({ changes, group: packet, type: "group_list" });
  }

  receiveInviteBlocked(name: string): void {
    this.events.emit({ name, type: "invite_blocked" });
  }

  receiveCommandResult(event: CommandResultEvent): void {
    this.events.emit(event);
  }

  receiveReadyStart(initiator: bigint, now: number): void {
    this.events.emit(
      this.ready.start(this.group, initiator, now, this.selfGuid()),
    );
  }

  receiveReadyConfirm(guid: bigint, ready: boolean): void {
    const event = this.ready.confirm(this.group, guid, ready);
    if (event) this.events.emit(event);
  }

  receiveReadyFinished(now: number): void {
    const event = this.ready.finish(this.group, now);
    if (event) this.events.emit(event);
  }

  noteOwnReadyAnswer(ready: boolean): void {
    this.ready.own(ready);
  }

  receiveTarget(update: RaidTargetUpdate): void {
    const event = this.markStore.receive(this.group, update);
    if (event) this.events.emit(event);
  }

  receivePing(who: bigint, x: number, y: number): void {
    this.events.emit(this.markStore.ping(this.group, who, x, y));
  }

  setZoneNames(zones: ZoneNames): void {
    this.zones = zones;
  }

  receiveSummon(packet: SummonRequest, now: number): void {
    const name =
      this.group?.members.find((member) => member.guid === packet.summoner)
        ?.name ?? "";
    this.events.emit(
      this.summons.receive(packet, now, name, this.zones?.get(packet.zoneId)),
    );
  }

  expireSummon(expiresAt: number): void {
    const event = this.summons.expire(expiresAt);
    if (event) this.events.emit(event);
  }

  clearSummon(): void {
    this.summons.clear();
  }

  dispose(): void {
    this.events.clear();
    this.summons.clear();
    this.ready.clear();
    this.markStore.clear();
    this.group = undefined;
    this.stats.clear();
    this.counter = 0;
  }

  receiveStats(stats: PartyMemberStats, now: number): void {
    const guid = (BigInt(stats.guidHigh) << 32n) | BigInt(stats.guidLow >>> 0);
    const member = this.group?.members.find((entry) => entry.guid === guid);
    if (!member) return;
    const before = this.stats.get(guid);
    const merged = mergeMemberStats(stats, before, member.name, now);
    this.stats.set(guid, merged);
    const transitions = statsTransitions(before, merged);
    this.events.emit({
      guid,
      name: member.name,
      transitions,
      type: "member_stats",
    });
  }
}
