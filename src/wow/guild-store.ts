export type GuildMember = {
  guid: bigint;
  name: string;
  rankIndex: number;
  level: number;
  playerClass: number;
  gender: number;
  area: number;
  status: number;
  timeOffline: number;
  publicNote: string;
  officerNote: string;
};

export type GuildRoster = {
  guildName: string;
  motd: string;
  guildInfo: string;
  rankNames: string[];
  members: GuildMember[];
};

export type GuildEvent =
  | { type: "guild-roster"; roster: GuildRoster }
  | { type: "promotion"; officer: string; member: string; rank: string }
  | { type: "demotion"; officer: string; member: string; rank: string }
  | { type: "motd"; text: string }
  | { type: "joined"; name: string }
  | { type: "left"; name: string }
  | { type: "removed"; member: string; officer: string }
  | { type: "leader_is"; name: string }
  | { type: "leader_changed"; oldLeader: string; newLeader: string }
  | { type: "disbanded" }
  | { type: "signed_on"; name: string }
  | { type: "signed_off"; name: string };

export class GuildStore {
  private members: Map<bigint, GuildMember>;
  private guildName: string;
  private motd: string;
  private guildInfo: string;
  private rankNames: string[];
  private listener?: (event: GuildEvent) => void;

  constructor() {
    this.members = new Map();
    this.guildName = "";
    this.motd = "";
    this.guildInfo = "";
    this.rankNames = [];
  }

  onEvent(cb: (event: GuildEvent) => void): void {
    this.listener = cb;
  }

  setRoster(motd: string, guildInfo: string, members: GuildMember[]): void {
    this.motd = motd;
    this.guildInfo = guildInfo;
    this.members.clear();
    for (const m of members) {
      this.members.set(m.guid, { ...m });
    }
    this.fire();
  }

  setGuildMeta(name: string, rankNames: string[]): void {
    this.guildName = name;
    this.rankNames = rankNames;
    if (this.members.size > 0) this.fire();
  }

  get(): GuildRoster | undefined {
    if (this.members.size === 0) return undefined;
    return {
      guildName: this.guildName,
      motd: this.motd,
      guildInfo: this.guildInfo,
      rankNames: this.rankNames,
      members: this.all(),
    };
  }

  all(): GuildMember[] {
    return [...this.members.values()].sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  }

  private fire(): void {
    const roster = this.get();
    if (roster) this.listener?.({ type: "guild-roster", roster });
  }
}
