# Friend List Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Parse SMSG_CONTACT_LIST and SMSG_FRIEND_STATUS, store friend entries in a FriendStore, and expose them through `/friends`, `/friend add|remove` commands, and IPC verbs.

**Architecture:** New protocol module `social.ts` handles packet parsing/building. New `FriendStore` class stores friend entries with an event callback. Handlers in `client.ts` wire packets to the store. Name resolution uses the existing `nameCache` + `CMSG_NAME_QUERY` mechanism.

**Tech Stack:** TypeScript, Bun test runner, PacketReader/PacketWriter

---

### Task 1: Protocol Module — Enums and Packet Builders

**Files:**

- Create: `src/wow/protocol/social.ts`
- Test: `src/wow/protocol/social.test.ts`

**Step 1: Write failing tests for enums and builders**

```typescript
import { test, expect, describe } from "bun:test";
import { PacketReader } from "wow/protocol/packet";
import {
  SocialFlag,
  FriendStatus,
  FriendResult,
  buildAddFriend,
  buildDelFriend,
} from "wow/protocol/social";

describe("social enums", () => {
  test("SocialFlag values", () => {
    expect(SocialFlag.FRIEND).toBe(0x01);
    expect(SocialFlag.IGNORED).toBe(0x02);
    expect(SocialFlag.MUTED).toBe(0x04);
  });

  test("FriendStatus values", () => {
    expect(FriendStatus.OFFLINE).toBe(0);
    expect(FriendStatus.ONLINE).toBe(1);
    expect(FriendStatus.AFK).toBe(2);
    expect(FriendStatus.DND).toBe(4);
  });

  test("FriendResult values", () => {
    expect(FriendResult.ONLINE).toBe(0x02);
    expect(FriendResult.OFFLINE).toBe(0x03);
    expect(FriendResult.REMOVED).toBe(0x05);
    expect(FriendResult.ADDED_ONLINE).toBe(0x06);
    expect(FriendResult.ADDED_OFFLINE).toBe(0x07);
  });
});

describe("buildAddFriend", () => {
  test("writes name and empty note", () => {
    const body = buildAddFriend("Arthas", "");
    const r = new PacketReader(body);
    expect(r.cString()).toBe("Arthas");
    expect(r.cString()).toBe("");
  });

  test("writes name and note", () => {
    const body = buildAddFriend("Arthas", "my friend");
    const r = new PacketReader(body);
    expect(r.cString()).toBe("Arthas");
    expect(r.cString()).toBe("my friend");
  });
});

describe("buildDelFriend", () => {
  test("writes full 64-bit guid", () => {
    const body = buildDelFriend(0x0000000100000042n);
    const r = new PacketReader(body);
    expect(r.uint64LE()).toBe(0x0000000100000042n);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `mise test src/wow/protocol/social.test.ts`
Expected: FAIL — module not found

**Step 3: Implement enums and builders**

Create `src/wow/protocol/social.ts`:

```typescript
import { PacketReader, PacketWriter } from "wow/protocol/packet";

export const SocialFlag = {
  FRIEND: 0x01,
  IGNORED: 0x02,
  MUTED: 0x04,
} as const;

export const FriendStatus = {
  OFFLINE: 0,
  ONLINE: 1,
  AFK: 2,
  DND: 4,
} as const;

export const FriendResult = {
  DB_ERROR: 0x00,
  LIST_FULL: 0x01,
  ONLINE: 0x02,
  OFFLINE: 0x03,
  NOT_FOUND: 0x04,
  REMOVED: 0x05,
  ADDED_ONLINE: 0x06,
  ADDED_OFFLINE: 0x07,
  ALREADY: 0x08,
  SELF: 0x09,
  ENEMY: 0x0a,
} as const;

export function buildAddFriend(name: string, note: string): Uint8Array {
  const w = new PacketWriter();
  w.cString(name);
  w.cString(note);
  return w.finish();
}

export function buildDelFriend(guid: bigint): Uint8Array {
  const w = new PacketWriter();
  w.uint64LE(guid);
  return w.finish();
}
```

**Step 4: Run test to verify it passes**

Run: `mise test src/wow/protocol/social.test.ts`
Expected: PASS

**Step 5: Commit**

```
feat: Add social protocol enums and builders
```

---

### Task 2: Protocol Module — Contact List Parser

**Files:**

- Modify: `src/wow/protocol/social.ts`
- Modify: `src/wow/protocol/social.test.ts`

**Step 1: Write failing tests for parseContactList**

Append to `social.test.ts`:

```typescript
import {
  // ...existing imports...
  parseContactList,
} from "wow/protocol/social";
import { PacketWriter } from "wow/protocol/packet";

function buildContactListPacket(
  listMask: number,
  entries: Array<{
    guid: bigint;
    flags: number;
    note: string;
    status?: number;
    area?: number;
    level?: number;
    playerClass?: number;
  }>,
): Uint8Array {
  const w = new PacketWriter();
  w.uint32LE(listMask);
  w.uint32LE(entries.length);
  for (const e of entries) {
    w.uint64LE(e.guid);
    w.uint32LE(e.flags);
    w.cString(e.note);
    if (e.flags & SocialFlag.FRIEND) {
      w.uint8(e.status ?? 0);
      if ((e.status ?? 0) !== 0) {
        w.uint32LE(e.area ?? 0);
        w.uint32LE(e.level ?? 0);
        w.uint32LE(e.playerClass ?? 0);
      }
    }
  }
  return w.finish();
}

describe("parseContactList", () => {
  test("parses empty list", () => {
    const data = buildContactListPacket(7, []);
    const result = parseContactList(new PacketReader(data));
    expect(result.listMask).toBe(7);
    expect(result.contacts).toEqual([]);
  });

  test("parses online friend", () => {
    const data = buildContactListPacket(7, [
      {
        guid: 42n,
        flags: SocialFlag.FRIEND,
        note: "best buddy",
        status: FriendStatus.ONLINE,
        area: 1519,
        level: 80,
        playerClass: 1,
      },
    ]);
    const result = parseContactList(new PacketReader(data));
    expect(result.contacts).toHaveLength(1);
    const c = result.contacts[0]!;
    expect(c.guid).toBe(42n);
    expect(c.flags).toBe(SocialFlag.FRIEND);
    expect(c.note).toBe("best buddy");
    expect(c.status).toBe(FriendStatus.ONLINE);
    expect(c.area).toBe(1519);
    expect(c.level).toBe(80);
    expect(c.playerClass).toBe(1);
  });

  test("parses offline friend — no area/level/class fields", () => {
    const data = buildContactListPacket(7, [
      {
        guid: 99n,
        flags: SocialFlag.FRIEND,
        note: "",
        status: FriendStatus.OFFLINE,
      },
    ]);
    const result = parseContactList(new PacketReader(data));
    const c = result.contacts[0]!;
    expect(c.status).toBe(FriendStatus.OFFLINE);
    expect(c.area).toBeUndefined();
    expect(c.level).toBeUndefined();
    expect(c.playerClass).toBeUndefined();
  });

  test("parses AFK friend with area/level/class", () => {
    const data = buildContactListPacket(7, [
      {
        guid: 55n,
        flags: SocialFlag.FRIEND,
        note: "",
        status: FriendStatus.AFK,
        area: 1,
        level: 70,
        playerClass: 2,
      },
    ]);
    const result = parseContactList(new PacketReader(data));
    expect(result.contacts[0]!.status).toBe(FriendStatus.AFK);
    expect(result.contacts[0]!.area).toBe(1);
  });

  test("parses ignored entry — no status fields", () => {
    const data = buildContactListPacket(7, [
      { guid: 100n, flags: SocialFlag.IGNORED, note: "spammer" },
    ]);
    const result = parseContactList(new PacketReader(data));
    const c = result.contacts[0]!;
    expect(c.flags).toBe(SocialFlag.IGNORED);
    expect(c.status).toBeUndefined();
  });

  test("parses mixed friends and ignored", () => {
    const data = buildContactListPacket(7, [
      {
        guid: 1n,
        flags: SocialFlag.FRIEND,
        note: "",
        status: FriendStatus.ONLINE,
        area: 1,
        level: 60,
        playerClass: 4,
      },
      { guid: 2n, flags: SocialFlag.IGNORED, note: "" },
      {
        guid: 3n,
        flags: SocialFlag.FRIEND,
        note: "",
        status: FriendStatus.OFFLINE,
      },
    ]);
    const result = parseContactList(new PacketReader(data));
    expect(result.contacts).toHaveLength(3);
    expect(result.contacts[0]!.flags).toBe(SocialFlag.FRIEND);
    expect(result.contacts[1]!.flags).toBe(SocialFlag.IGNORED);
    expect(result.contacts[2]!.flags).toBe(SocialFlag.FRIEND);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `mise test src/wow/protocol/social.test.ts`
Expected: FAIL — parseContactList not exported

**Step 3: Implement parseContactList**

Add to `src/wow/protocol/social.ts`:

```typescript
export type ContactEntry = {
  guid: bigint;
  flags: number;
  note: string;
  status?: number;
  area?: number;
  level?: number;
  playerClass?: number;
};

export type ContactList = {
  listMask: number;
  contacts: ContactEntry[];
};

export function parseContactList(r: PacketReader): ContactList {
  const listMask = r.uint32LE();
  const count = r.uint32LE();
  const contacts: ContactEntry[] = [];
  for (let i = 0; i < count; i++) {
    const guid = r.uint64LE();
    const flags = r.uint32LE();
    const note = r.cString();
    const entry: ContactEntry = { guid, flags, note };
    if (flags & SocialFlag.FRIEND) {
      entry.status = r.uint8();
      if (entry.status !== FriendStatus.OFFLINE) {
        entry.area = r.uint32LE();
        entry.level = r.uint32LE();
        entry.playerClass = r.uint32LE();
      }
    }
    contacts.push(entry);
  }
  return { listMask, contacts };
}
```

**Step 4: Run test to verify it passes**

Run: `mise test src/wow/protocol/social.test.ts`
Expected: PASS

**Step 5: Commit**

```
feat: Parse SMSG_CONTACT_LIST packets
```

---

### Task 3: Protocol Module — Friend Status Parser

**Files:**

- Modify: `src/wow/protocol/social.ts`
- Modify: `src/wow/protocol/social.test.ts`

**Step 1: Write failing tests for parseFriendStatus**

```typescript
import {
  // ...existing...
  parseFriendStatus,
} from "wow/protocol/social";

function buildFriendStatusPacket(fields: {
  result: number;
  guid: bigint;
  note?: string;
  status?: number;
  area?: number;
  level?: number;
  playerClass?: number;
}): Uint8Array {
  const w = new PacketWriter();
  w.uint8(fields.result);
  w.uint64LE(fields.guid);
  if (
    fields.result === FriendResult.ADDED_ONLINE ||
    fields.result === FriendResult.ADDED_OFFLINE
  ) {
    w.cString(fields.note ?? "");
  }
  if (
    fields.result === FriendResult.ADDED_ONLINE ||
    fields.result === FriendResult.ONLINE
  ) {
    w.uint8(fields.status ?? FriendStatus.ONLINE);
    w.uint32LE(fields.area ?? 0);
    w.uint32LE(fields.level ?? 0);
    w.uint32LE(fields.playerClass ?? 0);
  }
  return w.finish();
}

describe("parseFriendStatus", () => {
  test("parses ADDED_ONLINE — has note + online info", () => {
    const data = buildFriendStatusPacket({
      result: FriendResult.ADDED_ONLINE,
      guid: 42n,
      note: "new friend",
      status: FriendStatus.ONLINE,
      area: 1519,
      level: 80,
      playerClass: 1,
    });
    const r = parseFriendStatus(new PacketReader(data));
    expect(r.result).toBe(FriendResult.ADDED_ONLINE);
    expect(r.guid).toBe(42n);
    expect(r.note).toBe("new friend");
    expect(r.status).toBe(FriendStatus.ONLINE);
    expect(r.area).toBe(1519);
    expect(r.level).toBe(80);
    expect(r.playerClass).toBe(1);
  });

  test("parses ADDED_OFFLINE — has note, no online info", () => {
    const data = buildFriendStatusPacket({
      result: FriendResult.ADDED_OFFLINE,
      guid: 99n,
      note: "offline pal",
    });
    const r = parseFriendStatus(new PacketReader(data));
    expect(r.result).toBe(FriendResult.ADDED_OFFLINE);
    expect(r.guid).toBe(99n);
    expect(r.note).toBe("offline pal");
    expect(r.status).toBeUndefined();
  });

  test("parses ONLINE — no note, has online info", () => {
    const data = buildFriendStatusPacket({
      result: FriendResult.ONLINE,
      guid: 55n,
      status: FriendStatus.AFK,
      area: 1,
      level: 70,
      playerClass: 2,
    });
    const r = parseFriendStatus(new PacketReader(data));
    expect(r.result).toBe(FriendResult.ONLINE);
    expect(r.note).toBeUndefined();
    expect(r.status).toBe(FriendStatus.AFK);
  });

  test("parses OFFLINE — just result + guid", () => {
    const data = buildFriendStatusPacket({
      result: FriendResult.OFFLINE,
      guid: 77n,
    });
    const r = parseFriendStatus(new PacketReader(data));
    expect(r.result).toBe(FriendResult.OFFLINE);
    expect(r.guid).toBe(77n);
    expect(r.note).toBeUndefined();
    expect(r.status).toBeUndefined();
  });

  test("parses REMOVED — just result + guid", () => {
    const data = buildFriendStatusPacket({
      result: FriendResult.REMOVED,
      guid: 33n,
    });
    const r = parseFriendStatus(new PacketReader(data));
    expect(r.result).toBe(FriendResult.REMOVED);
    expect(r.guid).toBe(33n);
  });

  test("parses error codes — just result + guid", () => {
    for (const result of [
      FriendResult.NOT_FOUND,
      FriendResult.ALREADY,
      FriendResult.SELF,
      FriendResult.ENEMY,
      FriendResult.LIST_FULL,
    ]) {
      const data = buildFriendStatusPacket({ result, guid: 1n });
      const r = parseFriendStatus(new PacketReader(data));
      expect(r.result).toBe(result);
      expect(r.guid).toBe(1n);
    }
  });
});
```

**Step 2: Run test to verify it fails**

Run: `mise test src/wow/protocol/social.test.ts`
Expected: FAIL — parseFriendStatus not exported

**Step 3: Implement parseFriendStatus**

Add to `src/wow/protocol/social.ts`:

```typescript
export type FriendStatusPacket = {
  result: number;
  guid: bigint;
  note?: string;
  status?: number;
  area?: number;
  level?: number;
  playerClass?: number;
};

export function parseFriendStatus(r: PacketReader): FriendStatusPacket {
  const result = r.uint8();
  const guid = r.uint64LE();
  const packet: FriendStatusPacket = { result, guid };
  if (
    result === FriendResult.ADDED_ONLINE ||
    result === FriendResult.ADDED_OFFLINE
  ) {
    packet.note = r.cString();
  }
  if (result === FriendResult.ADDED_ONLINE || result === FriendResult.ONLINE) {
    packet.status = r.uint8();
    packet.area = r.uint32LE();
    packet.level = r.uint32LE();
    packet.playerClass = r.uint32LE();
  }
  return packet;
}
```

**Step 4: Run test to verify it passes**

Run: `mise test src/wow/protocol/social.test.ts`
Expected: PASS

**Step 5: Commit**

```
feat: Parse SMSG_FRIEND_STATUS packets
```

---

### Task 4: FriendStore

**Files:**

- Create: `src/wow/friend-store.ts`
- Test: `src/wow/friend-store.test.ts`

**Step 1: Write failing tests**

```typescript
import { test, expect, describe } from "bun:test";
import {
  FriendStore,
  type FriendEntry,
  type FriendEvent,
} from "wow/friend-store";

describe("FriendStore", () => {
  test("set() replaces all entries and fires friend-list event", () => {
    const store = new FriendStore();
    const events: FriendEvent[] = [];
    store.onEvent((e) => events.push(e));
    const entries: FriendEntry[] = [
      {
        guid: 1n,
        name: "Arthas",
        note: "",
        status: 1,
        area: 0,
        level: 80,
        playerClass: 1,
      },
      {
        guid: 2n,
        name: "Jaina",
        note: "",
        status: 0,
        area: 0,
        level: 70,
        playerClass: 8,
      },
    ];
    store.set(entries);
    expect(store.all()).toHaveLength(2);
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe("friend-list");
  });

  test("set() clears previous entries", () => {
    const store = new FriendStore();
    store.set([
      {
        guid: 1n,
        name: "A",
        note: "",
        status: 0,
        area: 0,
        level: 1,
        playerClass: 1,
      },
    ]);
    store.set([
      {
        guid: 2n,
        name: "B",
        note: "",
        status: 0,
        area: 0,
        level: 1,
        playerClass: 1,
      },
    ]);
    expect(store.all()).toHaveLength(1);
    expect(store.all()[0]!.guid).toBe(2n);
  });

  test("update() modifies existing entry and fires event", () => {
    const store = new FriendStore();
    const events: FriendEvent[] = [];
    store.set([
      {
        guid: 1n,
        name: "Arthas",
        note: "",
        status: 0,
        area: 0,
        level: 80,
        playerClass: 1,
      },
    ]);
    store.onEvent((e) => events.push(e));
    store.update(1n, { status: 1, area: 1519, level: 80, playerClass: 1 });
    expect(store.all()[0]!.status).toBe(1);
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe("friend-online");
  });

  test("update() to offline fires friend-offline event", () => {
    const store = new FriendStore();
    store.set([
      {
        guid: 1n,
        name: "Arthas",
        note: "",
        status: 1,
        area: 1519,
        level: 80,
        playerClass: 1,
      },
    ]);
    const events: FriendEvent[] = [];
    store.onEvent((e) => events.push(e));
    store.update(1n, { status: 0 });
    expect(events[0]!.type).toBe("friend-offline");
  });

  test("update() ignores unknown guid", () => {
    const store = new FriendStore();
    store.update(999n, { status: 1 });
    expect(store.all()).toHaveLength(0);
  });

  test("add() inserts new entry and fires friend-added event", () => {
    const store = new FriendStore();
    const events: FriendEvent[] = [];
    store.onEvent((e) => events.push(e));
    store.add({
      guid: 5n,
      name: "",
      note: "new",
      status: 1,
      area: 1,
      level: 60,
      playerClass: 4,
    });
    expect(store.all()).toHaveLength(1);
    expect(events[0]!.type).toBe("friend-added");
  });

  test("remove() deletes entry and fires friend-removed event", () => {
    const store = new FriendStore();
    store.set([
      {
        guid: 1n,
        name: "Arthas",
        note: "",
        status: 0,
        area: 0,
        level: 80,
        playerClass: 1,
      },
    ]);
    const events: FriendEvent[] = [];
    store.onEvent((e) => events.push(e));
    store.remove(1n);
    expect(store.all()).toHaveLength(0);
    expect(events[0]!.type).toBe("friend-removed");
  });

  test("remove() ignores unknown guid", () => {
    const store = new FriendStore();
    const events: FriendEvent[] = [];
    store.onEvent((e) => events.push(e));
    store.remove(999n);
    expect(events).toHaveLength(0);
  });

  test("setName() updates name on matching entry", () => {
    const store = new FriendStore();
    store.set([
      {
        guid: 1n,
        name: "",
        note: "",
        status: 0,
        area: 0,
        level: 80,
        playerClass: 1,
      },
    ]);
    store.setName(1n, "Arthas");
    expect(store.all()[0]!.name).toBe("Arthas");
  });

  test("findByName() returns entry by case-insensitive name", () => {
    const store = new FriendStore();
    store.set([
      {
        guid: 1n,
        name: "Arthas",
        note: "",
        status: 0,
        area: 0,
        level: 80,
        playerClass: 1,
      },
    ]);
    expect(store.findByName("arthas")?.guid).toBe(1n);
    expect(store.findByName("ARTHAS")?.guid).toBe(1n);
    expect(store.findByName("nobody")).toBeUndefined();
  });

  test("all() returns sorted by name", () => {
    const store = new FriendStore();
    store.set([
      {
        guid: 1n,
        name: "Zul",
        note: "",
        status: 0,
        area: 0,
        level: 1,
        playerClass: 1,
      },
      {
        guid: 2n,
        name: "Arthas",
        note: "",
        status: 0,
        area: 0,
        level: 1,
        playerClass: 1,
      },
    ]);
    expect(store.all()[0]!.name).toBe("Arthas");
    expect(store.all()[1]!.name).toBe("Zul");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `mise test src/wow/friend-store.test.ts`
Expected: FAIL — module not found

**Step 3: Implement FriendStore**

Create `src/wow/friend-store.ts`:

```typescript
export type FriendEntry = {
  guid: bigint;
  name: string;
  note: string;
  status: number;
  area: number;
  level: number;
  playerClass: number;
};

export type FriendEvent =
  | { type: "friend-list"; friends: FriendEntry[] }
  | { type: "friend-online"; friend: FriendEntry }
  | { type: "friend-offline"; guid: bigint; name: string }
  | { type: "friend-added"; friend: FriendEntry }
  | { type: "friend-removed"; guid: bigint; name: string }
  | { type: "friend-error"; result: number; name: string };

export class FriendStore {
  private friends = new Map<bigint, FriendEntry>();
  private listener?: (event: FriendEvent) => void;

  onEvent(cb: (event: FriendEvent) => void): void {
    this.listener = cb;
  }

  set(entries: FriendEntry[]): void {
    this.friends.clear();
    for (const entry of entries) {
      this.friends.set(entry.guid, { ...entry });
    }
    this.listener?.({ type: "friend-list", friends: this.all() });
  }

  add(entry: FriendEntry): void {
    this.friends.set(entry.guid, { ...entry });
    this.listener?.({
      type: "friend-added",
      friend: this.friends.get(entry.guid)!,
    });
  }

  update(
    guid: bigint,
    fields: Partial<
      Pick<FriendEntry, "status" | "area" | "level" | "playerClass">
    >,
  ): void {
    const existing = this.friends.get(guid);
    if (!existing) return;
    Object.assign(existing, fields);
    if (existing.status === 0) {
      this.listener?.({ type: "friend-offline", guid, name: existing.name });
    } else {
      this.listener?.({ type: "friend-online", friend: existing });
    }
  }

  remove(guid: bigint): void {
    const existing = this.friends.get(guid);
    if (!existing) return;
    this.friends.delete(guid);
    this.listener?.({ type: "friend-removed", guid, name: existing.name });
  }

  setName(guid: bigint, name: string): void {
    const existing = this.friends.get(guid);
    if (existing) existing.name = name;
  }

  findByName(name: string): FriendEntry | undefined {
    const lower = name.toLowerCase();
    for (const entry of this.friends.values()) {
      if (entry.name.toLowerCase() === lower) return entry;
    }
    return undefined;
  }

  all(): FriendEntry[] {
    return [...this.friends.values()].sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  }
}
```

**Step 4: Run test to verify it passes**

Run: `mise test src/wow/friend-store.test.ts`
Expected: PASS

**Step 5: Commit**

```
feat: Add FriendStore for friend list state
```

---

### Task 5: Wire Handlers in client.ts

**Files:**

- Modify: `src/wow/client.ts`

**Step 1: Add imports**

Add to the import block in `client.ts`:

```typescript
import {
  FriendStore,
  type FriendEntry,
  type FriendEvent,
} from "wow/friend-store";
import {
  parseContactList,
  parseFriendStatus,
  buildAddFriend,
  buildDelFriend,
  SocialFlag,
  FriendStatus,
  FriendResult,
} from "wow/protocol/social";
```

**Step 2: Add to WorldHandle type**

Add after `getNearbyEntities(): Entity[];`:

```typescript
getFriends(): FriendEntry[];
addFriend(name: string): void;
removeFriend(name: string): void;
onFriendEvent(cb: (event: FriendEvent) => void): void;
```

**Step 3: Add to WorldConn type**

Add after `pendingNameQueries: Set<string>;`:

```typescript
friendStore: FriendStore;
onFriendEvent?: (event: FriendEvent) => void;
```

**Step 4: Initialize in worldSession**

Add after `pendingNameQueries: new Set(),` in the `conn` object literal:

```typescript
friendStore: new FriendStore(),
```

Add after `conn.entityStore.onEvent(...)`:

```typescript
conn.friendStore.onEvent((event) => conn.onFriendEvent?.(event));
```

**Step 5: Add handler functions**

Add these handler functions (near the other handler functions):

```typescript
function handleContactList(conn: WorldConn, r: PacketReader): void {
  const list = parseContactList(r);
  const friends: FriendEntry[] = [];
  for (const contact of list.contacts) {
    if (!(contact.flags & SocialFlag.FRIEND)) continue;
    const guidLow = Number(contact.guid & 0xffffffffn);
    const name = conn.nameCache.get(guidLow) ?? "";
    friends.push({
      guid: contact.guid,
      name,
      note: contact.note,
      status: contact.status ?? 0,
      area: contact.area ?? 0,
      level: contact.level ?? 0,
      playerClass: contact.playerClass ?? 0,
    });
    if (!name && !conn.pendingNameQueries.has(`player:${guidLow}`)) {
      conn.pendingNameQueries.add(`player:${guidLow}`);
      sendPacket(
        conn,
        GameOpcode.CMSG_NAME_QUERY,
        buildNameQuery(guidLow, Number((contact.guid >> 32n) & 0xffffffffn)),
      );
    }
  }
  conn.friendStore.set(friends);
}

function handleFriendStatus(conn: WorldConn, r: PacketReader): void {
  const packet = parseFriendStatus(r);
  const guidLow = Number(packet.guid & 0xffffffffn);

  switch (packet.result) {
    case FriendResult.ADDED_ONLINE:
    case FriendResult.ADDED_OFFLINE: {
      const name = conn.nameCache.get(guidLow) ?? "";
      conn.friendStore.add({
        guid: packet.guid,
        name,
        note: packet.note ?? "",
        status: packet.status ?? 0,
        area: packet.area ?? 0,
        level: packet.level ?? 0,
        playerClass: packet.playerClass ?? 0,
      });
      if (!name && !conn.pendingNameQueries.has(`player:${guidLow}`)) {
        conn.pendingNameQueries.add(`player:${guidLow}`);
        sendPacket(
          conn,
          GameOpcode.CMSG_NAME_QUERY,
          buildNameQuery(guidLow, Number((packet.guid >> 32n) & 0xffffffffn)),
        );
      }
      break;
    }
    case FriendResult.ONLINE:
      conn.friendStore.update(packet.guid, {
        status: packet.status ?? FriendStatus.ONLINE,
        area: packet.area ?? 0,
        level: packet.level ?? 0,
        playerClass: packet.playerClass ?? 0,
      });
      break;
    case FriendResult.OFFLINE:
      conn.friendStore.update(packet.guid, { status: FriendStatus.OFFLINE });
      break;
    case FriendResult.REMOVED:
      conn.friendStore.remove(packet.guid);
      break;
    default: {
      const name = conn.nameCache.get(guidLow) ?? `guid:${guidLow}`;
      conn.onFriendEvent?.({
        type: "friend-error",
        result: packet.result,
        name,
      });
      break;
    }
  }
}
```

**Step 6: Register handlers**

Add before the `registerStubs(...)` call in `worldSession`:

```typescript
conn.dispatch.on(GameOpcode.SMSG_CONTACT_LIST, (r) =>
  handleContactList(conn, r),
);
conn.dispatch.on(GameOpcode.SMSG_FRIEND_STATUS, (r) =>
  handleFriendStatus(conn, r),
);
```

**Step 7: Hook name resolution into friendStore**

In `handleNameQueryResponse`, after the entity store name-setting loop (after `conn.entityStore.setName(entity.guid, result.name)`), add:

```typescript
conn.friendStore.setName(BigInt(result.guidLow), result.name);
```

Wait — the friend guid is the full 64-bit value, but the nameCache key is only the low 32-bit. The FriendStore keys by full guid. We need to iterate friends and match by low guid. Better approach — search for matching friend:

Actually, looking at this more carefully, player GUIDs in 3.3.5a have the low 32 bits as the unique identifier and the high 32 bits as a type marker. The simplest approach: in `handleNameQueryResponse`, iterate `friendStore` entries whose low guid matches:

Add inside the `if (result.found && result.name)` block, after the entityStore loop:

```typescript
for (const friend of conn.friendStore.all()) {
  if (Number(friend.guid & 0xffffffffn) === result.guidLow && !friend.name) {
    conn.friendStore.setName(friend.guid, result.name);
  }
}
```

**Step 8: Add WorldHandle methods in handle object literal**

Add before the closing `};` of the handle object:

```typescript
getFriends() {
  return conn.friendStore.all();
},
addFriend(name) {
  sendPacket(conn, GameOpcode.CMSG_ADD_FRIEND, buildAddFriend(name, ""));
},
removeFriend(name) {
  const friend = conn.friendStore.findByName(name);
  if (!friend) {
    conn.onMessage?.({
      type: ChatType.SYSTEM,
      sender: "",
      message: `"${name}" is not on your friends list.`,
    });
    return;
  }
  sendPacket(conn, GameOpcode.CMSG_DEL_FRIEND, buildDelFriend(friend.guid));
},
onFriendEvent(cb) {
  conn.onFriendEvent = cb;
},
```

**Step 9: Update close() to clear friend event handler**

In the `close()` method, add `conn.onFriendEvent = undefined;` before `conn.socket.end();` (same pattern as onEntityEvent).

**Step 10: Add re-exports**

Add to the existing re-export block:

```typescript
export type { FriendEntry, FriendEvent };
```

**Step 11: Run tests**

Run: `mise test`
Expected: PASS (may need mock handle updates first — see Task 6)

**Step 12: Commit**

```
feat: Wire friend list handlers in client
```

---

### Task 6: Update Mock Handles

**Files:**

- Modify: `src/test/mock-handle.ts`
- Modify: `src/daemon/start.test.ts`

**Step 1: Update mock-handle.ts**

Add import:

```typescript
import type { FriendEntry, FriendEvent } from "wow/friend-store";
```

Add to the return type: `triggerFriendEvent(event: FriendEvent): void;`

Add inside `createMockHandle`:

```typescript
let friendEventCb: ((event: FriendEvent) => void) | undefined;
```

Add to the returned object:

```typescript
getFriends: jest.fn((): FriendEntry[] => []),
addFriend: jest.fn(),
removeFriend: jest.fn(),
onFriendEvent(cb) {
  friendEventCb = cb;
},
triggerFriendEvent(event) {
  friendEventCb?.(event);
},
```

**Step 2: Update start.test.ts inline mock**

Add to the inline mock WorldHandle object (inside `worldSession: jest.fn(async (): Promise<WorldHandle> => ({...}))`):

```typescript
getFriends: jest.fn(() => []),
addFriend: jest.fn(),
removeFriend: jest.fn(),
onFriendEvent: jest.fn(),
```

**Step 3: Run tests**

Run: `mise test`
Expected: PASS

**Step 4: Commit**

```
feat: Update mock handles for friend list
```

---

### Task 7: TUI Commands

**Files:**

- Modify: `src/ui/tui.ts`
- Modify: `src/ui/tui.test.ts` (read existing tests first to match style)

**Step 1: Add Command variants**

In the `Command` union type, replace `{ type: "unimplemented"; feature: string }` with three new variants before it:

```typescript
| { type: "friends" }
| { type: "add-friend"; target: string }
| { type: "remove-friend"; target: string }
```

(Keep the `unimplemented` variant — other features still use it.)

**Step 2: Update parseCommand**

Replace the `/friends` / `/f` case:

```typescript
case "/friends":
  return { type: "friends" };
case "/f":
  return { type: "friends" };
case "/friend": {
  const parts = rest.split(" ");
  const sub = parts[0] ?? "";
  const target = parts.slice(1).join(" ");
  if (sub === "add" && target) return { type: "add-friend", target };
  if (sub === "remove" && target) return { type: "remove-friend", target };
  return { type: "friends" };
}
```

**Step 3: Add format functions**

Add imports at top of tui.ts:

```typescript
import type { FriendEntry } from "wow/friend-store";
import { FriendStatus } from "wow/protocol/social";
```

Add helper functions (near the other format functions):

```typescript
const CLASS_NAMES: Record<number, string> = {
  1: "Warrior",
  2: "Paladin",
  3: "Hunter",
  4: "Rogue",
  5: "Priest",
  6: "Death Knight",
  7: "Shaman",
  8: "Mage",
  9: "Warlock",
  11: "Druid",
};

function friendStatusLabel(status: number): string {
  if (status === FriendStatus.AFK) return "AFK";
  if (status === FriendStatus.DND) return "DND";
  if (status !== FriendStatus.OFFLINE) return "Online";
  return "Offline";
}

export function formatFriendList(friends: FriendEntry[]): string {
  if (friends.length === 0) return "[friends] No friends on your list";
  const lines = friends.map((f) => {
    const name = f.name || `guid:${Number(f.guid & 0xffffffffn)}`;
    if (f.status === FriendStatus.OFFLINE) return `  ${name} — Offline`;
    const cls = CLASS_NAMES[f.playerClass] ?? `class ${f.playerClass}`;
    const statusLabel = friendStatusLabel(f.status);
    return `  ${name} — ${statusLabel}, Level ${f.level} ${cls}`;
  });
  const online = friends.filter(
    (f) => f.status !== FriendStatus.OFFLINE,
  ).length;
  return `[friends] ${online}/${friends.length} online\n${lines.join("\n")}`;
}

export function formatFriendListJson(friends: FriendEntry[]): string {
  return JSON.stringify({
    type: "FRIENDS",
    count: friends.length,
    online: friends.filter((f) => f.status !== FriendStatus.OFFLINE).length,
    friends: friends.map((f) => ({
      guid: `0x${f.guid.toString(16)}`,
      name: f.name,
      note: f.note,
      status: friendStatusLabel(f.status).toUpperCase(),
      level: f.level,
      class: CLASS_NAMES[f.playerClass] ?? `class ${f.playerClass}`,
      area: f.area,
    })),
  });
}
```

**Step 4: Add formatFriendEvent and formatFriendEventObj**

```typescript
import type { FriendEvent } from "wow/friend-store";

export function formatFriendEvent(event: FriendEvent): string | undefined {
  switch (event.type) {
    case "friend-online": {
      const f = event.friend;
      const cls = CLASS_NAMES[f.playerClass] ?? "";
      const lvl = f.level ? ` Level ${f.level}` : "";
      return `[friends] ${f.name || "Unknown"} is now online (${lvl} ${cls})`
        .replace(/\(\s+/, "(")
        .replace(/\s+\)/, ")");
    }
    case "friend-offline":
      return `[friends] ${event.name || "Unknown"} went offline`;
    case "friend-added": {
      const f = event.friend;
      return `[friends] ${f.name || "Unknown"} added to friends list`;
    }
    case "friend-removed":
      return `[friends] ${event.name || "Unknown"} removed from friends list`;
    case "friend-error":
      return `[friends] Error: ${friendResultLabel(event.result)}`;
    case "friend-list":
      return undefined;
  }
}

function friendResultLabel(result: number): string {
  const labels: Record<number, string> = {
    0x00: "database error",
    0x01: "friends list is full",
    0x04: "player not found",
    0x08: "already on friends list",
    0x09: "cannot add yourself",
    0x0a: "cannot add enemy faction",
  };
  return labels[result] ?? `error ${result}`;
}

export function formatFriendEventObj(
  event: FriendEvent,
): Record<string, unknown> | undefined {
  switch (event.type) {
    case "friend-online":
      return {
        type: "FRIEND_ONLINE",
        name: event.friend.name,
        level: event.friend.level,
        class: CLASS_NAMES[event.friend.playerClass],
        area: event.friend.area,
      };
    case "friend-offline":
      return { type: "FRIEND_OFFLINE", name: event.name };
    case "friend-added":
      return { type: "FRIEND_ADDED", name: event.friend.name };
    case "friend-removed":
      return { type: "FRIEND_REMOVED", name: event.name };
    case "friend-error":
      return {
        type: "FRIEND_ERROR",
        result: event.result,
        message: friendResultLabel(event.result),
      };
    case "friend-list":
      return undefined;
  }
}
```

**Step 5: Handle new commands in executeCommand**

Add cases before `"unimplemented"`:

```typescript
case "friends": {
  const friends = state.handle.getFriends();
  state.write(formatFriendList(friends) + "\n");
  break;
}
case "add-friend":
  state.handle.addFriend(cmd.target);
  break;
case "remove-friend":
  state.handle.removeFriend(cmd.target);
  break;
```

**Step 6: Write tests for new commands**

Read existing `tui.test.ts` first for style, then add tests for:

- `parseCommand("/friends")` returns `{ type: "friends" }`
- `parseCommand("/f")` returns `{ type: "friends" }`
- `parseCommand("/friend add Arthas")` returns `{ type: "add-friend", target: "Arthas" }`
- `parseCommand("/friend remove Arthas")` returns `{ type: "remove-friend", target: "Arthas" }`
- `parseCommand("/friend")` returns `{ type: "friends" }` (bare `/friend` with no subcommand)
- `formatFriendList([])`
- `formatFriendList([online, offline])`

**Step 7: Run tests**

Run: `mise test`
Expected: PASS

**Step 8: Commit**

```
feat: Add /friends and /friend commands to TUI
```

---

### Task 8: IPC Commands and Event Pipeline

**Files:**

- Modify: `src/daemon/commands.ts`
- Modify: `src/daemon/server.ts`

**Step 1: Add IpcCommand variants**

Add to the `IpcCommand` union:

```typescript
| { type: "friends" }
| { type: "friends_json" }
| { type: "add_friend"; target: string }
| { type: "del_friend"; target: string }
```

**Step 2: Update parseIpcCommand — slash commands**

In the slash-command switch, add a case for the new `"friends"`, `"add-friend"`, `"remove-friend"` types from `parseCommand`:

```typescript
case "friends":
  return { type: "friends" };
case "add-friend":
  return { type: "add_friend", target: parsed.target };
case "remove-friend":
  return { type: "del_friend", target: parsed.target };
```

**Step 3: Update parseIpcCommand — uppercase verbs**

Replace the `FRIENDS` unimplemented stub:

```typescript
case "FRIENDS":
  return { type: "friends" };
case "FRIENDS_JSON":
  return { type: "friends_json" };
case "ADD_FRIEND":
  return rest ? { type: "add_friend", target: rest } : undefined;
case "DEL_FRIEND":
  return rest ? { type: "del_friend", target: rest } : undefined;
```

**Step 4: Update dispatchCommand**

Add cases before `"unimplemented"`:

```typescript
case "friends": {
  const friends = handle.getFriends();
  writeLines(socket, formatFriendList(friends).split("\n"));
  return false;
}
case "friends_json": {
  const friends = handle.getFriends();
  writeLines(socket, [formatFriendListJson(friends)]);
  return false;
}
case "add_friend":
  handle.addFriend(cmd.target);
  writeLines(socket, ["OK"]);
  return false;
case "del_friend":
  handle.removeFriend(cmd.target);
  writeLines(socket, ["OK"]);
  return false;
```

Add imports at top of `commands.ts`:

```typescript
import type { FriendEvent } from "wow/friend-store";
import {
  formatFriendList,
  formatFriendListJson,
  formatFriendEvent,
  formatFriendEventObj,
} from "ui/tui";
```

**Step 5: Add onFriendEvent handler**

Add after `onEntityEvent`:

```typescript
export function onFriendEvent(
  event: FriendEvent,
  events: RingBuffer<EventEntry>,
  log: SessionLog,
): void {
  const text = formatFriendEvent(event);
  const obj = formatFriendEventObj(event);
  if (obj) {
    events.push({ text: text ?? undefined, json: JSON.stringify(obj) });
    log.append(obj as LogEntry).catch(() => {});
  }
}
```

**Step 6: Wire in server.ts**

In `startDaemonServer`, add after the `handle.onEntityEvent(...)` line:

```typescript
handle.onFriendEvent((event) => onFriendEvent(event, events, log));
```

Add to imports in `server.ts`:

```typescript
import { onFriendEvent } from "daemon/commands";
```

**Step 7: Write tests for IPC commands**

Read existing `commands.test.ts` for style. Add tests for:

- `parseIpcCommand("FRIENDS")` → `{ type: "friends" }`
- `parseIpcCommand("FRIENDS_JSON")` → `{ type: "friends_json" }`
- `parseIpcCommand("ADD_FRIEND Arthas")` → `{ type: "add_friend", target: "Arthas" }`
- `parseIpcCommand("DEL_FRIEND Arthas")` → `{ type: "del_friend", target: "Arthas" }`
- `parseIpcCommand("/friends")` → `{ type: "friends" }`
- `parseIpcCommand("/friend add Arthas")` → `{ type: "add_friend", target: "Arthas" }`
- `dispatchCommand` for `friends` calls `handle.getFriends()` and writes lines

**Step 8: Run tests**

Run: `mise test`
Expected: PASS

**Step 9: Commit**

```
feat: Add friend IPC commands and event pipeline
```

---

### Task 9: Integration Tests with Mock World Server

**Files:**

- Modify: `src/wow/client.test.ts` (read existing tests to match style)

**Step 1: Read existing client.test.ts to understand mock server pattern**

The existing tests use a mock world server that sends crafted packets. Follow this pattern for friend list tests.

**Step 2: Write integration tests**

Tests to add:

- Receiving SMSG_CONTACT_LIST populates friendStore, fires friend-list event
- SMSG_CONTACT_LIST triggers CMSG_NAME_QUERY for unknown friend GUIDs
- SMSG_FRIEND_STATUS with ADDED_ONLINE adds to store
- SMSG_FRIEND_STATUS with ONLINE updates store status
- SMSG_FRIEND_STATUS with OFFLINE updates store status
- SMSG_FRIEND_STATUS with REMOVED removes from store
- `addFriend("Arthas")` sends CMSG_ADD_FRIEND packet
- `removeFriend("Arthas")` sends CMSG_DEL_FRIEND packet (lookup by name)
- `removeFriend("nobody")` triggers system message (not on list)

**Step 3: Run tests**

Run: `mise test`
Expected: PASS

**Step 4: Commit**

```
test: Add friend list integration tests
```

---

### Task 10: Update Documentation and Clean Up

**Files:**

- Modify: `src/cli/help.ts`
- Modify: `docs/manual.md`
- Modify: `.claude/skills/tuicraft/SKILL.md`
- Modify: `README.md`
- Modify: `docs/bugs.md`

**Step 1: Update help.ts**

Add to INTERACTIVE COMMANDS section:

```
  /friends        Show friends list
  /friend add <name>   Add a friend
  /friend remove <name> Remove a friend
```

**Step 2: Update docs/bugs.md**

Mark the bug as resolved (check the checkbox):

```markdown
- [x] ~~No SMSG_CONTACT_LIST handler — friend list unavailable~~
```

**Step 3: Update docs/manual.md, SKILL.md, README.md**

Add friend list commands to the relevant sections in each file. Read each file first to find the right location.

**Step 4: Run full CI**

Run: `mise ci`
Expected: PASS (typecheck + test + format)

**Step 5: Fix any formatting issues**

Run: `mise format:fix`

**Step 6: Commit**

```
docs: Add friend list to help, manual, SKILL.md, README
```

---

### Task 11: Live Server Test

**Step 1: Run live tests**

Run: `mise test:live`

Verify that SMSG_CONTACT_LIST is received at login and parsed without error. If the test account has friends, verify they appear in the friend list.

**Step 2: Fix any issues discovered**

If live tests reveal packet parsing issues, fix and add regression tests.

**Step 3: Commit any fixes**

```
fix: Address live test findings for friend list
```
