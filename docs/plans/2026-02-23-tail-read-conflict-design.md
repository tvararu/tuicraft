# Per-Socket Cursor Design

## Problem

`tuicraft tail` polls with `READ_WAIT`, which drains the same shared ring
buffer cursor used by `read` and `--wait` flows. When multiple clients connect,
whichever drains first consumes events for everyone else.

## Solution

Replace the single shared cursor on `RingBuffer` with per-socket cursors stored
in the existing `socketStates` WeakMap. Each connected client reads independently
from the same underlying buffer.

## RingBuffer Changes

Add `drainFrom(cursor: number): { items: T[], cursor: number }` — a pure read
that takes an external cursor, returns items from that position to `writePos`,
and returns the updated cursor. If the caller's cursor has fallen behind the
oldest slot (buffer overwrote past it), clamp to `writePos - capacity`.

Remove the internal `cursor` field and `drain()` method — all consumers use
`drainFrom()` with their own external cursor.

## Socket State

On connect, initialize `cursor` to `events.writePos` (future-only — new
connections see only events arriving after they connect).

On `READ`/`READ_WAIT`, call `events.drainFrom(state.cursor)`, update the
socket's stored cursor, write items to the socket.

On disconnect, WeakMap auto-cleans — no explicit teardown.

## What Stays The Same

- Protocol commands: `READ`, `READ_JSON`, `READ_WAIT`, `READ_WAIT_JSON` unchanged
- Client code: `main.ts`, `ipc.ts`, `args.ts` untouched
- `tail` still loops `READ_WAIT 1000` — it just gets its own cursor now
- SessionLog: unchanged, still appends independently
- Event creation: `onChatMessage`/`onGroupEvent` still push to one ring buffer
- Ring buffer capacity: still 1000

## Files Changed

1. `src/lib/ring-buffer.ts` — add `drainFrom()`, remove `drain()` and internal cursor
2. `src/lib/ring-buffer.test.ts` — test `drainFrom()`, remove `drain()` tests
3. `src/daemon/server.ts` — add `cursor` to socket state init
4. `src/daemon/commands.ts` — pass cursor to `drainFrom()`, return new cursor
5. `src/daemon/commands.test.ts` — update tests to use per-client cursors

## Alternatives Considered

**Multiple RingBuffer instances per client:** Fan-out events to per-client
buffers. Rejected — memory scales with connections, duplicates data needlessly.
The ring buffer already stores data once; we just need independent read
positions.

**Append-only event log with sequence numbers:** Replace ring buffer with a log
indexed by sequence number. Rejected — rewrites working code for the same result.
The circular overwrite already handles capacity management.
