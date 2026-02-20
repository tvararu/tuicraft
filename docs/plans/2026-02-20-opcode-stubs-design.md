# Comprehensive Opcode Stub System

## Problem

tuicraft handles ~35 opcodes but the 3.3.5a protocol has hundreds. Unhandled
server packets are silently dropped, and there's no visibility into what features
are missing. The bugs.md file tracks one gap (friends list) but the real surface
area is much larger.

## Solution

Add every known 3.3.5a opcode constant to `opcodes.ts`, create a stub registry
in `stubs.ts` that registers first-hit notification handlers for unimplemented
SMSG opcodes, and add TUI/IPC command stubs for unimplemented slash commands.
Delete `bugs.md` — the stubs become the source of truth for missing features.

## Design

### 1. Opcode Constants (`src/wow/protocol/opcodes.ts`)

Add the complete set of 3.3.5a world opcodes to the `GameOpcode` object. Source
the values from `wow_messages` wowm definitions and AzerothCore `Opcodes.h`.
Group entries by feature area with blank lines between groups. Existing entries
stay in place; new ones are added after them.

### 2. Stub Registry (`src/wow/protocol/stubs.ts`)

Single file exporting:

- `StubEntry` type: `{ opcode: number; area: string; label: string; priority: "high" | "medium" | "low" }`
- `STUBS` array: every unimplemented opcode with metadata
- `registerStubs(dispatch, notify)`: registers each SMSG opcode in the dispatch table

Behavior per stub handler:

- First receipt: calls `notify("[tuicraft] <label> is not yet implemented")`
- Subsequent receipts: silently drops the packet (prevents spam from
  high-frequency opcodes like SMSG_UPDATE_OBJECT)

The `notify` callback is the same `onMessage` path used for system messages, so
notifications appear naturally in TUI output and the daemon event buffer.

CMSG opcodes appear in the `STUBS` array for documentation/grep purposes but
don't get dispatch handlers (they're outbound-only).

### 3. TUI Command Stubs (`src/ui/tui.ts`)

New `Command` variant: `{ type: "unimplemented"; feature: string }`.

New entries in `parseCommand`:

- `/friends`, `/f` — "Friends list"
- `/ignore <name>` — "Ignore list"
- `/join <channel>`, `/leave <channel>` — "Channel join/leave" (distinct from
  existing `/leave` which is group leave)
- `/ginvite <name>`, `/gkick <name>`, `/gleave`, `/gpromote <name>` — "Guild management"
- `/mail` — "Mail"
- `/roll` — "Random roll"
- `/dnd`, `/afk` — "Player status"
- `/e`, `/emote` — "Text emotes"

`executeCommand` handles `unimplemented` by printing
`[tuicraft] <feature> is not yet implemented`.

### 4. IPC Command Stubs (`src/daemon/commands.ts`)

New `IpcCommand` variant: `{ type: "unimplemented"; feature: string }`.

New verbs in `parseIpcCommand`: `FRIENDS`, `IGNORE`, `JOIN`, `ROLL`, `MAIL`,
`GINVITE`, `GKICK`, `GLEAVE`, `GPROMOTE`, `DND`, `AFK`, `EMOTE`.

`dispatchCommand` handles `unimplemented` by writing
`UNIMPLEMENTED <feature>\n\n` to the socket.

### 5. Cleanup

Delete `docs/bugs.md`. The stubs are the source of truth for unimplemented
features.

### 6. Registration

In `client.ts`, call `registerStubs(conn.dispatch, msg => conn.onMessage?.({...}))`
after registering the real handlers. Real handlers take precedence because they're
registered first and OpcodeDispatch uses a Map (last-write doesn't apply — first
registered wins... actually Map.set overwrites). So stubs must skip opcodes that
already have real handlers — `registerStubs` checks `dispatch.has(opcode)` before
registering. This means `OpcodeDispatch` needs a `has(opcode)` method.

## Priority Tiers

Stubs are tagged by priority for future implementation ordering:

**High:** Social/friends, channel join/leave, guild events/roster, server messages
**Medium:** Mail, text emotes, /roll, achievements, ready check, notifications
**Low:** Trade, auction, battlefield, movement, spells, calendar, LFG, duel,
loot, weather, warden

## What This Does NOT Do

- No protocol parsing logic
- No new WorldHandle methods
- No new test files (stubs are thin data + a one-line handler)
- No behavior changes to existing features
