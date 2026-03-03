# Mail Notifications Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Display a `[mail] You have new mail.` notification when the server sends SMSG_RECEIVED_MAIL, and update the `/mail` command stub wording.

**Architecture:** Add a `handleReceivedMail` handler following the same pattern as `handleNotification` (read packet, call `conn.onMessage`). Add `"mail"` to the `ChatMessage.origin` union. Add formatting branches in `formatMessage`/`formatMessageObj`. Update the `/mail` command feature string in both parsers.

**Tech Stack:** TypeScript, Bun test runner, existing world handler infrastructure.

---

### Task 1: Add `"mail"` to the ChatMessage origin union

**Files:**

- Modify: `src/wow/client.ts:105`

**Step 1: Update the origin type**

In `src/wow/client.ts`, line 105, change:

```typescript
  origin?: "server" | "notification";
```

to:

```typescript
  origin?: "server" | "notification" | "mail";
```

**Step 2: Run typecheck**

Run: `mise typecheck`
Expected: PASS (no consumers of `"mail"` yet, adding a union member is non-breaking)

**Step 3: Commit**

```
git add src/wow/client.ts
git commit -m "feat: Add mail origin to ChatMessage type"
```

---

### Task 2: Add format branches for mail origin

**Files:**

- Modify: `src/ui/format.ts:41-49` (formatMessage), `src/ui/format.ts:77-91` (formatMessageObj)
- Test: `src/ui/format.test.ts`

**Step 1: Write the failing tests**

In `src/ui/format.test.ts`, add two tests. Inside the `describe("formatMessage"` block (after the notification test around line 101):

```typescript
test("mail origin shows [mail] label", () => {
  const msg = {
    type: ChatType.SYSTEM,
    sender: "",
    message: "You have new mail.",
    origin: "mail" as const,
  };
  expect(formatMessage(msg)).toBe("[mail] You have new mail.");
});
```

Inside the `describe("formatMessageJson"` block (after the notification JSON test around line 208):

```typescript
test("mail origin uses MAIL JSON type", () => {
  const msg = {
    type: ChatType.SYSTEM,
    sender: "",
    message: "You have new mail.",
    origin: "mail" as const,
  };
  expect(formatMessageObj(msg)).toEqual({
    type: "MAIL",
    sender: "",
    message: "You have new mail.",
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `mise test src/ui/format.test.ts`
Expected: FAIL — mail origin falls through to the generic `[system]` branch and `SYSTEM` JSON type.

**Step 3: Implement the format branches**

In `src/ui/format.ts`, in `formatMessage()`, add a new branch between the `origin === "notification"` check (line 46) and the plain `ChatType.SYSTEM` check (line 47):

```typescript
if (msg.type === ChatType.SYSTEM && msg.origin === "mail") {
  return `[mail] ${message}`;
}
```

In `formatMessageObj()`, extend the ternary chain at lines 78-83. Change:

```typescript
const type =
  msg.origin === "server"
    ? "SERVER_BROADCAST"
    : msg.origin === "notification"
      ? "NOTIFICATION"
      : (JSON_TYPE_LABELS[msg.type] ?? `TYPE_${msg.type}`);
```

to:

```typescript
const type =
  msg.origin === "server"
    ? "SERVER_BROADCAST"
    : msg.origin === "notification"
      ? "NOTIFICATION"
      : msg.origin === "mail"
        ? "MAIL"
        : (JSON_TYPE_LABELS[msg.type] ?? `TYPE_${msg.type}`);
```

**Step 4: Run tests to verify they pass**

Run: `mise test src/ui/format.test.ts`
Expected: PASS

**Step 5: Commit**

```
git add src/ui/format.ts src/ui/format.test.ts
git commit -m "feat: Format mail notifications as [mail] label"
```

---

### Task 3: Add handleReceivedMail handler

**Files:**

- Modify: `src/wow/world-handlers.ts` (add handler after `handleNotification`)
- Modify: `src/wow/client.ts` (register on dispatch, import handler)
- Modify: `src/wow/protocol/stubs.ts` (remove SMSG_RECEIVED_MAIL entry)
- Test: `src/wow/world-handlers.test.ts`

**Step 1: Write the failing test**

In `src/wow/world-handlers.test.ts`, add an integration test inside the `describe("world handler tests"` block. The test uses `inject()` to send a raw SMSG_RECEIVED_MAIL packet:

```typescript
test("handles SMSG_RECEIVED_MAIL", async () => {
  const ws = await startMockWorldServer();
  try {
    const handle = await worldSession(
      { ...base, host: "127.0.0.1", port: ws.port },
      fakeAuth(ws.port),
    );
    await waitForEchoProbe(handle);
    const received = new Promise<ChatMessage>((resolve) =>
      handle.onMessage(resolve),
    );
    const body = new PacketWriter(4);
    body.writeFloat32(0);
    ws.inject(GameOpcode.SMSG_RECEIVED_MAIL, body.result());
    const msg = await received;
    expect(msg.type).toBe(ChatType.SYSTEM);
    expect(msg.message).toBe("You have new mail.");
    expect(msg.origin).toBe("mail");
    handle.close();
    await handle.closed;
  } finally {
    ws.stop();
  }
});
```

Note: SMSG_RECEIVED_MAIL body is a single `f32` (4 bytes). Using `writeFloat32(0)` to fill it.

**Step 2: Run test to verify it fails**

Run: `mise test src/wow/world-handlers.test.ts`
Expected: The test either times out (stub swallows packet silently) or gets the wrong message format from the stub handler.

**Step 3: Add the handler function**

In `src/wow/world-handlers.ts`, after the `handleNotification` function (around line 269), add:

```typescript
export function handleReceivedMail(conn: WorldConn, r: PacketReader): void {
  r.readFloat32();
  conn.onMessage?.({
    type: ChatType.SYSTEM,
    sender: "",
    message: "You have new mail.",
    origin: "mail",
  });
}
```

**Step 4: Register the handler in client.ts**

In `src/wow/client.ts`:

1. Add `handleReceivedMail` to the import from `"wow/world-handlers"` (around line 64):

```typescript
  handleReceivedMail,
```

2. Register on the dispatch, after the `SMSG_NOTIFICATION` registration (after line 401):

```typescript
conn.dispatch.on(GameOpcode.SMSG_RECEIVED_MAIL, (r) =>
  handleReceivedMail(conn, r),
);
```

**Step 5: Remove SMSG_RECEIVED_MAIL from stubs**

In `src/wow/protocol/stubs.ts`, delete lines 225-230 (the SMSG_RECEIVED_MAIL entry):

```typescript
  {
    opcode: GameOpcode.SMSG_RECEIVED_MAIL,
    area: "mail",
    label: "New mail notification",
    priority: "medium",
  },
```

**Step 6: Run test to verify it passes**

Run: `mise test src/wow/world-handlers.test.ts`
Expected: PASS

**Step 7: Commit**

```
git add src/wow/world-handlers.ts src/wow/client.ts src/wow/protocol/stubs.ts src/wow/world-handlers.test.ts
git commit -m "feat: Handle SMSG_RECEIVED_MAIL notification"
```

---

### Task 4: Update /mail command wording

**Files:**

- Modify: `src/ui/commands.ts:134`
- Modify: `src/daemon/commands.ts:245`
- Test: `src/ui/commands.test.ts`, `src/daemon/commands.test.ts`

**Step 1: Update the test expectations first**

In `src/ui/commands.test.ts`, find the `/mail` test (around line 300-304) and change the expected feature from `"Mail"` to `"Mail reading"`:

```typescript
test("/mail returns unimplemented", () => {
  expect(parseCommand("/mail")).toEqual({
    type: "unimplemented",
    feature: "Mail reading",
  });
});
```

In `src/daemon/commands.test.ts`, find the MAIL entry in the unimplemented IPC commands cases (line 426) and change:

```typescript
      ["MAIL", "Mail reading"],
```

**Step 2: Run tests to verify they fail**

Run: `mise test src/ui/commands.test.ts src/daemon/commands.test.ts`
Expected: FAIL — feature string is still `"Mail"`.

**Step 3: Update the command parsers**

In `src/ui/commands.ts`, line 134, change:

```typescript
return { type: "unimplemented", feature: "Mail" };
```

to:

```typescript
return { type: "unimplemented", feature: "Mail reading" };
```

In `src/daemon/commands.ts`, line 245, change:

```typescript
return { type: "unimplemented", feature: "Mail" };
```

to:

```typescript
return { type: "unimplemented", feature: "Mail reading" };
```

**Step 4: Run tests to verify they pass**

Run: `mise test src/ui/commands.test.ts src/daemon/commands.test.ts`
Expected: PASS

**Step 5: Commit**

```
git add src/ui/commands.ts src/daemon/commands.ts src/ui/commands.test.ts src/daemon/commands.test.ts
git commit -m "feat: Update /mail stub to say 'Mail reading'"
```

---

### Task 5: Full test suite + coverage verification

**Step 1: Run the full test suite**

Run: `mise test`
Expected: All tests pass.

**Step 2: Run typecheck**

Run: `mise typecheck`
Expected: No errors.

**Step 3: Run formatter**

Run: `mise format`
Expected: All files formatted. If not, run `mise format:fix` and amend.

**Step 4: Verify coverage**

Check that the new handler and format branches have 100% coverage. Run:

Run: `mise test --coverage`

Verify `handleReceivedMail` and the new format branches show full line/branch/function coverage.

**Step 5: Run live server tests**

Run: `mise test:live`

This validates that the handler registration doesn't break the real world session flow. The mail notification itself won't fire unless the test account has pending mail, but the session must connect and function normally.
