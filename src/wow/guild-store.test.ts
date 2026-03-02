import { describe, expect, test } from "bun:test";
import { GuildStore, type GuildEvent, type GuildMember } from "wow/guild-store";

function makeMember(overrides: Partial<GuildMember> = {}): GuildMember {
  return {
    guid: 1n,
    name: "Thrall",
    rankIndex: 0,
    level: 80,
    playerClass: 7,
    gender: 0,
    area: 10,
    status: 1,
    timeOffline: 0,
    publicNote: "",
    officerNote: "",
    ...overrides,
  };
}

describe("GuildStore", () => {
  test("setRoster() stores members and fires guild-roster event", () => {
    const store = new GuildStore();
    const events: GuildEvent[] = [];
    store.onEvent((e) => events.push(e));

    const members = [
      makeMember({ guid: 1n, name: "Thrall" }),
      makeMember({ guid: 2n, name: "Jaina" }),
    ];
    store.setRoster("Welcome!", "Guild info text", members);

    expect(store.all()).toHaveLength(2);
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe("guild-roster");
    expect(events[0]!.roster.motd).toBe("Welcome!");
    expect(events[0]!.roster.guildInfo).toBe("Guild info text");
    expect(events[0]!.roster.members).toHaveLength(2);
  });

  test("setRoster() clears previous members", () => {
    const store = new GuildStore();
    store.setRoster("motd", "info", [
      makeMember({ guid: 1n, name: "Thrall" }),
      makeMember({ guid: 2n, name: "Jaina" }),
    ]);
    store.setRoster("motd2", "info2", [
      makeMember({ guid: 3n, name: "Sylvanas" }),
    ]);

    expect(store.all()).toHaveLength(1);
    expect(store.all()[0]!.name).toBe("Sylvanas");
  });

  test("setGuildMeta() stores name and rank names, fires event if members exist", () => {
    const store = new GuildStore();
    const events: GuildEvent[] = [];
    store.onEvent((e) => events.push(e));

    store.setRoster("motd", "info", [makeMember({ guid: 1n, name: "Thrall" })]);
    events.length = 0;

    store.setGuildMeta("Horde Elite", ["Guild Master", "Officer", "Member"]);

    expect(events).toHaveLength(1);
    expect(events[0]!.roster.guildName).toBe("Horde Elite");
    expect(events[0]!.roster.rankNames).toEqual([
      "Guild Master",
      "Officer",
      "Member",
    ]);
  });

  test("setGuildMeta() before setRoster() does not fire event", () => {
    const store = new GuildStore();
    const events: GuildEvent[] = [];
    store.onEvent((e) => events.push(e));

    store.setGuildMeta("Horde Elite", ["Guild Master", "Officer"]);

    expect(events).toHaveLength(0);
  });

  test("get() returns undefined when no members", () => {
    const store = new GuildStore();

    expect(store.get()).toBeUndefined();
  });

  test("get() returns undefined after setGuildMeta() with no roster", () => {
    const store = new GuildStore();
    store.setGuildMeta("Horde Elite", ["GM", "Officer"]);

    expect(store.get()).toBeUndefined();
  });

  test("get() returns full roster with all fields", () => {
    const store = new GuildStore();
    store.setGuildMeta("Horde Elite", ["Guild Master", "Officer"]);
    store.setRoster("Welcome!", "Guild info", [
      makeMember({
        guid: 1n,
        name: "Thrall",
        rankIndex: 0,
        level: 80,
        playerClass: 7,
        gender: 0,
        area: 10,
        status: 1,
        timeOffline: 0,
        publicNote: "Warchief",
        officerNote: "Founder",
      }),
    ]);

    const roster = store.get();
    expect(roster).toBeDefined();
    expect(roster!.guildName).toBe("Horde Elite");
    expect(roster!.motd).toBe("Welcome!");
    expect(roster!.guildInfo).toBe("Guild info");
    expect(roster!.rankNames).toEqual(["Guild Master", "Officer"]);
    expect(roster!.members).toHaveLength(1);

    const m = roster!.members[0]!;
    expect(m.guid).toBe(1n);
    expect(m.name).toBe("Thrall");
    expect(m.rankIndex).toBe(0);
    expect(m.level).toBe(80);
    expect(m.playerClass).toBe(7);
    expect(m.gender).toBe(0);
    expect(m.area).toBe(10);
    expect(m.status).toBe(1);
    expect(m.timeOffline).toBe(0);
    expect(m.publicNote).toBe("Warchief");
    expect(m.officerNote).toBe("Founder");
  });

  test("all() returns members sorted by name", () => {
    const store = new GuildStore();
    store.setRoster("motd", "info", [
      makeMember({ guid: 1n, name: "Zul'jin" }),
      makeMember({ guid: 2n, name: "Arthas" }),
      makeMember({ guid: 3n, name: "Jaina" }),
    ]);

    const all = store.all();
    expect(all[0]!.name).toBe("Arthas");
    expect(all[1]!.name).toBe("Jaina");
    expect(all[2]!.name).toBe("Zul'jin");
  });

  test("all() returns empty array when no members", () => {
    const store = new GuildStore();

    expect(store.all()).toEqual([]);
  });

  test("event includes full roster data", () => {
    const store = new GuildStore();
    const events: GuildEvent[] = [];
    store.onEvent((e) => events.push(e));

    store.setGuildMeta("Horde Elite", ["GM", "Officer"]);
    store.setRoster("Welcome!", "Info", [
      makeMember({ guid: 1n, name: "Thrall" }),
      makeMember({ guid: 2n, name: "Garrosh" }),
    ]);

    expect(events).toHaveLength(1);
    const roster = events[0]!.roster;
    expect(roster.guildName).toBe("Horde Elite");
    expect(roster.motd).toBe("Welcome!");
    expect(roster.guildInfo).toBe("Info");
    expect(roster.rankNames).toEqual(["GM", "Officer"]);
    expect(roster.members).toHaveLength(2);
    expect(roster.members[0]!.name).toBe("Garrosh");
    expect(roster.members[1]!.name).toBe("Thrall");
  });

  test("members are stored as copies", () => {
    const store = new GuildStore();
    const original = makeMember({ guid: 1n, name: "Thrall" });
    store.setRoster("motd", "info", [original]);

    original.name = "Mutated";
    expect(store.all()[0]!.name).toBe("Thrall");
  });

  test("no event fires without listener", () => {
    const store = new GuildStore();

    store.setRoster("motd", "info", [makeMember({ guid: 1n, name: "Thrall" })]);
    store.setGuildMeta("Guild", ["Rank"]);

    expect(store.get()).toBeDefined();
  });

  test("setGuildMeta() after setRoster() preserves meta in get()", () => {
    const store = new GuildStore();
    store.setRoster("motd", "info", [makeMember({ guid: 1n, name: "Thrall" })]);
    store.setGuildMeta("Horde Elite", ["GM", "Officer", "Member"]);

    const roster = store.get();
    expect(roster!.guildName).toBe("Horde Elite");
    expect(roster!.rankNames).toEqual(["GM", "Officer", "Member"]);
    expect(roster!.motd).toBe("motd");
    expect(roster!.members).toHaveLength(1);
  });
});
