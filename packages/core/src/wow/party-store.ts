import type { GroupList } from "#wow/protocol/group";
import { joinGuid } from "#wow/protocol/packet";

export const LOOT_METHODS: Record<number, string> = {
  0: "free_for_all",
  1: "round_robin",
  2: "master_loot",
  3: "group_loot",
  4: "need_before_greed",
};

export const ITEM_QUALITIES: Record<number, string> = {
  0: "poor",
  1: "common",
  2: "uncommon",
  3: "rare",
  4: "epic",
  5: "legendary",
  6: "artifact",
  7: "heirloom",
};

export type PartyMemberStats = {
  online?: boolean;
  hp?: number;
  maxHp?: number;
  level?: number;
};

export type PartyMember = {
  name: string;
  guid: bigint;
  online: boolean;
  health: number | null;
  maxHealth: number | null;
  level: number | null;
  statsAt: number | null;
  source: "unit" | "party_stats" | null;
};

export type PartyUnit = { health: number; maxHealth: number; level: number };

export type PartyLoot = {
  method: string;
  masterLooter: bigint | null;
  threshold: string;
};

export type PartyState = {
  inGroup: boolean;
  leader: string | null;
  loot: PartyLoot | null;
  members: PartyMember[];
};

export type PartyChange = {
  formed: boolean;
  added: string[];
  removed: string[];
};

type Stats = Omit<PartyMember, "name" | "guid" | "online" | "source">;

export class PartyStore {
  private state: PartyState = {
    inGroup: false,
    leader: null,
    loot: null,
    members: [],
  };
  private readonly stats = new Map<bigint, Stats>();

  snapshot(
    unitOf: (guid: bigint) => PartyUnit | undefined = () => undefined,
    now = 0,
  ): PartyState {
    return {
      ...this.state,
      loot: this.state.loot ? { ...this.state.loot } : null,
      members: this.state.members.map((member): PartyMember => {
        const unit = unitOf(member.guid);
        if (unit) return { ...member, ...unit, source: "unit", statsAt: now };
        const stats = this.stats.get(member.guid);
        return stats ? { ...member, ...stats, source: "party_stats" } : member;
      }),
    };
  }

  applyList(list: GroupList, leader: string): PartyChange {
    const before = new Set(this.state.members.map((member) => member.name));
    const formed = !this.state.inGroup && list.members.length > 0;
    const members = list.members.map((member) => ({
      name: member.name,
      guid: joinGuid(member.guidLow, member.guidHigh),
      online: member.online,
      health: null,
      maxHealth: null,
      level: null,
      statsAt: null,
      source: null,
    }));
    const { loot } = list;
    const looter = loot
      ? joinGuid(loot.looterGuidLow, loot.looterGuidHigh)
      : 0n;
    this.state = {
      inGroup: members.length > 0,
      leader: members.length > 0 ? leader || null : null,
      loot: loot
        ? {
            method: LOOT_METHODS[loot.method] ?? `method_${loot.method}`,
            masterLooter: looter === 0n ? null : looter,
            threshold:
              ITEM_QUALITIES[loot.threshold] ?? `quality_${loot.threshold}`,
          }
        : null,
      members,
    };
    const after = new Set(members.map((member) => member.name));
    for (const guid of this.stats.keys())
      if (!members.some((member) => member.guid === guid))
        this.stats.delete(guid);
    return {
      formed,
      added: formed ? [] : [...after].filter((name) => !before.has(name)),
      removed: [...before].filter((name) => !after.has(name)),
    };
  }

  applyLeader(name: string): void {
    if (this.state.inGroup) this.state.leader = name;
  }

  applyStats(guid: bigint, update: PartyMemberStats, now: number): void {
    const previous = this.stats.get(guid) ?? {
      health: null,
      maxHealth: null,
      level: null,
      statsAt: null,
    };
    this.stats.set(guid, {
      health: update.hp ?? previous.health,
      maxHealth: update.maxHp ?? previous.maxHealth,
      level: update.level ?? previous.level,
      statsAt: now,
    });
    const member = this.state.members.find((entry) => entry.guid === guid);
    if (member && update.online !== undefined) member.online = update.online;
  }

  clear(): void {
    this.state = { inGroup: false, leader: null, loot: null, members: [] };
    this.stats.clear();
  }
}
