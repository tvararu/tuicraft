import { describe, expect, test } from "bun:test";
import {
  type FriendEntry,
  FriendStatus,
  type IgnoreEntry,
} from "@tuicraft/core";
import {
  makeFriendEntry,
  makeIgnoreEntry,
} from "#test-support/format-fixtures";
import {
  formatFriendEvent,
  formatFriendEventObj,
  formatFriendList,
  formatFriendListJson,
  formatIgnoreEvent,
  formatIgnoreEventObj,
  formatIgnoreList,
  formatIgnoreListJson,
} from "#ui/format";

describe("formatFriendList", () => {
  test("empty list returns no-friends message", () => {
    expect(formatFriendList([])).toBe("[friends] No friends on your list");
  });

  test("shows online and offline friends", () => {
    const friends: FriendEntry[] = [
      makeFriendEntry(),
      makeFriendEntry({
        guid: 2n,
        name: "Jaina",
        playerClass: 8,
        status: FriendStatus.OFFLINE,
      }),
    ];
    const result = formatFriendList(friends);
    expect(result).toContain("1/2 online");
    expect(result).toContain("Arthas — Online, Level 80 Death Knight");
    expect(result).toContain("Jaina — Offline");
  });

  test("shows AFK and DND statuses", () => {
    const friends: FriendEntry[] = [
      makeFriendEntry({
        level: 70,
        name: "Afker",
        playerClass: 1,
        status: FriendStatus.AFK,
      }),
      makeFriendEntry({
        guid: 2n,
        level: 60,
        name: "Dnder",
        playerClass: 4,
        status: FriendStatus.DND,
      }),
    ];
    const result = formatFriendList(friends);
    expect(result).toContain("Afker — AFK, Level 70 Warrior");
    expect(result).toContain("Dnder — DND, Level 60 Rogue");
  });

  test("falls back to guid when name is empty", () => {
    const friends: FriendEntry[] = [
      makeFriendEntry({
        guid: 42n,
        level: 1,
        name: "",
        playerClass: 1,
        status: FriendStatus.OFFLINE,
      }),
    ];
    const result = formatFriendList(friends);
    expect(result).toContain("guid:42 — Offline");
  });
});

describe("formatFriendListJson", () => {
  test("serializes friends with status, class, and area", () => {
    const friends: FriendEntry[] = [
      makeFriendEntry({ area: 394, note: "buddy" }),
      makeFriendEntry({
        guid: 2n,
        name: "Jaina",
        playerClass: 8,
        status: FriendStatus.OFFLINE,
      }),
    ];
    const result = JSON.parse(formatFriendListJson(friends));
    expect(result.type).toBe("FRIENDS");
    expect(result.count).toBe(2);
    expect(result.online).toBe(1);
    expect(result.friends[0].name).toBe("Arthas");
    expect(result.friends[0].note).toBe("buddy");
    expect(result.friends[0].status).toBe("ONLINE");
    expect(result.friends[0].level).toBe(80);
    expect(result.friends[0].class).toBe("Death Knight");
    expect(result.friends[0].area).toBe(394);
    expect(result.friends[1].name).toBe("Jaina");
    expect(result.friends[1].status).toBe("OFFLINE");
    expect(result.friends[1].class).toBe("Mage");
  });
});

describe("formatFriendEvent", () => {
  test("friend-online with class and level", () => {
    const result = formatFriendEvent({
      friend: makeFriendEntry(),
      type: "friend-online",
    });
    expect(result).toBe(
      "[friends] Arthas is now online (Level 80 Death Knight)",
    );
  });

  test("friend-offline", () => {
    const result = formatFriendEvent({
      guid: 1n,
      name: "Arthas",
      type: "friend-offline",
    });
    expect(result).toBe("[friends] Arthas went offline");
  });

  test("friend-added", () => {
    const result = formatFriendEvent({
      friend: makeFriendEntry({
        name: "Jaina",
        playerClass: 8,
        status: FriendStatus.OFFLINE,
      }),
      type: "friend-added",
    });
    expect(result).toBe("[friends] Jaina added to friends list");
  });

  test("friend-removed", () => {
    const result = formatFriendEvent({
      guid: 1n,
      name: "Jaina",
      type: "friend-removed",
    });
    expect(result).toBe("[friends] Jaina removed from friends list");
  });

  test("friend-error", () => {
    const result = formatFriendEvent({
      name: "Nobody",
      result: 0x04,
      type: "friend-error",
    });
    expect(result).toBe("[friends] Error: player not found");
  });

  test("friend-error with unknown code", () => {
    const result = formatFriendEvent({
      name: "Nobody",
      result: 0xff,
      type: "friend-error",
    });
    expect(result).toBe("[friends] Error: error 255");
  });

  test("friend-list returns undefined", () => {
    const result = formatFriendEvent({ friends: [], type: "friend-list" });
    expect(result).toBeUndefined();
  });
});

describe("formatFriendEventObj", () => {
  test("friend-online", () => {
    const result = formatFriendEventObj({
      friend: makeFriendEntry({ area: 394 }),
      type: "friend-online",
    });
    expect(result).toEqual({
      area: 394,
      class: "Death Knight",
      level: 80,
      name: "Arthas",
      type: "FRIEND_ONLINE",
    });
  });

  test("friend-offline", () => {
    const result = formatFriendEventObj({
      guid: 1n,
      name: "Arthas",
      type: "friend-offline",
    });
    expect(result).toEqual({ name: "Arthas", type: "FRIEND_OFFLINE" });
  });

  test("friend-added", () => {
    const result = formatFriendEventObj({
      friend: makeFriendEntry({
        name: "Jaina",
        playerClass: 8,
        status: FriendStatus.OFFLINE,
      }),
      type: "friend-added",
    });
    expect(result).toEqual({ name: "Jaina", type: "FRIEND_ADDED" });
  });

  test("friend-removed", () => {
    const result = formatFriendEventObj({
      guid: 1n,
      name: "Jaina",
      type: "friend-removed",
    });
    expect(result).toEqual({ name: "Jaina", type: "FRIEND_REMOVED" });
  });

  test("friend-error", () => {
    const result = formatFriendEventObj({
      name: "Self",
      result: 0x08,
      type: "friend-error",
    });
    expect(result).toEqual({
      message: "already on friends list",
      result: 0x08,
      type: "FRIEND_ERROR",
    });
  });

  test("friend-list returns undefined", () => {
    const result = formatFriendEventObj({ friends: [], type: "friend-list" });
    expect(result).toBeUndefined();
  });
});

describe("formatIgnoreList", () => {
  test("empty list returns empty message", () => {
    expect(formatIgnoreList([])).toBe("[ignore] Ignore list is empty");
  });

  test("shows ignored players", () => {
    const ignored: IgnoreEntry[] = [
      makeIgnoreEntry(),
      makeIgnoreEntry({ guid: 2n, name: "Annoying" }),
    ];
    const result = formatIgnoreList(ignored);
    expect(result).toContain("2 ignored");
    expect(result).toContain("Spammer");
    expect(result).toContain("Annoying");
  });

  test("falls back to guid when name is empty", () => {
    const ignored: IgnoreEntry[] = [makeIgnoreEntry({ guid: 42n, name: "" })];
    const result = formatIgnoreList(ignored);
    expect(result).toContain("guid:42");
  });
});

describe("formatIgnoreListJson", () => {
  test("serializes ignored players", () => {
    const ignored: IgnoreEntry[] = [
      makeIgnoreEntry(),
      makeIgnoreEntry({ guid: 2n, name: "Annoying" }),
    ];
    const result = JSON.parse(formatIgnoreListJson(ignored));
    expect(result.type).toBe("IGNORED");
    expect(result.count).toBe(2);
    expect(result.ignored[0].name).toBe("Spammer");
    expect(result.ignored[1].name).toBe("Annoying");
  });
});

describe("formatIgnoreEvent", () => {
  test("ignore-added", () => {
    const result = formatIgnoreEvent({
      entry: makeIgnoreEntry(),
      type: "ignore-added",
    });
    expect(result).toBe("[ignore] Spammer added to ignore list");
  });

  test("ignore-removed", () => {
    const result = formatIgnoreEvent({
      guid: 1n,
      name: "Spammer",
      type: "ignore-removed",
    });
    expect(result).toBe("[ignore] Spammer removed from ignore list");
  });

  test("ignore-error", () => {
    const result = formatIgnoreEvent({
      name: "Nobody",
      result: 0x0d,
      type: "ignore-error",
    });
    expect(result).toBe("[ignore] Error: player not found");
  });

  test("ignore-error with unknown code", () => {
    const result = formatIgnoreEvent({
      name: "Nobody",
      result: 0xff,
      type: "ignore-error",
    });
    expect(result).toBe("[ignore] Error: error 255");
  });

  test("ignore-list returns undefined", () => {
    const result = formatIgnoreEvent({ entries: [], type: "ignore-list" });
    expect(result).toBeUndefined();
  });

  test("ignore-error ignore list full", () => {
    const result = formatIgnoreEvent({
      name: "Someone",
      result: 0x0b,
      type: "ignore-error",
    });
    expect(result).toBe("[ignore] Error: ignore list is full");
  });

  test("ignore-error cannot ignore yourself", () => {
    const result = formatIgnoreEvent({
      name: "Self",
      result: 0x0c,
      type: "ignore-error",
    });
    expect(result).toBe("[ignore] Error: cannot ignore yourself");
  });

  test("ignore-error already ignoring", () => {
    const result = formatIgnoreEvent({
      name: "Dup",
      result: 0x0e,
      type: "ignore-error",
    });
    expect(result).toBe("[ignore] Error: already ignoring");
  });

  test("ignore-error ambiguous name", () => {
    const result = formatIgnoreEvent({
      name: "Amb",
      result: 0x11,
      type: "ignore-error",
    });
    expect(result).toBe("[ignore] Error: name is ambiguous");
  });
});

describe("formatIgnoreEventObj", () => {
  test("ignore-added", () => {
    const result = formatIgnoreEventObj({
      entry: makeIgnoreEntry(),
      type: "ignore-added",
    });
    expect(result).toEqual({ name: "Spammer", type: "IGNORE_ADDED" });
  });

  test("ignore-removed", () => {
    const result = formatIgnoreEventObj({
      guid: 1n,
      name: "Spammer",
      type: "ignore-removed",
    });
    expect(result).toEqual({ name: "Spammer", type: "IGNORE_REMOVED" });
  });

  test("ignore-error", () => {
    const result = formatIgnoreEventObj({
      name: "Dup",
      result: 0x0e,
      type: "ignore-error",
    });
    expect(result).toEqual({
      message: "already ignoring",
      result: 0x0e,
      type: "IGNORE_ERROR",
    });
  });

  test("ignore-list returns undefined", () => {
    const result = formatIgnoreEventObj({ entries: [], type: "ignore-list" });
    expect(result).toBeUndefined();
  });
});
