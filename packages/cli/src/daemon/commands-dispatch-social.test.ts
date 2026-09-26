import { describe, expect, jest, test } from "bun:test";
import { createMockHandle } from "@tuicraft/core/test-support/mock-handle";
import { dispatchCommand, type EventEntry } from "#daemon/commands";
import { RingBuffer } from "#lib/ring-buffer";
import { createMockSocket } from "#test-support/commands-fixtures";

describe("dispatchCommand", () => {
  test("invite calls handle.invite and writes OK", async () => {
    const handle = createMockHandle();
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand(
      { target: "Voidtrix", type: "invite" },
      { cleanup, events, handle, socket },
    );

    expect(handle.invite).toHaveBeenCalledWith("Voidtrix");
    expect(socket.written()).toBe("OK\n\n");
  });

  test("kick calls handle.uninvite and writes OK", async () => {
    const handle = createMockHandle();
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand(
      { target: "Voidtrix", type: "kick" },
      { cleanup, events, handle, socket },
    );

    expect(handle.uninvite).toHaveBeenCalledWith("Voidtrix");
    expect(socket.written()).toBe("OK\n\n");
  });

  test("leave calls handle.leaveGroup and writes OK", async () => {
    const handle = createMockHandle();
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand(
      { type: "leave" },
      { cleanup, events, handle, socket },
    );

    expect(handle.leaveGroup).toHaveBeenCalled();
    expect(socket.written()).toBe("OK\n\n");
  });

  test("join_channel calls handle.joinChannel and writes OK", async () => {
    const handle = createMockHandle();
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand(
      { channel: "Trade", type: "join_channel" },
      { cleanup, events, handle, socket },
    );

    expect(handle.joinChannel).toHaveBeenCalledWith("Trade", undefined);
    expect(socket.written()).toBe("OK\n\n");
  });

  test("join_channel with password passes it through", async () => {
    const handle = createMockHandle();
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand(
      { channel: "Secret", password: "hunter2", type: "join_channel" },
      { cleanup, events, handle, socket },
    );

    expect(handle.joinChannel).toHaveBeenCalledWith("Secret", "hunter2");
    expect(socket.written()).toBe("OK\n\n");
  });

  test("leave_channel calls handle.leaveChannel and writes OK", async () => {
    const handle = createMockHandle();
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand(
      { channel: "Trade", type: "leave_channel" },
      { cleanup, events, handle, socket },
    );

    expect(handle.leaveChannel).toHaveBeenCalledWith("Trade");
    expect(socket.written()).toBe("OK\n\n");
  });

  test("leader calls handle.setLeader and writes OK", async () => {
    const handle = createMockHandle();
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand(
      { target: "Voidtrix", type: "leader" },
      { cleanup, events, handle, socket },
    );

    expect(handle.setLeader).toHaveBeenCalledWith("Voidtrix");
    expect(socket.written()).toBe("OK\n\n");
  });

  test("accept calls handle.acceptInvite and writes OK", async () => {
    const handle = createMockHandle();
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand(
      { type: "accept" },
      { cleanup, events, handle, socket },
    );

    expect(handle.acceptInvite).toHaveBeenCalled();
    expect(socket.written()).toBe("OK\n\n");
  });

  test("decline calls handle.declineInvite and writes OK", async () => {
    const handle = createMockHandle();
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand(
      { type: "decline" },
      { cleanup, events, handle, socket },
    );

    expect(handle.declineInvite).toHaveBeenCalled();
    expect(socket.written()).toBe("OK\n\n");
  });

  test("who_json returns JSON formatted results", async () => {
    const handle = createMockHandle();
    (handle.who as ReturnType<typeof jest.fn>).mockResolvedValue([
      {
        classId: 1,
        gender: 0,
        guild: "G",
        level: 80,
        name: "Test",
        race: 1,
        zone: 1,
      },
    ]);
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand(
      { filter: "mage", type: "who_json" },
      { cleanup, events, handle, socket },
    );

    expect(handle.who).toHaveBeenCalledWith({ name: "mage" });
    const parsed = JSON.parse(socket.written().replace(/\n+$/, ""));
    expect(parsed.type).toBe("WHO");
    expect(parsed.count).toBe(1);
    expect(parsed.results[0].name).toBe("Test");
  });

  test("friends calls getFriends and writes friend list", async () => {
    const handle = createMockHandle();
    (handle.getFriends as ReturnType<typeof jest.fn>).mockReturnValue([]);
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand(
      { type: "friends" },
      { cleanup, events, handle, socket },
    );

    expect(handle.getFriends).toHaveBeenCalled();
    expect(socket.written()).toContain("No friends on your list");
  });

  test("friends_json calls getFriends and writes JSON", async () => {
    const handle = createMockHandle();
    (handle.getFriends as ReturnType<typeof jest.fn>).mockReturnValue([]);
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand(
      { type: "friends_json" },
      { cleanup, events, handle, socket },
    );

    expect(handle.getFriends).toHaveBeenCalled();
    const parsed = JSON.parse(socket.written().replace(/\n+$/, ""));
    expect(parsed.type).toBe("FRIENDS");
    expect(parsed.count).toBe(0);
  });

  test("add_friend calls handle.addFriend and writes OK", async () => {
    const handle = createMockHandle();
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand(
      { target: "Arthas", type: "add_friend" },
      { cleanup, events, handle, socket },
    );

    expect(handle.addFriend).toHaveBeenCalledWith("Arthas");
    expect(socket.written()).toBe("OK\n\n");
  });

  test("del_friend calls handle.removeFriend and writes OK", async () => {
    const handle = createMockHandle();
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand(
      { target: "Arthas", type: "del_friend" },
      { cleanup, events, handle, socket },
    );

    expect(handle.removeFriend).toHaveBeenCalledWith("Arthas");
    expect(socket.written()).toBe("OK\n\n");
  });

  test("ignored calls getIgnored and writes ignore list", async () => {
    const handle = createMockHandle();
    (handle.getIgnored as ReturnType<typeof jest.fn>).mockReturnValue([]);
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand(
      { type: "ignored" },
      { cleanup, events, handle, socket },
    );

    expect(handle.getIgnored).toHaveBeenCalled();
    expect(socket.written()).toContain("Ignore list is empty");
  });

  test("ignored_json calls getIgnored and writes JSON", async () => {
    const handle = createMockHandle();
    (handle.getIgnored as ReturnType<typeof jest.fn>).mockReturnValue([]);
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand(
      { type: "ignored_json" },
      { cleanup, events, handle, socket },
    );

    expect(handle.getIgnored).toHaveBeenCalled();
    const parsed = JSON.parse(socket.written().replace(/\n+$/, ""));
    expect(parsed.type).toBe("IGNORED");
    expect(parsed.count).toBe(0);
  });

  test("add_ignore calls handle.addIgnore and writes OK", async () => {
    const handle = createMockHandle();
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand(
      { target: "Spammer", type: "add_ignore" },
      { cleanup, events, handle, socket },
    );

    expect(handle.addIgnore).toHaveBeenCalledWith("Spammer");
    expect(socket.written()).toBe("OK\n\n");
  });

  test("del_ignore calls handle.removeIgnore and writes OK", async () => {
    const handle = createMockHandle();
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand(
      { target: "Spammer", type: "del_ignore" },
      { cleanup, events, handle, socket },
    );

    expect(handle.removeIgnore).toHaveBeenCalledWith("Spammer");
    expect(socket.written()).toBe("OK\n\n");
  });
});
