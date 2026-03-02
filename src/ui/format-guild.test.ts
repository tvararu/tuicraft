import { test, expect, describe } from "bun:test";
import { formatGuildRoster, formatGuildRosterJson } from "ui/format";
import { GuildMemberStatus } from "wow/protocol/guild";
import type { GuildMember, GuildRoster } from "wow/guild-store";

function makeMember(overrides: Partial<GuildMember> = {}): GuildMember {
  return {
    guid: 1n,
    name: "Xiara",
    rankIndex: 0,
    level: 80,
    playerClass: 9,
    gender: 0,
    area: 394,
    status: GuildMemberStatus.ONLINE,
    timeOffline: 0,
    publicNote: "",
    officerNote: "",
    ...overrides,
  };
}

function makeRoster(overrides: Partial<GuildRoster> = {}): GuildRoster {
  return {
    guildName: "Test Guild",
    motd: "",
    guildInfo: "",
    rankNames: ["Guild Master", "Officer", "Member"],
    members: [],
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
          name: "Arthas",
          rankIndex: 0,
          level: 80,
          playerClass: 6,
          status: GuildMemberStatus.ONLINE,
        }),
        makeMember({
          guid: 2n,
          name: "Jaina",
          rankIndex: 1,
          level: 80,
          playerClass: 8,
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
      motd: "Welcome to the guild!",
      guildInfo: "Founded in 2008",
    });
    const result = formatGuildRoster(roster);
    expect(result).toContain("MOTD: Welcome to the guild!");
    expect(result).toContain("Info: Founded in 2008");
  });

  test("MOTD line appears before info line", () => {
    const roster = makeRoster({
      motd: "Hello",
      guildInfo: "About us",
    });
    const result = formatGuildRoster(roster);
    const motdIndex = result.indexOf("MOTD:");
    const infoIndex = result.indexOf("Info:");
    expect(motdIndex).toBeLessThan(infoIndex);
  });

  test("omits MOTD line when empty", () => {
    const roster = makeRoster({ motd: "", guildInfo: "About us" });
    const result = formatGuildRoster(roster);
    expect(result).not.toContain("MOTD:");
    expect(result).toContain("Info: About us");
  });

  test("omits guild info line when empty", () => {
    const roster = makeRoster({ motd: "Hello", guildInfo: "" });
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
    const firstLine = result.split("\n")[0]!;
    expect(firstLine).toBe("[guild] 1/1 online");
  });

  test("resolves rank name from rankNames array", () => {
    const roster = makeRoster({
      rankNames: ["GM", "Officer", "Raider", "Member", "Initiate"],
      members: [
        makeMember({
          name: "Alpha",
          rankIndex: 0,
          status: GuildMemberStatus.ONLINE,
        }),
        makeMember({
          name: "Beta",
          rankIndex: 2,
          status: GuildMemberStatus.ONLINE,
          guid: 2n,
        }),
        makeMember({
          name: "Gamma",
          rankIndex: 4,
          status: GuildMemberStatus.ONLINE,
          guid: 3n,
        }),
      ],
    });
    const result = formatGuildRoster(roster);
    expect(result).toContain("Alpha — GM,");
    expect(result).toContain("Beta — Raider,");
    expect(result).toContain("Gamma — Initiate,");
  });

  test("falls back to Rank N when rank name is missing", () => {
    const roster = makeRoster({
      rankNames: ["Guild Master"],
      members: [
        makeMember({
          name: "Orphan",
          rankIndex: 5,
          status: GuildMemberStatus.ONLINE,
        }),
      ],
    });
    const result = formatGuildRoster(roster);
    expect(result).toContain("Orphan — Rank 5,");
  });

  test("falls back to Rank N for offline members too", () => {
    const roster = makeRoster({
      rankNames: [],
      members: [
        makeMember({
          name: "Ghost",
          rankIndex: 3,
          status: GuildMemberStatus.OFFLINE,
          timeOffline: 0.5,
        }),
      ],
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
    const firstLine = result.split("\n")[0]!;
    expect(firstLine).toBe("[guild] Shadow Council — 0/0 online");
  });
});

describe("formatGuildRosterJson", () => {
  test("basic roster data structure", () => {
    const roster = makeRoster({
      guildName: "Horde Elite",
      motd: "Lok'tar Ogar!",
      guildInfo: "PvP guild",
      rankNames: ["Warchief", "General", "Grunt"],
      members: [
        makeMember({
          guid: 0xabcn,
          name: "Thrall",
          rankIndex: 0,
          level: 80,
          playerClass: 7,
          status: GuildMemberStatus.ONLINE,
          area: 1637,
          publicNote: "leader",
          officerNote: "alt: Garrosh",
        }),
      ],
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
      rankNames: ["Guild Master", "Officer"],
      members: [
        makeMember({
          guid: 0xffn,
          name: "Sylvanas",
          rankIndex: 1,
          level: 80,
          playerClass: 3,
          status: GuildMemberStatus.ONLINE,
          area: 4395,
          publicNote: "ranger",
          officerNote: "promote soon",
        }),
      ],
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
      rankNames: ["GM"],
      members: [makeMember({ name: "Orphan", rankIndex: 7 })],
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
