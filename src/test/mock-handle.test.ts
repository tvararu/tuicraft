import { test, expect } from "bun:test";
import { createMockHandle } from "./mock-handle";

test("resolveClosed resolves closed promise", async () => {
  const handle = createMockHandle();
  handle.resolveClosed();
  await expect(handle.closed).resolves.toBeUndefined();
});

test("close resolves closed promise", async () => {
  const handle = createMockHandle();
  handle.close();
  await expect(handle.closed).resolves.toBeUndefined();
});

test("default who returns empty list", async () => {
  const handle = createMockHandle();
  await expect(handle.who({})).resolves.toEqual([]);
});

test("getLastChatMode defaults to say", () => {
  const handle = createMockHandle();
  expect(handle.getLastChatMode()).toEqual({ type: "say" });
});

test("setLastChatMode updates getLastChatMode", () => {
  const handle = createMockHandle();
  handle.setLastChatMode({ type: "whisper", target: "Xiara" });
  expect(handle.getLastChatMode()).toEqual({
    type: "whisper",
    target: "Xiara",
  });
});

test("triggerMessage forwards to onMessage callback", () => {
  const handle = createMockHandle();
  let seen = "";
  handle.onMessage((msg) => {
    seen = `${msg.sender}:${msg.message}`;
  });
  handle.triggerMessage({ type: 0, sender: "Alice", message: "hi" });
  expect(seen).toBe("Alice:hi");
});

test("triggerGroupEvent forwards to onGroupEvent callback", () => {
  const handle = createMockHandle();
  let seen = "";
  handle.onGroupEvent((event) => {
    seen = event.type;
  });
  handle.triggerGroupEvent({ type: "group_destroyed" });
  expect(seen).toBe("group_destroyed");
});

test("default getNearbyEntities returns empty list", () => {
  const handle = createMockHandle();
  expect(handle.getNearbyEntities()).toEqual([]);
});

test("default getFriends returns empty list", () => {
  const handle = createMockHandle();
  expect(handle.getFriends()).toEqual([]);
});

test("triggerFriendEvent forwards to onFriendEvent callback", () => {
  const handle = createMockHandle();
  let seen = "";
  handle.onFriendEvent((event) => {
    seen = event.type;
  });
  handle.triggerFriendEvent({ type: "friend-list", friends: [] });
  expect(seen).toBe("friend-list");
});
