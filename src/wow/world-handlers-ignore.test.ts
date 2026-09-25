import { describe, expect, test } from "bun:test";
import { startMockWorldServer } from "test/mock-world-server";
import { must } from "test/must";
import {
  base,
  buildContactList,
  buildFriendStatus,
  buildNameQueryResponse,
  fakeAuth,
  waitForEchoProbe,
} from "test/world-handlers-fixtures";
import { type ChatMessage, type IgnoreEvent, worldSession } from "wow/client";
import { ChatType, GameOpcode } from "wow/protocol/opcodes";
import { PacketReader } from "wow/protocol/packet";

describe("world handler tests", () => {
  describe("friend list", () => {
    test("SMSG_FRIEND_STATUS IGNORE_ADDED adds to ignoreStore", async () => {
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
          GameOpcode.SMSG_FRIEND_STATUS,
          buildFriendStatus({
            result: 0x0f,
            guid: 0xddn,
          }),
        );

        const event = await eventReady;
        expect(event.type).toBe("ignore-added");

        const ignored = handle.getIgnored();
        expect(ignored).toHaveLength(1);
        expect(must(ignored[0]).guid).toBe(0xddn);

        handle.close();
        await handle.closed;
      } finally {
        ws.stop();
      }
    });

    test("SMSG_FRIEND_STATUS IGNORE_REMOVED removes from ignoreStore", async () => {
      const ws = await startMockWorldServer();
      try {
        const handle = await worldSession(
          { ...base, host: "127.0.0.1", port: ws.port },
          fakeAuth(ws.port),
        );

        const listReady = new Promise<IgnoreEvent>((resolve) => {
          handle.onIgnoreEvent(resolve);
        });

        ws.inject(
          GameOpcode.SMSG_CONTACT_LIST,
          buildContactList([
            {
              guid: 0xeen,
              flags: 0x02,
              note: "",
            },
          ]),
        );
        await listReady;

        const removedReady = new Promise<IgnoreEvent>((resolve) => {
          handle.onIgnoreEvent(resolve);
        });

        ws.inject(
          GameOpcode.SMSG_FRIEND_STATUS,
          buildFriendStatus({
            result: 0x10,
            guid: 0xeen,
          }),
        );

        const event = await removedReady;
        expect(event.type).toBe("ignore-removed");
        expect(handle.getIgnored()).toHaveLength(0);

        handle.close();
        await handle.closed;
      } finally {
        ws.stop();
      }
    });

    test("SMSG_FRIEND_STATUS ignore error fires ignore-error event", async () => {
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
          GameOpcode.SMSG_FRIEND_STATUS,
          buildFriendStatus({
            result: 0x0b,
            guid: 0x00n,
          }),
        );

        const event = await eventReady;
        expect(event.type).toBe("ignore-error");
        if (event.type === "ignore-error") {
          expect(event.result).toBe(0x0b);
        }

        handle.close();
        await handle.closed;
      } finally {
        ws.stop();
      }
    });

    test("messages from ignored sender are silently dropped", async () => {
      const ws = await startMockWorldServer();
      try {
        const handle = await worldSession(
          { ...base, host: "127.0.0.1", port: ws.port },
          fakeAuth(ws.port),
        );

        const listReady = new Promise<IgnoreEvent>((resolve) => {
          handle.onIgnoreEvent(resolve);
        });

        ws.inject(
          GameOpcode.SMSG_CONTACT_LIST,
          buildContactList([
            {
              guid: 0x42n,
              flags: 0x02,
              note: "",
            },
          ]),
        );
        await listReady;

        const messages: ChatMessage[] = [];
        handle.onMessage((msg) => messages.push(msg));

        handle.sendSay("hello");
        await Bun.sleep(50);

        expect(messages).toHaveLength(0);

        handle.close();
        await handle.closed;
      } finally {
        ws.stop();
      }
    });

    test("addIgnore sends CMSG_ADD_IGNORE", async () => {
      const ws = await startMockWorldServer();
      try {
        const handle = await worldSession(
          { ...base, host: "127.0.0.1", port: ws.port },
          fakeAuth(ws.port),
        );

        handle.addIgnore("Spammer");
        await Bun.sleep(1);

        const addPackets = ws.captured.filter(
          (p) => p.opcode === GameOpcode.CMSG_ADD_IGNORE,
        );
        expect(addPackets).toHaveLength(1);
        const r = new PacketReader(must(addPackets[0]).body);
        expect(r.cString()).toBe("Spammer");

        handle.close();
        await handle.closed;
      } finally {
        ws.stop();
      }
    });

    test("removeIgnore sends CMSG_DEL_IGNORE", async () => {
      const ws = await startMockWorldServer();
      try {
        const handle = await worldSession(
          { ...base, host: "127.0.0.1", port: ws.port },
          fakeAuth(ws.port),
        );

        const listReady = new Promise<IgnoreEvent>((resolve) => {
          handle.onIgnoreEvent(resolve);
        });

        ws.inject(
          GameOpcode.SMSG_CONTACT_LIST,
          buildContactList([
            {
              guid: 0xffn,
              flags: 0x02,
              note: "",
            },
          ]),
        );
        await listReady;

        ws.inject(
          GameOpcode.SMSG_NAME_QUERY_RESPONSE,
          buildNameQueryResponse(0xff, "Spammer"),
        );
        await Bun.sleep(1);

        handle.removeIgnore("Spammer");
        await Bun.sleep(1);

        const delPackets = ws.captured.filter(
          (p) => p.opcode === GameOpcode.CMSG_DEL_IGNORE,
        );
        expect(delPackets).toHaveLength(1);
        const r = new PacketReader(must(delPackets[0]).body);
        expect(r.uint64LE()).toBe(0xffn);

        handle.close();
        await handle.closed;
      } finally {
        ws.stop();
      }
    });

    test("removeIgnore for unknown name triggers system message", async () => {
      const ws = await startMockWorldServer();
      try {
        const handle = await worldSession(
          { ...base, host: "127.0.0.1", port: ws.port },
          fakeAuth(ws.port),
        );
        await waitForEchoProbe(handle);

        const received = new Promise<ChatMessage>((resolve) => {
          handle.onMessage(resolve);
        });

        handle.removeIgnore("Nobody");

        const msg = await received;
        expect(msg.type).toBe(ChatType.SYSTEM);
        expect(msg.message).toBe('"Nobody" is not on your ignore list.');

        handle.close();
        await handle.closed;
      } finally {
        ws.stop();
      }
    });
  });
});
