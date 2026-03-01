# File Split Refactoring Design

Split `src/wow/client.ts` (1,390 lines) and `src/ui/tui.ts` (728 lines) into
smaller, single-responsibility modules. 100% test coverage gives us confidence
to move code without behavioral changes.

## client.ts → 3 files

### src/wow/auth.ts (~180 lines)

All auth handshake logic, completely self-contained:

- Functions: `handleChallenge`, `handleProof`, `handleRealms`,
  `handleReconnectChallenge`, `handleReconnectProof`, `advanceAuth`,
  `authHandshake`, `authWithRetry`
- `ReconnectRequiredError` class
- Types: `AuthResult`, `AuthContext`
- Imports: `wow/protocol/auth`, `wow/protocol/world` (AccumulatorBuffer),
  `wow/crypto/srp`, `wow/protocol/packet`
- Zero coupling to WorldConn or handlers

### src/wow/world-handlers.ts (~500 lines)

All 25+ packet handler functions plus helpers:

- `sendPacket` (used by both handlers and WorldHandle methods)
- All `handle*` functions: `handleTimeSync`, `handleChatMessage`,
  `handleGmChatMessage`, `handleNameQueryResponse`, `handleChannelNotify`,
  `handleMotd`, `handlePlayerNotFound`, `handleServerBroadcast`,
  `handleNotification`, `handleRandomRoll`, `handlePartyCommandResult`,
  `handleGroupInviteReceived`, `handleGroupSetLeaderMsg`, `handleGroupListMsg`,
  `handleGroupDestroyed`, `handleGroupUninvite`, `handleGroupDeclineMsg`,
  `handleUpdateObject`, `handleCompressedUpdateObject`, `handleDestroyObject`,
  `handleCreatureQueryResponse`, `handleGameObjectQueryResponse`,
  `handlePartyMemberStatsMsg`, `handleContactList`, `handleFriendStatus`
- Helpers: `deliverMessage`, `resolveAndDeliver`, `lookupCachedName`,
  `queryEntityName`
- Imports `WorldConn` as `import type` from client.ts (type-only, no runtime
  circular dependency)

### src/wow/client.ts (~600 lines)

Session setup, types, and the WorldHandle facade:

- Types: `ClientConfig`, `ChatMessage`, `GroupEvent`, `ChatMode`, `WorldHandle`,
  `WorldConn` (now exported for world-handlers.ts)
- Functions: `drainWorldPackets`, `authenticateWorld`, `selectCharacter`,
  `startPingLoop`, `worldSession`
- Imports handler functions + `sendPacket` from world-handlers.ts
- Re-exports `AuthResult` from auth.ts for backward compatibility

## tui.ts → 3 files

### src/ui/commands.ts (~145 lines)

Pure command parsing, no wow/ dependencies:

- `Command` type
- `parseCommand()` function

### src/ui/format.ts (~360 lines)

All formatting functions and lookup tables:

- Functions: `formatMessage`, `formatMessageObj`, `formatMessageJson`,
  `formatError`, `formatWhoResults`, `formatWhoResultsJson`, `formatPrompt`,
  `formatGroupEvent`, `formatEntityEvent`, `formatEntityEventObj`,
  `formatFriendList`, `formatFriendListJson`, `formatFriendEvent`,
  `formatFriendEventObj`
- Tables: `CHAT_TYPE_LABELS`, `JSON_TYPE_LABELS`, `CLASS_NAMES`
- Helpers: `partyResultLabel`, `friendStatusLabel`, `friendResultLabel`

### src/ui/tui.ts (~205 lines)

TUI runtime, the only file that imports `node:readline`:

- Types: `TuiState`, `TuiOptions`
- Functions: `executeCommand`, `startTui`
- Imports `Command`/`parseCommand` from commands.ts, formatters from format.ts

## External import changes

- `daemon/server.ts`, `main.ts`: import `authHandshake`/`authWithRetry` from
  `wow/auth` instead of `wow/client`
- All other external consumers unchanged — `worldSession`, `WorldHandle`,
  `ChatMessage` etc. still come from `wow/client`

## Test split

Tests mirror the source split:

- `src/wow/client.test.ts` (2,878 lines) → `auth.test.ts` +
  `world-handlers.test.ts` + `client.test.ts`
- `src/ui/tui.test.ts` (2,056 lines) → `commands.test.ts` + `format.test.ts` +
  `tui.test.ts`

No tests deleted. Every existing test case moves to the file matching its source
module. Coverage stays at 100%.
