import { describe, expect, test } from "bun:test";
import {
  formatEntityEvent,
  formatEntityEventObj,
  formatFriendEvent,
  formatFriendEventObj,
  formatFriendList,
  formatFriendListJson,
  formatGroupEvent,
  formatIgnoreEvent,
  formatIgnoreEventObj,
  formatIgnoreList,
  formatIgnoreListJson,
  formatMessage,
  formatMessageJson,
  formatMessageObj,
  formatPrompt,
} from "ui/format";
import type { Entity } from "wow/entity-store";
import type { FriendEntry } from "wow/friend-store";
import type { IgnoreEntry } from "wow/ignore-store";
import { ObjectType } from "wow/protocol/entity-fields";
import { ChatType, PartyOperation, PartyResult } from "wow/protocol/opcodes";
import { FriendStatus } from "wow/protocol/social";

describe("formatMessage", () => {
  test("whisper from", () => {
    const msg = { message: "psst", sender: "Eve", type: ChatType.WHISPER };
    expect(formatMessage(msg)).toBe("[whisper from Eve] psst");
  });

  test("whisper to", () => {
    const msg = {
      message: "hey",
      sender: "Eve",
      type: ChatType.WHISPER_INFORM,
    };
    expect(formatMessage(msg)).toBe("[whisper to Eve] hey");
  });

  test("system message", () => {
    const msg = { message: "Welcome", sender: "", type: ChatType.SYSTEM };
    expect(formatMessage(msg)).toBe("[system] Welcome");
  });

  test("channel message", () => {
    const msg = {
      channel: "General",
      message: "hey",
      sender: "Al",
      type: ChatType.CHANNEL,
    };
    expect(formatMessage(msg)).toBe("[General] Al: hey");
  });

  test("generic say", () => {
    const msg = { message: "hi", sender: "Alice", type: ChatType.SAY };
    expect(formatMessage(msg)).toBe("[say] Alice: hi");
  });

  test("unknown type", () => {
    const msg = { message: "wat", sender: "Bob", type: 99 };
    expect(formatMessage(msg)).toBe("[type 99] Bob: wat");
  });

  test("strips color codes from message", () => {
    const msg = {
      message: "|cff1eff00|Hitem:1234|h[Cool Sword]|h|r equipped",
      sender: "Alice",
      type: ChatType.SAY,
    };
    expect(formatMessage(msg)).toBe("[say] Alice: [Cool Sword] equipped");
  });

  test("roll message", () => {
    const msg = {
      message: "rolled 42 (1-100)",
      sender: "Xiara",
      type: ChatType.ROLL,
    };
    expect(formatMessage(msg)).toBe("[roll] Xiara rolled 42 (1-100)");
  });

  test("server broadcast origin shows [server] label", () => {
    const msg = {
      message: "Server shutdown in 15:00",
      origin: "server" as const,
      sender: "",
      type: ChatType.SYSTEM,
    };
    expect(formatMessage(msg)).toBe("[server] Server shutdown in 15:00");
  });

  test("notification origin shows [server] label", () => {
    const msg = {
      message: "Autobroadcast text",
      origin: "notification" as const,
      sender: "",
      type: ChatType.SYSTEM,
    };
    expect(formatMessage(msg)).toBe("[server] Autobroadcast text");
  });

  test("mail origin shows [mail] label", () => {
    const msg = {
      message: "You have new mail.",
      origin: "mail" as const,
      sender: "",
      type: ChatType.SYSTEM,
    };
    expect(formatMessage(msg)).toBe("[mail] You have new mail.");
  });
});

describe("formatMessageJson", () => {
  test("json say", () => {
    const msg = { message: "hi", sender: "Alice", type: ChatType.SAY };
    expect(JSON.parse(formatMessageJson(msg))).toEqual({
      message: "hi",
      sender: "Alice",
      type: "SAY",
    });
  });

  test("json whisper from", () => {
    const msg = { message: "psst", sender: "Eve", type: ChatType.WHISPER };
    expect(JSON.parse(formatMessageJson(msg))).toEqual({
      message: "psst",
      sender: "Eve",
      type: "WHISPER_FROM",
    });
  });

  test("json whisper to", () => {
    const msg = {
      message: "hey",
      sender: "Eve",
      type: ChatType.WHISPER_INFORM,
    };
    expect(JSON.parse(formatMessageJson(msg))).toEqual({
      message: "hey",
      sender: "Eve",
      type: "WHISPER_TO",
    });
  });

  test("json channel includes channel field", () => {
    const msg = {
      channel: "General",
      message: "hey",
      sender: "Al",
      type: ChatType.CHANNEL,
    };
    expect(JSON.parse(formatMessageJson(msg))).toEqual({
      channel: "General",
      message: "hey",
      sender: "Al",
      type: "CHANNEL",
    });
  });

  test("json system message", () => {
    const msg = { message: "Welcome", sender: "", type: ChatType.SYSTEM };
    expect(JSON.parse(formatMessageJson(msg))).toEqual({
      message: "Welcome",
      sender: "",
      type: "SYSTEM",
    });
  });

  test("json unknown type uses TYPE_N", () => {
    const msg = { message: "wat", sender: "Bob", type: 99 };
    expect(JSON.parse(formatMessageJson(msg))).toEqual({
      message: "wat",
      sender: "Bob",
      type: "TYPE_99",
    });
  });

  test("json roll message", () => {
    const msg = {
      message: "rolled 42 (1-100)",
      sender: "Xiara",
      type: ChatType.ROLL,
    };
    expect(JSON.parse(formatMessageJson(msg))).toEqual({
      message: "rolled 42 (1-100)",
      sender: "Xiara",
      type: "ROLL",
    });
  });

  test("server broadcast origin uses SERVER_BROADCAST JSON type", () => {
    const msg = {
      message: "Shutdown in 5:00",
      origin: "server" as const,
      sender: "",
      type: ChatType.SYSTEM,
    };
    expect(formatMessageObj(msg)).toEqual({
      message: "Shutdown in 5:00",
      sender: "",
      type: "SERVER_BROADCAST",
    });
  });

  test("notification origin uses NOTIFICATION JSON type", () => {
    const msg = {
      message: "Auto message",
      origin: "notification" as const,
      sender: "",
      type: ChatType.SYSTEM,
    };
    expect(formatMessageObj(msg)).toEqual({
      message: "Auto message",
      sender: "",
      type: "NOTIFICATION",
    });
  });

  test("mail origin uses MAIL JSON type", () => {
    const msg = {
      message: "You have new mail.",
      origin: "mail" as const,
      sender: "",
      type: ChatType.SYSTEM,
    };
    expect(formatMessageObj(msg)).toEqual({
      message: "You have new mail.",
      sender: "",
      type: "MAIL",
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
    expect(formatPrompt({ target: "Xiara", type: "whisper" })).toBe(
      "[whisper: Xiara] > ",
    );
  });

  test("channel mode includes channel name", () => {
    expect(formatPrompt({ channel: "General", type: "channel" })).toBe(
      "[General] > ",
    );
  });
});

describe("formatGroupEvent", () => {
  test("invite success", () => {
    expect(
      formatGroupEvent({
        operation: PartyOperation.INVITE,
        result: PartyResult.SUCCESS,
        target: "Voidtrix",
        type: "command_result",
      }),
    ).toBe("[group] Invited Voidtrix");
  });

  test("invite failure", () => {
    expect(
      formatGroupEvent({
        operation: PartyOperation.INVITE,
        result: PartyResult.BAD_PLAYER_NAME,
        target: "Voidtrix",
        type: "command_result",
      }),
    ).toBe("[group] Cannot invite Voidtrix: player not found");
  });

  test("uninvite success", () => {
    expect(
      formatGroupEvent({
        operation: PartyOperation.UNINVITE,
        result: PartyResult.SUCCESS,
        target: "Voidtrix",
        type: "command_result",
      }),
    ).toBe("[group] Removed Voidtrix from group");
  });

  test("uninvite failure", () => {
    expect(
      formatGroupEvent({
        operation: PartyOperation.UNINVITE,
        result: PartyResult.NOT_LEADER,
        target: "Voidtrix",
        type: "command_result",
      }),
    ).toBe("[group] Cannot kick Voidtrix: you are not the leader");
  });

  test("leave success", () => {
    expect(
      formatGroupEvent({
        operation: PartyOperation.LEAVE,
        result: PartyResult.SUCCESS,
        target: "",
        type: "command_result",
      }),
    ).toBe("[group] Left the group");
  });

  test("leave failure", () => {
    expect(
      formatGroupEvent({
        operation: PartyOperation.LEAVE,
        result: PartyResult.NOT_LEADER,
        target: "",
        type: "command_result",
      }),
    ).toBe("[group] Cannot leave: you are not the leader");
  });

  test("command_result with empty target omits extra space", () => {
    expect(
      formatGroupEvent({
        operation: PartyOperation.UNINVITE,
        result: PartyResult.NOT_LEADER,
        target: "",
        type: "command_result",
      }),
    ).toBe("[group] Cannot kick: you are not the leader");
  });

  test("invite failure with group full label", () => {
    expect(
      formatGroupEvent({
        operation: PartyOperation.INVITE,
        result: PartyResult.GROUP_FULL,
        target: "Voidtrix",
        type: "command_result",
      }),
    ).toBe("[group] Cannot invite Voidtrix: group is full");
  });

  test("invite failure with already in group label", () => {
    expect(
      formatGroupEvent({
        operation: PartyOperation.INVITE,
        result: PartyResult.ALREADY_IN_GROUP,
        target: "Voidtrix",
        type: "command_result",
      }),
    ).toBe("[group] Cannot invite Voidtrix: already in a group");
  });

  test("invite failure with wrong faction label", () => {
    expect(
      formatGroupEvent({
        operation: PartyOperation.INVITE,
        result: PartyResult.PLAYER_WRONG_FACTION,
        target: "Voidtrix",
        type: "command_result",
      }),
    ).toBe("[group] Cannot invite Voidtrix: wrong faction");
  });

  test("invite failure with ignoring you label", () => {
    expect(
      formatGroupEvent({
        operation: PartyOperation.INVITE,
        result: PartyResult.IGNORING_YOU,
        target: "Voidtrix",
        type: "command_result",
      }),
    ).toBe("[group] Cannot invite Voidtrix: player is ignoring you");
  });

  test("leader changed", () => {
    expect(formatGroupEvent({ name: "Alice", type: "leader_changed" })).toBe(
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
    expect(formatGroupEvent({ name: "Bob", type: "invite_declined" })).toBe(
      "[group] Bob has declined your invitation",
    );
  });

  test("group_list returns undefined", () => {
    expect(
      formatGroupEvent({
        leader: "",
        members: [],
        type: "group_list",
      }),
    ).toBeUndefined();
  });
});

describe("formatEntityEvent", () => {
  test("formats unit appear with name and level", () => {
    const result = formatEntityEvent({
      entity: {
        class_: 0,
        displayId: 0,
        entry: 0,
        factionTemplate: 0,
        gender: 0,
        guid: 1n,
        health: 100,
        level: 55,
        maxHealth: 100,
        maxPower: [],
        name: "Innkeeper Palla",
        npcFlags: 0,
        objectType: ObjectType.UNIT,
        position: undefined,
        power: [],
        race: 0,
        rawFields: new Map(),
        scale: 1,
        target: 0n,
        unitFlags: 0,
      },
      type: "appear",
    });
    expect(result).toBe("[world] Innkeeper Palla appeared (NPC, level 55)");
  });

  test("suppresses appear without name", () => {
    const result = formatEntityEvent({
      entity: {
        guid: 2n,
        level: 1,
        name: undefined,
        objectType: ObjectType.UNIT,
      } as unknown as Entity,
      type: "appear",
    });
    expect(result).toBeUndefined();
  });

  test("formats player appear", () => {
    const result = formatEntityEvent({
      entity: {
        class_: 0,
        displayId: 0,
        entry: 0,
        factionTemplate: 0,
        gender: 0,
        guid: 2n,
        health: 100,
        level: 80,
        maxHealth: 100,
        maxPower: [],
        name: "Thrall",
        npcFlags: 0,
        objectType: ObjectType.PLAYER,
        position: undefined,
        power: [],
        race: 0,
        rawFields: new Map(),
        scale: 1,
        target: 0n,
        unitFlags: 0,
      },
      type: "appear",
    });
    expect(result).toBe("[world] Thrall appeared (Player, level 80)");
  });

  test("formats gameobject appear", () => {
    const result = formatEntityEvent({
      entity: {
        bytes1: 0,
        displayId: 0,
        entry: 0,
        flags: 0,
        gameObjectType: 19,
        guid: 3n,
        name: "Mailbox",
        objectType: ObjectType.GAMEOBJECT,
        position: undefined,
        rawFields: new Map(),
        scale: 1,
      },
      type: "appear",
    });
    expect(result).toBe("[world] Mailbox appeared (GameObject)");
  });

  test("formats disappear", () => {
    const result = formatEntityEvent({
      guid: 1n,
      name: "Silvermoon Guardian",
      type: "disappear",
    });
    expect(result).toBe("[world] Silvermoon Guardian left range");
  });

  test("formats disappear without name", () => {
    const result = formatEntityEvent({
      guid: 1n,
      type: "disappear",
    });
    expect(result).toBe("[world] Unknown entity left range");
  });

  test("update returns undefined for non-name changes", () => {
    const result = formatEntityEvent({
      changed: ["health"],
      entity: { guid: 1n } as unknown as Entity,
      type: "update",
    });
    expect(result).toBeUndefined();
  });

  test("update with name change formats appear-like message for NPC", () => {
    const result = formatEntityEvent({
      changed: ["name"],
      entity: {
        guid: 1n,
        level: 1,
        name: "Springpaw Cub",
        objectType: ObjectType.UNIT,
      } as unknown as Entity,
      type: "update",
    });
    expect(result).toBe("[world] Springpaw Cub appeared (NPC, level 1)");
  });

  test("appear for CORPSE returns undefined", () => {
    const result = formatEntityEvent({
      entity: {
        entry: 0,
        guid: 10n,
        name: "Some Corpse",
        objectType: ObjectType.CORPSE,
        position: undefined,
        rawFields: new Map(),
        scale: 1,
      },
      type: "appear",
    });
    expect(result).toBeUndefined();
  });
});

describe("formatEntityEventObj", () => {
  test("appear for UNIT with position", () => {
    const result = formatEntityEventObj({
      entity: {
        class_: 0,
        displayId: 0,
        entry: 0,
        factionTemplate: 0,
        gender: 0,
        guid: 1n,
        health: 4200,
        level: 55,
        maxHealth: 5000,
        maxPower: [],
        name: "Innkeeper Palla",
        npcFlags: 0,
        objectType: ObjectType.UNIT,
        position: { mapId: 0, orientation: 0, x: 100.5, y: 200.5, z: 50.0 },
        power: [],
        race: 0,
        rawFields: new Map(),
        scale: 1,
        target: 0n,
        unitFlags: 0,
      },
      type: "appear",
    });
    expect(result).toEqual({
      guid: "0x1",
      health: 4200,
      level: 55,
      maxHealth: 5000,
      name: "Innkeeper Palla",
      objectType: ObjectType.UNIT,
      type: "ENTITY_APPEAR",
      x: 100.5,
      y: 200.5,
      z: 50.0,
    });
  });

  test("appear for UNIT without position", () => {
    const result = formatEntityEventObj({
      entity: {
        class_: 0,
        displayId: 0,
        entry: 0,
        factionTemplate: 0,
        gender: 0,
        guid: 1n,
        health: 100,
        level: 75,
        maxHealth: 100,
        maxPower: [],
        name: "Guard",
        npcFlags: 0,
        objectType: ObjectType.UNIT,
        position: undefined,
        power: [],
        race: 0,
        rawFields: new Map(),
        scale: 1,
        target: 0n,
        unitFlags: 0,
      },
      type: "appear",
    });
    expect(result).toEqual({
      guid: "0x1",
      health: 100,
      level: 75,
      maxHealth: 100,
      name: "Guard",
      objectType: ObjectType.UNIT,
      type: "ENTITY_APPEAR",
    });
    expect(result).not.toHaveProperty("x");
    expect(result).not.toHaveProperty("y");
    expect(result).not.toHaveProperty("z");
  });

  test("appear for PLAYER with position", () => {
    const result = formatEntityEventObj({
      entity: {
        class_: 0,
        displayId: 0,
        entry: 0,
        factionTemplate: 0,
        gender: 0,
        guid: 5n,
        health: 9000,
        level: 80,
        maxHealth: 9000,
        maxPower: [],
        name: "Thrall",
        npcFlags: 0,
        objectType: ObjectType.PLAYER,
        position: { mapId: 0, orientation: 0, x: 1, y: 2, z: 3 },
        power: [],
        race: 0,
        rawFields: new Map(),
        scale: 1,
        target: 0n,
        unitFlags: 0,
      },
      type: "appear",
    });
    expect(result).toEqual({
      guid: "0x5",
      health: 9000,
      level: 80,
      maxHealth: 9000,
      name: "Thrall",
      objectType: ObjectType.PLAYER,
      type: "ENTITY_APPEAR",
      x: 1,
      y: 2,
      z: 3,
    });
  });

  test("appear for GAMEOBJECT", () => {
    const result = formatEntityEventObj({
      entity: {
        bytes1: 0,
        displayId: 0,
        entry: 0,
        flags: 0,
        gameObjectType: 19,
        guid: 1n,
        name: "Mailbox",
        objectType: ObjectType.GAMEOBJECT,
        position: undefined,
        rawFields: new Map(),
        scale: 1,
      },
      type: "appear",
    });
    expect(result).toEqual({
      guid: "0x1",
      name: "Mailbox",
      objectType: ObjectType.GAMEOBJECT,
      type: "ENTITY_APPEAR",
    });
    expect(result).not.toHaveProperty("level");
    expect(result).not.toHaveProperty("health");
    expect(result).not.toHaveProperty("maxHealth");
  });

  test("disappear", () => {
    const result = formatEntityEventObj({
      guid: 1n,
      name: "Silvermoon Guardian",
      type: "disappear",
    });
    expect(result).toEqual({
      guid: "0x1",
      name: "Silvermoon Guardian",
      type: "ENTITY_DISAPPEAR",
    });
  });

  test("update returns undefined", () => {
    const result = formatEntityEventObj({
      changed: ["health"],
      entity: { guid: 1n, objectType: ObjectType.UNIT } as unknown as Entity,
      type: "update",
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
        area: 0,
        guid: 1n,
        level: 80,
        name: "Arthas",
        note: "",
        playerClass: 6,
        status: FriendStatus.ONLINE,
      },
      {
        area: 0,
        guid: 2n,
        level: 80,
        name: "Jaina",
        note: "",
        playerClass: 8,
        status: FriendStatus.OFFLINE,
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
        area: 0,
        guid: 1n,
        level: 70,
        name: "Afker",
        note: "",
        playerClass: 1,
        status: FriendStatus.AFK,
      },
      {
        area: 0,
        guid: 2n,
        level: 60,
        name: "Dnder",
        note: "",
        playerClass: 4,
        status: FriendStatus.DND,
      },
    ];
    const result = formatFriendList(friends);
    expect(result).toContain("Afker — AFK, Level 70 Warrior");
    expect(result).toContain("Dnder — DND, Level 60 Rogue");
  });

  test("falls back to guid when name is empty", () => {
    const friends: FriendEntry[] = [
      {
        area: 0,
        guid: 42n,
        level: 1,
        name: "",
        note: "",
        playerClass: 1,
        status: FriendStatus.OFFLINE,
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
        area: 394,
        guid: 1n,
        level: 80,
        name: "Arthas",
        note: "buddy",
        playerClass: 6,
        status: FriendStatus.ONLINE,
      },
      {
        area: 0,
        guid: 2n,
        level: 80,
        name: "Jaina",
        note: "",
        playerClass: 8,
        status: FriendStatus.OFFLINE,
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
      friend: {
        area: 0,
        guid: 1n,
        level: 80,
        name: "Arthas",
        note: "",
        playerClass: 6,
        status: FriendStatus.ONLINE,
      },
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
      friend: {
        area: 0,
        guid: 1n,
        level: 80,
        name: "Jaina",
        note: "",
        playerClass: 8,
        status: FriendStatus.OFFLINE,
      },
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
      friend: {
        area: 394,
        guid: 1n,
        level: 80,
        name: "Arthas",
        note: "",
        playerClass: 6,
        status: FriendStatus.ONLINE,
      },
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
      friend: {
        area: 0,
        guid: 1n,
        level: 80,
        name: "Jaina",
        note: "",
        playerClass: 8,
        status: FriendStatus.OFFLINE,
      },
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
      { guid: 1n, name: "Spammer" },
      { guid: 2n, name: "Annoying" },
    ];
    const result = formatIgnoreList(ignored);
    expect(result).toContain("2 ignored");
    expect(result).toContain("Spammer");
    expect(result).toContain("Annoying");
  });

  test("falls back to guid when name is empty", () => {
    const ignored: IgnoreEntry[] = [{ guid: 42n, name: "" }];
    const result = formatIgnoreList(ignored);
    expect(result).toContain("guid:42");
  });
});

describe("formatIgnoreListJson", () => {
  test("serializes ignored players", () => {
    const ignored: IgnoreEntry[] = [
      { guid: 1n, name: "Spammer" },
      { guid: 2n, name: "Annoying" },
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
      entry: { guid: 1n, name: "Spammer" },
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
      entry: { guid: 1n, name: "Spammer" },
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
