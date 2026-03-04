# Channel Join/Leave Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add `/join <channel>` and `/leave <channel>` commands that send CMSG_JOIN_CHANNEL / CMSG_LEAVE_CHANNEL, and surface SMSG_CHANNEL_NOTIFY feedback (join, leave, errors) to the user.

**Architecture:** Fire-and-forget commands (like `/invite`) that send a packet and return immediately. The existing `handleChannelNotify` handler already tracks `conn.channels`; we extend it to also emit system messages so the user sees feedback. The `ChannelNotify` enum gains error codes (wrong password, banned, etc.) and `parseChannelNotify` returns structured events for them.

**Tech Stack:** TypeScript, Bun, `PacketWriter`/`PacketReader`, existing `WorldHandle` pattern

---

### Task 1: Packet Builders and Parser Expansion

**Files:**

- Modify: `src/wow/protocol/opcodes.ts:639-642` (expand `ChannelNotify` enum)
- Modify: `src/wow/protocol/chat.ts:118-141` (expand `ChannelNotifyEvent`, add builders, expand parser)
- Test: `src/wow/protocol/chat.test.ts`

**Step 1: Write failing tests for `buildJoinChannel`, `buildLeaveChannel`, and expanded `parseChannelNotify`**

Add to `src/wow/protocol/chat.test.ts`:

```typescript
import {
  // ...existing imports...
  buildJoinChannel,
  buildLeaveChannel,
} from "wow/protocol/chat";

describe("buildJoinChannel", () => {
  test("builds join packet without password", () => {
    const body = buildJoinChannel("General");
    const r = new PacketReader(body);
    expect(r.uint32LE()).toBe(0);
    expect(r.uint8()).toBe(0);
    expect(r.uint8()).toBe(0);
    expect(r.cString()).toBe("General");
    expect(r.cString()).toBe("");
  });

  test("builds join packet with password", () => {
    const body = buildJoinChannel("Secret", "hunter2");
    const r = new PacketReader(body);
    expect(r.uint32LE()).toBe(0);
    expect(r.uint8()).toBe(0);
    expect(r.uint8()).toBe(0);
    expect(r.cString()).toBe("Secret");
    expect(r.cString()).toBe("hunter2");
  });
});

describe("buildLeaveChannel", () => {
  test("builds leave packet", () => {
    const body = buildLeaveChannel("General");
    const r = new PacketReader(body);
    expect(r.uint32LE()).toBe(0);
    expect(r.cString()).toBe("General");
  });
});
```

Add to the existing `parseChannelNotify` describe block:

```typescript
test("parses WRONG_PASSWORD", () => {
  const w = new PacketWriter();
  w.uint8(ChannelNotify.WRONG_PASSWORD);
  w.cString("Secret");

  const result = parseChannelNotify(new PacketReader(w.finish()));
  expect(result).toEqual({
    type: "error",
    channel: "Secret",
    code: ChannelNotify.WRONG_PASSWORD,
    message: "Wrong password for Secret",
  });
});

test("parses NOT_MEMBER", () => {
  const w = new PacketWriter();
  w.uint8(ChannelNotify.NOT_MEMBER);
  w.cString("Trade");

  const result = parseChannelNotify(new PacketReader(w.finish()));
  expect(result).toEqual({
    type: "error",
    channel: "Trade",
    code: ChannelNotify.NOT_MEMBER,
    message: "Not on channel Trade",
  });
});

test("parses BANNED", () => {
  const w = new PacketWriter();
  w.uint8(ChannelNotify.BANNED);
  w.cString("Trade");

  const result = parseChannelNotify(new PacketReader(w.finish()));
  expect(result).toEqual({
    type: "error",
    channel: "Trade",
    code: ChannelNotify.BANNED,
    message: "You are banned from Trade",
  });
});

test("parses MUTED", () => {
  const w = new PacketWriter();
  w.uint8(ChannelNotify.MUTED);
  w.cString("General");

  const result = parseChannelNotify(new PacketReader(w.finish()));
  expect(result).toEqual({
    type: "error",
    channel: "General",
    code: ChannelNotify.MUTED,
    message: "You do not have permission to speak in General",
  });
});

test("parses ALREADY_MEMBER", () => {
  const w = new PacketWriter();
  w.uint8(ChannelNotify.ALREADY_MEMBER);
  w.cString("General");

  const result = parseChannelNotify(new PacketReader(w.finish()));
  expect(result).toEqual({
    type: "error",
    channel: "General",
    code: ChannelNotify.ALREADY_MEMBER,
    message: "You are already in General",
  });
});

test("parses INVALID_NAME", () => {
  const w = new PacketWriter();
  w.uint8(ChannelNotify.INVALID_NAME);
  w.cString("");

  const result = parseChannelNotify(new PacketReader(w.finish()));
  expect(result).toEqual({
    type: "error",
    channel: "",
    code: ChannelNotify.INVALID_NAME,
    message: "Invalid channel name",
  });
});

test("parses THROTTLED", () => {
  const w = new PacketWriter();
  w.uint8(ChannelNotify.THROTTLED);
  w.cString("General");

  const result = parseChannelNotify(new PacketReader(w.finish()));
  expect(result).toEqual({
    type: "error",
    channel: "General",
    code: ChannelNotify.THROTTLED,
    message: "Channel message throttled in General",
  });
});

test("parses WRONG_FACTION", () => {
  const w = new PacketWriter();
  w.uint8(ChannelNotify.WRONG_FACTION);
  w.cString("General");

  const result = parseChannelNotify(new PacketReader(w.finish()));
  expect(result).toEqual({
    type: "error",
    channel: "General",
    code: ChannelNotify.WRONG_FACTION,
    message: "Wrong faction for General",
  });
});

test("parses NOT_IN_AREA", () => {
  const w = new PacketWriter();
  w.uint8(ChannelNotify.NOT_IN_AREA);
  w.cString("LocalDefense");

  const result = parseChannelNotify(new PacketReader(w.finish()));
  expect(result).toEqual({
    type: "error",
    channel: "LocalDefense",
    code: ChannelNotify.NOT_IN_AREA,
    message: "You are not in the correct area for LocalDefense",
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `mise test src/wow/protocol/chat.test.ts`
Expected: FAIL — `buildJoinChannel`, `buildLeaveChannel` not exported; new `ChannelNotify` constants don't exist

**Step 3: Expand `ChannelNotify` enum in opcodes.ts**

In `src/wow/protocol/opcodes.ts`, replace the `ChannelNotify` const:

```typescript
export const ChannelNotify = {
  YOU_JOINED: 0x02,
  YOU_LEFT: 0x03,
  WRONG_PASSWORD: 0x04,
  NOT_MEMBER: 0x05,
  MUTED: 0x11,
  BANNED: 0x13,
  ALREADY_MEMBER: 0x17,
  WRONG_FACTION: 0x1a,
  INVALID_NAME: 0x1b,
  THROTTLED: 0x1f,
  NOT_IN_AREA: 0x20,
} as const;
```

**Step 4: Expand `ChannelNotifyEvent` and add builders/parser in chat.ts**

In `src/wow/protocol/chat.ts`, replace the `ChannelNotifyEvent` type and `parseChannelNotify` function, and add the two builders:

```typescript
export type ChannelNotifyEvent =
  | { type: "joined"; channel: string }
  | { type: "left"; channel: string }
  | { type: "error"; channel: string; code: number; message: string }
  | { type: "other" };

const CHANNEL_NOTIFY_MESSAGES: Record<number, (ch: string) => string> = {
  [ChannelNotify.WRONG_PASSWORD]: (ch) => `Wrong password for ${ch}`,
  [ChannelNotify.NOT_MEMBER]: (ch) => `Not on channel ${ch}`,
  [ChannelNotify.MUTED]: (ch) => `You do not have permission to speak in ${ch}`,
  [ChannelNotify.BANNED]: (ch) => `You are banned from ${ch}`,
  [ChannelNotify.ALREADY_MEMBER]: (ch) => `You are already in ${ch}`,
  [ChannelNotify.WRONG_FACTION]: (ch) => `Wrong faction for ${ch}`,
  [ChannelNotify.INVALID_NAME]: () => "Invalid channel name",
  [ChannelNotify.THROTTLED]: (ch) => `Channel message throttled in ${ch}`,
  [ChannelNotify.NOT_IN_AREA]: (ch) =>
    `You are not in the correct area for ${ch}`,
};

export function parseChannelNotify(r: PacketReader): ChannelNotifyEvent {
  const notifyType = r.uint8();
  const channel = r.cString();

  if (notifyType === ChannelNotify.YOU_JOINED) {
    r.uint8();
    r.uint32LE();
    r.uint32LE();
    return { type: "joined", channel };
  }

  if (notifyType === ChannelNotify.YOU_LEFT) {
    r.uint32LE();
    r.uint8();
    return { type: "left", channel };
  }

  const fmt = CHANNEL_NOTIFY_MESSAGES[notifyType];
  if (fmt) {
    return { type: "error", channel, code: notifyType, message: fmt(channel) };
  }

  return { type: "other" };
}

export function buildJoinChannel(name: string, password?: string): Uint8Array {
  const w = new PacketWriter();
  w.uint32LE(0);
  w.uint8(0);
  w.uint8(0);
  w.cString(name);
  w.cString(password ?? "");
  return w.finish();
}

export function buildLeaveChannel(name: string): Uint8Array {
  const w = new PacketWriter();
  w.uint32LE(0);
  w.cString(name);
  return w.finish();
}
```

**Step 5: Run tests to verify they pass**

Run: `mise test src/wow/protocol/chat.test.ts`
Expected: PASS

**Step 6: Commit**

```
feat: Add channel join/leave packet builders

Add buildJoinChannel and buildLeaveChannel for CMSG_JOIN_CHANNEL
and CMSG_LEAVE_CHANNEL. Expand ChannelNotify enum and parser to
surface error codes (wrong password, banned, muted, etc.).
```

---

### Task 2: Surface Channel Notify Events to the User

**Files:**

- Modify: `src/wow/world-handlers.ts:175-183` (expand `handleChannelNotify`)
- Test: `src/wow/world-handlers.test.ts`

**Step 1: Write failing tests for `handleChannelNotify` emitting system messages**

Add to the `handleChannelNotify` test area in `src/wow/world-handlers.test.ts`. These tests use the mock world server's `inject` method to push an SMSG_CHANNEL_NOTIFY and verify the user sees a system message via `onMessage`:

```typescript
test("channel join emits system message", async () => {
  const ws = await startMockWorldServer();
  try {
    const handle = await worldSession(
      { ...base, host: "127.0.0.1", port: ws.port },
      fakeAuth(ws.port),
    );
    await waitForEchoProbe(handle);

    const messages: ChatMessage[] = [];
    handle.onMessage((msg) => messages.push(msg));

    const w = new PacketWriter();
    w.uint8(ChannelNotify.YOU_JOINED);
    w.cString("MyChannel");
    w.uint8(0);
    w.uint32LE(5);
    w.uint32LE(0);
    ws.inject(GameOpcode.SMSG_CHANNEL_NOTIFY, w.finish());

    await waitForEchoProbe(handle);
    expect(messages.some((m) => m.message.includes("MyChannel"))).toBe(true);
    expect(handle.getChannel(3)).toBe("MyChannel");

    handle.close();
    await handle.closed;
  } finally {
    ws.stop();
  }
});

test("channel notify error emits system message", async () => {
  const ws = await startMockWorldServer();
  try {
    const handle = await worldSession(
      { ...base, host: "127.0.0.1", port: ws.port },
      fakeAuth(ws.port),
    );
    await waitForEchoProbe(handle);

    const messages: ChatMessage[] = [];
    handle.onMessage((msg) => messages.push(msg));

    const w = new PacketWriter();
    w.uint8(ChannelNotify.WRONG_PASSWORD);
    w.cString("Secret");
    ws.inject(GameOpcode.SMSG_CHANNEL_NOTIFY, w.finish());

    await waitForEchoProbe(handle);
    expect(
      messages.some((m) => m.message === "Wrong password for Secret"),
    ).toBe(true);

    handle.close();
    await handle.closed;
  } finally {
    ws.stop();
  }
});
```

**Step 2: Run tests to verify they fail**

Run: `mise test src/wow/world-handlers.test.ts`
Expected: FAIL — `handleChannelNotify` doesn't emit system messages yet

**Step 3: Expand `handleChannelNotify` to emit system messages**

In `src/wow/world-handlers.ts`, replace the `handleChannelNotify` function:

```typescript
export function handleChannelNotify(conn: WorldConn, r: PacketReader): void {
  const event = parseChannelNotify(r);
  if (event.type === "joined") {
    conn.channels.push(event.channel);
    conn.onMessage?.({
      type: ChatType.SYSTEM,
      sender: "",
      message: `Joined channel: ${event.channel}`,
    });
  } else if (event.type === "left") {
    const idx = conn.channels.indexOf(event.channel);
    if (idx !== -1) conn.channels.splice(idx, 1);
    conn.onMessage?.({
      type: ChatType.SYSTEM,
      sender: "",
      message: `Left channel: ${event.channel}`,
    });
  } else if (event.type === "error") {
    conn.onMessage?.({
      type: ChatType.SYSTEM,
      sender: "",
      message: event.message,
    });
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `mise test src/wow/world-handlers.test.ts`
Expected: PASS

**Step 5: Commit**

```
feat: Surface channel notify events to user

handleChannelNotify now emits system messages for join, leave,
and error notifications so the user sees feedback.
```

---

### Task 3: WorldHandle Methods and Mock Updates

**Files:**

- Modify: `src/wow/client.ts:148-190` (add `joinChannel`/`leaveChannel` to `WorldHandle` type)
- Modify: `src/wow/client.ts` (add implementations in `worldSession` handle object, near line 586-601)
- Modify: `src/test/mock-handle.ts` (add mock methods)
- Modify: `src/daemon/start.test.ts` (add to inline mock)

**Step 1: Add `joinChannel` and `leaveChannel` to `WorldHandle` type**

In `src/wow/client.ts`, after `leaveGroup(): void;` (line 173):

```typescript
  joinChannel(name: string, password?: string): void;
  leaveChannel(name: string): void;
```

Add `buildJoinChannel` and `buildLeaveChannel` to the imports from `"wow/protocol/chat"`.

**Step 2: Add implementations in `worldSession`**

In `src/wow/client.ts`, after the `leaveGroup()` implementation (around line 601):

```typescript
        joinChannel(name, password) {
          sendPacket(
            conn,
            GameOpcode.CMSG_JOIN_CHANNEL,
            buildJoinChannel(name, password),
          );
        },
        leaveChannel(name) {
          sendPacket(
            conn,
            GameOpcode.CMSG_LEAVE_CHANNEL,
            buildLeaveChannel(name),
          );
        },
```

**Step 3: Add mock methods to `src/test/mock-handle.ts`**

After `leaveGroup: jest.fn(),` (line 56):

```typescript
    joinChannel: jest.fn(),
    leaveChannel: jest.fn(),
```

**Step 4: Add to inline mock in `src/daemon/start.test.ts`**

After `leaveGroup: jest.fn(),` (line 66):

```typescript
        joinChannel: jest.fn(),
        leaveChannel: jest.fn(),
```

**Step 5: Run full test suite to verify no type errors or regressions**

Run: `mise test`
Expected: PASS

**Step 6: Commit**

```
feat: Add joinChannel/leaveChannel to WorldHandle

Fire-and-forget methods that send CMSG_JOIN_CHANNEL and
CMSG_LEAVE_CHANNEL. Updates both mocks per CLAUDE.md.
```

---

### Task 4: Command Parsing

**Files:**

- Modify: `src/ui/commands.ts` (add command types, update `/join` and `/leave` parsing)
- Test: `src/ui/commands.test.ts`

**Step 1: Write failing tests**

Update existing tests and add new ones in `src/ui/commands.test.ts`:

```typescript
test("/join parses channel name", () => {
  expect(parseCommand("/join Trade")).toEqual({
    type: "join-channel",
    channel: "Trade",
  });
});

test("/join parses channel name with password", () => {
  expect(parseCommand("/join Secret hunter2")).toEqual({
    type: "join-channel",
    channel: "Secret",
    password: "hunter2",
  });
});

test("/join with no argument sends say", () => {
  expect(parseCommand("/join")).toEqual({ type: "say", message: "/join" });
});

test("/leave with no argument leaves party", () => {
  expect(parseCommand("/leave")).toEqual({ type: "leave" });
});

test("/leave with argument leaves channel", () => {
  expect(parseCommand("/leave Trade")).toEqual({
    type: "leave-channel",
    channel: "Trade",
  });
});
```

Remove or update the existing `/join returns unimplemented` test.

**Step 2: Run tests to verify they fail**

Run: `mise test src/ui/commands.test.ts`
Expected: FAIL — new command types don't exist

**Step 3: Implement command parsing changes**

In `src/ui/commands.ts`:

Add to the `Command` union type (after `{ type: "leave" }`):

```typescript
  | { type: "join-channel"; channel: string; password?: string }
  | { type: "leave-channel"; channel: string }
```

Replace the `/leave` case (line 77-78):

```typescript
    case "/leave":
      if (rest) return { type: "leave-channel", channel: rest.split(" ")[0]! };
      return { type: "leave" };
```

Replace the `/join` case (line 117-118):

```typescript
    case "/join": {
      if (!rest) return { type: "say", message: input };
      const parts = rest.split(" ");
      const channel = parts[0]!;
      const password = parts[1];
      return password
        ? { type: "join-channel", channel, password }
        : { type: "join-channel", channel };
    }
```

**Step 4: Run tests to verify they pass**

Run: `mise test src/ui/commands.test.ts`
Expected: PASS

**Step 5: Commit**

```
feat: Parse /join and /leave channel commands

/join <channel> [password] sends join-channel. /leave with an
argument sends leave-channel; without args it still leaves party.
```

---

### Task 5: IPC Command Parsing and Dispatch

**Files:**

- Modify: `src/daemon/commands.ts` (add IPC types, update parsing and dispatch)
- Test: `src/daemon/commands.test.ts`

**Step 1: Write failing tests**

Add to `src/daemon/commands.test.ts` parse tests:

```typescript
test("JOIN parses channel", () => {
  expect(parseIpcCommand("JOIN Trade")).toEqual({
    type: "join_channel",
    channel: "Trade",
  });
});

test("JOIN parses channel with password", () => {
  expect(parseIpcCommand("JOIN Secret hunter2")).toEqual({
    type: "join_channel",
    channel: "Secret",
    password: "hunter2",
  });
});

test("JOIN with no channel returns undefined", () => {
  expect(parseIpcCommand("JOIN")).toBeUndefined();
});

test("LEAVE with channel parses leave_channel", () => {
  expect(parseIpcCommand("LEAVE Trade")).toEqual({
    type: "leave_channel",
    channel: "Trade",
  });
});

test("LEAVE without channel parses leave", () => {
  expect(parseIpcCommand("LEAVE")).toEqual({ type: "leave" });
});

test("slash /join maps to join_channel", () => {
  expect(parseIpcCommand("/join Trade")).toEqual({
    type: "join_channel",
    channel: "Trade",
  });
});

test("slash /leave channel maps to leave_channel", () => {
  expect(parseIpcCommand("/leave Trade")).toEqual({
    type: "leave_channel",
    channel: "Trade",
  });
});
```

Add dispatch tests:

```typescript
test("join_channel calls handle.joinChannel and writes OK", async () => {
  const handle = createMockHandle();
  const events = new RingBuffer<EventEntry>(10);
  const socket = createMockSocket();
  const cleanup = jest.fn();

  await dispatchCommand(
    { type: "join_channel", channel: "Trade" },
    handle,
    events,
    socket,
    cleanup,
  );

  expect(handle.joinChannel).toHaveBeenCalledWith("Trade", undefined);
  expect(socket.written()).toBe("OK\n\n");
});

test("join_channel with password passes it through", async () => {
  const handle = createMockHandle();
  const events = new RingBuffer<EventEntry>(10);
  const socket = createMockSocket();
  const cleanup = jest.fn();

  await dispatchCommand(
    { type: "join_channel", channel: "Secret", password: "hunter2" },
    handle,
    events,
    socket,
    cleanup,
  );

  expect(handle.joinChannel).toHaveBeenCalledWith("Secret", "hunter2");
  expect(socket.written()).toBe("OK\n\n");
});

test("leave_channel calls handle.leaveChannel and writes OK", async () => {
  const handle = createMockHandle();
  const events = new RingBuffer<EventEntry>(10);
  const socket = createMockSocket();
  const cleanup = jest.fn();

  await dispatchCommand(
    { type: "leave_channel", channel: "Trade" },
    handle,
    events,
    socket,
    cleanup,
  );

  expect(handle.leaveChannel).toHaveBeenCalledWith("Trade");
  expect(socket.written()).toBe("OK\n\n");
});
```

Update existing unimplemented tests: remove `"JOIN Trade"` from the unimplemented cases array, and remove the `"slash /join maps to unimplemented"` test.

**Step 2: Run tests to verify they fail**

Run: `mise test src/daemon/commands.test.ts`
Expected: FAIL — new IPC types don't exist

**Step 3: Implement IPC command changes**

In `src/daemon/commands.ts`:

Add to `IpcCommand` union (after `{ type: "leave" }`):

```typescript
  | { type: "join_channel"; channel: string; password?: string }
  | { type: "leave_channel"; channel: string }
```

In `parseIpcCommand`, slash prefix section — add cases for the new command types from `parseCommand`. After the existing `case "leave":` (line 96), add:

```typescript
      case "join-channel":
        return parsed.password
          ? { type: "join_channel", channel: parsed.channel, password: parsed.password }
          : { type: "join_channel", channel: parsed.channel };
      case "leave-channel":
        return { type: "leave_channel", channel: parsed.channel };
```

In the uppercase verb section, replace the `"LEAVE"` case (line 181-182):

```typescript
    case "LEAVE":
      if (rest) {
        const channel = rest.split(" ")[0]!;
        return { type: "leave_channel", channel };
      }
      return { type: "leave" };
```

Replace the `"JOIN"` case (line 209-210):

```typescript
    case "JOIN": {
      if (!rest) return undefined;
      const parts = rest.split(" ");
      const channel = parts[0]!;
      const password = parts[1];
      return password
        ? { type: "join_channel", channel, password }
        : { type: "join_channel", channel };
    }
```

In `dispatchCommand`, add cases before the `"unimplemented"` case:

```typescript
    case "join_channel":
      handle.joinChannel(cmd.channel, cmd.password);
      writeLines(socket, ["OK"]);
      return false;
    case "leave_channel":
      handle.leaveChannel(cmd.channel);
      writeLines(socket, ["OK"]);
      return false;
```

**Step 4: Run tests to verify they pass**

Run: `mise test src/daemon/commands.test.ts`
Expected: PASS

**Step 5: Commit**

```
feat: Wire channel join/leave through IPC dispatch

JOIN/LEAVE verbs and /join /leave slash commands dispatch to
handle.joinChannel() and handle.leaveChannel().
```

---

### Task 6: TUI Command Execution

**Files:**

- Modify: `src/ui/tui.ts:23-149` (add cases to `executeCommand`)

**Step 1: Add `join-channel` and `leave-channel` cases to `executeCommand`**

In `src/ui/tui.ts`, after the `case "leave":` block (line 90-92):

```typescript
    case "join-channel":
      state.handle.joinChannel(cmd.channel, cmd.password);
      break;
    case "leave-channel":
      state.handle.leaveChannel(cmd.channel);
      break;
```

**Step 2: Run full test suite**

Run: `mise test`
Expected: PASS (no compile errors — TypeScript will enforce exhaustive switch via the `Command` union)

**Step 3: Commit**

```
feat: Handle /join and /leave in interactive TUI

Adds join-channel and leave-channel cases to executeCommand so
the interactive TUI dispatches to the new WorldHandle methods.
```

---

### Task 7: Integration Test — Join/Leave Round-trip

**Files:**

- Test: `src/wow/world-handlers.test.ts`

This verifies the full flow: client sends CMSG_JOIN_CHANNEL, server responds with SMSG_CHANNEL_NOTIFY YOU_JOINED, channel appears in the list, and the user sees a system message.

**Step 1: Write integration test**

Add to `src/wow/world-handlers.test.ts`:

```typescript
test("joinChannel sends CMSG_JOIN_CHANNEL", async () => {
  const ws = await startMockWorldServer();
  try {
    const handle = await worldSession(
      { ...base, host: "127.0.0.1", port: ws.port },
      fakeAuth(ws.port),
    );
    await waitForEchoProbe(handle);

    handle.joinChannel("MyCustom", "pass123");

    const captured = await ws.waitForCapture(
      (p) => p.opcode === GameOpcode.CMSG_JOIN_CHANNEL,
    );
    const r = new PacketReader(captured.body);
    expect(r.uint32LE()).toBe(0);
    expect(r.uint8()).toBe(0);
    expect(r.uint8()).toBe(0);
    expect(r.cString()).toBe("MyCustom");
    expect(r.cString()).toBe("pass123");

    handle.close();
    await handle.closed;
  } finally {
    ws.stop();
  }
});

test("leaveChannel sends CMSG_LEAVE_CHANNEL", async () => {
  const ws = await startMockWorldServer();
  try {
    const handle = await worldSession(
      { ...base, host: "127.0.0.1", port: ws.port },
      fakeAuth(ws.port),
    );
    await waitForEchoProbe(handle);

    handle.leaveChannel("General");

    const captured = await ws.waitForCapture(
      (p) => p.opcode === GameOpcode.CMSG_LEAVE_CHANNEL,
    );
    const r = new PacketReader(captured.body);
    expect(r.uint32LE()).toBe(0);
    expect(r.cString()).toBe("General");

    handle.close();
    await handle.closed;
  } finally {
    ws.stop();
  }
});
```

**Step 2: Run test**

Run: `mise test src/wow/world-handlers.test.ts`
Expected: PASS

**Step 3: Commit**

```
test: Add channel join/leave integration tests

Verifies CMSG_JOIN_CHANNEL and CMSG_LEAVE_CHANNEL wire format
via the mock world server, plus channel notify round-trip.
```

---

### Task 8: Live Server Verification

**Step 1: Run live tests**

Run: `mise test:live`
Expected: PASS — existing functionality unbroken

**Step 2: Run full CI suite**

Run: `mise ci`
Expected: PASS — typecheck, test, format all green
