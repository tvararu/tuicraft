# Chat Restricted & Wrong Faction Notice Handling

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Handle SMSG_CHAT_RESTRICTED and SMSG_CHAT_WRONG_FACTION opcodes so the user sees appropriate system messages instead of "not yet implemented" stubs.

**Architecture:** Two small handler functions in `client.ts` following the existing `handlePlayerNotFound` / `handleServerBroadcast` pattern — parse minimal payload, emit `ChatType.SYSTEM` via `conn.onMessage`. Remove stubs, update README feature table.

**Tech Stack:** TypeScript, Bun test runner, PacketReader/PacketWriter

---

### Task 1: Write failing test for SMSG_CHAT_RESTRICTED

**Files:**
- Test: `src/wow/client.test.ts` (after SMSG_NOTIFICATION test ~line 1082)

**Step 1: Write the failing test**

Insert after the `SMSG_NOTIFICATION delivers as notification-origin system message` test (after line 1082):

```typescript
test("SMSG_CHAT_RESTRICTED delivers restriction-specific system message", async () => {
  const ws = await startMockWorldServer();
  try {
    const handle = await worldSession(
      { ...base, host: "127.0.0.1", port: ws.port },
      fakeAuth(ws.port),
    );

    const received = new Promise<ChatMessage>((r) => handle.onMessage(r));

    const w = new PacketWriter();
    w.uint8(1);
    ws.inject(GameOpcode.SMSG_CHAT_RESTRICTED, w.finish());

    const msg = await received;
    expect(msg.type).toBe(ChatType.SYSTEM);
    expect(msg.sender).toBe("");
    expect(msg.message).toBe("Chat is throttled");

    handle.close();
    await handle.closed;
  } finally {
    ws.stop();
  }
});
```

**Step 2: Run test to verify it fails**

Run: `mise test src/wow/client.test.ts -t "SMSG_CHAT_RESTRICTED"`
Expected: FAIL — the stub handler doesn't emit a message, so the promise never resolves (timeout).

---

### Task 2: Implement handleChatRestricted handler + registration

**Files:**
- Modify: `src/wow/client.ts:565-572` (add handler near `handlePlayerNotFound`)
- Modify: `src/wow/client.ts:1059-1061` (add dispatch registration near `SMSG_CHAT_PLAYER_NOT_FOUND`)

**Step 3: Write the handler function**

Insert after `handlePlayerNotFound` (after line 572 in `client.ts`):

```typescript
const CHAT_RESTRICTION_MESSAGES: Record<number, string> = {
  0: "Chat is restricted",
  1: "Chat is throttled",
  2: "You have been squelched",
  3: "Yell is restricted",
};

function handleChatRestricted(conn: WorldConn, r: PacketReader): void {
  const restriction = r.uint8();
  conn.onMessage?.({
    type: ChatType.SYSTEM,
    sender: "",
    message:
      CHAT_RESTRICTION_MESSAGES[restriction] ??
      `Chat restriction ${restriction}`,
  });
}
```

**Step 4: Register the handler**

Insert after the `SMSG_CHAT_PLAYER_NOT_FOUND` dispatch registration (after line 1061):

```typescript
conn.dispatch.on(GameOpcode.SMSG_CHAT_RESTRICTED, (r) =>
  handleChatRestricted(conn, r),
);
```

**Step 5: Run test to verify it passes**

Run: `mise test src/wow/client.test.ts -t "SMSG_CHAT_RESTRICTED"`
Expected: PASS

**Step 6: Commit**

```
feat: Handle SMSG_CHAT_RESTRICTED opcode

Parse the 1-byte restriction type and emit a specific system
message for each variant (restricted, throttled, squelched, yell).
```

---

### Task 3: Write failing test for SMSG_CHAT_WRONG_FACTION

**Files:**
- Test: `src/wow/client.test.ts` (after the SMSG_CHAT_RESTRICTED test)

**Step 7: Write the failing test**

Insert after the SMSG_CHAT_RESTRICTED test:

```typescript
test("SMSG_CHAT_WRONG_FACTION delivers system message", async () => {
  const ws = await startMockWorldServer();
  try {
    const handle = await worldSession(
      { ...base, host: "127.0.0.1", port: ws.port },
      fakeAuth(ws.port),
    );

    const received = new Promise<ChatMessage>((r) => handle.onMessage(r));

    ws.inject(GameOpcode.SMSG_CHAT_WRONG_FACTION, new Uint8Array(0));

    const msg = await received;
    expect(msg.type).toBe(ChatType.SYSTEM);
    expect(msg.sender).toBe("");
    expect(msg.message).toBe(
      "You cannot speak to members of the opposing faction",
    );

    handle.close();
    await handle.closed;
  } finally {
    ws.stop();
  }
});
```

**Step 8: Run test to verify it fails**

Run: `mise test src/wow/client.test.ts -t "SMSG_CHAT_WRONG_FACTION"`
Expected: FAIL — no handler emits a message.

---

### Task 4: Implement handleChatWrongFaction handler + registration

**Files:**
- Modify: `src/wow/client.ts` (add handler after `handleChatRestricted`)
- Modify: `src/wow/client.ts` (add dispatch registration after `SMSG_CHAT_RESTRICTED`)

**Step 9: Write the handler function**

Insert after `handleChatRestricted`:

```typescript
function handleChatWrongFaction(conn: WorldConn): void {
  conn.onMessage?.({
    type: ChatType.SYSTEM,
    sender: "",
    message: "You cannot speak to members of the opposing faction",
  });
}
```

**Step 10: Register the handler**

Insert after the `SMSG_CHAT_RESTRICTED` dispatch registration:

```typescript
conn.dispatch.on(GameOpcode.SMSG_CHAT_WRONG_FACTION, () =>
  handleChatWrongFaction(conn),
);
```

**Step 11: Run test to verify it passes**

Run: `mise test src/wow/client.test.ts -t "SMSG_CHAT_WRONG_FACTION"`
Expected: PASS

**Step 12: Commit**

```
feat: Handle SMSG_CHAT_WRONG_FACTION opcode

Empty-payload packet — emit a system message when the player
tries to chat with someone from the opposing faction.
```

---

### Task 5: Remove stubs and update README

**Files:**
- Modify: `src/wow/protocol/stubs.ts:195-212` (remove both stub entries)
- Modify: `README.md:143-144` (flip ❌ to ✅)

**Step 13: Remove stub entries**

Delete these two blocks from `stubs.ts` (lines 195-212):

```typescript
  {
    opcode: GameOpcode.SMSG_CHAT_RESTRICTED,
    area: "chat",
    label: "Chat restricted",
    priority: "medium",
  },
```

```typescript
  {
    opcode: GameOpcode.SMSG_CHAT_WRONG_FACTION,
    area: "chat",
    label: "Wrong faction",
    priority: "medium",
  },
```

**Step 14: Update README feature table**

In `README.md`, change lines 143-144:

```markdown
| Server broadcast messages               | ✅     |
| Chat restricted / wrong faction notices | ✅     |
```

**Step 15: Run full test suite**

Run: `mise test`
Expected: All tests pass, no regressions.

**Step 16: Commit**

```
chore: Unstub chat notices, update README

Remove SMSG_CHAT_RESTRICTED and SMSG_CHAT_WRONG_FACTION from
stubs now that they have real handlers. Mark server broadcasts
and chat notices as done in the README feature table.
```
