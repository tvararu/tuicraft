# Ignore List Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Server-side ignore list using WoW's native protocol, mirroring the friend system pattern.

**Architecture:** IgnoreStore mirrors FriendStore but simpler (no status/level/class). Protocol uses existing SMSG_FRIEND_STATUS with ignore-specific result codes (0x0B-0x11). Message filtering in resolveAndDeliver checks ignoreStore before delivering.

**Tech Stack:** TypeScript, Bun, WoW 3.3.5a protocol

---

### Task 1: IgnoreStore

**Files:**

- Create: `src/wow/ignore-store.ts`
- Create: `src/wow/ignore-store.test.ts`

IgnoreEntry = { guid: bigint, name: string }. IgnoreEvent union with ignore-list, ignore-added, ignore-removed, ignore-error. Class with Map<bigint, IgnoreEntry>, methods: set, add, remove, setName, findByName, has(guidLow: number), all. The has() method uses Number(guid & 0xffffffffn) comparison for O(n) scan (list is small).

### Task 2: Protocol builders + ignore result codes

**Files:**

- Modify: `src/wow/protocol/social.ts`

Add IgnoreResult constants (FULL=0x0B through AMBIGUOUS=0x11). Add buildAddIgnore(name) and buildDelIgnore(guid) functions. buildAddIgnore writes just a cString (no note, unlike friend). buildDelIgnore writes uint64LE guid (same shape as buildDelFriend).

### Task 3: World handlers

**Files:**

- Modify: `src/wow/world-handlers.ts`

handleContactList: second loop for SocialFlag.IGNORED contacts, call ignoreStore.set(). handleFriendStatus: new cases for IgnoreResult.ADDED (0x0F) routes to ignoreStore.add(), REMOVED (0x10) to ignoreStore.remove(), all others (0x0B-0x0E, 0x11) fire ignore-error event. resolveAndDeliver: check ignoreStore.has(raw.senderGuidLow) before delivery. handleNameQueryResponse: also setName on ignoreStore entries.

### Task 4: WorldConn/WorldHandle

**Files:**

- Modify: `src/wow/client.ts`

WorldConn: add ignoreStore, onIgnoreEvent fields. WorldHandle: add getIgnored, addIgnore, removeIgnore, onIgnoreEvent methods. Wire ignoreStore.onEvent in worldSession. Clear onIgnoreEvent in close(). Export IgnoreEntry, IgnoreEvent types.

### Task 5: UI commands

**Files:**

- Modify: `src/ui/commands.ts`

Command union: add ignored, add-ignore, remove-ignore. Replace /ignore unimplemented stub. Add /ignorelist, /unignore, /addignore aliases.

### Task 6: Format functions

**Files:**

- Modify: `src/ui/format.ts`

formatIgnoreList, formatIgnoreListJson, formatIgnoreEvent, formatIgnoreEventObj, ignoreResultLabel. Mirror friend formatting but simpler (no status/level/class).

### Task 7: Daemon commands

**Files:**

- Modify: `src/daemon/commands.ts`

IpcCommand: add ignored, ignored_json, add_ignore, del_ignore. parseIpcCommand: route slash commands and IPC verbs. dispatchCommand: call handle methods, format output. onIgnoreEvent: mirror onFriendEvent.

### Task 8: TUI

**Files:**

- Modify: `src/ui/tui.ts`

executeCommand: add ignored, add-ignore, remove-ignore cases. Import formatIgnoreList.

### Task 9: Mock handles

**Files:**

- Modify: `src/test/mock-handle.ts`
- Modify: `src/daemon/start.test.ts`

Add getIgnored, addIgnore, removeIgnore, onIgnoreEvent to both mocks. Add triggerIgnoreEvent to shared mock.

### Task 10: Tests

**Files:**

- Modify: `src/ui/commands.test.ts`
- Modify: `src/daemon/commands.test.ts`
- Modify: `src/ui/tui.test.ts`
- Modify: `src/ui/format.test.ts`
- Modify: `src/wow/world-handlers.test.ts`

### Task 11: Documentation

**Files:**

- Modify: `src/cli/help.ts`
- Modify: `docs/manual.md`
- Modify: `.claude/skills/tuicraft/SKILL.md`
- Modify: `README.md`

### Task 12: CI + Commit + PR

Run mise ci. Fix any failures. Commit. Open PR.
