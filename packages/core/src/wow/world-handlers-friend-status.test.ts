import { describe, expect, test } from "bun:test";
import { startMockWorldServer } from "#test-support/mock-world-server";
import { must } from "#test-support/must";
import {
  base,
  buildContactList,
  buildFriendStatus,
  buildNameQueryResponse,
  fakeAuth,
  waitForEchoProbe,
} from "#test-support/world-handlers-fixtures";
import { type ChatMessage, type FriendEvent, worldSession } from "#wow/client";
import { ChatType, GameOpcode } from "#wow/protocol/opcodes";
import { PacketReader } from "#wow/protocol/packet";

describe("world handler tests", () => {
  describe("friend list", () => {
    test("SMSG_FRIEND_STATUS ADDED_ONLINE", async () => {
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
          GameOpcode.SMSG_FRIEND_STATUS,
          buildFriendStatus({
            result: 0x06,
            guid: 0xbbn,
            note: "new friend",
            status: 1,
            area: 1537,
            level: 55,
            playerClass: 4,
          }),
        );

        const event = await eventReady;
        expect(event.type).toBe("friend-added");

        const friends = handle.getFriends();
        expect(friends).toHaveLength(1);
        expect(must(friends[0]).guid).toBe(0xbbn);
        expect(must(friends[0]).note).toBe("new friend");
        expect(must(friends[0]).status).toBe(1);
        expect(must(friends[0]).area).toBe(1537);
        expect(must(friends[0]).level).toBe(55);
        expect(must(friends[0]).playerClass).toBe(4);

        handle.close();
        await handle.closed;
      } finally {
        ws.stop();
      }
    });

    test("SMSG_FRIEND_STATUS ONLINE updates existing friend", async () => {
      const ws = await startMockWorldServer();
      try {
        const handle = await worldSession(
          { ...base, host: "127.0.0.1", port: ws.port },
          fakeAuth(ws.port),
        );

        const listReady = new Promise<FriendEvent>((resolve) => {
          handle.onFriendEvent(resolve);
        });

        ws.inject(
          GameOpcode.SMSG_CONTACT_LIST,
          buildContactList([
            {
              guid: 0xccn,
              flags: 0x01,
              note: "",
              status: 0,
            },
          ]),
        );
        await listReady;

        const onlineReady = new Promise<FriendEvent>((resolve) => {
          handle.onFriendEvent(resolve);
        });

        ws.inject(
          GameOpcode.SMSG_FRIEND_STATUS,
          buildFriendStatus({
            result: 0x02,
            guid: 0xccn,
            status: 1,
            area: 400,
            level: 60,
            playerClass: 8,
          }),
        );

        const event = await onlineReady;
        expect(event.type).toBe("friend-online");

        const friends = handle.getFriends();
        expect(must(friends[0]).status).toBe(1);
        expect(must(friends[0]).area).toBe(400);
        expect(must(friends[0]).level).toBe(60);
        expect(must(friends[0]).playerClass).toBe(8);

        handle.close();
        await handle.closed;
      } finally {
        ws.stop();
      }
    });

    test("SMSG_FRIEND_STATUS OFFLINE clears status", async () => {
      const ws = await startMockWorldServer();
      try {
        const handle = await worldSession(
          { ...base, host: "127.0.0.1", port: ws.port },
          fakeAuth(ws.port),
        );

        const listReady = new Promise<FriendEvent>((resolve) => {
          handle.onFriendEvent(resolve);
        });

        ws.inject(
          GameOpcode.SMSG_CONTACT_LIST,
          buildContactList([
            {
              guid: 0xddn,
              flags: 0x01,
              note: "",
              status: 1,
              area: 100,
              level: 70,
              playerClass: 5,
            },
          ]),
        );
        await listReady;

        const offlineReady = new Promise<FriendEvent>((resolve) => {
          handle.onFriendEvent(resolve);
        });

        ws.inject(
          GameOpcode.SMSG_FRIEND_STATUS,
          buildFriendStatus({
            result: 0x03,
            guid: 0xddn,
          }),
        );

        const event = await offlineReady;
        expect(event.type).toBe("friend-offline");

        const friends = handle.getFriends();
        expect(must(friends[0]).status).toBe(0);

        handle.close();
        await handle.closed;
      } finally {
        ws.stop();
      }
    });

    test("SMSG_FRIEND_STATUS REMOVED deletes from store", async () => {
      const ws = await startMockWorldServer();
      try {
        const handle = await worldSession(
          { ...base, host: "127.0.0.1", port: ws.port },
          fakeAuth(ws.port),
        );

        const listReady = new Promise<FriendEvent>((resolve) => {
          handle.onFriendEvent(resolve);
        });

        ws.inject(
          GameOpcode.SMSG_CONTACT_LIST,
          buildContactList([
            {
              guid: 0xeen,
              flags: 0x01,
              note: "",
              status: 1,
              area: 10,
              level: 80,
              playerClass: 1,
            },
          ]),
        );
        await listReady;

        const removedReady = new Promise<FriendEvent>((resolve) => {
          handle.onFriendEvent(resolve);
        });

        ws.inject(
          GameOpcode.SMSG_FRIEND_STATUS,
          buildFriendStatus({
            result: 0x05,
            guid: 0xeen,
          }),
        );

        const event = await removedReady;
        expect(event.type).toBe("friend-removed");

        expect(handle.getFriends()).toHaveLength(0);

        handle.close();
        await handle.closed;
      } finally {
        ws.stop();
      }
    });

    test("SMSG_FRIEND_STATUS ADDED_OFFLINE adds with zero status", async () => {
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
          GameOpcode.SMSG_FRIEND_STATUS,
          buildFriendStatus({
            result: 0x07,
            guid: 0xabn,
            note: "offline pal",
          }),
        );

        const event = await eventReady;
        expect(event.type).toBe("friend-added");

        const friends = handle.getFriends();
        expect(friends).toHaveLength(1);
        expect(must(friends[0]).guid).toBe(0xabn);
        expect(must(friends[0]).note).toBe("offline pal");
        expect(must(friends[0]).status).toBe(0);

        handle.close();
        await handle.closed;
      } finally {
        ws.stop();
      }
    });

    test("SMSG_FRIEND_STATUS error fires friend-error event", async () => {
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
          GameOpcode.SMSG_FRIEND_STATUS,
          buildFriendStatus({
            result: 0x04,
            guid: 0x00n,
          }),
        );

        const event = await eventReady;
        expect(event.type).toBe("friend-error");
        if (event.type === "friend-error") {
          expect(event.result).toBe(0x04);
        }

        handle.close();
        await handle.closed;
      } finally {
        ws.stop();
      }
    });

    test("addFriend sends CMSG_ADD_FRIEND", async () => {
      const ws = await startMockWorldServer();
      try {
        const handle = await worldSession(
          { ...base, host: "127.0.0.1", port: ws.port },
          fakeAuth(ws.port),
        );

        handle.addFriend("Arthas");
        await Bun.sleep(1);

        const addPackets = ws.captured.filter(
          (p) => p.opcode === GameOpcode.CMSG_ADD_FRIEND,
        );
        expect(addPackets).toHaveLength(1);
        const r = new PacketReader(must(addPackets[0]).body);
        expect(r.cString()).toBe("Arthas");
        expect(r.cString()).toBe("");

        handle.close();
        await handle.closed;
      } finally {
        ws.stop();
      }
    });

    test("removeFriend sends CMSG_DEL_FRIEND", async () => {
      const ws = await startMockWorldServer();
      try {
        const handle = await worldSession(
          { ...base, host: "127.0.0.1", port: ws.port },
          fakeAuth(ws.port),
        );

        const listReady = new Promise<FriendEvent>((resolve) => {
          handle.onFriendEvent(resolve);
        });

        ws.inject(
          GameOpcode.SMSG_CONTACT_LIST,
          buildContactList([
            {
              guid: 0xffn,
              flags: 0x01,
              note: "",
              status: 1,
              area: 10,
              level: 80,
              playerClass: 1,
            },
          ]),
        );
        await listReady;

        ws.inject(
          GameOpcode.SMSG_NAME_QUERY_RESPONSE,
          buildNameQueryResponse(0xff, "Arthas"),
        );
        await Bun.sleep(1);

        handle.removeFriend("Arthas");
        await Bun.sleep(1);

        const delPackets = ws.captured.filter(
          (p) => p.opcode === GameOpcode.CMSG_DEL_FRIEND,
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

    test("removeFriend for unknown name triggers system message", async () => {
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

        handle.removeFriend("Nobody");

        const msg = await received;
        expect(msg.type).toBe(ChatType.SYSTEM);
        expect(msg.message).toBe('"Nobody" is not on your friends list.');

        handle.close();
        await handle.closed;
      } finally {
        ws.stop();
      }
    });
  });
});
