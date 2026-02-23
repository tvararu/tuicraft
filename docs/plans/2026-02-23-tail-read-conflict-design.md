# Tail/Read Conflict Design

## Problem

`tuicraft tail` polls with `READ_WAIT`, which drains the same shared ring
buffer cursor used by `read` and by send flows that include `--wait`. When
multiple clients connect, whichever drains first consumes events for everyone
else, causing contention and flaky behavior.

## Solution

Hybrid approach: keep `READ` on the shared drain cursor (unchanged behavior),
switch `READ_WAIT` to a non-destructive window-based slice.

The contention is between `READ_WAIT` consumers (`tail`, `--wait`). Plain `read`
is a one-shot drain that isn't part of the conflict. Only the polling paths need
to change.

## RingBuffer Changes

Add `slice(from: number): T[]` — a non-destructive read that returns items from
position `from` to `writePos`, clamped to the oldest available slot if `from`
has been overwritten. Does not mutate any internal state.

Add a `writePos` getter to expose the current write position.

Keep the existing `drain()` method and internal `cursor` — `READ`/`READ_JSON`
still use them.

## Command Dispatch Changes

`READ` and `READ_JSON`: unchanged. Still call `drain()` on the shared cursor.

`READ_WAIT` and `READ_WAIT_JSON`: snapshot `events.writePos` before the
setTimeout, then call `slice(savedPos)` after the sleep. Returns only events
that arrived during the wait window. No cursor mutation.

## What Stays The Same

- Protocol commands: `READ`, `READ_JSON`, `READ_WAIT`, `READ_WAIT_JSON` unchanged
- Client code: `main.ts`, `ipc.ts`, `args.ts` untouched
- `tail` still loops `READ_WAIT 1000`
- SessionLog: unchanged, still appends independently
- Event creation: `onChatMessage`/`onGroupEvent` still push to one ring buffer
- Ring buffer capacity: still 1000
- `SocketState` type in `server.ts`: unchanged
- `dispatchCommand` signature: unchanged

## Files Changed

1. `src/lib/ring-buffer.ts` — add `slice()` method and `writePos` getter
2. `src/lib/ring-buffer.test.ts` — add tests for `slice()`
3. `src/daemon/commands.ts` — change `read_wait` and `read_wait_json` cases
4. `src/daemon/commands.test.ts` — update tests for window-based read_wait

## Alternatives Considered

**Per-socket cursors:** Store a cursor per socket in the `socketStates` WeakMap.
Rejected — `sendToSocket` creates a new connection per call, so per-socket state
is ephemeral. Plain `read` (no wait) would always return empty because the
cursor starts at `writePos` and drain happens immediately.

**Non-destructive reads everywhere:** Make `READ` also use `slice()` instead of
`drain()`. Rejected — returns the full buffer every time, which is spammy and a
regression from the current drain-and-advance behavior.

**Multiple RingBuffer instances per client:** Fan-out events to per-client
buffers. Rejected — memory scales with connections, duplicates data needlessly.

**Append-only event log with sequence numbers:** Replace ring buffer with a log
indexed by sequence number. Rejected — rewrites working code for the same result.
