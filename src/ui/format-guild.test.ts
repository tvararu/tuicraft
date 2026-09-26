import { describe, expect, test } from "bun:test";
import { must } from "test/must";
import { formatGuildRoster, formatGuildRosterJson } from "ui/format";
import { type GuildMember, GuildMemberStatus, type GuildRoster } from "wow";

function makeMember(overrides: Partial<GuildMember> = {}): GuildMember {
  return {
    area: 394,
    gender: 0,
    guid: 1n,
    level: 80,
    name: "Xiara",
    officerNote: "",
    playerClass: 9,
    publicNote: "",
    rankIndex: 0,
    status: GuildMemberStatus.ONLINE,
    timeOffline: 0,
    ...overrides,
  };
}

function makeRoster(overrides: Partial<GuildRoster> = {}): GuildRoster {
  return {
    guildInfo: "",
    guildName: "Test Guild",
    members: [],
    motd: "",
    rankNames: ["Guild Master", "Officer", "Member"],
    ...overrides,
  };
}

describe("formatGuildRoster", () => {
  test("empty roster shows 0/0 online", () => {
    const roster = makeRoster();
    const result = formatGuildRoster(roster);
    expect(result).toBe("[guild] Test Guild — 0/0 online");
  });

  test("roster with online and offline members", () => {
    const roster = makeRoster({
      members: [
        makeMember({
          guid: 1n,
          level: 80,
          name: "Arthas",
          playerClass: 6,
          rankIndex: 0,
          status: GuildMemberStatus.ONLINE,
        }),
        makeMember({
          guid: 2n,
          level: 80,
          name: "Jaina",
          playerClass: 8,
          rankIndex: 1,
          status: GuildMemberStatus.OFFLINE,
          timeOffline: 3.5,
        }),
      ],
    });
    const result = formatGuildRoster(roster);
    expect(result).toContain("1/2 online");
    expect(result).toContain("Arthas — Guild Master, Level 80 Death Knight");
    expect(result).toContain("Jaina — Officer, Offline (3 days ago)");
  });

  test("roster with MOTD and guild info", () => {
    const roster = makeRoster({
      guildInfo: "Founded in 2008",
      motd: "Welcome to the guild!",
    });
    const result = formatGuildRoster(roster);
    expect(result).toContain("MOTD: Welcome to the guild!");
    expect(result).toContain("Info: Founded in 2008");
  });

  test("MOTD line appears before info line", () => {
    const roster = makeRoster({
      guildInfo: "About us",
      motd: "Hello",
    });
    const result = formatGuildRoster(roster);
    const motdIndex = result.indexOf("MOTD:");
    const infoIndex = result.indexOf("Info:");
    expect(motdIndex).toBeLessThan(infoIndex);
  });

  test("omits MOTD line when empty", () => {
    const roster = makeRoster({ guildInfo: "About us", motd: "" });
    const result = formatGuildRoster(roster);
    expect(result).not.toContain("MOTD:");
    expect(result).toContain("Info: About us");
  });

  test("omits guild info line when empty", () => {
    const roster = makeRoster({ guildInfo: "", motd: "Hello" });
    const result = formatGuildRoster(roster);
    expect(result).toContain("MOTD: Hello");
    expect(result).not.toContain("Info:");
  });

  test("roster without guild name omits name from header", () => {
    const roster = makeRoster({
      guildName: "",
      members: [makeMember({ status: GuildMemberStatus.ONLINE })],
    });
    const result = formatGuildRoster(roster);
    const firstLine = must(result.split("\n")[0]);
    expect(firstLine).toBe("[guild] 1/1 online");
  });

  test("resolves rank name from rankNames array", () => {
    const roster = makeRoster({
      members: [
        makeMember({
          name: "Alpha",
          rankIndex: 0,
          status: GuildMemberStatus.ONLINE,
        }),
        makeMember({
          guid: 2n,
          name: "Beta",
          rankIndex: 2,
          status: GuildMemberStatus.ONLINE,
        }),
        makeMember({
          guid: 3n,
          name: "Gamma",
          rankIndex: 4,
          status: GuildMemberStatus.ONLINE,
        }),
      ],
      rankNames: ["GM", "Officer", "Raider", "Member", "Initiate"],
    });
    const result = formatGuildRoster(roster);
    expect(result).toContain("Alpha — GM,");
    expect(result).toContain("Beta — Raider,");
    expect(result).toContain("Gamma — Initiate,");
  });

  test("falls back to Rank N when rank name is missing", () => {
    const roster = makeRoster({
      members: [
        makeMember({
          name: "Orphan",
          rankIndex: 5,
          status: GuildMemberStatus.ONLINE,
        }),
      ],
      rankNames: ["Guild Master"],
    });
    const result = formatGuildRoster(roster);
    expect(result).toContain("Orphan — Rank 5,");
  });

  test("falls back to Rank N for offline members too", () => {
    const roster = makeRoster({
      members: [
        makeMember({
          name: "Ghost",
          rankIndex: 3,
          status: GuildMemberStatus.OFFLINE,
          timeOffline: 0.5,
        }),
      ],
      rankNames: [],
    });
    const result = formatGuildRoster(roster);
    expect(result).toContain("Ghost — Rank 3, Offline");
  });

  test("offline time less than 1 hour shows < 1 hr ago", () => {
    const roster = makeRoster({
      members: [
        makeMember({
          name: "Recent",
          status: GuildMemberStatus.OFFLINE,
          timeOffline: 0.01,
        }),
      ],
    });
    const result = formatGuildRoster(roster);
    expect(result).toContain("Recent — Guild Master, Offline (< 1 hr ago)");
  });

  test("offline time exactly 1 hour shows < 1 hr ago", () => {
    const roster = makeRoster({
      members: [
        makeMember({
          name: "JustLeft",
          status: GuildMemberStatus.OFFLINE,
          timeOffline: 1 / 24,
        }),
      ],
    });
    const result = formatGuildRoster(roster);
    expect(result).toContain("Offline (< 1 hr ago)");
  });

  test("offline time several hours shows N hrs ago", () => {
    const roster = makeRoster({
      members: [
        makeMember({
          name: "FewHours",
          status: GuildMemberStatus.OFFLINE,
          timeOffline: 12 / 24,
        }),
      ],
    });
    const result = formatGuildRoster(roster);
    expect(result).toContain("Offline (12 hrs ago)");
  });

  test("offline time 1 day shows 1 day ago", () => {
    const roster = makeRoster({
      members: [
        makeMember({
          name: "Yesterday",
          status: GuildMemberStatus.OFFLINE,
          timeOffline: 1.5,
        }),
      ],
    });
    const result = formatGuildRoster(roster);
    expect(result).toContain("Offline (1 day ago)");
  });

  test("offline time multiple days shows N days ago", () => {
    const roster = makeRoster({
      members: [
        makeMember({
          name: "LongGone",
          status: GuildMemberStatus.OFFLINE,
          timeOffline: 14.2,
        }),
      ],
    });
    const result = formatGuildRoster(roster);
    expect(result).toContain("Offline (14 days ago)");
  });

  test("online members appear before offline members", () => {
    const roster = makeRoster({
      members: [
        makeMember({
          guid: 1n,
          name: "OfflineFirst",
          status: GuildMemberStatus.OFFLINE,
          timeOffline: 1,
        }),
        makeMember({
          guid: 2n,
          name: "OnlineSecond",
          status: GuildMemberStatus.ONLINE,
        }),
      ],
    });
    const result = formatGuildRoster(roster);
    const onlineIndex = result.indexOf("OnlineSecond");
    const offlineIndex = result.indexOf("OfflineFirst");
    expect(onlineIndex).toBeLessThan(offlineIndex);
  });

  test("uses class name from CLASS_NAMES map", () => {
    const classes: [number, string][] = [
      [1, "Warrior"],
      [2, "Paladin"],
      [3, "Hunter"],
      [4, "Rogue"],
      [5, "Priest"],
      [6, "Death Knight"],
      [7, "Shaman"],
      [8, "Mage"],
      [9, "Warlock"],
      [11, "Druid"],
    ];
    for (const [classId, className] of classes) {
      const roster = makeRoster({
        members: [
          makeMember({
            name: "Test",
            playerClass: classId,
            status: GuildMemberStatus.ONLINE,
          }),
        ],
      });
      const result = formatGuildRoster(roster);
      expect(result).toContain(className);
    }
  });

  test("falls back to class N for unknown class", () => {
    const roster = makeRoster({
      members: [
        makeMember({
          name: "Exotic",
          playerClass: 99,
          status: GuildMemberStatus.ONLINE,
        }),
      ],
    });
    const result = formatGuildRoster(roster);
    expect(result).toContain("Level 80 class 99");
  });

  test("header includes guild name with dash separator", () => {
    const roster = makeRoster({ guildName: "Shadow Council" });
    const result = formatGuildRoster(roster);
    const firstLine = must(result.split("\n")[0]);
    expect(firstLine).toBe("[guild] Shadow Council — 0/0 online");
  });
});

describe("formatGuildRosterJson", () => {
  test("basic roster data structure", () => {
    const roster = makeRoster({
      guildInfo: "PvP guild",
      guildName: "Horde Elite",
      members: [
        makeMember({
          area: 1637,
          guid: 0xabcn,
          level: 80,
          name: "Thrall",
          officerNote: "alt: Garrosh",
          playerClass: 7,
          publicNote: "leader",
          rankIndex: 0,
          status: GuildMemberStatus.ONLINE,
        }),
      ],
      motd: "Lok'tar Ogar!",
      rankNames: ["Warchief", "General", "Grunt"],
    });
    const result = JSON.parse(formatGuildRosterJson(roster));
    expect(result.type).toBe("GUILD_ROSTER");
    expect(result.guildName).toBe("Horde Elite");
    expect(result.motd).toBe("Lok'tar Ogar!");
    expect(result.guildInfo).toBe("PvP guild");
    expect(result.rankNames).toEqual(["Warchief", "General", "Grunt"]);
    expect(result.count).toBe(1);
    expect(result.online).toBe(1);
  });

  test("member fields are correct", () => {
    const roster = makeRoster({
      members: [
        makeMember({
          area: 4395,
          guid: 0xffn,
          level: 80,
          name: "Sylvanas",
          officerNote: "promote soon",
          playerClass: 3,
          publicNote: "ranger",
          rankIndex: 1,
          status: GuildMemberStatus.ONLINE,
        }),
      ],
      rankNames: ["Guild Master", "Officer"],
    });
    const result = JSON.parse(formatGuildRosterJson(roster));
    const member = result.members[0];
    expect(member.guid).toBe("0xff");
    expect(member.name).toBe("Sylvanas");
    expect(member.rank).toBe("Officer");
    expect(member.rankIndex).toBe(1);
    expect(member.level).toBe(80);
    expect(member.class).toBe("Hunter");
    expect(member.status).toBe("ONLINE");
    expect(member.area).toBe(4395);
    expect(member.publicNote).toBe("ranger");
    expect(member.officerNote).toBe("promote soon");
  });

  test("offline member has OFFLINE status", () => {
    const roster = makeRoster({
      members: [
        makeMember({
          name: "Sleeper",
          status: GuildMemberStatus.OFFLINE,
          timeOffline: 5,
        }),
      ],
    });
    const result = JSON.parse(formatGuildRosterJson(roster));
    expect(result.members[0].status).toBe("OFFLINE");
    expect(result.online).toBe(0);
  });

  test("online count and total count with mixed members", () => {
    const roster = makeRoster({
      members: [
        makeMember({ guid: 1n, name: "A", status: GuildMemberStatus.ONLINE }),
        makeMember({ guid: 2n, name: "B", status: GuildMemberStatus.ONLINE }),
        makeMember({
          guid: 3n,
          name: "C",
          status: GuildMemberStatus.OFFLINE,
          timeOffline: 1,
        }),
      ],
    });
    const result = JSON.parse(formatGuildRosterJson(roster));
    expect(result.count).toBe(3);
    expect(result.online).toBe(2);
    expect(result.members).toHaveLength(3);
  });

  test("falls back to Rank N in JSON when rank name missing", () => {
    const roster = makeRoster({
      members: [makeMember({ name: "Orphan", rankIndex: 7 })],
      rankNames: ["GM"],
    });
    const result = JSON.parse(formatGuildRosterJson(roster));
    expect(result.members[0].rank).toBe("Rank 7");
  });

  test("falls back to class N in JSON for unknown class", () => {
    const roster = makeRoster({
      members: [makeMember({ name: "Alien", playerClass: 42 })],
    });
    const result = JSON.parse(formatGuildRosterJson(roster));
    expect(result.members[0].class).toBe("class 42");
  });

  test("empty roster produces valid JSON with zero counts", () => {
    const roster = makeRoster();
    const result = JSON.parse(formatGuildRosterJson(roster));
    expect(result.type).toBe("GUILD_ROSTER");
    expect(result.count).toBe(0);
    expect(result.online).toBe(0);
    expect(result.members).toEqual([]);
  });

  test("guid is formatted as lowercase hex", () => {
    const roster = makeRoster({
      members: [makeMember({ guid: 0xdeadbeefn })],
    });
    const result = JSON.parse(formatGuildRosterJson(roster));
    expect(result.members[0].guid).toBe("0xdeadbeef");
  });
});
