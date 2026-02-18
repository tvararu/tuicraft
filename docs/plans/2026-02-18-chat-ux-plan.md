# Chat UX Fixes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add sticky chat mode (TUI + daemon) and strip WoW color codes from messages.

**Architecture:** ChatMode state lives in WorldConn, exposed via WorldHandle. A `sendInCurrentMode` convenience method avoids duplicating dispatch logic. Color stripping is a pure regex function in lib/.

**Tech Stack:** Bun/TypeScript, bun:test, PacketWriter/PacketReader for protocol tests.

**Style:** Follow `/typescript-style` skill. No comments. Strict TypeScript.

---

### Task 1: Color Code Stripping

**Files:**

- Create: `src/lib/strip-colors.ts`
- Create: `src/lib/strip-colors.test.ts`
- Modify: `src/ui/tui.ts:84` (formatMessage) and `src/ui/tui.ts:119` (formatMessageObj)

**Step 1: Write the failing tests**

```ts
// src/lib/strip-colors.test.ts
import { test, expect, describe } from "bun:test";
import { stripColorCodes } from "lib/strip-colors";

describe("stripColorCodes", () => {
  test("returns plain text unchanged", () => {
    expect(stripColorCodes("hello world")).toBe("hello world");
  });

  test("handles empty string", () => {
    expect(stripColorCodes("")).toBe("");
  });

  test("strips color code and reset", () => {
    expect(stripColorCodes("|cFF00FF00Green text|r")).toBe("Green text");
  });

  test("strips multiple color codes", () => {
    expect(stripColorCodes("|cFF00FF00Green|r and |cFFFF0000Red|r")).toBe(
      "Green and Red",
    );
  });

  test("strips item link preserving display text", () => {
    expect(
      stripColorCodes("|cff1eff00|Hitem:19019:0:0:0|h[Thunderfury]|h|r"),
    ).toBe("[Thunderfury]");
  });

  test("strips standalone reset", () => {
    expect(stripColorCodes("before|rafter")).toBe("beforeafter");
  });

  test("strips multiple item links in one string", () => {
    expect(
      stripColorCodes(
        "|cff0070dd|Hitem:1234|h[Blue Sword]|h|r and |cffffffff|Hitem:5678|h[White Shield]|h|r",
      ),
    ).toBe("[Blue Sword] and [White Shield]");
  });

  test("case insensitive hex digits", () => {
    expect(stripColorCodes("|cFFaaBBcc mixed case|r")).toBe(" mixed case");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `mise test src/lib/strip-colors.test.ts`
Expected: FAIL — module "lib/strip-colors" not found

**Step 3: Write implementation**

```ts
// src/lib/strip-colors.ts
const COLOR_PATTERN = /\|c[0-9a-fA-F]{8}|\|r|\|H[^|]*\|h|\|h/g;

export function stripColorCodes(text: string): string {
  return text.replace(COLOR_PATTERN, "");
}
```

**Step 4: Run test to verify it passes**

Run: `mise test src/lib/strip-colors.test.ts`
Expected: PASS — all 8 tests pass

**Step 5: Integrate into formatMessage and formatMessageObj**

In `src/ui/tui.ts`, import `stripColorCodes` and apply to `msg.message` at the
top of both `formatMessage` and `formatMessageObj`:

```ts
// at top of formatMessage:
export function formatMessage(msg: ChatMessage): string {
  const message = stripColorCodes(msg.message);
  // ... use `message` instead of `msg.message` throughout
```

```ts
// at top of formatMessageObj:
export function formatMessageObj(msg: ChatMessage): LogEntry {
  const type = JSON_TYPE_LABELS[msg.type] ?? `TYPE_${msg.type}`;
  const obj: LogEntry = {
    type,
    sender: msg.sender,
    message: stripColorCodes(msg.message),
  };
```

**Step 6: Add formatMessage color stripping test**

Add to the `formatMessage` describe block in `src/ui/tui.test.ts`:

```ts
test("strips color codes from message", () => {
  const msg = {
    type: ChatType.SAY,
    sender: "Alice",
    message: "|cff1eff00|Hitem:1234|h[Cool Sword]|h|r equipped",
  };
  expect(formatMessage(msg)).toBe("[say] Alice: [Cool Sword] equipped");
});
```

**Step 7: Run full test suite**

Run: `mise test`
Expected: All tests pass including new color stripping tests

**Step 8: Commit**

```
Add color code stripping for WoW message formatting

Strip |cAARRGGBB color codes, |r resets, and |H...|h hyperlink
wrappers from chat messages before display. Preserves bracketed
display text from item/spell links.
```

---

### Task 2: ChatMode Type + WorldHandle Sticky Mode

**Files:**

- Modify: `src/wow/client.ts` — add ChatMode type, lastChatMode to WorldConn, new WorldHandle methods
- Modify: `src/test/mock-handle.ts` — add new mock methods
- Modify: `src/test/mock-handle.test.ts` — test new mock methods

**Step 1: Add ChatMode type and WorldHandle methods**

In `src/wow/client.ts`, add the ChatMode type export after the existing type
definitions (after line 61):

```ts
export type ChatMode =
  | { type: "say" }
  | { type: "yell" }
  | { type: "guild" }
  | { type: "party" }
  | { type: "raid" }
  | { type: "whisper"; target: string }
  | { type: "channel"; channel: string };
```

Add `lastChatMode: ChatMode` to the WorldConn type (after `channels: string[]`):

```ts
lastChatMode: ChatMode;
```

Initialize it in the worldSession function where conn is created:

```ts
lastChatMode: { type: "say" },
```

Add three new methods to WorldHandle type (after `who`):

```ts
getLastChatMode(): ChatMode;
setLastChatMode(mode: ChatMode): void;
sendInCurrentMode(message: string): void;
```

**Step 2: Update each send method to set lastChatMode**

In the worldSession resolve block, add mode tracking to each send method. Add
one line at the top of each method body:

```ts
sendSay(message) {
  conn.lastChatMode = { type: "say" };
  sendPacket(/* existing */);
},
sendYell(message) {
  conn.lastChatMode = { type: "yell" };
  sendPacket(/* existing */);
},
sendGuild(message) {
  conn.lastChatMode = { type: "guild" };
  sendPacket(/* existing */);
},
sendParty(message) {
  conn.lastChatMode = { type: "party" };
  sendPacket(/* existing */);
},
sendRaid(message) {
  conn.lastChatMode = { type: "raid" };
  sendPacket(/* existing */);
},
sendWhisper(target, message) {
  conn.lastChatMode = { type: "whisper", target };
  sendPacket(/* existing */);
},
sendChannel(channel, message) {
  conn.lastChatMode = { type: "channel", channel };
  sendPacket(/* existing */);
},
```

**Step 3: Implement the three new WorldHandle methods**

Add to the handle object returned in worldSession resolve:

```ts
getLastChatMode() {
  return conn.lastChatMode;
},
setLastChatMode(mode) {
  conn.lastChatMode = mode;
},
sendInCurrentMode(message) {
  const mode = conn.lastChatMode;
  switch (mode.type) {
    case "say":
      handle.sendSay(message);
      break;
    case "yell":
      handle.sendYell(message);
      break;
    case "guild":
      handle.sendGuild(message);
      break;
    case "party":
      handle.sendParty(message);
      break;
    case "raid":
      handle.sendRaid(message);
      break;
    case "whisper":
      handle.sendWhisper(mode.target, message);
      break;
    case "channel":
      handle.sendChannel(mode.channel, message);
      break;
  }
},
```

Note: `handle` references the object being constructed. Assign to a `const`
before the `resolve()` call so the self-reference works:

```ts
const handle: WorldHandle = {
  /* ... */
};
resolve(handle);
```

**Step 4: Update mock-handle**

In `src/test/mock-handle.ts`, add new methods and update the return type:

```ts
import type { WorldHandle, ChatMessage, ChatMode } from "wow/client";

export function createMockHandle(): WorldHandle & {
  triggerMessage(msg: ChatMessage): void;
  resolveClosed(): void;
} {
  let messageCb: ((msg: ChatMessage) => void) | undefined;
  let closeResolve: () => void;
  const closed = new Promise<void>((r) => {
    closeResolve = r;
  });
  let lastChatMode: ChatMode = { type: "say" };

  return {
    closed,
    close: jest.fn(() => closeResolve()),
    onMessage(cb) {
      messageCb = cb;
    },
    sendWhisper: jest.fn(),
    sendSay: jest.fn(),
    sendYell: jest.fn(),
    sendGuild: jest.fn(),
    sendParty: jest.fn(),
    sendRaid: jest.fn(),
    sendChannel: jest.fn(),
    getChannel: jest.fn(),
    who: jest.fn(async () => []),
    getLastChatMode: jest.fn(() => lastChatMode),
    setLastChatMode: jest.fn((mode: ChatMode) => {
      lastChatMode = mode;
    }),
    sendInCurrentMode: jest.fn(),
    triggerMessage(msg) {
      messageCb?.(msg);
    },
    resolveClosed() {
      closeResolve();
    },
  };
}
```

**Step 5: Add mock-handle tests for new methods**

Add to `src/test/mock-handle.test.ts`:

```ts
test("getLastChatMode defaults to say", () => {
  const handle = createMockHandle();
  expect(handle.getLastChatMode()).toEqual({ type: "say" });
});

test("setLastChatMode updates getLastChatMode", () => {
  const handle = createMockHandle();
  handle.setLastChatMode({ type: "whisper", target: "Xiara" });
  expect(handle.getLastChatMode()).toEqual({
    type: "whisper",
    target: "Xiara",
  });
});
```

**Step 6: Run full test suite**

Run: `mise test`
Expected: All tests pass

**Step 7: Commit**

```
Add ChatMode type and sticky mode tracking to WorldHandle

Each send method now records its chat mode in WorldConn. New
getLastChatMode, setLastChatMode, and sendInCurrentMode methods
on WorldHandle let the TUI and daemon dispatch bare text using
the last-used mode.
```

---

### Task 3: TUI Sticky Mode + Dynamic Prompt

**Files:**

- Modify: `src/ui/tui.ts` — new "chat" Command type, parseCommand change, executeCommand change, dynamic prompt
- Modify: `src/ui/tui.test.ts` — update existing tests, add new tests

**Step 1: Write failing tests for new "chat" command type**

Update existing tests and add new ones in `src/ui/tui.test.ts`:

Update the existing "bare text becomes say" test:

```ts
test("bare text becomes chat", () => {
  expect(parseCommand("hello")).toEqual({ type: "chat", message: "hello" });
});
```

Update "empty string becomes say with empty message":

```ts
test("empty string becomes chat with empty message", () => {
  expect(parseCommand("")).toEqual({ type: "chat", message: "" });
});
```

The "unknown slash command becomes say" test stays as-is — unknown `/commands`
still fall through to say, not chat (preserves the `/emote` test behavior until
Branch C adds emote handling).

Add new startTui tests:

```ts
test("bare text sends via sticky mode", async () => {
  const handle = createMockHandle();
  const input = new PassThrough();

  const done = startTui(handle, false, { input, write: () => {} });
  writeLine(input, "hello");
  await flush();

  expect(handle.sendInCurrentMode).toHaveBeenCalledWith("hello");

  input.end();
  await done;
});

test("/say explicitly sends say and not sendInCurrentMode", async () => {
  const handle = createMockHandle();
  const input = new PassThrough();

  const done = startTui(handle, false, { input, write: () => {} });
  writeLine(input, "/say hello");
  await flush();

  expect(handle.sendSay).toHaveBeenCalledWith("hello");
  expect(handle.sendInCurrentMode).not.toHaveBeenCalled();

  input.end();
  await done;
});
```

**Step 2: Run tests to verify they fail**

Run: `mise test src/ui/tui.test.ts`
Expected: FAIL — "chat" type doesn't exist yet, sendInCurrentMode not called

**Step 3: Implement Command type and parseCommand change**

In `src/ui/tui.ts`, add to the Command union:

```ts
| { type: "chat"; message: string }
```

Change the first line of parseCommand:

```ts
if (!input.startsWith("/")) return { type: "chat", message: input };
```

**Step 4: Implement executeCommand "chat" case**

Add the "chat" case to executeCommand's switch:

```ts
case "chat":
  state.handle.sendInCurrentMode(cmd.message);
  break;
```

**Step 5: Update the existing "dispatches say command" startTui test**

The old test sends bare text "hello" and expects `handle.sendSay`. Now bare text
goes through `sendInCurrentMode`. Either update the test expectation or check
that the test you wrote in Step 1 covers this. Remove or update the old test:

```ts
test("dispatches say command via /say", async () => {
  const handle = createMockHandle();
  const input = new PassThrough();
  const output: string[] = [];

  const done = startTui(handle, false, {
    input,
    write: (s) => void output.push(s),
  });
  writeLine(input, "/say hello");
  await flush();

  expect(handle.sendSay).toHaveBeenCalledWith("hello");

  input.end();
  await done;
});
```

**Step 6: Add formatPrompt and dynamic prompt to startTui**

Add a helper function in `src/ui/tui.ts`:

```ts
export function formatPrompt(mode: ChatMode): string {
  switch (mode.type) {
    case "whisper":
      return `[whisper: ${mode.target}] > `;
    case "channel":
      return `[${mode.channel}] > `;
    default:
      return `[${mode.type}] > `;
  }
}
```

In `startTui`, import `ChatMode` and update the prompt logic. After each command
execution and after incoming messages, refresh the prompt:

```ts
// In the rl.on("line") handler, after executeCommand:
if (interactive) {
  rl.setPrompt(formatPrompt(handle.getLastChatMode()));
  rl.prompt();
}
```

Replace the initial prompt:

```ts
if (interactive) {
  rl.setPrompt(formatPrompt(handle.getLastChatMode()));
  rl.prompt();
}
```

**Step 7: Add formatPrompt tests**

```ts
import { formatPrompt } from "ui/tui";

describe("formatPrompt", () => {
  test("say mode", () => {
    expect(formatPrompt({ type: "say" })).toBe("[say] > ");
  });

  test("party mode", () => {
    expect(formatPrompt({ type: "party" })).toBe("[party] > ");
  });

  test("whisper mode includes target", () => {
    expect(formatPrompt({ type: "whisper", target: "Xiara" })).toBe(
      "[whisper: Xiara] > ",
    );
  });

  test("channel mode includes channel name", () => {
    expect(formatPrompt({ type: "channel", channel: "General" })).toBe(
      "[General] > ",
    );
  });
});
```

**Step 8: Run full test suite**

Run: `mise test`
Expected: All tests pass

**Step 9: Commit**

```
Add sticky chat mode to interactive TUI

Bare text now sends using the last-used chat mode instead of
always defaulting to say. The readline prompt updates dynamically
to show the current mode ([say], [party], [whisper: Xiara], etc).
```

---

### Task 4: Daemon Sticky Mode

**Files:**

- Modify: `src/daemon/commands.ts` — add "chat" IpcCommand, update parseIpcCommand default, add dispatchCommand handler
- Modify: `src/daemon/commands.test.ts` — update existing tests, add new tests
- Modify: `src/daemon/server.ts` — no changes needed (parseIpcCommand returning a command instead of undefined handles it)

**Step 1: Write failing tests**

Add to the parseIpcCommand describe in `src/daemon/commands.test.ts`:

```ts
test("unrecognized text becomes chat command", () => {
  expect(parseIpcCommand("hello world")).toEqual({
    type: "chat",
    message: "hello world",
  });
});

test("single word becomes chat command", () => {
  expect(parseIpcCommand("hello")).toEqual({
    type: "chat",
    message: "hello",
  });
});

test("empty string returns undefined", () => {
  expect(parseIpcCommand("")).toBeUndefined();
});
```

Update the existing test "unknown command returns undefined":

```ts
test("unrecognized verb becomes chat", () => {
  expect(parseIpcCommand("DANCE")).toEqual({
    type: "chat",
    message: "DANCE",
  });
});
```

Add dispatchCommand tests:

```ts
test("chat sends via sendInCurrentMode and responds with mode", async () => {
  const handle = createMockHandle();
  (handle.getLastChatMode as ReturnType<typeof jest.fn>).mockReturnValue({
    type: "say",
  });
  const events = new RingBuffer<EventEntry>(10);
  const socket = createMockSocket();
  const cleanup = jest.fn();

  const result = await dispatchCommand(
    { type: "chat", message: "hello" },
    handle,
    events,
    socket,
    cleanup,
  );

  expect(result).toBe(false);
  expect(handle.sendInCurrentMode).toHaveBeenCalledWith("hello");
  expect(socket.written()).toBe("OK SAY\n\n");
});

test("chat mode label includes whisper target", async () => {
  const handle = createMockHandle();
  (handle.getLastChatMode as ReturnType<typeof jest.fn>).mockReturnValue({
    type: "whisper",
    target: "Xiara",
  });
  const events = new RingBuffer<EventEntry>(10);
  const socket = createMockSocket();
  const cleanup = jest.fn();

  await dispatchCommand(
    { type: "chat", message: "follow me" },
    handle,
    events,
    socket,
    cleanup,
  );

  expect(socket.written()).toBe("OK WHISPER Xiara\n\n");
});

test("chat mode label includes channel name", async () => {
  const handle = createMockHandle();
  (handle.getLastChatMode as ReturnType<typeof jest.fn>).mockReturnValue({
    type: "channel",
    channel: "General",
  });
  const events = new RingBuffer<EventEntry>(10);
  const socket = createMockSocket();
  const cleanup = jest.fn();

  await dispatchCommand(
    { type: "chat", message: "hello general" },
    handle,
    events,
    socket,
    cleanup,
  );

  expect(socket.written()).toBe("OK CHANNEL General\n\n");
});
```

**Step 2: Run tests to verify they fail**

Run: `mise test src/daemon/commands.test.ts`
Expected: FAIL — "chat" type doesn't exist yet

**Step 3: Implement parseIpcCommand change**

Add to IpcCommand union:

```ts
| { type: "chat"; message: string }
```

Change the default case in parseIpcCommand:

```ts
default:
  return line ? { type: "chat", message: line } : undefined;
```

**Step 4: Implement dispatchCommand "chat" case**

Add the chat case to the switch in dispatchCommand. Also need to import ChatMode:

```ts
case "chat": {
  handle.sendInCurrentMode(cmd.message);
  const mode = handle.getLastChatMode();
  const label =
    mode.type === "whisper"
      ? `WHISPER ${mode.target}`
      : mode.type === "channel"
        ? `CHANNEL ${mode.channel}`
        : mode.type.toUpperCase();
  writeLines(socket, [`OK ${label}`]);
  return false;
}
```

**Step 5: Update IPC round-trip test for bare text**

The existing test "unknown command returns ERR" needs updating. With bare text
fallback, "DANCE" becomes a chat command, not an error. Update:

```ts
test("bare text sends via sticky mode", async () => {
  startTestServer();
  const lines = await sendToSocket("hello world", sockPath);
  expect(lines[0]).toMatch(/^OK /);
  expect(handle.sendInCurrentMode).toHaveBeenCalledWith("hello world");
});
```

Keep an ERR test for genuinely malformed commands:

```ts
test("READ_WAIT with bad args returns ERR", async () => {
  startTestServer();
  const lines = await sendToSocket("READ_WAIT abc", sockPath);
  expect(lines).toEqual(["ERR unknown command"]);
});
```

**Step 6: Run full test suite**

Run: `mise test`
Expected: All tests pass

**Step 7: Commit**

```
Add sticky chat mode to daemon IPC protocol

Unrecognized IPC lines are now sent as chat messages using the
last-used mode instead of returning ERR. Response includes the
mode label (OK SAY, OK WHISPER Xiara, etc) so the AI agent knows
which mode was used.
```

---

### Task 5: Verification

**Step 1: Run full test suite**

Run: `mise ci`
Expected: typecheck, test, and format all pass

**Step 2: Run live tests**

Run: `MISE_TASK_TIMEOUT=60s mise test:live`
Expected: Live tests pass — existing chat functionality unbroken

**Step 3: Manual TUI test (optional)**

Start the daemon, connect via TUI, verify:

- Bare text sends as say (default mode)
- `/w Xiara test` switches prompt to `[whisper: Xiara] > `
- Bare text after whisper sends as whisper
- `/p test` switches prompt to `[party] > `
- Color codes in incoming messages are stripped
