# Tail/Read Socket Conflict Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Eliminate `tail` vs `read` event-consumption contention by adding live push subscriptions (`SUBSCRIBE*`) while preserving existing `READ*` drain semantics.

**Architecture:** Add daemon-side subscriber registries keyed by output mode (text/json), register sockets via new IPC verbs (`SUBSCRIBE`, `SUBSCRIBE_JSON`), and fan out new events to subscribers without touching ring-buffer behavior. Keep request/response IPC helper unchanged for finite commands, add a dedicated streaming IPC helper for long-lived sockets, and switch CLI `tail` to a single persistent subscription.

**Tech Stack:** TypeScript, Bun, bun:test, mise tasks

---

### Task 1: Add IPC command parsing coverage for `SUBSCRIBE*`

**Files:**
- Modify: `src/daemon/commands.test.ts`
- Modify: `src/daemon/commands.ts`

**Step 1: Write failing parser tests**

Add tests in `src/daemon/commands.test.ts` asserting:
- `parseIpcCommand("SUBSCRIBE")` -> `{ type: "subscribe" }`
- `parseIpcCommand("SUBSCRIBE_JSON")` -> `{ type: "subscribe_json" }`

**Step 2: Run tests to verify failure**

Run:
```bash
mise test src/daemon/commands.test.ts
```
Expected: parser tests fail because new verbs are not recognized.

**Step 3: Implement minimal parser support**

Extend `IpcCommand` and `parseIpcCommand` in `src/daemon/commands.ts` with:
- `subscribe`
- `subscribe_json`

**Step 4: Re-run parser tests**

Run:
```bash
mise test src/daemon/commands.test.ts
```
Expected: new parse tests pass.

**Step 5: Commit**

```bash
git add src/daemon/commands.ts src/daemon/commands.test.ts
git commit -m "feat: Add SUBSCRIBE IPC command parsing"
```

### Task 2: Add daemon subscriber registries and live fanout

**Files:**
- Modify: `src/daemon/server.ts`
- Modify: `src/daemon/commands.ts`
- Modify: `src/daemon/commands.test.ts`

**Step 1: Write failing integration tests for coexistence and fanout**

In `src/daemon/commands.test.ts`, add server integration tests that:
- Open one subscriber socket and verify it receives a live event.
- Verify `READ` still drains ring-buffer events independently.
- Open two subscribers and verify both receive the same live event.

**Step 2: Run tests to verify failure**

Run:
```bash
mise test src/daemon/commands.test.ts
```
Expected: new subscribe tests fail.

**Step 3: Add subscriber state and registration plumbing**

Implement in `src/daemon/server.ts`:
- `textSubscribers: Set<IpcSocket>`
- `jsonSubscribers: Set<IpcSocket>`
- helper to remove a socket from both sets
- cleanup wiring on socket lifecycle paths

Plumb subscriber sets into command dispatch context.

**Step 4: Implement subscribe dispatch behavior**

In `src/daemon/commands.ts`:
- handle `subscribe`/`subscribe_json` by registering socket and returning without terminal write
- keep `READ*` behavior unchanged

**Step 5: Implement event fanout after ring-buffer push**

Ensure `onChatMessage` and `onGroupEvent` continue to push to ring buffer, then fan out one line to subscribers in matching mode.

**Step 6: Re-run daemon command tests**

Run:
```bash
mise test src/daemon/commands.test.ts
```
Expected: coexistence and multi-subscriber tests pass.

**Step 7: Commit**

```bash
git add src/daemon/server.ts src/daemon/commands.ts src/daemon/commands.test.ts
git commit -m "feat: Stream live events to SUBSCRIBE IPC clients"
```

### Task 3: Add subscriber disconnect cleanup coverage

**Files:**
- Modify: `src/daemon/commands.test.ts`
- Modify: `src/daemon/server.ts`

**Step 1: Write failing disconnect cleanup test**

Add a test that:
- starts a subscription
- closes subscriber socket
- emits subsequent events
- verifies no delivery attempts occur to the closed subscriber and server remains healthy

**Step 2: Run targeted tests**

Run:
```bash
mise test src/daemon/commands.test.ts
```
Expected: cleanup test fails before lifecycle cleanup is complete.

**Step 3: Complete lifecycle cleanup handling**

Ensure close/end/error paths remove sockets from registries exactly once.

**Step 4: Re-run targeted tests**

Run:
```bash
mise test src/daemon/commands.test.ts
```
Expected: cleanup test passes.

**Step 5: Commit**

```bash
git add src/daemon/server.ts src/daemon/commands.test.ts
git commit -m "test: Cover SUBSCRIBE socket cleanup on disconnect"
```

### Task 4: Add streaming IPC client helper

**Files:**
- Modify: `src/cli/ipc.ts`
- Modify: `src/cli/ipc.test.ts`

**Step 1: Write failing tests for long-lived streaming helper**

Add tests in `src/cli/ipc.test.ts` for a new helper that:
- sends one command on connect
- emits lines as they arrive
- does not require `\n\n` response framing
- supports explicit close/abort behavior

**Step 2: Run helper tests to verify failure**

Run:
```bash
mise test src/cli/ipc.test.ts
```
Expected: new tests fail because helper does not exist.

**Step 3: Implement minimal streaming helper**

In `src/cli/ipc.ts`, add a dedicated streaming API (separate from `sendToSocket`) for persistent IPC subscriptions.

**Step 4: Re-run helper tests**

Run:
```bash
mise test src/cli/ipc.test.ts
```
Expected: streaming helper tests pass and existing `sendToSocket` tests stay green.

**Step 5: Commit**

```bash
git add src/cli/ipc.ts src/cli/ipc.test.ts
git commit -m "feat: Add streaming IPC helper for persistent subscriptions"
```

### Task 5: Switch `tail` to persistent `SUBSCRIBE*`

**Files:**
- Modify: `src/main.ts`
- Modify: `src/daemon/commands.test.ts`
- Modify: `src/cli/help.ts`
- Modify: `src/cli/help.test.ts`

**Step 1: Write failing behavior tests for tail transport**

Add/adjust tests to assert `tail` uses `SUBSCRIBE` (or `SUBSCRIBE_JSON`) semantics rather than `READ_WAIT*` polling.

**Step 2: Run relevant tests**

Run:
```bash
mise test src/cli/help.test.ts src/daemon/commands.test.ts
```
Expected: behavior test fails before `main.ts` update.

**Step 3: Implement tail subscription flow**

Update `src/main.ts` tail branch to:
- open one long-lived IPC stream
- send `SUBSCRIBE` or `SUBSCRIBE_JSON`
- print each incoming line until interrupted

**Step 4: Re-run relevant tests**

Run:
```bash
mise test src/daemon/commands.test.ts src/cli/ipc.test.ts src/cli/help.test.ts
```
Expected: tests pass.

**Step 5: Commit**

```bash
git add src/main.ts src/daemon/commands.test.ts src/cli/help.ts src/cli/help.test.ts
git commit -m "feat: Switch tail to live SUBSCRIBE stream"
```

### Task 6: Full verification and live protocol check

**Files:**
- Modify: none expected

**Step 1: Run full local verification**

Run:
```bash
mise typecheck
mise test
mise format
mise ci
```
Expected: all commands pass.

**Step 2: Run live server test suite after protocol/daemon changes**

Run:
```bash
MISE_TASK_TIMEOUT=60s mise test:live
```
Expected: live tests pass against running server.

**Step 3: Inspect diff for unintended changes**

Run:
```bash
git status --short
git diff -- docs/plans/2026-02-22-tail-read-socket-conflict-plan.md src/main.ts src/cli/ipc.ts src/daemon/server.ts src/daemon/commands.ts
```
Expected: only intended files and behavior changes present.

**Step 4: Final squash/commit policy check**

Run:
```bash
git log -n 5
```
Expected: commit style remains consistent with repository conventions.
