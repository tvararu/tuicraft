# Server Broadcast Messages Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Handle SMSG_CHAT_SERVER_MESSAGE and SMSG_NOTIFICATION opcodes so server broadcasts display in TUI as `[server]` and emit typed JSON events in daemon mode.

**Architecture:** Route both opcodes through the existing ChatMessage pipeline by adding an optional `origin` field. Parse packets in `chat.ts`, register handlers in `client.ts`, format with distinct `[server]` label in `tui.ts`, remove from stubs. TDD throughout.

**Tech Stack:** TypeScript, Bun test, PacketReader/PacketWriter

---

### Task 1: Add `origin` to ChatMessage and parse functions

**Files:**
- Modify: `src/wow/protocol/chat.ts` (add `parseServerBroadcast`, `parseNotification`)
- Modify: `src/wow/client.ts:108-113` (add `origin` to ChatMessage type)
- Test: `src/wow/protocol/chat.test.ts`

**Step 1: Write failing tests for `parseServerBroadcast`**

Add to `src/wow/protocol/chat.test.ts`:

```typescript
import {
  // ... existing imports ...,
  parseServerBroadcast,
  parseNotification,
} from "wow/protocol/chat";

describe("parseServerBroadcast", () => {
  test("parses shutdown time message", () => {
    const w = new PacketWriter();
    w.uint32LE(1);
    w.cString("15:00");
    const result = parseServerBroadcast(new PacketReader(w.finish()));
    expect(result.message).toBe("Server shutdown in 15:00");
  });

  test("parses restart time message", () => {
    const w = new PacketWriter();
    w.uint32LE(2);
    w.cString("05:00");
    const result = parseServerBroadcast(new PacketReader(w.finish()));
    expect(result.message).toBe("Server restart in 05:00");
  });

  test("parses raw string message", () => {
    const w = new PacketWriter();
    w.uint32LE(3);
    w.cString("Custom admin broadcast");
    const result = parseServerBroadcast(new PacketReader(w.finish()));
    expect(result.message).toBe("Custom admin broadcast");
  });

  test("parses shutdown cancelled", () => {
    const w = new PacketWriter();
    w.uint32LE(4);
    w.cString("");
    const result = parseServerBroadcast(new PacketReader(w.finish()));
    expect(result.message).toBe("Server shutdown cancelled");
  });

  test("parses restart cancelled", () => {
    const w = new PacketWriter();
    w.uint32LE(5);
    w.cString("");
    const result = parseServerBroadcast(new PacketReader(w.finish()));
    expect(result.message).toBe("Server restart cancelled");
  });
});

describe("parseNotification", () => {
  test("parses notification string", () => {
    const w = new PacketWriter();
    w.cString("Welcome to our server!");
    const result = parseNotification(new PacketReader(w.finish()));
    expect(result.message).toBe("Welcome to our server!");
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `mise test src/wow/protocol/chat.test.ts`
Expected: FAIL — `parseServerBroadcast` and `parseNotification` not exported

**Step 3: Add `origin` to ChatMessage and implement parse functions**

In `src/wow/client.ts:108-113`, add `origin` to the public ChatMessage type:

```typescript
export type ChatMessage = {
  type: number;
  sender: string;
  message: string;
  channel?: string;
  origin?: "server" | "notification";
};
```

In `src/wow/protocol/chat.ts`, add at the end of the file:

```typescript
const SERVER_MESSAGES: Record<number, string | ((param: string) => string)> = {
  1: (p) => `Server shutdown in ${p}`,
  2: (p) => `Server restart in ${p}`,
  3: (p) => p,
  4: () => "Server shutdown cancelled",
  5: () => "Server restart cancelled",
};

export function parseServerBroadcast(r: PacketReader): { message: string } {
  const messageId = r.uint32LE();
  const param = r.cString();
  const fmt = SERVER_MESSAGES[messageId];
  const message = typeof fmt === "function" ? fmt(param) : `Server message ${messageId}: ${param}`;
  return { message };
}

export function parseNotification(r: PacketReader): { message: string } {
  return { message: r.cString() };
}
```

**Step 4: Run tests to verify they pass**

Run: `mise test src/wow/protocol/chat.test.ts`
Expected: PASS

**Step 5: Commit**

```
feat: Add server broadcast and notification parsers

SMSG_CHAT_SERVER_MESSAGE carries a message ID (shutdown/restart/
string/cancelled) plus a string parameter. SMSG_NOTIFICATION is
a bare null-terminated string. Both now parse into a message
string ready for display.
```

---

### Task 2: Register handlers in `client.ts`

**Files:**
- Modify: `src/wow/client.ts` (add handler functions + dispatch registrations)
- Test: `src/wow/client.test.ts`

**Step 1: Write failing integration tests**

Add to `src/wow/client.test.ts`:

```typescript
test("delivers SMSG_CHAT_SERVER_MESSAGE as server-origin system message", async () => {
  const ws = startMockWorldServer();
  try {
    const handle = await worldSession(
      { ...base, host: "127.0.0.1", port: ws.port },
      fakeAuth(ws.port),
    );

    const received = new Promise<ChatMessage>((r) => handle.onMessage(r));

    const w = new PacketWriter();
    w.uint32LE(1);
    w.cString("15:00");
    ws.inject(GameOpcode.SMSG_CHAT_SERVER_MESSAGE, w.finish());

    const msg = await received;
    expect(msg.type).toBe(ChatType.SYSTEM);
    expect(msg.sender).toBe("");
    expect(msg.message).toBe("Server shutdown in 15:00");
    expect(msg.origin).toBe("server");

    handle.close();
    await handle.closed;
  } finally {
    ws.stop();
  }
});

test("delivers SMSG_NOTIFICATION as notification-origin system message", async () => {
  const ws = startMockWorldServer();
  try {
    const handle = await worldSession(
      { ...base, host: "127.0.0.1", port: ws.port },
      fakeAuth(ws.port),
    );

    const received = new Promise<ChatMessage>((r) => handle.onMessage(r));

    const w = new PacketWriter();
    w.cString("Server autobroadcast message");
    ws.inject(GameOpcode.SMSG_NOTIFICATION, w.finish());

    const msg = await received;
    expect(msg.type).toBe(ChatType.SYSTEM);
    expect(msg.sender).toBe("");
    expect(msg.message).toBe("Server autobroadcast message");
    expect(msg.origin).toBe("notification");

    handle.close();
    await handle.closed;
  } finally {
    ws.stop();
  }
});
```

**Step 2: Run tests to verify they fail**

Run: `mise test src/wow/client.test.ts`
Expected: FAIL — messages not delivered (stubs swallow them)

**Step 3: Add handlers and register with dispatch**

In `src/wow/client.ts`, add imports:

```typescript
import {
  // ... existing imports ...,
  parseServerBroadcast,
  parseNotification,
} from "wow/protocol/chat";
```

Add handler functions (near `handleMotd`, around line 560):

```typescript
function handleServerBroadcast(conn: WorldConn, r: PacketReader): void {
  const { message } = parseServerBroadcast(r);
  conn.onMessage?.({
    type: ChatType.SYSTEM,
    sender: "",
    message,
    origin: "server",
  });
}

function handleNotification(conn: WorldConn, r: PacketReader): void {
  const { message } = parseNotification(r);
  conn.onMessage?.({
    type: ChatType.SYSTEM,
    sender: "",
    message,
    origin: "notification",
  });
}
```

Register with dispatch (after the SMSG_CHANNEL_NOTIFY registration, around line 1041):

```typescript
conn.dispatch.on(GameOpcode.SMSG_CHAT_SERVER_MESSAGE, (r) =>
  handleServerBroadcast(conn, r),
);
conn.dispatch.on(GameOpcode.SMSG_NOTIFICATION, (r) =>
  handleNotification(conn, r),
);
```

**Step 4: Run tests to verify they pass**

Run: `mise test src/wow/client.test.ts`
Expected: PASS

**Step 5: Commit**

```
feat: Handle server broadcast and notification packets

Register SMSG_CHAT_SERVER_MESSAGE and SMSG_NOTIFICATION with the
opcode dispatcher. Both deliver ChatMessage events with the new
origin field so display formatting can distinguish them.
```

---

### Task 3: Format with `[server]` label in TUI and JSON

**Files:**
- Modify: `src/ui/tui.ts:180-229` (update `formatMessage` and `formatMessageObj`)
- Test: `src/ui/tui.test.ts`

**Step 1: Write failing tests for `[server]` formatting**

Add to the `formatMessage` describe block in `src/ui/tui.test.ts`:

```typescript
test("server broadcast origin shows [server] label", () => {
  const msg = {
    type: ChatType.SYSTEM,
    sender: "",
    message: "Server shutdown in 15:00",
    origin: "server" as const,
  };
  expect(formatMessage(msg)).toBe("[server] Server shutdown in 15:00");
});

test("notification origin shows [server] label", () => {
  const msg = {
    type: ChatType.SYSTEM,
    sender: "",
    message: "Autobroadcast text",
    origin: "notification" as const,
  };
  expect(formatMessage(msg)).toBe("[server] Autobroadcast text");
});
```

Add to the `formatMessageJson` tests (or create a new describe for `formatMessageObj`):

```typescript
test("server broadcast origin uses SERVER_BROADCAST JSON type", () => {
  const msg = {
    type: ChatType.SYSTEM,
    sender: "",
    message: "Shutdown in 5:00",
    origin: "server" as const,
  };
  expect(formatMessageObj(msg)).toEqual({
    type: "SERVER_BROADCAST",
    sender: "",
    message: "Shutdown in 5:00",
  });
});

test("notification origin uses NOTIFICATION JSON type", () => {
  const msg = {
    type: ChatType.SYSTEM,
    sender: "",
    message: "Auto message",
    origin: "notification" as const,
  };
  expect(formatMessageObj(msg)).toEqual({
    type: "NOTIFICATION",
    sender: "",
    message: "Auto message",
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `mise test src/ui/tui.test.ts`
Expected: FAIL — `formatMessage` returns `[system]` instead of `[server]`

**Step 3: Update formatMessage and formatMessageObj**

The `ChatMessage` type is imported from `wow/client` which now has `origin`. In `src/ui/tui.ts`:

Update `formatMessage` — add an origin check before the existing `ChatType.SYSTEM` branch (around line 190):

```typescript
if (msg.type === ChatType.SYSTEM && msg.origin) {
  return `[server] ${message}`;
}
if (msg.type === ChatType.SYSTEM) {
  return `[system] ${message}`;
}
```

Update `formatMessageObj` — add origin check before the default type lookup (around line 220):

```typescript
export function formatMessageObj(msg: ChatMessage): LogEntry {
  const type =
    msg.origin === "server"
      ? "SERVER_BROADCAST"
      : msg.origin === "notification"
        ? "NOTIFICATION"
        : (JSON_TYPE_LABELS[msg.type] ?? `TYPE_${msg.type}`);
  const obj: LogEntry = {
    type,
    sender: msg.sender,
    message: stripColorCodes(msg.message),
  };
  if (msg.channel) obj.channel = msg.channel;
  return obj;
}
```

**Step 4: Run tests to verify they pass**

Run: `mise test src/ui/tui.test.ts`
Expected: PASS

**Step 5: Commit**

```
feat: Display server broadcasts with [server] label

Server broadcast and notification messages now render as
[server] instead of [system] in TUI mode, and use distinct
SERVER_BROADCAST / NOTIFICATION JSON types for daemon consumers.
```

---

### Task 4: Remove from stubs

**Files:**
- Modify: `src/wow/protocol/stubs.ts:189-194,302-307` (remove two entries)
- Test: run full suite

**Step 1: Remove SMSG_CHAT_SERVER_MESSAGE stub (lines 189-194)**

Delete the object at lines 189-194:

```typescript
  {
    opcode: GameOpcode.SMSG_CHAT_SERVER_MESSAGE,
    area: "chat",
    label: "Server broadcast message",
    priority: "high",
  },
```

**Step 2: Remove SMSG_NOTIFICATION stub (lines 302-307)**

Delete the object at lines 302-307:

```typescript
  {
    opcode: GameOpcode.SMSG_NOTIFICATION,
    area: "system",
    label: "Server notification",
    priority: "medium",
  },
```

**Step 3: Run the full test suite**

Run: `mise test`
Expected: all tests PASS

**Step 4: Run typecheck**

Run: `mise typecheck`
Expected: no errors

**Step 5: Commit**

```
chore: Remove server broadcast and notification stubs

Both opcodes are now handled — no longer need placeholder
stub entries.
```

---

### Task 5: Run live server tests

**Step 1: Run live tests to verify nothing broke**

Run: `mise test:live`
Expected: PASS (server broadcasts are rare events so won't trigger during test, but this confirms the new handlers don't break the world session)

**Step 2: Run full CI check**

Run: `mise ci`
Expected: typecheck, test, format all pass
