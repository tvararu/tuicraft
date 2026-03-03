import { test, expect } from "bun:test";
import { createMockHandle } from "./mock-handle";
import { ObjectType } from "wow/protocol/entity-fields";
import type { UnitEntity } from "wow/entity-store";

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

test("triggerEntityEvent forwards to onEntityEvent callback", () => {
  const handle = createMockHandle();
  let seen = "";
  handle.onEntityEvent((event) => {
    seen = event.type;
  });
  handle.triggerEntityEvent({
    type: "appear",
    entity: {
      guid: 1n,
      objectType: ObjectType.UNIT,
      name: "NPC",
      level: 10,
      entry: 0,
      scale: 1,
      position: undefined,
      rawFields: new Map(),
      health: 100,
      maxHealth: 100,
      factionTemplate: 0,
      displayId: 0,
      npcFlags: 0,
      unitFlags: 0,
      target: 0n,
      race: 0,
      class_: 0,
      gender: 0,
      power: [],
      maxPower: [],
    } satisfies UnitEntity,
  });
  expect(seen).toBe("appear");
});

test("triggerIgnoreEvent forwards to onIgnoreEvent callback", () => {
  const handle = createMockHandle();
  let seen = "";
  handle.onIgnoreEvent((event) => {
    seen = event.type;
  });
  handle.triggerIgnoreEvent({ type: "ignore-list", entries: [] });
  expect(seen).toBe("ignore-list");
});

test("triggerGuildEvent forwards to onGuildEvent callback", () => {
  const handle = createMockHandle();
  let seen = "";
  handle.onGuildEvent((event) => {
    seen = event.type;
  });
  handle.triggerGuildEvent({
    type: "guild-roster",
    roster: {
      guildName: "",
      motd: "",
      guildInfo: "",
      rankNames: [],
      members: [],
    },
  });
  expect(seen).toBe("guild-roster");
});

test("default getIgnored returns empty list", () => {
  const handle = createMockHandle();
  expect(handle.getIgnored()).toEqual([]);
});

test("default requestGuildRoster returns undefined", async () => {
  const handle = createMockHandle();
  await expect(handle.requestGuildRoster()).resolves.toBeUndefined();
});
