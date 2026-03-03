import { test, expect, describe } from "bun:test";
import { PacketReader, PacketWriter } from "wow/protocol/packet";
import {
  GuildMemberStatus,
  parseGuildRoster,
  parseGuildQueryResponse,
  buildGuildQuery,
} from "wow/protocol/guild";

describe("GuildMemberStatus", () => {
  test("OFFLINE is 0", () => {
    expect(GuildMemberStatus.OFFLINE).toBe(0);
  });

  test("ONLINE is 1", () => {
    expect(GuildMemberStatus.ONLINE).toBe(1);
  });
});

function writeRankData(w: PacketWriter) {
  w.uint32LE(0);
  w.uint32LE(0);
  for (let j = 0; j < 6; j++) {
    w.uint32LE(0);
    w.uint32LE(0);
  }
}

describe("parseGuildRoster", () => {
  test("parses empty roster with 0 members and 0 ranks", () => {
    const w = new PacketWriter();
    w.uint32LE(0);
    w.cString("");
    w.cString("");
    w.uint32LE(0);

    const result = parseGuildRoster(new PacketReader(w.finish()));
    expect(result.memberCount).toBe(0);
    expect(result.motd).toBe("");
    expect(result.guildInfo).toBe("");
    expect(result.rankCount).toBe(0);
    expect(result.members).toHaveLength(0);
  });

  test("parses roster with motd and guild info strings", () => {
    const w = new PacketWriter();
    w.uint32LE(0);
    w.cString("Welcome to the guild!");
    w.cString("We raid on Tuesdays.");
    w.uint32LE(0);

    const result = parseGuildRoster(new PacketReader(w.finish()));
    expect(result.motd).toBe("Welcome to the guild!");
    expect(result.guildInfo).toBe("We raid on Tuesdays.");
    expect(result.members).toHaveLength(0);
  });

  test("skips rank data correctly (56 bytes per rank)", () => {
    const w = new PacketWriter();
    w.uint32LE(0);
    w.cString("");
    w.cString("");
    w.uint32LE(3);
    for (let i = 0; i < 3; i++) {
      writeRankData(w);
    }

    const result = parseGuildRoster(new PacketReader(w.finish()));
    expect(result.rankCount).toBe(3);
    expect(result.members).toHaveLength(0);
  });

  test("parses 2 members: 1 online, 1 offline", () => {
    const w = new PacketWriter();
    w.uint32LE(2);
    w.cString("Hello guild");
    w.cString("");
    w.uint32LE(1);
    writeRankData(w);

    w.uint64LE(10n);
    w.uint8(GuildMemberStatus.ONLINE);
    w.cString("Thrall");
    w.uint32LE(0);
    w.uint8(80);
    w.uint8(1);
    w.uint8(0);
    w.uint32LE(1519);
    w.cString("GM");
    w.cString("leader");

    w.uint64LE(20n);
    w.uint8(GuildMemberStatus.OFFLINE);
    w.cString("Jaina");
    w.uint32LE(1);
    w.uint8(78);
    w.uint8(8);
    w.uint8(1);
    w.uint32LE(1637);
    w.floatLE(1.5);
    w.cString("");
    w.cString("on vacation");

    const result = parseGuildRoster(new PacketReader(w.finish()));
    expect(result.memberCount).toBe(2);
    expect(result.motd).toBe("Hello guild");
    expect(result.rankCount).toBe(1);
    expect(result.members).toHaveLength(2);

    const m0 = result.members[0]!;
    expect(m0.guid).toBe(10n);
    expect(m0.status).toBe(GuildMemberStatus.ONLINE);
    expect(m0.name).toBe("Thrall");
    expect(m0.rankIndex).toBe(0);
    expect(m0.level).toBe(80);
    expect(m0.playerClass).toBe(1);
    expect(m0.gender).toBe(0);
    expect(m0.area).toBe(1519);
    expect(m0.timeOffline).toBe(0);
    expect(m0.publicNote).toBe("GM");
    expect(m0.officerNote).toBe("leader");

    const m1 = result.members[1]!;
    expect(m1.guid).toBe(20n);
    expect(m1.status).toBe(GuildMemberStatus.OFFLINE);
    expect(m1.name).toBe("Jaina");
    expect(m1.rankIndex).toBe(1);
    expect(m1.level).toBe(78);
    expect(m1.playerClass).toBe(8);
    expect(m1.gender).toBe(1);
    expect(m1.area).toBe(1637);
    expect(m1.timeOffline).toBeCloseTo(1.5, 1);
    expect(m1.publicNote).toBe("");
    expect(m1.officerNote).toBe("on vacation");
  });

  test("online member has timeOffline defaulted to 0", () => {
    const w = new PacketWriter();
    w.uint32LE(1);
    w.cString("");
    w.cString("");
    w.uint32LE(0);

    w.uint64LE(5n);
    w.uint8(GuildMemberStatus.ONLINE);
    w.cString("Arthas");
    w.uint32LE(0);
    w.uint8(80);
    w.uint8(6);
    w.uint8(0);
    w.uint32LE(4395);
    w.cString("");
    w.cString("");

    const result = parseGuildRoster(new PacketReader(w.finish()));
    const m = result.members[0]!;
    expect(m.timeOffline).toBe(0);
  });

  test("offline member reads float for timeOffline", () => {
    const w = new PacketWriter();
    w.uint32LE(1);
    w.cString("");
    w.cString("");
    w.uint32LE(0);

    w.uint64LE(7n);
    w.uint8(GuildMemberStatus.OFFLINE);
    w.cString("Sylvanas");
    w.uint32LE(2);
    w.uint8(70);
    w.uint8(3);
    w.uint8(1);
    w.uint32LE(85);
    w.floatLE(0);
    w.cString("note");
    w.cString("");

    const result = parseGuildRoster(new PacketReader(w.finish()));
    const m = result.members[0]!;
    expect(m.timeOffline).toBe(0);
    expect(m.publicNote).toBe("note");
  });

  test("consumes all bytes with multiple ranks and members", () => {
    const w = new PacketWriter();
    w.uint32LE(1);
    w.cString("motd");
    w.cString("info");
    w.uint32LE(2);
    writeRankData(w);
    writeRankData(w);

    w.uint64LE(99n);
    w.uint8(GuildMemberStatus.ONLINE);
    w.cString("X");
    w.uint32LE(0);
    w.uint8(1);
    w.uint8(1);
    w.uint8(0);
    w.uint32LE(0);
    w.cString("");
    w.cString("");

    const buf = w.finish();
    const r = new PacketReader(buf);
    parseGuildRoster(r);
    expect(r.remaining).toBe(0);
  });
});

describe("parseGuildQueryResponse", () => {
  test("parses guild id and name", () => {
    const w = new PacketWriter();
    w.uint32LE(42);
    w.cString("Dark Iron Dwarves");
    for (let i = 0; i < 10; i++) {
      w.cString("");
    }

    const result = parseGuildQueryResponse(new PacketReader(w.finish()));
    expect(result.guildId).toBe(42);
    expect(result.name).toBe("Dark Iron Dwarves");
  });

  test("parses 10 rank names with some empty", () => {
    const w = new PacketWriter();
    w.uint32LE(1);
    w.cString("TestGuild");
    w.cString("Guild Master");
    w.cString("Officer");
    w.cString("Veteran");
    w.cString("Member");
    w.cString("Initiate");
    w.cString("");
    w.cString("");
    w.cString("");
    w.cString("");
    w.cString("");

    const result = parseGuildQueryResponse(new PacketReader(w.finish()));
    expect(result.rankNames).toHaveLength(10);
    expect(result.rankNames[0]).toBe("Guild Master");
    expect(result.rankNames[1]).toBe("Officer");
    expect(result.rankNames[2]).toBe("Veteran");
    expect(result.rankNames[3]).toBe("Member");
    expect(result.rankNames[4]).toBe("Initiate");
    expect(result.rankNames[5]).toBe("");
    expect(result.rankNames[6]).toBe("");
    expect(result.rankNames[7]).toBe("");
    expect(result.rankNames[8]).toBe("");
    expect(result.rankNames[9]).toBe("");
  });

  test("parses all 10 rank names populated", () => {
    const w = new PacketWriter();
    w.uint32LE(99);
    w.cString("BigGuild");
    const names = [
      "GM",
      "Co-GM",
      "Officer",
      "Raider",
      "Veteran",
      "Member",
      "Alt",
      "Trial",
      "Inactive",
      "Recruit",
    ];
    for (const n of names) {
      w.cString(n);
    }

    const result = parseGuildQueryResponse(new PacketReader(w.finish()));
    expect(result.guildId).toBe(99);
    expect(result.name).toBe("BigGuild");
    expect(result.rankNames).toEqual(names);
  });

  test("consumes all bytes", () => {
    const w = new PacketWriter();
    w.uint32LE(7);
    w.cString("G");
    for (let i = 0; i < 10; i++) {
      w.cString("");
    }

    const r = new PacketReader(w.finish());
    parseGuildQueryResponse(r);
    expect(r.remaining).toBe(0);
  });
});

describe("buildGuildQuery", () => {
  test("produces a 4-byte u32 LE packet", () => {
    const body = buildGuildQuery(123);
    expect(body.byteLength).toBe(4);
    const r = new PacketReader(body);
    expect(r.uint32LE()).toBe(123);
    expect(r.remaining).toBe(0);
  });

  test("encodes guild id 0", () => {
    const body = buildGuildQuery(0);
    const r = new PacketReader(body);
    expect(r.uint32LE()).toBe(0);
  });

  test("encodes large guild id", () => {
    const body = buildGuildQuery(0xdeadbeef);
    const r = new PacketReader(body);
    expect(r.uint32LE()).toBe(0xdeadbeef);
  });
});
