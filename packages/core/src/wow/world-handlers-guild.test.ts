import { describe, expect, test } from "bun:test";
import { startMockWorldServer } from "#test-support/mock-world-server";
import { must } from "#test-support/must";
import {
  base,
  fakeAuth,
  waitForEchoProbe,
} from "#test-support/world-handlers-fixtures";
import { type GuildEvent, worldSession } from "#wow/client";
import { GameOpcode } from "#wow/protocol/opcodes";
import { PacketReader, PacketWriter } from "#wow/protocol/packet";

describe("world handler tests", () => {
  describe("guild handlers", () => {
    function buildGuildRosterPacket(): Uint8Array {
      const w = new PacketWriter();
      w.uint32LE(1);
      w.cString("Welcome!");
      w.cString("Guild info");
      w.uint32LE(1);
      w.uint32LE(0);
      w.uint32LE(0);
      for (let j = 0; j < 6; j++) {
        w.uint32LE(0);
        w.uint32LE(0);
      }
      w.uint64LE(10n);
      w.uint8(1);
      w.cString("Thrall");
      w.uint32LE(0);
      w.uint8(80);
      w.uint8(7);
      w.uint8(0);
      w.uint32LE(1519);
      w.cString("Warchief");
      w.cString("");
      return w.finish();
    }

    function buildGuildQueryResponsePacket(): Uint8Array {
      const w = new PacketWriter();
      w.uint32LE(1);
      w.cString("Horde Elite");
      w.cString("Guild Master");
      w.cString("Officer");
      for (let i = 0; i < 8; i++) {
        w.cString("");
      }
      return w.finish();
    }

    test("SMSG_GUILD_ROSTER populates guildStore", async () => {
      const ws = await startMockWorldServer();
      try {
        const handle = await worldSession(
          { ...base, host: "127.0.0.1", port: ws.port },
          fakeAuth(ws.port),
        );

        const guildReady = new Promise<GuildEvent>((resolve) => {
          handle.onGuildEvent(resolve);
        });

        ws.inject(GameOpcode.SMSG_GUILD_ROSTER, buildGuildRosterPacket());

        const event = await guildReady;
        expect(event.type).toBe("guild-roster");
        if (event.type !== "guild-roster") throw new Error("expected roster");
        expect(event.roster.motd).toBe("Welcome!");
        expect(event.roster.members).toHaveLength(1);
        expect(must(event.roster.members[0]).name).toBe("Thrall");

        handle.close();
        await handle.closed;
      } finally {
        ws.stop();
      }
    });

    test("SMSG_GUILD_QUERY_RESPONSE updates guild meta", async () => {
      const ws = await startMockWorldServer();
      try {
        const handle = await worldSession(
          { ...base, host: "127.0.0.1", port: ws.port },
          fakeAuth(ws.port),
        );

        const firstEvent = new Promise<GuildEvent>((resolve) => {
          handle.onGuildEvent(resolve);
        });
        ws.inject(GameOpcode.SMSG_GUILD_ROSTER, buildGuildRosterPacket());
        await firstEvent;

        const metaEvent = new Promise<GuildEvent>((resolve) => {
          handle.onGuildEvent(resolve);
        });
        ws.inject(
          GameOpcode.SMSG_GUILD_QUERY_RESPONSE,
          buildGuildQueryResponsePacket(),
        );
        const event = await metaEvent;
        if (event.type !== "guild-roster") throw new Error("expected roster");

        expect(event.roster.guildName).toBe("Horde Elite");
        expect(event.roster.rankNames[0]).toBe("Guild Master");
        expect(event.roster.rankNames[1]).toBe("Officer");

        handle.close();
        await handle.closed;
      } finally {
        ws.stop();
      }
    });

    test("requestGuildRoster sends CMSG_GUILD_ROSTER and returns roster", async () => {
      const ws = await startMockWorldServer();
      try {
        const handle = await worldSession(
          { ...base, host: "127.0.0.1", port: ws.port },
          fakeAuth(ws.port),
        );
        await waitForEchoProbe(handle);

        const rosterPromise = handle.requestGuildRoster();

        const captured = await ws.waitForCapture(
          (p) => p.opcode === GameOpcode.CMSG_GUILD_ROSTER,
        );
        expect(captured).toBeDefined();

        ws.inject(GameOpcode.SMSG_GUILD_ROSTER, buildGuildRosterPacket());

        const roster = await rosterPromise;
        expect(roster).toBeDefined();
        expect(must(roster).members).toHaveLength(1);
        expect(must(must(roster).members[0]).name).toBe("Thrall");

        handle.close();
        await handle.closed;
      } finally {
        ws.stop();
      }
    });

    test("requestGuildRoster with guildId also sends CMSG_GUILD_QUERY", async () => {
      const ws = await startMockWorldServer({ guildId: 42 });
      try {
        const handle = await worldSession(
          { ...base, host: "127.0.0.1", port: ws.port },
          fakeAuth(ws.port),
        );
        await waitForEchoProbe(handle);

        const rosterPromise = handle.requestGuildRoster();

        const rosterCapture = await ws.waitForCapture(
          (p) => p.opcode === GameOpcode.CMSG_GUILD_ROSTER,
        );
        expect(rosterCapture).toBeDefined();

        const queryCapture = await ws.waitForCapture(
          (p) => p.opcode === GameOpcode.CMSG_GUILD_QUERY,
        );
        const qr = new PacketReader(queryCapture.body);
        expect(qr.uint32LE()).toBe(42);

        ws.inject(GameOpcode.SMSG_GUILD_ROSTER, buildGuildRosterPacket());
        ws.inject(
          GameOpcode.SMSG_GUILD_QUERY_RESPONSE,
          buildGuildQueryResponsePacket(),
        );

        const roster = await rosterPromise;
        expect(roster).toBeDefined();
        expect(must(roster).guildName).toBe("Horde Elite");
        expect(must(roster).members).toHaveLength(1);

        handle.close();
        await handle.closed;
      } finally {
        ws.stop();
      }
    });

    test("SMSG_GUILD_EVENT signed_on fires guild event", async () => {
      const ws = await startMockWorldServer();
      try {
        const handle = await worldSession(
          { ...base, host: "127.0.0.1", port: ws.port },
          fakeAuth(ws.port),
        );

        const eventReady = new Promise<GuildEvent>((resolve) => {
          handle.onGuildEvent(resolve);
        });

        const w = new PacketWriter();
        w.uint8(12);
        w.uint8(1);
        w.cString("Thrall");
        w.uint64LE(10n);
        ws.inject(GameOpcode.SMSG_GUILD_EVENT, w.finish());

        const event = await eventReady;
        expect(event.type).toBe("signed_on");
        if (event.type === "signed_on") {
          expect(event.name).toBe("Thrall");
        }

        handle.close();
        await handle.closed;
      } finally {
        ws.stop();
      }
    });

    test("SMSG_GUILD_EVENT promotion fires guild event", async () => {
      const ws = await startMockWorldServer();
      try {
        const handle = await worldSession(
          { ...base, host: "127.0.0.1", port: ws.port },
          fakeAuth(ws.port),
        );

        const eventReady = new Promise<GuildEvent>((resolve) => {
          handle.onGuildEvent(resolve);
        });

        const w = new PacketWriter();
        w.uint8(0);
        w.uint8(3);
        w.cString("Thrall");
        w.cString("Garrosh");
        w.cString("Officer");
        ws.inject(GameOpcode.SMSG_GUILD_EVENT, w.finish());

        const event = await eventReady;
        expect(event.type).toBe("promotion");
        if (event.type === "promotion") {
          expect(event.officer).toBe("Thrall");
          expect(event.member).toBe("Garrosh");
          expect(event.rank).toBe("Officer");
        }

        handle.close();
        await handle.closed;
      } finally {
        ws.stop();
      }
    });

    test("SMSG_GUILD_EVENT unknown type is silently ignored", async () => {
      const ws = await startMockWorldServer();
      try {
        const handle = await worldSession(
          { ...base, host: "127.0.0.1", port: ws.port },
          fakeAuth(ws.port),
        );

        const events: GuildEvent[] = [];
        handle.onGuildEvent((e) => events.push(e));

        const w = new PacketWriter();
        w.uint8(9);
        w.uint8(0);
        ws.inject(GameOpcode.SMSG_GUILD_EVENT, w.finish());

        await Bun.sleep(50);
        expect(events).toHaveLength(0);

        handle.close();
        await handle.closed;
      } finally {
        ws.stop();
      }
    });

    test("guild management methods send correct packets", async () => {
      const ws = await startMockWorldServer();
      try {
        const handle = await worldSession(
          { ...base, host: "127.0.0.1", port: ws.port },
          fakeAuth(ws.port),
        );

        handle.guildInvite("Thrall");
        handle.guildRemove("Garrosh");
        handle.guildLeave();
        handle.guildPromote("Jaina");
        handle.guildDemote("Arthas");
        handle.guildLeader("Sylvanas");
        handle.guildMotd("Raid tonight");
        handle.acceptGuildInvite();
        handle.declineGuildInvite();
        await Bun.sleep(1);

        const opcodes = ws.captured.map((p) => p.opcode);
        expect(opcodes).toContain(GameOpcode.CMSG_GUILD_INVITE);
        expect(opcodes).toContain(GameOpcode.CMSG_GUILD_REMOVE);
        expect(opcodes).toContain(GameOpcode.CMSG_GUILD_LEAVE);
        expect(opcodes).toContain(GameOpcode.CMSG_GUILD_PROMOTE);
        expect(opcodes).toContain(GameOpcode.CMSG_GUILD_DEMOTE);
        expect(opcodes).toContain(GameOpcode.CMSG_GUILD_LEADER);
        expect(opcodes).toContain(GameOpcode.CMSG_GUILD_MOTD);
        expect(opcodes).toContain(GameOpcode.CMSG_GUILD_ACCEPT);
        expect(opcodes).toContain(GameOpcode.CMSG_GUILD_DECLINE);

        const invite = must(
          ws.captured.find((p) => p.opcode === GameOpcode.CMSG_GUILD_INVITE),
        );
        expect(new PacketReader(invite.body).cString()).toBe("Thrall");

        const motd = must(
          ws.captured.find((p) => p.opcode === GameOpcode.CMSG_GUILD_MOTD),
        );
        expect(new PacketReader(motd.body).cString()).toBe("Raid tonight");

        const leave = must(
          ws.captured.find((p) => p.opcode === GameOpcode.CMSG_GUILD_LEAVE),
        );
        expect(leave.body.length).toBe(0);

        handle.close();
        await handle.closed;
      } finally {
        ws.stop();
      }
    });

    test("SMSG_GUILD_COMMAND_RESULT fires guild event", async () => {
      const ws = await startMockWorldServer();
      try {
        const handle = await worldSession(
          { ...base, host: "127.0.0.1", port: ws.port },
          fakeAuth(ws.port),
        );

        const eventReady = new Promise<GuildEvent>((resolve) => {
          handle.onGuildEvent(resolve);
        });

        const w = new PacketWriter();
        w.uint32LE(1);
        w.cString("Thrall");
        w.uint32LE(0x03);
        ws.inject(GameOpcode.SMSG_GUILD_COMMAND_RESULT, w.finish());

        const event = await eventReady;
        expect(event.type).toBe("command_result");
        if (event.type === "command_result") {
          expect(event.command).toBe(1);
          expect(event.name).toBe("Thrall");
          expect(event.result).toBe(0x03);
        }

        handle.close();
        await handle.closed;
      } finally {
        ws.stop();
      }
    });

    test("SMSG_GUILD_INVITE fires guild invite event", async () => {
      const ws = await startMockWorldServer();
      try {
        const handle = await worldSession(
          { ...base, host: "127.0.0.1", port: ws.port },
          fakeAuth(ws.port),
        );

        const eventReady = new Promise<GuildEvent>((resolve) => {
          handle.onGuildEvent(resolve);
        });

        const w = new PacketWriter();
        w.cString("Thrall");
        w.cString("Horde Heroes");
        ws.inject(GameOpcode.SMSG_GUILD_INVITE, w.finish());

        const event = await eventReady;
        expect(event.type).toBe("guild_invite");
        if (event.type === "guild_invite") {
          expect(event.inviter).toBe("Thrall");
          expect(event.guildName).toBe("Horde Heroes");
        }

        handle.close();
        await handle.closed;
      } finally {
        ws.stop();
      }
    });
  });
});
