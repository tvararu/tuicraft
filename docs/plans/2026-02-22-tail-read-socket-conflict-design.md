# Tail/Read Socket Conflict Design

## Problem

`tuicraft tail` currently polls with `READ_WAIT*`, which drains the same shared
ring buffer used by `read` and by send flows that include `--wait`. With
multiple clients, whichever command drains first consumes events for everyone,
causing contention and flaky behavior.

## Decision Summary

- Keep CLI command as `tail`.
- Add IPC commands: `SUBSCRIBE` and `SUBSCRIBE_JSON`.
- `SUBSCRIBE*` is live-only.
- `SUBSCRIBE*` is silent while idle.
- Keep existing `READ*`/`READ_WAIT*` drain semantics unchanged.

This keeps pull consumers backward-compatible while making `tail` a passive
subscriber that no longer competes for buffered events.

## Protocol Design

### New IPC Commands

- `SUBSCRIBE`
- `SUBSCRIBE_JSON`

Behavior:

- Register the caller socket as a subscriber in the selected format.
- Keep the socket open.
- Stream one line per event as events arrive.
- Do not send `OK`.
- Do not send history replay.
- Do not send keepalives.

### Existing Commands

No semantic changes:

- `READ`, `READ_JSON` continue to drain immediately.
- `READ_WAIT`, `READ_WAIT_JSON` continue to wait then drain.

## Server Runtime Design

### Subscriber State

Extend `ServerCtx` with socket registries:

- `textSubscribers: Set<IpcSocket>`
- `jsonSubscribers: Set<IpcSocket>`

Helpers:

- register subscriber by mode
- remove socket from both sets
- fan out one `EventEntry` to active subscribers

### Event Flow

On incoming chat/group event:

1. Push event into ring buffer (unchanged).
2. Fan out formatted text/json line to subscribers.

A failed write drops only the failing subscriber and does not impact message
ingestion or other subscribers.

### Socket Lifecycle

On socket close/end/error:

- remove socket from subscriber sets

This prevents stale subscriber accumulation.

## CLI Design

### `tail`

Change from polling loop to single persistent stream:

- open one socket
- send `SUBSCRIBE` or `SUBSCRIBE_JSON`
- print each incoming line until interrupted

### IPC Client Helper

Add a streaming helper for long-lived connections. Keep `sendToSocket` unchanged
for finite request/response commands.

## Error Handling

- Unknown commands keep existing `ERR unknown command` behavior.
- `SUBSCRIBE*` never emits terminal blank-line framing.
- Subscriber disconnect cleanup is silent.
- Fanout is best-effort per subscriber; failures are isolated.

## Testing

1. Tail/read coexistence:
   - subscriber receives live event
   - `READ` drain behavior remains intact
2. Multiple subscribers:
   - all subscribers receive the same event
3. Disconnect cleanup:
   - closed subscriber is removed
4. Regression with active tail:
   - send/read flows do not starve each other
5. CLI tail behavior:
   - uses one persistent subscribe command, not polling

## Non-Goals

- Changing `READ*` or `READ_WAIT*` semantics
- Removing ring buffer history
- Adding replay or keepalive to `SUBSCRIBE*`
