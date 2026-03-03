# Duel Accept/Decline Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Handle all 6 incoming SMSG*DUEL*\* packets and wire context-aware `/accept` / `/decline` dispatch for duels vs group invites.

**Architecture:** New `src/wow/protocol/duel.ts` for parse/build functions. Six handler functions in `world-handlers.ts` fire `DuelEvent` via a new `onDuelEvent` callback on `WorldConn`. A `pendingRequest` field on `WorldConn` lets `acceptInvite()` / `declineInvite()` route to the correct opcode. Format functions in `commands.ts` handle TUI text (`[duel]` labels) and JSONL output.

**Tech Stack:** TypeScript, Bun test runner, PacketReader/PacketWriter

---

### Task 1: Protocol parse/build functions

**Files:**

- Create: `src/wow/protocol/duel.ts`
- Create: `src/wow/protocol/duel.test.ts`

**Step 1: Write the failing tests**

```typescript
// src/wow/protocol/duel.test.ts
import { test, expect, describe } from "bun:test";
import { PacketWriter, PacketReader } from "wow/protocol/packet";
import {
  parseDuelRequested,
  parseDuelCountdown,
  parseDuelComplete,
  parseDuelWinner,
  buildDuelAccepted,
  buildDuelCancelled,
} from "wow/protocol/duel";

describe("duel protocol", () => {
  test("parseDuelRequested reads initiator and arbiter GUIDs", () => {
    const w = new PacketWriter();
    w.uint64LE(100n);
    w.uint64LE(200n);
    const result = parseDuelRequested(new PacketReader(w.finish()));
    expect(result.initiator).toBe(100n);
    expect(result.arbiter).toBe(200n);
  });

  test("parseDuelCountdown reads time in ms", () => {
    const w = new PacketWriter();
    w.uint32LE(3000);
    const result = parseDuelCountdown(new PacketReader(w.finish()));
    expect(result.timeMs).toBe(3000);
  });

  test("parseDuelComplete reads completed flag", () => {
    const w = new PacketWriter();
    w.uint8(1);
    expect(parseDuelComplete(new PacketReader(w.finish())).completed).toBe(
      true,
    );

    const w2 = new PacketWriter();
    w2.uint8(0);
    expect(parseDuelComplete(new PacketReader(w2.finish())).completed).toBe(
      false,
    );
  });

  test("parseDuelWinner reads reason and names", () => {
    const w = new PacketWriter();
    w.uint8(0);
    w.cString("Loser");
    w.cString("Winner");
    const result = parseDuelWinner(new PacketReader(w.finish()));
    expect(result.reason).toBe("won");
    expect(result.loser).toBe("Loser");
    expect(result.winner).toBe("Winner");
  });

  test("parseDuelWinner with fled reason", () => {
    const w = new PacketWriter();
    w.uint8(1);
    w.cString("Quitter");
    w.cString("Stayer");
    const result = parseDuelWinner(new PacketReader(w.finish()));
    expect(result.reason).toBe("fled");
    expect(result.loser).toBe("Quitter");
    expect(result.winner).toBe("Stayer");
  });

  test("buildDuelAccepted writes arbiter GUID", () => {
    const buf = buildDuelAccepted(42n);
    const r = new PacketReader(buf);
    expect(r.uint64LE()).toBe(42n);
  });

  test("buildDuelCancelled writes arbiter GUID", () => {
    const buf = buildDuelCancelled(99n);
    const r = new PacketReader(buf);
    expect(r.uint64LE()).toBe(99n);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `mise test src/wow/protocol/duel.test.ts`
Expected: FAIL — cannot resolve `"wow/protocol/duel"`

**Step 3: Write minimal implementation**

```typescript
// src/wow/protocol/duel.ts
import { PacketReader, PacketWriter } from "wow/protocol/packet";

export type DuelRequested = {
  initiator: bigint;
  arbiter: bigint;
};

export type DuelCountdown = {
  timeMs: number;
};

export type DuelComplete = {
  completed: boolean;
};

export type DuelWinner = {
  reason: "won" | "fled";
  loser: string;
  winner: string;
};

export function parseDuelRequested(r: PacketReader): DuelRequested {
  return {
    initiator: r.uint64LE(),
    arbiter: r.uint64LE(),
  };
}

export function parseDuelCountdown(r: PacketReader): DuelCountdown {
  return { timeMs: r.uint32LE() };
}

export function parseDuelComplete(r: PacketReader): DuelComplete {
  return { completed: r.uint8() !== 0 };
}

export function parseDuelWinner(r: PacketReader): DuelWinner {
  const reason = r.uint8() === 0 ? "won" : "fled";
  const loser = r.cString();
  const winner = r.cString();
  return { reason, loser, winner } as const;
}

export function buildDuelAccepted(arbiter: bigint): Uint8Array {
  const w = new PacketWriter();
  w.uint64LE(arbiter);
  return w.finish();
}

export function buildDuelCancelled(arbiter: bigint): Uint8Array {
  const w = new PacketWriter();
  w.uint64LE(arbiter);
  return w.finish();
}
```

**Step 4: Run test to verify it passes**

Run: `mise test src/wow/protocol/duel.test.ts`
Expected: PASS — all 7 tests green

**Step 5: Commit**

```
feat: Add duel protocol parse/build functions
```

---

### Task 2: DuelEvent type + WorldConn fields + WorldHandle methods

**Files:**

- Modify: `src/wow/client.ts`

**Step 1: Add DuelEvent type after GroupEvent (around line 138)**

Add after the `GroupEvent` type definition and before the re-exports:

```typescript
export type DuelEvent =
  | { type: "duel_requested"; challenger: string }
  | { type: "duel_countdown"; timeMs: number }
  | { type: "duel_complete"; completed: boolean }
  | {
      type: "duel_winner";
      reason: "won" | "fled";
      winner: string;
      loser: string;
    }
  | { type: "duel_out_of_bounds" }
  | { type: "duel_in_bounds" };
```

**Step 2: Add WorldConn fields (around line 233)**

Add three fields to the `WorldConn` type before the closing `}`:

```typescript
  pendingRequest: "group" | "duel" | null;
  duelArbiter: bigint;
  onDuelEvent?: (event: DuelEvent) => void;
```

**Step 3: Initialize the new fields in the WorldConn constructor**

Find where `WorldConn` is constructed (look for `guildId: 0` assignment around line 340) and add:

```typescript
  pendingRequest: null,
  duelArbiter: 0n,
```

**Step 4: Add WorldHandle methods**

Add to the `WorldHandle` type (around line 201, before the closing `}`):

```typescript
  onDuelEvent(cb: (event: DuelEvent) => void): void;
```

**Step 5: Wire `onDuelEvent` in the handle object**

In the WorldHandle return object (near `onGuildEvent`), add:

```typescript
onDuelEvent(cb) {
  conn.onDuelEvent = cb;
},
```

**Step 6: Make acceptInvite/declineInvite context-aware**

Replace the current `acceptInvite()` (line 662-663) and `declineInvite()` (line 665-666) with:

```typescript
acceptInvite() {
  if (conn.pendingRequest === "duel") {
    sendPacket(
      conn,
      GameOpcode.CMSG_DUEL_ACCEPTED,
      buildDuelAccepted(conn.duelArbiter),
    );
  } else if (conn.pendingRequest === "group") {
    sendPacket(conn, GameOpcode.CMSG_GROUP_ACCEPT, buildGroupAccept());
  } else {
    conn.onMessage?.({
      type: ChatType.SYSTEM,
      sender: "",
      message: "Nothing to accept.",
    });
  }
  conn.pendingRequest = null;
},
declineInvite() {
  if (conn.pendingRequest === "duel") {
    sendPacket(
      conn,
      GameOpcode.CMSG_DUEL_CANCELLED,
      buildDuelCancelled(conn.duelArbiter),
    );
  } else if (conn.pendingRequest === "group") {
    sendPacket(conn, GameOpcode.CMSG_GROUP_DECLINE, buildGroupDecline());
  } else {
    conn.onMessage?.({
      type: ChatType.SYSTEM,
      sender: "",
      message: "Nothing to decline.",
    });
  }
  conn.pendingRequest = null;
},
```

Add the imports at the top of `client.ts`:

```typescript
import { buildDuelAccepted, buildDuelCancelled } from "wow/protocol/duel";
```

**Step 7: Set `pendingRequest = "group"` in the group invite handler**

In `world-handlers.ts`, modify `handleGroupInviteReceived` to also set `conn.pendingRequest = "group"`:

```typescript
export function handleGroupInviteReceived(
  conn: WorldConn,
  r: PacketReader,
): void {
  const invite = parseGroupInvite(r);
  conn.pendingRequest = "group";
  conn.onGroupEvent?.({ type: "invite_received", from: invite.name });
}
```

**Step 8: Run typecheck**

Run: `mise typecheck`
Expected: PASS (may need to update mocks first — see Task 3)

**Step 9: Commit**

```
feat: Add DuelEvent type and context-aware accept
```

---

### Task 3: Update mocks

**Files:**

- Modify: `src/test/mock-handle.ts`
- Modify: `src/daemon/start.test.ts`

**Step 1: Update shared mock in mock-handle.ts**

Add `DuelEvent` to the imports (line 7):

```typescript
import type {
  WorldHandle,
  ChatMessage,
  ChatMode,
  GroupEvent,
  DuelEvent,
} from "wow/client";
```

Add to the mock factory return type (line 13):

```typescript
export function createMockHandle(): WorldHandle & {
  triggerMessage(msg: ChatMessage): void;
  triggerGroupEvent(event: GroupEvent): void;
  triggerDuelEvent(event: DuelEvent): void;
  triggerEntityEvent(event: EntityEvent): void;
  triggerFriendEvent(event: FriendEvent): void;
  triggerIgnoreEvent(event: IgnoreEvent): void;
  triggerGuildEvent(event: GuildEvent): void;
  resolveClosed(): void;
};
```

Add the callback variable (after `groupEventCb` line 23):

```typescript
let duelEventCb: ((event: DuelEvent) => void) | undefined;
```

Add the methods to the return object (after `onGroupEvent`, around line 65):

```typescript
onDuelEvent(cb) {
  duelEventCb = cb;
},
```

Add the trigger (after `triggerGroupEvent`, around line 96):

```typescript
triggerDuelEvent(event) {
  duelEventCb?.(event);
},
```

**Step 2: Update inline mock in start.test.ts**

Add `onDuelEvent: jest.fn(),` after `onGroupEvent: jest.fn(),` (around line 72).

**Step 3: Run typecheck**

Run: `mise typecheck`
Expected: PASS

**Step 4: Commit**

```
chore: Update mocks for DuelEvent
```

---

### Task 4: Handler functions + registration

**Files:**

- Modify: `src/wow/world-handlers.ts`
- Modify: `src/wow/client.ts` (handler registration)
- Modify: `src/wow/protocol/stubs.ts` (remove duel stubs)

**Step 1: Add 6 handler functions to world-handlers.ts**

Add imports at top of `world-handlers.ts`:

```typescript
import {
  parseDuelRequested,
  parseDuelCountdown,
  parseDuelComplete,
  parseDuelWinner,
} from "wow/protocol/duel";
```

Add handler functions (after `handleReceivedMail`, around line 279):

```typescript
export function handleDuelRequested(conn: WorldConn, r: PacketReader): void {
  const duel = parseDuelRequested(r);
  conn.duelArbiter = duel.arbiter;
  conn.pendingRequest = "duel";
  const guidLow = Number(duel.initiator & 0xffffffffn);
  const name = conn.nameCache.get(guidLow) ?? "Unknown";
  conn.onDuelEvent?.({ type: "duel_requested", challenger: name });
}

export function handleDuelCountdown(conn: WorldConn, r: PacketReader): void {
  const { timeMs } = parseDuelCountdown(r);
  conn.onDuelEvent?.({ type: "duel_countdown", timeMs });
}

export function handleDuelComplete(conn: WorldConn, r: PacketReader): void {
  const { completed } = parseDuelComplete(r);
  conn.onDuelEvent?.({ type: "duel_complete", completed });
}

export function handleDuelWinner(conn: WorldConn, r: PacketReader): void {
  const { reason, winner, loser } = parseDuelWinner(r);
  conn.duelArbiter = 0n;
  conn.onDuelEvent?.({ type: "duel_winner", reason, winner, loser });
}

export function handleDuelOutOfBounds(conn: WorldConn): void {
  conn.onDuelEvent?.({ type: "duel_out_of_bounds" });
}

export function handleDuelInBounds(conn: WorldConn): void {
  conn.onDuelEvent?.({ type: "duel_in_bounds" });
}
```

**Step 2: Register handlers in client.ts**

Add after the `SMSG_RECEIVED_MAIL` registration (around line 405):

```typescript
conn.dispatch.on(GameOpcode.SMSG_DUEL_REQUESTED, (r) =>
  handleDuelRequested(conn, r),
);
conn.dispatch.on(GameOpcode.SMSG_DUEL_COUNTDOWN, (r) =>
  handleDuelCountdown(conn, r),
);
conn.dispatch.on(GameOpcode.SMSG_DUEL_COMPLETE, (r) =>
  handleDuelComplete(conn, r),
);
conn.dispatch.on(GameOpcode.SMSG_DUEL_WINNER, (r) => handleDuelWinner(conn, r));
conn.dispatch.on(GameOpcode.SMSG_DUEL_OUTOFBOUNDS, () =>
  handleDuelOutOfBounds(conn),
);
conn.dispatch.on(GameOpcode.SMSG_DUEL_INBOUNDS, () => handleDuelInBounds(conn));
```

Add to the import of handler functions from `world-handlers.ts`:

```typescript
import {
  // ... existing imports ...
  handleDuelRequested,
  handleDuelCountdown,
  handleDuelComplete,
  handleDuelWinner,
  handleDuelOutOfBounds,
  handleDuelInBounds,
} from "wow/world-handlers";
```

**Step 3: Remove duel stubs from stubs.ts**

Remove the three stub entries for `SMSG_DUEL_REQUESTED`, `SMSG_DUEL_WINNER`, and `SMSG_DUEL_COMPLETE` (lines 321-338 in `src/wow/protocol/stubs.ts`).

**Step 4: Run typecheck**

Run: `mise typecheck`
Expected: PASS

**Step 5: Commit**

```
feat: Register duel SMSG handlers
```

---

### Task 5: Handler integration tests

**Files:**

- Modify: `src/wow/world-handlers.test.ts`

**Step 1: Write duel handler integration tests**

Add `DuelEvent` to the imports from `wow/client` (line 11).

Add a `waitForDuelEvents` helper after `waitForGroupEvents` (around line 77):

```typescript
function waitForDuelEvents(
  handle: Pick<WorldHandle, "onDuelEvent">,
  count: number,
): Promise<DuelEvent[]> {
  const events: DuelEvent[] = [];
  return new Promise((resolve) => {
    handle.onDuelEvent((event) => {
      events.push(event);
      if (events.length === count) resolve(events);
    });
  });
}
```

Add test inside the main `describe` block:

```typescript
test("duel opcodes emit expected duel events", async () => {
  const ws = await startMockWorldServer();
  try {
    const handle = await worldSession(
      { ...base, host: "127.0.0.1", port: ws.port },
      fakeAuth(ws.port),
    );

    const received = waitForDuelEvents(handle, 6);

    const requested = new PacketWriter();
    requested.uint64LE(100n);
    requested.uint64LE(200n);
    ws.inject(GameOpcode.SMSG_DUEL_REQUESTED, requested.finish());

    const countdown = new PacketWriter();
    countdown.uint32LE(3000);
    ws.inject(GameOpcode.SMSG_DUEL_COUNTDOWN, countdown.finish());

    ws.inject(GameOpcode.SMSG_DUEL_OUTOFBOUNDS, new Uint8Array(0));
    ws.inject(GameOpcode.SMSG_DUEL_INBOUNDS, new Uint8Array(0));

    const complete = new PacketWriter();
    complete.uint8(1);
    ws.inject(GameOpcode.SMSG_DUEL_COMPLETE, complete.finish());

    const winner = new PacketWriter();
    winner.uint8(0);
    winner.cString("Loser");
    winner.cString("Winner");
    ws.inject(GameOpcode.SMSG_DUEL_WINNER, winner.finish());

    const events = await received;
    expect(events.map((e) => e.type)).toEqual([
      "duel_requested",
      "duel_countdown",
      "duel_out_of_bounds",
      "duel_in_bounds",
      "duel_complete",
      "duel_winner",
    ]);

    const req = events[0] as { type: "duel_requested"; challenger: string };
    expect(req.challenger).toBe("Unknown");

    const cd = events[1] as { type: "duel_countdown"; timeMs: number };
    expect(cd.timeMs).toBe(3000);

    const win = events[5] as {
      type: "duel_winner";
      reason: string;
      winner: string;
      loser: string;
    };
    expect(win.reason).toBe("won");
    expect(win.winner).toBe("Winner");
    expect(win.loser).toBe("Loser");

    handle.close();
    await handle.closed;
  } finally {
    ws.stop();
  }
});

test("SMSG_DUEL_REQUESTED resolves name from nameCache", async () => {
  const ws = await startMockWorldServer();
  try {
    const handle = await worldSession(
      { ...base, host: "127.0.0.1", port: ws.port },
      fakeAuth(ws.port),
    );
    await waitForEchoProbe(handle);

    const duelEvent = new Promise<DuelEvent>((resolve) =>
      handle.onDuelEvent(resolve),
    );

    const nameResp = new PacketWriter();
    nameResp.uint8(0x2a);
    nameResp.uint8(0);
    nameResp.uint8(0);
    nameResp.uint8(0);
    nameResp.uint8(0);
    nameResp.uint8(0);
    nameResp.uint8(0);
    nameResp.uint8(0);
    nameResp.uint8(0);
    nameResp.cString("Arthas");
    nameResp.cString("");
    nameResp.uint8(2);
    nameResp.uint8(1);
    nameResp.uint8(1);
    nameResp.uint8(0);
    ws.inject(GameOpcode.SMSG_NAME_QUERY_RESPONSE, nameResp.finish());

    await Bun.sleep(1);

    const requested = new PacketWriter();
    requested.uint64LE(42n);
    requested.uint64LE(200n);
    ws.inject(GameOpcode.SMSG_DUEL_REQUESTED, requested.finish());

    const event = await duelEvent;
    expect(event.type).toBe("duel_requested");
    if (event.type === "duel_requested") {
      expect(event.challenger).toBe("Arthas");
    }

    handle.close();
    await handle.closed;
  } finally {
    ws.stop();
  }
});

test("context-aware accept sends CMSG_DUEL_ACCEPTED after duel request", async () => {
  const ws = await startMockWorldServer();
  try {
    const handle = await worldSession(
      { ...base, host: "127.0.0.1", port: ws.port },
      fakeAuth(ws.port),
    );
    await waitForEchoProbe(handle);

    const duelEvent = new Promise<DuelEvent>((resolve) =>
      handle.onDuelEvent(resolve),
    );

    const requested = new PacketWriter();
    requested.uint64LE(100n);
    requested.uint64LE(200n);
    ws.inject(GameOpcode.SMSG_DUEL_REQUESTED, requested.finish());
    await duelEvent;

    const sent = ws.waitForOpcode(GameOpcode.CMSG_DUEL_ACCEPTED);
    handle.acceptInvite();
    const packet = await sent;
    const r = new PacketReader(packet);
    expect(r.uint64LE()).toBe(200n);

    handle.close();
    await handle.closed;
  } finally {
    ws.stop();
  }
});

test("context-aware decline sends CMSG_DUEL_CANCELLED after duel request", async () => {
  const ws = await startMockWorldServer();
  try {
    const handle = await worldSession(
      { ...base, host: "127.0.0.1", port: ws.port },
      fakeAuth(ws.port),
    );
    await waitForEchoProbe(handle);

    const duelEvent = new Promise<DuelEvent>((resolve) =>
      handle.onDuelEvent(resolve),
    );

    const requested = new PacketWriter();
    requested.uint64LE(100n);
    requested.uint64LE(200n);
    ws.inject(GameOpcode.SMSG_DUEL_REQUESTED, requested.finish());
    await duelEvent;

    const sent = ws.waitForOpcode(GameOpcode.CMSG_DUEL_CANCELLED);
    handle.declineInvite();
    const packet = await sent;
    const r = new PacketReader(packet);
    expect(r.uint64LE()).toBe(200n);

    handle.close();
    await handle.closed;
  } finally {
    ws.stop();
  }
});

test("accept with no pending request fires system message", async () => {
  const ws = await startMockWorldServer();
  try {
    const handle = await worldSession(
      { ...base, host: "127.0.0.1", port: ws.port },
      fakeAuth(ws.port),
    );
    await waitForEchoProbe(handle);

    const msg = new Promise<ChatMessage>((resolve) =>
      handle.onMessage(resolve),
    );
    handle.acceptInvite();
    const result = await msg;
    expect(result.message).toBe("Nothing to accept.");

    handle.close();
    await handle.closed;
  } finally {
    ws.stop();
  }
});
```

Note: The `ws.waitForOpcode` helper may not exist yet on the mock server. If it doesn't, the test will need to use an alternative approach — capture sent packets in the mock server's `data` callback and match by opcode. Check `src/test/mock-world-server.ts` for available methods and adapt accordingly.

**Step 2: Run tests**

Run: `mise test src/wow/world-handlers.test.ts`
Expected: PASS — all new duel tests green alongside existing tests

**Step 3: Commit**

```
test: Add duel handler integration tests
```

---

### Task 6: Format functions + ring buffer wiring

**Files:**

- Modify: `src/daemon/commands.ts`

**Step 1: Add `formatDuelEvent` text formatter**

Add after the `formatGroupEvent` function (look for the existing pattern near the `onGroupEvent` export):

```typescript
function formatDuelEvent(event: DuelEvent): string | undefined {
  switch (event.type) {
    case "duel_requested":
      return `[duel] ${event.challenger} challenges you to a duel`;
    case "duel_countdown":
      return `[duel] Duel starting in ${event.timeMs / 1000} seconds`;
    case "duel_complete":
      return event.completed ? undefined : "[duel] Duel interrupted";
    case "duel_winner":
      return event.reason === "won"
        ? `[duel] ${event.winner} has defeated ${event.loser} in a duel`
        : `[duel] ${event.loser} has fled from ${event.winner} in a duel`;
    case "duel_out_of_bounds":
      return "[duel] Out of bounds — return to the duel area";
    case "duel_in_bounds":
      return "[duel] Back in bounds";
  }
}
```

**Step 2: Add `formatDuelEventObj` JSON formatter**

```typescript
function formatDuelEventObj(
  event: DuelEvent,
): Record<string, unknown> | undefined {
  switch (event.type) {
    case "duel_requested":
      return { type: "DUEL_REQUESTED", challenger: event.challenger };
    case "duel_countdown":
      return { type: "DUEL_COUNTDOWN", timeMs: event.timeMs };
    case "duel_complete":
      return { type: "DUEL_COMPLETE", completed: event.completed };
    case "duel_winner":
      return {
        type: "DUEL_WINNER",
        reason: event.reason,
        winner: event.winner,
        loser: event.loser,
      };
    case "duel_out_of_bounds":
      return { type: "DUEL_OUT_OF_BOUNDS" };
    case "duel_in_bounds":
      return { type: "DUEL_IN_BOUNDS" };
  }
}
```

**Step 3: Add `onDuelEvent` ring buffer export**

Follow the exact pattern of `onGroupEvent` (line 607-616):

```typescript
export function onDuelEvent(
  event: DuelEvent,
  events: RingBuffer<EventEntry>,
  log: SessionLog,
): void {
  const text = formatDuelEvent(event);
  const obj = formatDuelEventObj(event);
  if (obj) {
    events.push({ text, json: JSON.stringify(obj) });
    log.append(obj as LogEntry).catch(() => {});
  }
}
```

Add `DuelEvent` to the imports from `wow/client`.

**Step 4: Wire onDuelEvent in daemon startup**

Find where `onGroupEvent` is wired in the daemon startup. It will be in `src/daemon/server.ts` or wherever the handle callbacks are connected. Wire `onDuelEvent` the same way:

```typescript
handle.onDuelEvent((event) => onDuelEvent(event, events, log));
```

The `onDuelEvent` function should be imported from `commands.ts`.

**Step 5: Run typecheck**

Run: `mise typecheck`
Expected: PASS

**Step 6: Commit**

```
feat: Add duel event formatters and ring buffer
```

---

### Task 7: Format function tests

**Files:**

- Modify: `src/ui/format.test.ts` or create test in the appropriate location

Check where `formatGroupEvent` is tested. The format functions for duel are in `commands.ts`, so tests should be alongside existing format tests. If `formatDuelEvent` and `formatDuelEventObj` are not exported, they can be tested indirectly through `onDuelEvent`.

**Step 1: Write tests for duel formatters**

Test via `onDuelEvent` (which is exported):

```typescript
describe("duel event formatting", () => {
  test("duel_requested formats with challenger name", () => {
    const events = new RingBuffer<EventEntry>(10);
    const log = { append: jest.fn(async () => {}) } as unknown as SessionLog;
    onDuelEvent({ type: "duel_requested", challenger: "Arthas" }, events, log);
    const entries = events.drain();
    expect(entries).toHaveLength(1);
    expect(entries[0]!.text).toBe("[duel] Arthas challenges you to a duel");
    expect(JSON.parse(entries[0]!.json)).toEqual({
      type: "DUEL_REQUESTED",
      challenger: "Arthas",
    });
  });

  test("duel_countdown formats with seconds", () => {
    const events = new RingBuffer<EventEntry>(10);
    const log = { append: jest.fn(async () => {}) } as unknown as SessionLog;
    onDuelEvent({ type: "duel_countdown", timeMs: 3000 }, events, log);
    const entries = events.drain();
    expect(entries[0]!.text).toBe("[duel] Duel starting in 3 seconds");
  });

  test("duel_winner won formats correctly", () => {
    const events = new RingBuffer<EventEntry>(10);
    const log = { append: jest.fn(async () => {}) } as unknown as SessionLog;
    onDuelEvent(
      {
        type: "duel_winner",
        reason: "won",
        winner: "Thrall",
        loser: "Garrosh",
      },
      events,
      log,
    );
    const entries = events.drain();
    expect(entries[0]!.text).toBe(
      "[duel] Thrall has defeated Garrosh in a duel",
    );
  });

  test("duel_winner fled formats correctly", () => {
    const events = new RingBuffer<EventEntry>(10);
    const log = { append: jest.fn(async () => {}) } as unknown as SessionLog;
    onDuelEvent(
      {
        type: "duel_winner",
        reason: "fled",
        winner: "Thrall",
        loser: "Garrosh",
      },
      events,
      log,
    );
    const entries = events.drain();
    expect(entries[0]!.text).toBe(
      "[duel] Garrosh has fled from Thrall in a duel",
    );
  });

  test("duel_out_of_bounds formats warning", () => {
    const events = new RingBuffer<EventEntry>(10);
    const log = { append: jest.fn(async () => {}) } as unknown as SessionLog;
    onDuelEvent({ type: "duel_out_of_bounds" }, events, log);
    const entries = events.drain();
    expect(entries[0]!.text).toBe(
      "[duel] Out of bounds — return to the duel area",
    );
  });

  test("duel_in_bounds formats notice", () => {
    const events = new RingBuffer<EventEntry>(10);
    const log = { append: jest.fn(async () => {}) } as unknown as SessionLog;
    onDuelEvent({ type: "duel_in_bounds" }, events, log);
    const entries = events.drain();
    expect(entries[0]!.text).toBe("[duel] Back in bounds");
  });

  test("duel_complete completed=true is silent", () => {
    const events = new RingBuffer<EventEntry>(10);
    const log = { append: jest.fn(async () => {}) } as unknown as SessionLog;
    onDuelEvent({ type: "duel_complete", completed: true }, events, log);
    const entries = events.drain();
    expect(entries[0]!.text).toBeUndefined();
  });

  test("duel_complete completed=false shows interrupted", () => {
    const events = new RingBuffer<EventEntry>(10);
    const log = { append: jest.fn(async () => {}) } as unknown as SessionLog;
    onDuelEvent({ type: "duel_complete", completed: false }, events, log);
    const entries = events.drain();
    expect(entries[0]!.text).toBe("[duel] Duel interrupted");
  });
});
```

**Step 2: Run tests**

Run: `mise test` (relevant test file)
Expected: PASS

**Step 3: Commit**

```
test: Add duel event format tests
```

---

### Task 8: Update help text, manual, and skill file

**Files:**

- Modify: `src/cli/help.ts`
- Modify: `docs/manual.md`
- Modify: `.claude/skills/tuicraft/SKILL.md`

**Step 1: Update help.ts**

Change lines 50-51 from:

```
  /accept         Accept a group invitation
  /decline        Decline a group invitation
```

to:

```
  /accept         Accept a pending invitation (group or duel)
  /decline        Decline a pending invitation (group or duel)
```

**Step 2: Update docs/manual.md**

Change the `/accept` and `/decline` rows in the command table from:

```
| `/accept`                    | Accept a group invitation   |
| `/decline`                   | Decline a group invitation  |
```

to:

```
| `/accept`                    | Accept a pending invitation (group or duel) |
| `/decline`                   | Decline a pending invitation (group or duel) |
```

**Step 3: Update SKILL.md**

Find the group commands section in `.claude/skills/tuicraft/SKILL.md` and update the `/accept` and `/decline` descriptions similarly. Add a note about duel events being surfaced in the event stream.

**Step 4: Commit**

```
docs: Update help text for context-aware accept
```

---

### Task 9: Update README feature table

**Files:**

- Modify: `README.md`

**Step 1: Update duel row**

Change line 161 from:

```
| Duel accept / decline                | ❌     |
```

to:

```
| Duel accept / decline                | ✅     |
```

**Step 2: Update mail notifications row**

Change line 178 from:

```
| Mail notifications  | ❌     |
```

to:

```
| Mail notifications  | ✅     |
```

**Step 3: Commit**

```
docs: Mark duel and mail notifications as done
```

---

### Task 10: Full test suite + live test

**Step 1: Run full test suite**

Run: `mise ci`
Expected: typecheck, test, and format all pass

**Step 2: Fix formatting**

Run: `mise format:fix`
Then re-run: `mise ci`

**Step 3: Run live server test**

Run: `mise test:live`
Expected: PASS — duel handlers don't break existing protocol flow. No live duel test needed since we can't initiate duels yet.

**Step 4: Final commit if any fixes needed**

```
fix: Address CI issues from duel implementation
```
