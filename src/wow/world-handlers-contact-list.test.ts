import { describe, expect, test } from "bun:test";
import { startMockWorldServer } from "test/mock-world-server";
import { must } from "test/must";
import {
  base,
  buildContactList,
  buildNameQueryResponse,
  fakeAuth,
} from "test/world-handlers-fixtures";
import { type FriendEvent, type IgnoreEvent, worldSession } from "wow/client";
import { GameOpcode } from "wow/protocol/opcodes";
import { PacketReader } from "wow/protocol/packet";

describe("world handler tests", () => {
  describe("friend list", () => {
    test("SMSG_CONTACT_LIST with online friend", async () => {
      const ws = await startMockWorldServer();
      try {
        const handle = await worldSession(
          { ...base, host: "127.0.0.1", port: ws.port },
          fakeAuth(ws.port),
        );

        const eventReady = new Promise<FriendEvent>((resolve) => {
          handle.onFriendEvent(resolve);
        });

        ws.inject(
          GameOpcode.SMSG_CONTACT_LIST,
          buildContactList([
            {
              guid: 0x99n,
              flags: 0x01,
              note: "best buddy",
              status: 1,
              area: 1519,
              level: 80,
              playerClass: 1,
            },
          ]),
        );

        const event = await eventReady;
        expect(event.type).toBe("friend-list");

        const friends = handle.getFriends();
        expect(friends).toHaveLength(1);
        expect(must(friends[0]).guid).toBe(0x99n);
        expect(must(friends[0]).status).toBe(1);
        expect(must(friends[0]).area).toBe(1519);
        expect(must(friends[0]).level).toBe(80);
        expect(must(friends[0]).playerClass).toBe(1);
        expect(must(friends[0]).note).toBe("best buddy");

        handle.close();
        await handle.closed;
      } finally {
        ws.stop();
      }
    });

    test("SMSG_CONTACT_LIST filters out ignored entries", async () => {
      const ws = await startMockWorldServer();
      try {
        const handle = await worldSession(
          { ...base, host: "127.0.0.1", port: ws.port },
          fakeAuth(ws.port),
        );

        const eventReady = new Promise<FriendEvent>((resolve) => {
          handle.onFriendEvent(resolve);
        });

        ws.inject(
          GameOpcode.SMSG_CONTACT_LIST,
          buildContactList([
            {
              guid: 0x99n,
              flags: 0x01,
              note: "",
              status: 1,
              area: 10,
              level: 70,
              playerClass: 2,
            },
            {
              guid: 0xaan,
              flags: 0x02,
              note: "ignored person",
            },
          ]),
        );

        await eventReady;

        const friends = handle.getFriends();
        expect(friends).toHaveLength(1);
        expect(must(friends[0]).guid).toBe(0x99n);

        handle.close();
        await handle.closed;
      } finally {
        ws.stop();
      }
    });

    test("SMSG_CONTACT_LIST triggers name queries", async () => {
      const ws = await startMockWorldServer();
      try {
        const handle = await worldSession(
          { ...base, host: "127.0.0.1", port: ws.port },
          fakeAuth(ws.port),
        );

        const eventReady = new Promise<FriendEvent>((resolve) => {
          handle.onFriendEvent(resolve);
        });

        ws.inject(
          GameOpcode.SMSG_CONTACT_LIST,
          buildContactList([
            {
              guid: 0x99n,
              flags: 0x01,
              note: "",
              status: 1,
              area: 10,
              level: 80,
              playerClass: 1,
            },
          ]),
        );

        await eventReady;
        await Bun.sleep(1);

        const nameQueries = ws.captured.filter(
          (p) => p.opcode === GameOpcode.CMSG_NAME_QUERY,
        );
        const match = nameQueries.find((p) => {
          const r = new PacketReader(p.body);
          return r.uint32LE() === 0x99;
        });
        expect(match).toBeDefined();

        ws.inject(
          GameOpcode.SMSG_NAME_QUERY_RESPONSE,
          buildNameQueryResponse(0x99, "Arthas"),
        );
        await Bun.sleep(1);

        const friends = handle.getFriends();
        expect(must(friends[0]).name).toBe("Arthas");

        handle.close();
        await handle.closed;
      } finally {
        ws.stop();
      }
    });

    test("SMSG_CONTACT_LIST populates ignoreStore", async () => {
      const ws = await startMockWorldServer();
      try {
        const handle = await worldSession(
          { ...base, host: "127.0.0.1", port: ws.port },
          fakeAuth(ws.port),
        );

        const eventReady = new Promise<IgnoreEvent>((resolve) => {
          handle.onIgnoreEvent(resolve);
        });

        ws.inject(
          GameOpcode.SMSG_CONTACT_LIST,
          buildContactList([
            {
              guid: 0xaan,
              flags: 0x02,
              note: "",
            },
          ]),
        );

        const event = await eventReady;
        expect(event.type).toBe("ignore-list");

        const ignored = handle.getIgnored();
        expect(ignored).toHaveLength(1);
        expect(must(ignored[0]).guid).toBe(0xaan);

        handle.close();
        await handle.closed;
      } finally {
        ws.stop();
      }
    });

    test("SMSG_CONTACT_LIST triggers name queries for ignored entries", async () => {
      const ws = await startMockWorldServer();
      try {
        const handle = await worldSession(
          { ...base, host: "127.0.0.1", port: ws.port },
          fakeAuth(ws.port),
        );

        const eventReady = new Promise<IgnoreEvent>((resolve) => {
          handle.onIgnoreEvent(resolve);
        });

        ws.inject(
          GameOpcode.SMSG_CONTACT_LIST,
          buildContactList([
            {
              guid: 0xabn,
              flags: 0x02,
              note: "",
            },
          ]),
        );

        await eventReady;
        await Bun.sleep(1);

        const nameQueries = ws.captured.filter(
          (p) => p.opcode === GameOpcode.CMSG_NAME_QUERY,
        );
        const match = nameQueries.find((p) => {
          const r = new PacketReader(p.body);
          return r.uint32LE() === 0xab;
        });
        expect(match).toBeDefined();

        ws.inject(
          GameOpcode.SMSG_NAME_QUERY_RESPONSE,
          buildNameQueryResponse(0xab, "Spammer"),
        );
        await Bun.sleep(1);

        const ignored = handle.getIgnored();
        expect(must(ignored[0]).name).toBe("Spammer");

        handle.close();
        await handle.closed;
      } finally {
        ws.stop();
      }
    });
  });
});
