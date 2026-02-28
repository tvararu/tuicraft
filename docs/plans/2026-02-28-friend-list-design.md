# Friend List Design

## Goal

Parse SMSG_CONTACT_LIST and SMSG_FRIEND_STATUS, store friend entries in a
FriendStore, and expose them through `/friends` (TUI), `/friend add|remove`
commands, and IPC verbs.

## Scope

Friends only. The parser reads all contact types (friends, ignored, muted) but
only stores entries with the FRIEND flag set. Ignored/muted support is deferred.

## Packet Formats

Six opcodes in the social family. Opcodes are already defined in `opcodes.ts`.

### SMSG_CONTACT_LIST (0x0067)

```
u32       listMask        (RelationType flags echoed back)
u32       count
Relation[count]:
  u64     guid
  u32     relationMask    (FRIEND=0x01, IGNORED=0x02, MUTED=0x04)
  CString note
  if (relationMask & FRIEND):
    u8    status          (0=offline, 1=online, 2=afk, 4=dnd)
    if (status != 0):
      u32 area            (zone ID)
      u32 level
      u32 playerClass
```

**Critical**: The packet does NOT include character names. Names must be
resolved via CMSG_NAME_QUERY using the existing `nameCache` mechanism.

### SMSG_FRIEND_STATUS (0x0068)

```
u8        result          (FriendResult enum)
u64       guid
if (result == ADDED_ONLINE || result == ADDED_OFFLINE):
  CString note
if (result == ADDED_ONLINE || result == ONLINE):
  u8      status
  u32     area
  u32     level
  u32     playerClass
```

Key result codes: DB_ERROR(0), LIST_FULL(1), ONLINE(2), OFFLINE(3),
NOT_FOUND(4), REMOVED(5), ADDED_ONLINE(6), ADDED_OFFLINE(7), ALREADY(8),
SELF(9), ENEMY(10).

### CMSG_ADD_FRIEND (0x0069)

```
CString   name
CString   note
```

### CMSG_DEL_FRIEND (0x006A)

```
u64       guid
```

Takes a GUID, not a name. The `/friend remove <name>` command must look up the
GUID from the FriendStore.

## Architecture

### FriendStore (`src/wow/friend-store.ts`)

Follows the EntityStore pattern: a class with Map-based storage and an event
callback.

```
FriendEntry = { guid, name, note, status, area, level, playerClass }

FriendEvent =
  | { type: "friend-list"; friends: FriendEntry[] }
  | { type: "friend-online"; friend: FriendEntry }
  | { type: "friend-offline"; guid: bigint; name: string }
  | { type: "friend-added"; friend: FriendEntry }
  | { type: "friend-removed"; guid: bigint; name: string }
  | { type: "friend-error"; result: number; name: string }
```

Methods: `set(entries)`, `update(guid, fields)`, `remove(guid)`,
`setName(guid, name)`, `findByName(name)`, `all()`.

### Name Resolution

When SMSG_CONTACT_LIST arrives:

1. Parse all entries, store friends in FriendStore
2. For each friend GUID not in `conn.nameCache`, send CMSG_NAME_QUERY
3. Existing `handleNameQueryResponse` populates `nameCache` — add a hook to
   also call `conn.friendStore.setName()` when the GUID matches a friend

### WorldHandle Additions

```
getFriends(): FriendEntry[]
addFriend(name: string): void
removeFriend(name: string): void
onFriendEvent(cb: (event: FriendEvent) => void): void
```

### Command Additions

TUI: `/friends` lists friends, `/friend add <name>`, `/friend remove <name>`.
IPC: `FRIENDS`, `FRIENDS_JSON`, `ADD_FRIEND <name>`, `DEL_FRIEND <name>`.

### Event Pipeline

`onFriendEvent` in `commands.ts` follows the `onGroupEvent` pattern: formats
text + JSON, pushes to ring buffer, appends to session log. Wired up in
`startDaemonServer`.
