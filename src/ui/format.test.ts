import { test, expect, describe } from "bun:test";
import {
  formatMessage,
  formatMessageJson,
  formatMessageObj,
  formatPrompt,
  formatGroupEvent,
  formatEntityEvent,
  formatEntityEventObj,
  formatFriendList,
  formatFriendListJson,
  formatFriendEvent,
  formatFriendEventObj,
} from "ui/format";
import { ChatType, PartyOperation, PartyResult } from "wow/protocol/opcodes";
import { ObjectType } from "wow/protocol/entity-fields";
import { FriendStatus } from "wow/protocol/social";
import type { FriendEntry } from "wow/friend-store";

describe("formatMessage", () => {
  test("whisper from", () => {
    const msg = { type: ChatType.WHISPER, sender: "Eve", message: "psst" };
    expect(formatMessage(msg)).toBe("[whisper from Eve] psst");
  });

  test("whisper to", () => {
    const msg = {
      type: ChatType.WHISPER_INFORM,
      sender: "Eve",
      message: "hey",
    };
    expect(formatMessage(msg)).toBe("[whisper to Eve] hey");
  });

  test("system message", () => {
    const msg = { type: ChatType.SYSTEM, sender: "", message: "Welcome" };
    expect(formatMessage(msg)).toBe("[system] Welcome");
  });

  test("channel message", () => {
    const msg = {
      type: ChatType.CHANNEL,
      sender: "Al",
      message: "hey",
      channel: "General",
    };
    expect(formatMessage(msg)).toBe("[General] Al: hey");
  });

  test("generic say", () => {
    const msg = { type: ChatType.SAY, sender: "Alice", message: "hi" };
    expect(formatMessage(msg)).toBe("[say] Alice: hi");
  });

  test("unknown type", () => {
    const msg = { type: 99, sender: "Bob", message: "wat" };
    expect(formatMessage(msg)).toBe("[type 99] Bob: wat");
  });

  test("strips color codes from message", () => {
    const msg = {
      type: ChatType.SAY,
      sender: "Alice",
      message: "|cff1eff00|Hitem:1234|h[Cool Sword]|h|r equipped",
    };
    expect(formatMessage(msg)).toBe("[say] Alice: [Cool Sword] equipped");
  });

  test("roll message", () => {
    const msg = {
      type: ChatType.ROLL,
      sender: "Xiara",
      message: "rolled 42 (1-100)",
    };
    expect(formatMessage(msg)).toBe("[roll] Xiara rolled 42 (1-100)");
  });

  test("server broadcast origin shows [server] label", () => {
    const msg = {
      type: ChatType.SYSTEM,
      sender: "",
      message: "Server shutdown in 15:00",
      origin: "server" as const,
    };
    expect(formatMessage(msg)).toBe("[server] Server shutdown in 15:00");
  });

  test("notification origin shows [server] label", () => {
    const msg = {
      type: ChatType.SYSTEM,
      sender: "",
      message: "Autobroadcast text",
      origin: "notification" as const,
    };
    expect(formatMessage(msg)).toBe("[server] Autobroadcast text");
  });
});

describe("formatMessageJson", () => {
  test("json say", () => {
    const msg = { type: ChatType.SAY, sender: "Alice", message: "hi" };
    expect(JSON.parse(formatMessageJson(msg))).toEqual({
      type: "SAY",
      sender: "Alice",
      message: "hi",
    });
  });

  test("json whisper from", () => {
    const msg = { type: ChatType.WHISPER, sender: "Eve", message: "psst" };
    expect(JSON.parse(formatMessageJson(msg))).toEqual({
      type: "WHISPER_FROM",
      sender: "Eve",
      message: "psst",
    });
  });

  test("json whisper to", () => {
    const msg = {
      type: ChatType.WHISPER_INFORM,
      sender: "Eve",
      message: "hey",
    };
    expect(JSON.parse(formatMessageJson(msg))).toEqual({
      type: "WHISPER_TO",
      sender: "Eve",
      message: "hey",
    });
  });

  test("json channel includes channel field", () => {
    const msg = {
      type: ChatType.CHANNEL,
      sender: "Al",
      message: "hey",
      channel: "General",
    };
    expect(JSON.parse(formatMessageJson(msg))).toEqual({
      type: "CHANNEL",
      sender: "Al",
      message: "hey",
      channel: "General",
    });
  });

  test("json system message", () => {
    const msg = { type: ChatType.SYSTEM, sender: "", message: "Welcome" };
    expect(JSON.parse(formatMessageJson(msg))).toEqual({
      type: "SYSTEM",
      sender: "",
      message: "Welcome",
    });
  });

  test("json unknown type uses TYPE_N", () => {
    const msg = { type: 99, sender: "Bob", message: "wat" };
    expect(JSON.parse(formatMessageJson(msg))).toEqual({
      type: "TYPE_99",
      sender: "Bob",
      message: "wat",
    });
  });

  test("json roll message", () => {
    const msg = {
      type: ChatType.ROLL,
      sender: "Xiara",
      message: "rolled 42 (1-100)",
    };
    expect(JSON.parse(formatMessageJson(msg))).toEqual({
      type: "ROLL",
      sender: "Xiara",
      message: "rolled 42 (1-100)",
    });
  });

  test("server broadcast origin uses SERVER_BROADCAST JSON type", () => {
    const msg = {
      type: ChatType.SYSTEM,
      sender: "",
      message: "Shutdown in 5:00",
      origin: "server" as const,
    };
    expect(formatMessageObj(msg)).toEqual({
      type: "SERVER_BROADCAST",
      sender: "",
      message: "Shutdown in 5:00",
    });
  });

  test("notification origin uses NOTIFICATION JSON type", () => {
    const msg = {
      type: ChatType.SYSTEM,
      sender: "",
      message: "Auto message",
      origin: "notification" as const,
    };
    expect(formatMessageObj(msg)).toEqual({
      type: "NOTIFICATION",
      sender: "",
      message: "Auto message",
    });
  });
});

describe("formatPrompt", () => {
  test("say mode", () => {
    expect(formatPrompt({ type: "say" })).toBe("[say] > ");
  });

  test("party mode", () => {
    expect(formatPrompt({ type: "party" })).toBe("[party] > ");
  });

  test("whisper mode includes target", () => {
    expect(formatPrompt({ type: "whisper", target: "Xiara" })).toBe(
      "[whisper: Xiara] > ",
    );
  });

  test("channel mode includes channel name", () => {
    expect(formatPrompt({ type: "channel", channel: "General" })).toBe(
      "[General] > ",
    );
  });
});

describe("formatGroupEvent", () => {
  test("invite success", () => {
    expect(
      formatGroupEvent({
        type: "command_result",
        operation: PartyOperation.INVITE,
        target: "Voidtrix",
        result: PartyResult.SUCCESS,
      }),
    ).toBe("[group] Invited Voidtrix");
  });

  test("invite failure", () => {
    expect(
      formatGroupEvent({
        type: "command_result",
        operation: PartyOperation.INVITE,
        target: "Voidtrix",
        result: PartyResult.BAD_PLAYER_NAME,
      }),
    ).toBe("[group] Cannot invite Voidtrix: player not found");
  });

  test("uninvite success", () => {
    expect(
      formatGroupEvent({
        type: "command_result",
        operation: PartyOperation.UNINVITE,
        target: "Voidtrix",
        result: PartyResult.SUCCESS,
      }),
    ).toBe("[group] Removed Voidtrix from group");
  });

  test("uninvite failure", () => {
    expect(
      formatGroupEvent({
        type: "command_result",
        operation: PartyOperation.UNINVITE,
        target: "Voidtrix",
        result: PartyResult.NOT_LEADER,
      }),
    ).toBe("[group] Cannot kick Voidtrix: you are not the leader");
  });

  test("leave success", () => {
    expect(
      formatGroupEvent({
        type: "command_result",
        operation: PartyOperation.LEAVE,
        target: "",
        result: PartyResult.SUCCESS,
      }),
    ).toBe("[group] Left the group");
  });

  test("leave failure", () => {
    expect(
      formatGroupEvent({
        type: "command_result",
        operation: PartyOperation.LEAVE,
        target: "",
        result: PartyResult.NOT_LEADER,
      }),
    ).toBe("[group] Cannot leave: you are not the leader");
  });

  test("command_result with empty target omits extra space", () => {
    expect(
      formatGroupEvent({
        type: "command_result",
        operation: PartyOperation.UNINVITE,
        target: "",
        result: PartyResult.NOT_LEADER,
      }),
    ).toBe("[group] Cannot kick: you are not the leader");
  });

  test("invite failure with group full label", () => {
    expect(
      formatGroupEvent({
        type: "command_result",
        operation: PartyOperation.INVITE,
        target: "Voidtrix",
        result: PartyResult.GROUP_FULL,
      }),
    ).toBe("[group] Cannot invite Voidtrix: group is full");
  });

  test("invite failure with already in group label", () => {
    expect(
      formatGroupEvent({
        type: "command_result",
        operation: PartyOperation.INVITE,
        target: "Voidtrix",
        result: PartyResult.ALREADY_IN_GROUP,
      }),
    ).toBe("[group] Cannot invite Voidtrix: already in a group");
  });

  test("invite failure with wrong faction label", () => {
    expect(
      formatGroupEvent({
        type: "command_result",
        operation: PartyOperation.INVITE,
        target: "Voidtrix",
        result: PartyResult.PLAYER_WRONG_FACTION,
      }),
    ).toBe("[group] Cannot invite Voidtrix: wrong faction");
  });

  test("invite failure with ignoring you label", () => {
    expect(
      formatGroupEvent({
        type: "command_result",
        operation: PartyOperation.INVITE,
        target: "Voidtrix",
        result: PartyResult.IGNORING_YOU,
      }),
    ).toBe("[group] Cannot invite Voidtrix: player is ignoring you");
  });

  test("leader changed", () => {
    expect(formatGroupEvent({ type: "leader_changed", name: "Alice" })).toBe(
      "[group] Alice is now the group leader",
    );
  });

  test("group destroyed", () => {
    expect(formatGroupEvent({ type: "group_destroyed" })).toBe(
      "[group] Group has been disbanded",
    );
  });

  test("kicked", () => {
    expect(formatGroupEvent({ type: "kicked" })).toBe(
      "[group] You have been removed from the group",
    );
  });

  test("invite declined", () => {
    expect(formatGroupEvent({ type: "invite_declined", name: "Bob" })).toBe(
      "[group] Bob has declined your invitation",
    );
  });

  test("group_list returns undefined", () => {
    expect(
      formatGroupEvent({
        type: "group_list",
        members: [],
        leader: "",
      }),
    ).toBeUndefined();
  });
});

describe("formatEntityEvent", () => {
  test("formats unit appear with name and level", () => {
    const result = formatEntityEvent({
      type: "appear",
      entity: {
        guid: 1n,
        objectType: ObjectType.UNIT,
        name: "Innkeeper Palla",
        level: 55,
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
      },
    });
    expect(result).toBe("[world] Innkeeper Palla appeared (NPC, level 55)");
  });

  test("suppresses appear without name", () => {
    const result = formatEntityEvent({
      type: "appear",
      entity: {
        guid: 2n,
        objectType: ObjectType.UNIT,
        name: undefined,
        level: 1,
      } as any,
    });
    expect(result).toBeUndefined();
  });

  test("formats player appear", () => {
    const result = formatEntityEvent({
      type: "appear",
      entity: {
        guid: 2n,
        objectType: ObjectType.PLAYER,
        name: "Thrall",
        level: 80,
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
      },
    });
    expect(result).toBe("[world] Thrall appeared (Player, level 80)");
  });

  test("formats gameobject appear", () => {
    const result = formatEntityEvent({
      type: "appear",
      entity: {
        guid: 3n,
        objectType: ObjectType.GAMEOBJECT,
        name: "Mailbox",
        entry: 0,
        scale: 1,
        position: undefined,
        rawFields: new Map(),
        displayId: 0,
        flags: 0,
        gameObjectType: 19,
        bytes1: 0,
      },
    });
    expect(result).toBe("[world] Mailbox appeared (GameObject)");
  });

  test("formats disappear", () => {
    const result = formatEntityEvent({
      type: "disappear",
      guid: 1n,
      name: "Silvermoon Guardian",
    });
    expect(result).toBe("[world] Silvermoon Guardian left range");
  });

  test("formats disappear without name", () => {
    const result = formatEntityEvent({
      type: "disappear",
      guid: 1n,
    });
    expect(result).toBe("[world] Unknown entity left range");
  });

  test("update returns undefined for non-name changes", () => {
    const result = formatEntityEvent({
      type: "update",
      entity: { guid: 1n } as any,
      changed: ["health"],
    });
    expect(result).toBeUndefined();
  });

  test("update with name change formats appear-like message for NPC", () => {
    const result = formatEntityEvent({
      type: "update",
      entity: {
        guid: 1n,
        objectType: ObjectType.UNIT,
        name: "Springpaw Cub",
        level: 1,
      } as any,
      changed: ["name"],
    });
    expect(result).toBe("[world] Springpaw Cub appeared (NPC, level 1)");
  });

  test("appear for CORPSE returns undefined", () => {
    const result = formatEntityEvent({
      type: "appear",
      entity: {
        guid: 10n,
        objectType: ObjectType.CORPSE,
        name: "Some Corpse",
        entry: 0,
        scale: 1,
        position: undefined,
        rawFields: new Map(),
      },
    });
    expect(result).toBeUndefined();
  });
});

describe("formatEntityEventObj", () => {
  test("appear for UNIT with position", () => {
    const result = formatEntityEventObj({
      type: "appear",
      entity: {
        guid: 1n,
        objectType: ObjectType.UNIT,
        name: "Innkeeper Palla",
        level: 55,
        entry: 0,
        scale: 1,
        position: { mapId: 0, x: 100.5, y: 200.5, z: 50.0, orientation: 0 },
        rawFields: new Map(),
        health: 4200,
        maxHealth: 5000,
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
      },
    });
    expect(result).toEqual({
      type: "ENTITY_APPEAR",
      guid: "0x1",
      objectType: ObjectType.UNIT,
      name: "Innkeeper Palla",
      level: 55,
      health: 4200,
      maxHealth: 5000,
      x: 100.5,
      y: 200.5,
      z: 50.0,
    });
  });

  test("appear for UNIT without position", () => {
    const result = formatEntityEventObj({
      type: "appear",
      entity: {
        guid: 1n,
        objectType: ObjectType.UNIT,
        name: "Guard",
        level: 75,
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
      },
    });
    expect(result).toEqual({
      type: "ENTITY_APPEAR",
      guid: "0x1",
      objectType: ObjectType.UNIT,
      name: "Guard",
      level: 75,
      health: 100,
      maxHealth: 100,
    });
    expect(result).not.toHaveProperty("x");
    expect(result).not.toHaveProperty("y");
    expect(result).not.toHaveProperty("z");
  });

  test("appear for PLAYER with position", () => {
    const result = formatEntityEventObj({
      type: "appear",
      entity: {
        guid: 5n,
        objectType: ObjectType.PLAYER,
        name: "Thrall",
        level: 80,
        entry: 0,
        scale: 1,
        position: { mapId: 0, x: 1, y: 2, z: 3, orientation: 0 },
        rawFields: new Map(),
        health: 9000,
        maxHealth: 9000,
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
      },
    });
    expect(result).toEqual({
      type: "ENTITY_APPEAR",
      guid: "0x5",
      objectType: ObjectType.PLAYER,
      name: "Thrall",
      level: 80,
      health: 9000,
      maxHealth: 9000,
      x: 1,
      y: 2,
      z: 3,
    });
  });

  test("appear for GAMEOBJECT", () => {
    const result = formatEntityEventObj({
      type: "appear",
      entity: {
        guid: 1n,
        objectType: ObjectType.GAMEOBJECT,
        name: "Mailbox",
        entry: 0,
        scale: 1,
        position: undefined,
        rawFields: new Map(),
        displayId: 0,
        flags: 0,
        gameObjectType: 19,
        bytes1: 0,
      },
    });
    expect(result).toEqual({
      type: "ENTITY_APPEAR",
      guid: "0x1",
      objectType: ObjectType.GAMEOBJECT,
      name: "Mailbox",
    });
    expect(result).not.toHaveProperty("level");
    expect(result).not.toHaveProperty("health");
    expect(result).not.toHaveProperty("maxHealth");
  });

  test("disappear", () => {
    const result = formatEntityEventObj({
      type: "disappear",
      guid: 1n,
      name: "Silvermoon Guardian",
    });
    expect(result).toEqual({
      type: "ENTITY_DISAPPEAR",
      guid: "0x1",
      name: "Silvermoon Guardian",
    });
  });

  test("update returns undefined", () => {
    const result = formatEntityEventObj({
      type: "update",
      entity: { guid: 1n, objectType: ObjectType.UNIT } as any,
      changed: ["health"],
    });
    expect(result).toBeUndefined();
  });
});

describe("formatFriendList", () => {
  test("empty list returns no-friends message", () => {
    expect(formatFriendList([])).toBe("[friends] No friends on your list");
  });

  test("shows online and offline friends", () => {
    const friends: FriendEntry[] = [
      {
        guid: 1n,
        name: "Arthas",
        note: "",
        status: FriendStatus.ONLINE,
        area: 0,
        level: 80,
        playerClass: 6,
      },
      {
        guid: 2n,
        name: "Jaina",
        note: "",
        status: FriendStatus.OFFLINE,
        area: 0,
        level: 80,
        playerClass: 8,
      },
    ];
    const result = formatFriendList(friends);
    expect(result).toContain("1/2 online");
    expect(result).toContain("Arthas — Online, Level 80 Death Knight");
    expect(result).toContain("Jaina — Offline");
  });

  test("shows AFK and DND statuses", () => {
    const friends: FriendEntry[] = [
      {
        guid: 1n,
        name: "Afker",
        note: "",
        status: FriendStatus.AFK,
        area: 0,
        level: 70,
        playerClass: 1,
      },
      {
        guid: 2n,
        name: "Dnder",
        note: "",
        status: FriendStatus.DND,
        area: 0,
        level: 60,
        playerClass: 4,
      },
    ];
    const result = formatFriendList(friends);
    expect(result).toContain("Afker — AFK, Level 70 Warrior");
    expect(result).toContain("Dnder — DND, Level 60 Rogue");
  });

  test("falls back to guid when name is empty", () => {
    const friends: FriendEntry[] = [
      {
        guid: 42n,
        name: "",
        note: "",
        status: FriendStatus.OFFLINE,
        area: 0,
        level: 1,
        playerClass: 1,
      },
    ];
    const result = formatFriendList(friends);
    expect(result).toContain("guid:42 — Offline");
  });
});

describe("formatFriendListJson", () => {
  test("serializes friends with status, class, and area", () => {
    const friends: FriendEntry[] = [
      {
        guid: 1n,
        name: "Arthas",
        note: "buddy",
        status: FriendStatus.ONLINE,
        area: 394,
        level: 80,
        playerClass: 6,
      },
      {
        guid: 2n,
        name: "Jaina",
        note: "",
        status: FriendStatus.OFFLINE,
        area: 0,
        level: 80,
        playerClass: 8,
      },
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
      type: "friend-online",
      friend: {
        guid: 1n,
        name: "Arthas",
        note: "",
        status: FriendStatus.ONLINE,
        area: 0,
        level: 80,
        playerClass: 6,
      },
    });
    expect(result).toBe(
      "[friends] Arthas is now online (Level 80 Death Knight)",
    );
  });

  test("friend-offline", () => {
    const result = formatFriendEvent({
      type: "friend-offline",
      guid: 1n,
      name: "Arthas",
    });
    expect(result).toBe("[friends] Arthas went offline");
  });

  test("friend-added", () => {
    const result = formatFriendEvent({
      type: "friend-added",
      friend: {
        guid: 1n,
        name: "Jaina",
        note: "",
        status: FriendStatus.OFFLINE,
        area: 0,
        level: 80,
        playerClass: 8,
      },
    });
    expect(result).toBe("[friends] Jaina added to friends list");
  });

  test("friend-removed", () => {
    const result = formatFriendEvent({
      type: "friend-removed",
      guid: 1n,
      name: "Jaina",
    });
    expect(result).toBe("[friends] Jaina removed from friends list");
  });

  test("friend-error", () => {
    const result = formatFriendEvent({
      type: "friend-error",
      result: 0x04,
      name: "Nobody",
    });
    expect(result).toBe("[friends] Error: player not found");
  });

  test("friend-error with unknown code", () => {
    const result = formatFriendEvent({
      type: "friend-error",
      result: 0xff,
      name: "Nobody",
    });
    expect(result).toBe("[friends] Error: error 255");
  });

  test("friend-list returns undefined", () => {
    const result = formatFriendEvent({ type: "friend-list", friends: [] });
    expect(result).toBeUndefined();
  });
});

describe("formatFriendEventObj", () => {
  test("friend-online", () => {
    const result = formatFriendEventObj({
      type: "friend-online",
      friend: {
        guid: 1n,
        name: "Arthas",
        note: "",
        status: FriendStatus.ONLINE,
        area: 394,
        level: 80,
        playerClass: 6,
      },
    });
    expect(result).toEqual({
      type: "FRIEND_ONLINE",
      name: "Arthas",
      level: 80,
      class: "Death Knight",
      area: 394,
    });
  });

  test("friend-offline", () => {
    const result = formatFriendEventObj({
      type: "friend-offline",
      guid: 1n,
      name: "Arthas",
    });
    expect(result).toEqual({ type: "FRIEND_OFFLINE", name: "Arthas" });
  });

  test("friend-added", () => {
    const result = formatFriendEventObj({
      type: "friend-added",
      friend: {
        guid: 1n,
        name: "Jaina",
        note: "",
        status: FriendStatus.OFFLINE,
        area: 0,
        level: 80,
        playerClass: 8,
      },
    });
    expect(result).toEqual({ type: "FRIEND_ADDED", name: "Jaina" });
  });

  test("friend-removed", () => {
    const result = formatFriendEventObj({
      type: "friend-removed",
      guid: 1n,
      name: "Jaina",
    });
    expect(result).toEqual({ type: "FRIEND_REMOVED", name: "Jaina" });
  });

  test("friend-error", () => {
    const result = formatFriendEventObj({
      type: "friend-error",
      result: 0x08,
      name: "Self",
    });
    expect(result).toEqual({
      type: "FRIEND_ERROR",
      result: 0x08,
      message: "already on friends list",
    });
  });

  test("friend-list returns undefined", () => {
    const result = formatFriendEventObj({ type: "friend-list", friends: [] });
    expect(result).toBeUndefined();
  });
});
