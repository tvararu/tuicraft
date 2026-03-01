# File Split Refactoring Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Split `src/wow/client.ts` and `src/ui/tui.ts` into smaller single-responsibility modules without behavioral changes.

**Architecture:** Extract auth logic to `wow/auth.ts`, packet handlers to `wow/world-handlers.ts`, command parsing to `ui/commands.ts`, and formatters to `ui/format.ts`. The remaining `client.ts` and `tui.ts` become thin orchestrators. Tests split to match.

**Tech Stack:** TypeScript, Bun, bun:test

---

### Task 1: Extract auth.ts from client.ts

**Files:**
- Create: `src/wow/auth.ts`
- Modify: `src/wow/client.ts`

**Step 1: Create `src/wow/auth.ts`**

Move these items from `client.ts` to a new `auth.ts`:

- `AuthResult` type (lines 103–108)
- `ReconnectRequiredError` class (lines 273–278)
- `AuthContext` type (lines 330–337)
- Functions: `handleChallenge` (230–250), `handleProof` (252–262),
  `handleRealms` (264–271), `handleReconnectChallenge` (280–297),
  `handleReconnectProof` (299–306), `advanceAuth` (339–368),
  `authHandshake` (370–409), `authWithRetry` (308–328)
- Import `ClientConfig` as `import type` from `wow/client`

Exports from `auth.ts`: `authHandshake`, `authWithRetry`,
`ReconnectRequiredError`, `AuthResult`

**Step 2: Update `src/wow/client.ts`**

- Remove the moved code
- Add `import { authHandshake } from "wow/auth"` (needed by `authenticateWorld`
  — actually no, `authenticateWorld` doesn't use `authHandshake`. But
  `authHandshake` was exported from client.ts for external consumers)
- Add `export { authHandshake, authWithRetry, ReconnectRequiredError } from "wow/auth"`
- Add `export type { AuthResult } from "wow/auth"`
- Remove the now-unused imports that only auth needed: `SRP`/`SRPResult` from
  `wow/crypto/srp`, `buildLogonChallenge`/`parseLogonChallengeResponse`/
  `buildLogonProof`/`parseLogonProofResponse`/`buildRealmListRequest`/
  `parseRealmList`/`parseReconnectChallengeResponse`/`buildReconnectProof`
  from `wow/protocol/auth`

**Step 3: Run tests**

Run: `mise test src/wow/client.test.ts`
Expected: All 83 tests pass — re-exports preserve the public API.

**Step 4: Commit**

```
refactor: Extract auth handshake to wow/auth.ts

Move SRP challenge/proof/reconnect and retry logic out of the 1,390-line
client.ts into a focused auth module. Re-export from client.ts so
external consumers are unaffected.
```

---

### Task 2: Extract world-handlers.ts from client.ts

**Files:**
- Create: `src/wow/world-handlers.ts`
- Modify: `src/wow/client.ts`

**Step 1: Export `WorldConn` from `client.ts`**

Change `type WorldConn = {` to `export type WorldConn = {` in client.ts.

**Step 2: Create `src/wow/world-handlers.ts`**

Move these items from `client.ts`:

- `sendPacket` function (lines 411–417)
- All `handle*` functions (lines 443–857, 859–938): `handleTimeSync`,
  `deliverMessage`, `resolveAndDeliver`, `handleChatMessage`,
  `handleRandomRoll`, `handleGmChatMessage`, `handleNameQueryResponse`,
  `handleChannelNotify`, `handleMotd`, `handlePlayerNotFound`,
  `handleServerBroadcast`, `handleNotification`, `handlePartyCommandResult`,
  `handleGroupInviteReceived`, `handleGroupSetLeaderMsg`,
  `handleGroupListMsg`, `handleGroupDestroyed`, `handleGroupUninvite`,
  `handleGroupDeclineMsg`, `handleUpdateObject`,
  `handleCompressedUpdateObject`, `handleDestroyObject`,
  `lookupCachedName`, `queryEntityName`, `handleCreatureQueryResponse`,
  `handleGameObjectQueryResponse`, `handlePartyMemberStatsMsg`,
  `handleContactList`, `handleFriendStatus`

Import from client.ts: `import type { WorldConn } from "wow/client"`

Move protocol imports that only handlers need: `parseChatMessage`,
`buildChatMessage`, `buildNameQuery`, `parseNameQueryResponse`,
`parseChannelNotify`, `parseRandomRoll`, `parseServerBroadcast`,
`parseNotification`, `buildCreatureQuery`, `parseCreatureQueryResponse`,
`buildGameObjectQuery`, `parseGameObjectQueryResponse`, and the group/social
parsers used by handlers.

Export `sendPacket` and all `handle*` functions.

**Step 3: Update `src/wow/client.ts`**

- Import `sendPacket` and all handler functions from `wow/world-handlers`
- Remove moved code and now-unused imports
- `worldSession` continues to register handlers via `conn.dispatch.on()`
  and use `sendPacket` in the WorldHandle methods

**Step 4: Run tests**

Run: `mise test src/wow/client.test.ts`
Expected: All 83 tests pass.

**Step 5: Commit**

```
refactor: Extract world packet handlers to world-handlers.ts

Move 25+ handle* functions and sendPacket out of client.ts. The session
file is now focused on connection lifecycle, handler registration, and
the WorldHandle facade.
```

---

### Task 3: Extract commands.ts from tui.ts

**Files:**
- Create: `src/ui/commands.ts`
- Modify: `src/ui/tui.ts`

**Step 1: Create `src/ui/commands.ts`**

Move from `tui.ts`:
- `Command` type (lines 17–43)
- `parseCommand` function (lines 45–160)

No wow/ imports needed — pure string parsing.

**Step 2: Update `src/ui/tui.ts`**

- Add `import { parseCommand, type Command } from "ui/commands"`
- Remove moved code
- Add re-export: `export { parseCommand, type Command } from "ui/commands"`

**Step 3: Run tests**

Run: `mise test src/ui/tui.test.ts`
Expected: All 170 tests pass — re-exports preserve the public API.

**Step 4: Commit**

```
refactor: Extract command parsing to ui/commands.ts

Move the Command type and parseCommand function out of tui.ts. Pure
string parsing with no wow/ dependencies.
```

---

### Task 4: Extract format.ts from tui.ts

**Files:**
- Create: `src/ui/format.ts`
- Modify: `src/ui/tui.ts`

**Step 1: Create `src/ui/format.ts`**

Move from `tui.ts`:
- Lookup tables: `CHAT_TYPE_LABELS` (162–178), `JSON_TYPE_LABELS` (208–224),
  `CLASS_NAMES` (407–418)
- Helper functions: `partyResultLabel` (283–300), `friendStatusLabel` (420–425),
  `friendResultLabel` (459–469)
- All `format*` functions: `formatMessage` (180–206),
  `formatMessageObj` (226–240), `formatMessageJson` (242–244),
  `formatError` (246–248), `formatWhoResults` (250–254),
  `formatWhoResultsJson` (256–270), `formatPrompt` (272–281),
  `formatGroupEvent` (302–335), `formatEntityEvent` (337–366),
  `formatEntityEventObj` (368–405), `formatFriendList` (427–440),
  `formatFriendListJson` (442–457), `formatFriendEvent` (471–493),
  `formatFriendEventObj` (495–522)

Move the imports these functions need: `ChatType`, `PartyOperation`,
`PartyResult` from `wow/protocol/opcodes`, `ObjectType` from
`wow/protocol/entity-fields`, `FriendStatus` from `wow/protocol/social`,
`stripColorCodes` from `lib/strip-colors`, and the relevant type imports.

**Step 2: Update `src/ui/tui.ts`**

- Import needed formatters from `ui/format`
- Remove moved code and now-unused imports
- Add re-exports so `daemon/commands.ts` doesn't break:
  `export { formatMessage, formatMessageObj, formatWhoResults, formatWhoResultsJson, formatGroupEvent, formatEntityEvent, formatEntityEventObj, formatFriendList, formatFriendListJson, formatFriendEvent, formatFriendEventObj, parseCommand } from ...`

**Step 3: Run tests**

Run: `mise test src/ui/tui.test.ts`
Expected: All 170 tests pass.

**Step 4: Commit**

```
refactor: Extract formatters to ui/format.ts

Move all format* functions, lookup tables, and helpers out of tui.ts.
The TUI file is now focused on runtime: readline, state, command
execution.
```

---

### Task 5: Update external imports

**Files:**
- Modify: `src/daemon/server.ts`
- Modify: `src/daemon/commands.ts`
- Modify: `src/main.ts`

**Step 1: Update `src/daemon/server.ts`**

Change:
```typescript
import { authHandshake, authWithRetry, worldSession } from "wow/client";
```
To:
```typescript
import { authHandshake, authWithRetry } from "wow/auth";
import { worldSession } from "wow/client";
```

**Step 2: Update `src/daemon/commands.ts`**

Change:
```typescript
import {
  formatMessage,
  formatMessageObj,
  formatWhoResults,
  formatWhoResultsJson,
  formatGroupEvent,
  formatEntityEvent,
  formatEntityEventObj,
  formatFriendList,
  formatFriendListJson,
  formatFriendEvent,
  formatFriendEventObj,
  parseCommand,
} from "ui/tui";
```
To:
```typescript
import { parseCommand } from "ui/commands";
import {
  formatMessage,
  formatMessageObj,
  formatWhoResults,
  formatWhoResultsJson,
  formatGroupEvent,
  formatEntityEvent,
  formatEntityEventObj,
  formatFriendList,
  formatFriendListJson,
  formatFriendEvent,
  formatFriendEventObj,
} from "ui/format";
```

**Step 3: Update `src/main.ts`**

Change:
```typescript
const { authWithRetry, worldSession } = await import("wow/client");
```
To:
```typescript
const { authWithRetry } = await import("wow/auth");
const { worldSession } = await import("wow/client");
```

**Step 4: Remove re-exports from `client.ts` and `tui.ts`**

Now that external consumers import directly from the new modules, remove
the re-exports added in Tasks 1–4. This makes the module boundaries clean
with no passthrough re-exports.

**Step 5: Run full test suite**

Run: `mise test`
Expected: All tests pass.

**Step 6: Commit**

```
refactor: Point external imports at new modules

daemon/server.ts and main.ts now import auth functions from wow/auth.
daemon/commands.ts imports parsers from ui/commands and formatters from
ui/format. Removes re-exports from client.ts and tui.ts.
```

---

### Task 6: Split client.test.ts

**Files:**
- Create: `src/wow/auth.test.ts`
- Create: `src/wow/world-handlers.test.ts`
- Modify: `src/wow/client.test.ts`

**Step 1: Create `src/wow/auth.test.ts`**

Move from `client.test.ts`:
- Helper functions: `buildChallengeResponse`, `buildSuccessProofResponse`,
  `base` constant (needed by auth tests)
- The `authHandshake completes SRP` test (lines 123–134)
- The entire "auth error paths" describe block (lines 152–492, 12 tests)
- Update imports: import `authHandshake`, `authWithRetry`,
  `ReconnectRequiredError` from `wow/auth` instead of `wow/client`
- Import `startMockAuthServer` from test fixtures

Total: 13 auth tests.

**Step 2: Create `src/wow/world-handlers.test.ts`**

Move from `client.test.ts`:
- The `full login flow` test stays in client.test.ts (it tests worldSession)
- All handler tests from "world error paths" describe (lines 504–1732):
  time sync, chat sends/receives, name resolution, channels, who, motd,
  player not found, server broadcast, notification, chat restricted,
  chat wrong faction, channel left, chat modes, packet error, group opcodes,
  group leader self-match, setLeader missing member, stubbed opcode,
  group commands, rolls
- The entire "entity handling" nested describe (lines 1734–2359, 13 tests)
- The entire "friend list" nested describe (lines 2361–2956, 12 tests)
- Helper functions: `fakeAuth`, `waitForEchoProbe`, `waitForGroupEvents`,
  entity helpers (`writePackedGuid`, `writeLivingMovementBlock`, etc.),
  friend helpers (`buildContactList`, `buildFriendStatus`, etc.)
- Import handler functions from `wow/world-handlers` for any direct tests;
  most tests exercise handlers indirectly through `worldSession`

Total: ~70 handler/entity/friend tests.

Note: Many of these tests exercise handlers indirectly through worldSession +
mock server. That's fine — they're testing handler behavior even though they
go through the session. Group them by what they're verifying, not how they
invoke it.

**Step 3: Update `src/wow/client.test.ts`**

Keep only tests that exercise worldSession lifecycle:
- `full login flow` (lines 136–149)
- `rejects when world auth status is not 0x0c` (519–531)
- `rejects with named message for system error` (533–545)
- `rejects with named message for account in use` (547–559)
- `rejects when character is not found` (561–578)
- `ping interval fires` (580–593)
- `handler error in drainWorldPackets calls onPacketError` (1383–1407)

Keep: `fakeAuth` helper, `base` constant, mock server imports.
Total: ~7 session lifecycle tests.

**Step 4: Run tests**

Run: `mise test src/wow/auth.test.ts src/wow/world-handlers.test.ts src/wow/client.test.ts`
Expected: All tests pass, same count as before.

**Step 5: Commit**

```
test: Split client.test.ts into auth, handler, and session tests

auth.test.ts covers SRP handshake, reconnect, and retry logic.
world-handlers.test.ts covers chat, group, entity, and friend handlers.
client.test.ts retains session lifecycle tests.
```

---

### Task 7: Split tui.test.ts

**Files:**
- Create: `src/ui/commands.test.ts`
- Create: `src/ui/format.test.ts`
- Modify: `src/ui/tui.test.ts`

**Step 1: Create `src/ui/commands.test.ts`**

Move from `tui.test.ts`:
- The entire `parseCommand` describe block (lines 34–335, 52 tests)
- The `/tuicraft` parseCommand tests from the tuicraft section
  (lines 1237–1259, 3 tests)
- Import `parseCommand` from `ui/commands`

Total: 55 command parsing tests.

**Step 2: Create `src/ui/format.test.ts`**

Move from `tui.test.ts`:
- `formatMessage` describe (lines 337–414, 10 tests)
- `formatMessageJson` describe (lines 416–522, 9 tests)
- `formatPrompt` tests (lines 1057–1077, 4 tests)
- `formatGroupEvent` tests (lines 1079–1235, 15 tests)
- `formatEntityEvent` tests (lines 1421–1569, 9 tests)
- `formatEntityEventObj` tests (lines 1570–1741, 6 tests)
- `formatFriendList` tests (lines 1742–1816, 4 tests)
- `formatFriendListJson` tests (lines 1817–1854, 1 test)
- `formatFriendEvent` tests (lines 1855–1931, 7 tests)
- `formatFriendEventObj` tests (lines 1932–2007, 6 tests)
- Import formatters from `ui/format`

Total: 71 formatting tests.

**Step 3: Update `src/ui/tui.test.ts`**

Keep only TUI runtime tests:
- `startTui` describe (lines 523–1056, 34 tests)
- Tuicraft entity toggle tests (lines 1260–1420, 8 tests)
- Friend TUI command tests (lines 2008–2056, 3 tests)
- Helper functions: `writeLine`, `flush`, `createMockHandle` import

Total: 45 runtime tests.

**Step 4: Run tests**

Run: `mise test src/ui/commands.test.ts src/ui/format.test.ts src/ui/tui.test.ts`
Expected: All tests pass, same count as before.

**Step 5: Commit**

```
test: Split tui.test.ts into commands, format, and runtime tests

commands.test.ts covers parseCommand. format.test.ts covers all
format* functions. tui.test.ts retains executeCommand and startTui.
```

---

### Task 8: Update mock-handle and start.test.ts imports

**Files:**
- Modify: `src/test/mock-handle.ts`
- Modify: `src/daemon/start.test.ts`

**Step 1: Update `src/test/mock-handle.ts`**

The mock-handle imports `WorldHandle`, `ChatMessage`, `ChatMode`, `GroupEvent`
as types from `wow/client`. These types still live in client.ts, so no change
is needed unless we moved them. Verify and leave as-is if unchanged.

**Step 2: Update `src/daemon/start.test.ts`**

Imports `AuthResult` type from `wow/client`. After Task 5 removed the
re-export, update to:
```typescript
import type { AuthResult } from "wow/auth";
import type { WorldHandle } from "wow/client";
```

**Step 3: Run full test suite and typecheck**

Run: `mise ci`
Expected: All tests pass, no type errors, formatting clean.

**Step 4: Commit**

```
refactor: Update remaining test imports for new modules

start.test.ts imports AuthResult from wow/auth. mock-handle.ts unchanged
since WorldHandle and chat types remain in client.ts.
```

---

### Task 9: Final verification

**Step 1: Run full CI**

Run: `mise ci`
Expected: typecheck, test, and format all pass.

**Step 2: Verify file sizes**

Run: `git ls-files -z 'src/wow/client.ts' 'src/wow/auth.ts' 'src/wow/world-handlers.ts' 'src/ui/tui.ts' 'src/ui/commands.ts' 'src/ui/format.ts' | xargs -0 wc -l | sort -rn`

Expected approximate sizes:
- `src/wow/client.ts` ~600 lines (down from 1,390)
- `src/wow/world-handlers.ts` ~500 lines
- `src/wow/auth.ts` ~180 lines
- `src/ui/format.ts` ~360 lines
- `src/ui/tui.ts` ~205 lines (down from 728)
- `src/ui/commands.ts` ~145 lines

**Step 3: Verify no re-exports remain**

Grep for re-export patterns in client.ts and tui.ts to confirm they were
removed in Task 5. These files should only export their own code.
