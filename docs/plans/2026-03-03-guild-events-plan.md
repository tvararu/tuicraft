# Guild Events Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Handle SMSG_GUILD_EVENT (0x0092) to display guild activity notifications as system messages.

**Architecture:** Expand the existing `GuildEvent` union with 11 new variants, add a packet parser, wire a handler through the existing `onGuildEvent` callback pipeline, and add text/JSON formatters. TDD throughout.

**Tech Stack:** TypeScript, Bun test runner, PacketReader/PacketWriter

---

### Task 1: Parser — parseGuildEvent

**Files:**

- Modify: `src/wow/protocol/guild.ts`
- Test: `src/wow/protocol/guild.test.ts`

**Step 1: Write failing tests**

Add to `src/wow/protocol/guild.test.ts`:

```ts
import { GuildEventCode, parseGuildEvent } from "wow/protocol/guild";
```

Add these test blocks:

```ts
describe("GuildEventCode", () => {
  test("PROMOTION is 0", () => {
    expect(GuildEventCode.PROMOTION).toBe(0);
  });

  test("SIGNED_OFF is 13", () => {
    expect(GuildEventCode.SIGNED_OFF).toBe(13);
  });
});

describe("parseGuildEvent", () => {
  test("parses MOTD with 1 string param", () => {
    const w = new PacketWriter();
    w.uint8(GuildEventCode.MOTD);
    w.uint8(1);
    w.cString("Welcome back!");
    const result = parseGuildEvent(new PacketReader(w.finish()));
    expect(result).toEqual({
      eventType: GuildEventCode.MOTD,
      params: ["Welcome back!"],
    });
  });

  test("parses PROMOTION with 3 string params", () => {
    const w = new PacketWriter();
    w.uint8(GuildEventCode.PROMOTION);
    w.uint8(3);
    w.cString("Thrall");
    w.cString("Garrosh");
    w.cString("Officer");
    const result = parseGuildEvent(new PacketReader(w.finish()));
    expect(result).toEqual({
      eventType: GuildEventCode.PROMOTION,
      params: ["Thrall", "Garrosh", "Officer"],
    });
  });

  test("parses DISBANDED with 0 string params", () => {
    const w = new PacketWriter();
    w.uint8(GuildEventCode.DISBANDED);
    w.uint8(0);
    const result = parseGuildEvent(new PacketReader(w.finish()));
    expect(result).toEqual({
      eventType: GuildEventCode.DISBANDED,
      params: [],
    });
  });

  test("parses SIGNED_ON with trailing guid", () => {
    const w = new PacketWriter();
    w.uint8(GuildEventCode.SIGNED_ON);
    w.uint8(1);
    w.cString("Jaina");
    w.uint64LE(42n);
    const r = new PacketReader(w.finish());
    const result = parseGuildEvent(r);
    expect(result).toEqual({
      eventType: GuildEventCode.SIGNED_ON,
      params: ["Jaina"],
    });
    expect(r.remaining).toBe(0);
  });

  test("parses JOINED with trailing guid", () => {
    const w = new PacketWriter();
    w.uint8(GuildEventCode.JOINED);
    w.uint8(1);
    w.cString("Arthas");
    w.uint64LE(99n);
    const r = new PacketReader(w.finish());
    parseGuildEvent(r);
    expect(r.remaining).toBe(0);
  });

  test("parses LEFT with trailing guid", () => {
    const w = new PacketWriter();
    w.uint8(GuildEventCode.LEFT);
    w.uint8(1);
    w.cString("Sylvanas");
    w.uint64LE(7n);
    const r = new PacketReader(w.finish());
    parseGuildEvent(r);
    expect(r.remaining).toBe(0);
  });

  test("parses SIGNED_OFF with trailing guid", () => {
    const w = new PacketWriter();
    w.uint8(GuildEventCode.SIGNED_OFF);
    w.uint8(1);
    w.cString("Varian");
    w.uint64LE(55n);
    const r = new PacketReader(w.finish());
    parseGuildEvent(r);
    expect(r.remaining).toBe(0);
  });

  test("parses REMOVED with 2 string params", () => {
    const w = new PacketWriter();
    w.uint8(GuildEventCode.REMOVED);
    w.uint8(2);
    w.cString("Garrosh");
    w.cString("Thrall");
    const result = parseGuildEvent(new PacketReader(w.finish()));
    expect(result).toEqual({
      eventType: GuildEventCode.REMOVED,
      params: ["Garrosh", "Thrall"],
    });
  });

  test("parses LEADER_CHANGED with 2 string params", () => {
    const w = new PacketWriter();
    w.uint8(GuildEventCode.LEADER_CHANGED);
    w.uint8(2);
    w.cString("Thrall");
    w.cString("Garrosh");
    const result = parseGuildEvent(new PacketReader(w.finish()));
    expect(result).toEqual({
      eventType: GuildEventCode.LEADER_CHANGED,
      params: ["Thrall", "Garrosh"],
    });
  });

  test("parses unknown event type without crashing", () => {
    const w = new PacketWriter();
    w.uint8(19);
    w.uint8(0);
    const result = parseGuildEvent(new PacketReader(w.finish()));
    expect(result.eventType).toBe(19);
    expect(result.params).toEqual([]);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `mise test src/wow/protocol/guild.test.ts`
Expected: FAIL — `GuildEventCode` and `parseGuildEvent` not found

**Step 3: Implement parser**

Add to `src/wow/protocol/guild.ts`:

```ts
export const GuildEventCode = {
  PROMOTION: 0,
  DEMOTION: 1,
  MOTD: 2,
  JOINED: 3,
  LEFT: 4,
  REMOVED: 5,
  LEADER_IS: 6,
  LEADER_CHANGED: 7,
  DISBANDED: 8,
  SIGNED_ON: 12,
  SIGNED_OFF: 13,
} as const;

const HAS_TRAILING_GUID = new Set([
  GuildEventCode.JOINED,
  GuildEventCode.LEFT,
  GuildEventCode.SIGNED_ON,
  GuildEventCode.SIGNED_OFF,
]);

export type GuildEventRaw = {
  eventType: number;
  params: string[];
};

export function parseGuildEvent(r: PacketReader): GuildEventRaw {
  const eventType = r.uint8();
  const paramCount = r.uint8();
  const params: string[] = [];
  for (let i = 0; i < paramCount; i++) {
    params.push(r.cString());
  }
  if (HAS_TRAILING_GUID.has(eventType as any)) {
    r.uint64LE();
  }
  return { eventType, params };
}
```

Note: The `as any` cast is needed because `eventType` is `number` while the Set contains literal values. This is the simplest approach — the set membership check works at runtime regardless.

**Step 4: Run tests to verify they pass**

Run: `mise test src/wow/protocol/guild.test.ts`
Expected: All PASS

**Step 5: Commit**

```
feat: Add parseGuildEvent for SMSG_GUILD_EVENT

Parses event type, variable-length string params, and the
trailing GUID present on join/leave/sign-on/sign-off events.
```

---

### Task 2: Expand GuildEvent union

**Files:**

- Modify: `src/wow/guild-store.ts:23`

**Step 1: No test needed** — this is a type-only change. TypeScript compilation will verify correctness when the handler and formatters reference the new variants.

**Step 2: Replace the GuildEvent type**

Replace line 23 of `src/wow/guild-store.ts`:

```ts
export type GuildEvent = { type: "guild-roster"; roster: GuildRoster };
```

With:

```ts
export type GuildEvent =
  | { type: "guild-roster"; roster: GuildRoster }
  | { type: "promotion"; officer: string; member: string; rank: string }
  | { type: "demotion"; officer: string; member: string; rank: string }
  | { type: "motd"; text: string }
  | { type: "joined"; name: string }
  | { type: "left"; name: string }
  | { type: "removed"; member: string; officer: string }
  | { type: "leader_is"; name: string }
  | { type: "leader_changed"; oldLeader: string; newLeader: string }
  | { type: "disbanded" }
  | { type: "signed_on"; name: string }
  | { type: "signed_off"; name: string };
```

**Step 3: Fix onGuildEvent in commands.ts**

The existing `onGuildEvent` at `src/daemon/commands.ts:672-686` directly accesses `event.roster` — this will no longer typecheck since the union now has multiple variants. Refactor it to use `formatGuildEvent`/`formatGuildEventObj` (Task 5 below). For now, add a type narrowing guard so it compiles:

Replace the body of `onGuildEvent` (lines 672-686) with:

```ts
export function onGuildEvent(
  event: GuildEvent,
  events: RingBuffer<EventEntry>,
  log: SessionLog,
): void {
  const text = formatGuildEvent(event);
  const obj = formatGuildEventObj(event);
  if (obj) {
    events.push({ text, json: JSON.stringify(obj) });
    log.append(obj as LogEntry).catch(() => {});
  }
}
```

This depends on `formatGuildEvent` and `formatGuildEventObj` being defined (Task 5). **Tasks 2 and 5 should be implemented together** — expand the type, then immediately add the formatters and update `onGuildEvent` so it compiles.

**Step 4: Run typecheck**

Run: `mise typecheck`
Expected: PASS (after Task 5 formatters are in place)

**Step 5: Commit** (combined with Task 5)

---

### Task 3: Handler — handleGuildEvent

**Files:**

- Modify: `src/wow/world-handlers.ts`
- Test: `src/wow/world-handlers.test.ts`

**Step 1: Write failing test**

Add to the `describe("guild handlers", ...)` block in `src/wow/world-handlers.test.ts` (after the existing guild tests around line 3399):

```ts
test("SMSG_GUILD_EVENT signed_on fires guild event", async () => {
  const ws = await startMockWorldServer();
  try {
    const handle = await worldSession(
      { ...base, host: "127.0.0.1", port: ws.port },
      fakeAuth(ws.port),
    );

    const eventReady = new Promise<GuildEvent>((resolve) => {
      handle.onGuildEvent(resolve);
    });

    const w = new PacketWriter();
    w.uint8(12);
    w.uint8(1);
    w.cString("Thrall");
    w.uint64LE(10n);
    ws.inject(GameOpcode.SMSG_GUILD_EVENT, w.finish());

    const event = await eventReady;
    expect(event.type).toBe("signed_on");
    if (event.type === "signed_on") {
      expect(event.name).toBe("Thrall");
    }

    handle.close();
    await handle.closed;
  } finally {
    ws.stop();
  }
});

test("SMSG_GUILD_EVENT promotion fires guild event", async () => {
  const ws = await startMockWorldServer();
  try {
    const handle = await worldSession(
      { ...base, host: "127.0.0.1", port: ws.port },
      fakeAuth(ws.port),
    );

    const eventReady = new Promise<GuildEvent>((resolve) => {
      handle.onGuildEvent(resolve);
    });

    const w = new PacketWriter();
    w.uint8(0);
    w.uint8(3);
    w.cString("Thrall");
    w.cString("Garrosh");
    w.cString("Officer");
    ws.inject(GameOpcode.SMSG_GUILD_EVENT, w.finish());

    const event = await eventReady;
    expect(event.type).toBe("promotion");
    if (event.type === "promotion") {
      expect(event.officer).toBe("Thrall");
      expect(event.member).toBe("Garrosh");
      expect(event.rank).toBe("Officer");
    }

    handle.close();
    await handle.closed;
  } finally {
    ws.stop();
  }
});

test("SMSG_GUILD_EVENT unknown type is silently ignored", async () => {
  const ws = await startMockWorldServer();
  try {
    const handle = await worldSession(
      { ...base, host: "127.0.0.1", port: ws.port },
      fakeAuth(ws.port),
    );

    const events: GuildEvent[] = [];
    handle.onGuildEvent((e) => events.push(e));

    const w = new PacketWriter();
    w.uint8(9);
    w.uint8(0);
    ws.inject(GameOpcode.SMSG_GUILD_EVENT, w.finish());

    await Bun.sleep(50);
    expect(events).toHaveLength(0);

    handle.close();
    await handle.closed;
  } finally {
    ws.stop();
  }
});
```

**Step 2: Run tests to verify they fail**

Run: `mise test src/wow/world-handlers.test.ts`
Expected: FAIL — `handleGuildEvent` not registered, SMSG_GUILD_EVENT goes to stub

**Step 3: Implement handler**

Add to `src/wow/world-handlers.ts`:

Import at top:

```ts
import { parseGuildEvent, GuildEventCode } from "wow/protocol/guild";
```

(Add `parseGuildEvent` and `GuildEventCode` to existing guild import line)

Add handler function (after `handleGuildQueryResponse`, around line 715):

```ts
export function handleGuildEvent(conn: WorldConn, r: PacketReader): void {
  const raw = parseGuildEvent(r);
  const p = raw.params;
  switch (raw.eventType) {
    case GuildEventCode.PROMOTION:
      conn.onGuildEvent?.({
        type: "promotion",
        officer: p[0] ?? "",
        member: p[1] ?? "",
        rank: p[2] ?? "",
      });
      break;
    case GuildEventCode.DEMOTION:
      conn.onGuildEvent?.({
        type: "demotion",
        officer: p[0] ?? "",
        member: p[1] ?? "",
        rank: p[2] ?? "",
      });
      break;
    case GuildEventCode.MOTD:
      conn.onGuildEvent?.({ type: "motd", text: p[0] ?? "" });
      break;
    case GuildEventCode.JOINED:
      conn.onGuildEvent?.({ type: "joined", name: p[0] ?? "" });
      break;
    case GuildEventCode.LEFT:
      conn.onGuildEvent?.({ type: "left", name: p[0] ?? "" });
      break;
    case GuildEventCode.REMOVED:
      conn.onGuildEvent?.({
        type: "removed",
        member: p[0] ?? "",
        officer: p[1] ?? "",
      });
      break;
    case GuildEventCode.LEADER_IS:
      conn.onGuildEvent?.({ type: "leader_is", name: p[0] ?? "" });
      break;
    case GuildEventCode.LEADER_CHANGED:
      conn.onGuildEvent?.({
        type: "leader_changed",
        oldLeader: p[0] ?? "",
        newLeader: p[1] ?? "",
      });
      break;
    case GuildEventCode.DISBANDED:
      conn.onGuildEvent?.({ type: "disbanded" });
      break;
    case GuildEventCode.SIGNED_ON:
      conn.onGuildEvent?.({ type: "signed_on", name: p[0] ?? "" });
      break;
    case GuildEventCode.SIGNED_OFF:
      conn.onGuildEvent?.({ type: "signed_off", name: p[0] ?? "" });
      break;
  }
}
```

**Step 4: Register handler in client.ts**

In `src/wow/client.ts`, add import for `handleGuildEvent` (to existing import from `"wow/world-handlers"`), then add registration after the `SMSG_GUILD_QUERY_RESPONSE` handler (around line 507):

```ts
conn.dispatch.on(GameOpcode.SMSG_GUILD_EVENT, (r) => handleGuildEvent(conn, r));
```

**Step 5: Run tests to verify they pass**

Run: `mise test src/wow/world-handlers.test.ts`
Expected: All PASS

**Step 6: Commit**

```
feat: Handle SMSG_GUILD_EVENT opcode

Maps 11 guild event types (promotion, demotion, MOTD, join,
leave, kick, leader, disband, sign on/off) to GuildEvent union.
```

---

### Task 4: Remove stub

**Files:**

- Modify: `src/wow/protocol/stubs.ts:104-109`
- Test: `src/wow/protocol/stubs.test.ts`

**Step 1: Update stubs test**

In `src/wow/protocol/stubs.test.ts`, the test at line 14 checks `d.has(GameOpcode.SMSG_GUILD_EVENT)` is true. Now that we register a real handler before stubs, the stub will be skipped (due to the `if (dispatch.has(stub.opcode)) continue` guard at stubs.ts:814). The stub entry can stay in the list — it's harmless and documents intent. But the test expectation needs updating if it asserts the stub fires. Check if the test just checks `d.has()` — if so, it still passes since the stub entry exists.

Actually, looking at `stubs.ts:814`: `if (dispatch.has(stub.opcode)) continue;` — the stub won't register because the real handler is already registered. The STUBS array still contains the entry but `registerStubs` skips it. The stubs.test.ts test creates a fresh dispatch with no handlers, so it will still register. No test change needed.

However, per the design doc: remove the SMSG_GUILD_EVENT entry from STUBS to keep the list clean.

**Step 2: Remove the stub entry**

Remove these lines from `src/wow/protocol/stubs.ts` (lines 104-109):

```ts
  {
    opcode: GameOpcode.SMSG_GUILD_EVENT,
    area: "guild",
    label: "Guild events",
    priority: "high",
  },
```

**Step 3: Update stubs test**

In `src/wow/protocol/stubs.test.ts`, remove the line that checks `SMSG_GUILD_EVENT` is in the dispatch (line 14):

```ts
expect(d.has(GameOpcode.SMSG_GUILD_EVENT)).toBe(true);
```

**Step 4: Run tests**

Run: `mise test src/wow/protocol/stubs.test.ts`
Expected: PASS

**Step 5: Commit**

```
chore: Remove SMSG_GUILD_EVENT stub

Now handled by the real guild event handler.
```

---

### Task 5: Text and JSON formatters + onGuildEvent refactor

**Files:**

- Modify: `src/daemon/commands.ts:672-686`
- Test: `src/daemon/commands.test.ts`

**Step 1: Write failing tests**

Add to `src/daemon/commands.test.ts` inside the `describe("onGuildEvent", ...)` block (after the existing tests at line 2297):

```ts
test("promotion formats text and JSON", () => {
  const events = new RingBuffer<EventEntry>(10);
  const log = {
    append: jest.fn(() => Promise.resolve()),
  } as unknown as SessionLog;
  onGuildEvent(
    {
      type: "promotion",
      officer: "Thrall",
      member: "Garrosh",
      rank: "Officer",
    },
    events,
    log,
  );
  const entries = events.drain();
  expect(entries).toHaveLength(1);
  expect(entries[0]!.text).toBe("[guild] Thrall promoted Garrosh to Officer");
  expect(JSON.parse(entries[0]!.json)).toEqual({
    type: "GUILD_PROMOTION",
    officer: "Thrall",
    member: "Garrosh",
    rank: "Officer",
  });
});

test("demotion formats text and JSON", () => {
  const events = new RingBuffer<EventEntry>(10);
  const log = {
    append: jest.fn(() => Promise.resolve()),
  } as unknown as SessionLog;
  onGuildEvent(
    { type: "demotion", officer: "Thrall", member: "Garrosh", rank: "Member" },
    events,
    log,
  );
  const entries = events.drain();
  expect(entries[0]!.text).toBe("[guild] Thrall demoted Garrosh to Member");
  expect(JSON.parse(entries[0]!.json)).toEqual({
    type: "GUILD_DEMOTION",
    officer: "Thrall",
    member: "Garrosh",
    rank: "Member",
  });
});

test("motd formats text and JSON", () => {
  const events = new RingBuffer<EventEntry>(10);
  const log = {
    append: jest.fn(() => Promise.resolve()),
  } as unknown as SessionLog;
  onGuildEvent({ type: "motd", text: "Raid tonight!" }, events, log);
  const entries = events.drain();
  expect(entries[0]!.text).toBe("[guild] MOTD: Raid tonight!");
  expect(JSON.parse(entries[0]!.json)).toEqual({
    type: "GUILD_MOTD",
    text: "Raid tonight!",
  });
});

test("joined formats text and JSON", () => {
  const events = new RingBuffer<EventEntry>(10);
  const log = {
    append: jest.fn(() => Promise.resolve()),
  } as unknown as SessionLog;
  onGuildEvent({ type: "joined", name: "Arthas" }, events, log);
  const entries = events.drain();
  expect(entries[0]!.text).toBe("[guild] Arthas has joined the guild");
  expect(JSON.parse(entries[0]!.json)).toEqual({
    type: "GUILD_JOINED",
    name: "Arthas",
  });
});

test("left formats text and JSON", () => {
  const events = new RingBuffer<EventEntry>(10);
  const log = {
    append: jest.fn(() => Promise.resolve()),
  } as unknown as SessionLog;
  onGuildEvent({ type: "left", name: "Sylvanas" }, events, log);
  const entries = events.drain();
  expect(entries[0]!.text).toBe("[guild] Sylvanas has left the guild");
  expect(JSON.parse(entries[0]!.json)).toEqual({
    type: "GUILD_LEFT",
    name: "Sylvanas",
  });
});

test("removed formats text and JSON", () => {
  const events = new RingBuffer<EventEntry>(10);
  const log = {
    append: jest.fn(() => Promise.resolve()),
  } as unknown as SessionLog;
  onGuildEvent(
    { type: "removed", member: "Garrosh", officer: "Thrall" },
    events,
    log,
  );
  const entries = events.drain();
  expect(entries[0]!.text).toBe(
    "[guild] Thrall removed Garrosh from the guild",
  );
  expect(JSON.parse(entries[0]!.json)).toEqual({
    type: "GUILD_REMOVED",
    member: "Garrosh",
    officer: "Thrall",
  });
});

test("leader_is formats text and JSON", () => {
  const events = new RingBuffer<EventEntry>(10);
  const log = {
    append: jest.fn(() => Promise.resolve()),
  } as unknown as SessionLog;
  onGuildEvent({ type: "leader_is", name: "Thrall" }, events, log);
  const entries = events.drain();
  expect(entries[0]!.text).toBe("[guild] Thrall is the guild leader");
  expect(JSON.parse(entries[0]!.json)).toEqual({
    type: "GUILD_LEADER_IS",
    name: "Thrall",
  });
});

test("leader_changed formats text and JSON", () => {
  const events = new RingBuffer<EventEntry>(10);
  const log = {
    append: jest.fn(() => Promise.resolve()),
  } as unknown as SessionLog;
  onGuildEvent(
    { type: "leader_changed", oldLeader: "Thrall", newLeader: "Garrosh" },
    events,
    log,
  );
  const entries = events.drain();
  expect(entries[0]!.text).toBe(
    "[guild] Thrall has made Garrosh the new guild leader",
  );
  expect(JSON.parse(entries[0]!.json)).toEqual({
    type: "GUILD_LEADER_CHANGED",
    oldLeader: "Thrall",
    newLeader: "Garrosh",
  });
});

test("disbanded formats text and JSON", () => {
  const events = new RingBuffer<EventEntry>(10);
  const log = {
    append: jest.fn(() => Promise.resolve()),
  } as unknown as SessionLog;
  onGuildEvent({ type: "disbanded" }, events, log);
  const entries = events.drain();
  expect(entries[0]!.text).toBe("[guild] Guild has been disbanded");
  expect(JSON.parse(entries[0]!.json)).toEqual({
    type: "GUILD_DISBANDED",
  });
});

test("signed_on formats text and JSON", () => {
  const events = new RingBuffer<EventEntry>(10);
  const log = {
    append: jest.fn(() => Promise.resolve()),
  } as unknown as SessionLog;
  onGuildEvent({ type: "signed_on", name: "Jaina" }, events, log);
  const entries = events.drain();
  expect(entries[0]!.text).toBe("[guild] Jaina has come online");
  expect(JSON.parse(entries[0]!.json)).toEqual({
    type: "GUILD_SIGNED_ON",
    name: "Jaina",
  });
});

test("signed_off formats text and JSON", () => {
  const events = new RingBuffer<EventEntry>(10);
  const log = {
    append: jest.fn(() => Promise.resolve()),
  } as unknown as SessionLog;
  onGuildEvent({ type: "signed_off", name: "Varian" }, events, log);
  const entries = events.drain();
  expect(entries[0]!.text).toBe("[guild] Varian has gone offline");
  expect(JSON.parse(entries[0]!.json)).toEqual({
    type: "GUILD_SIGNED_OFF",
    name: "Varian",
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `mise test src/daemon/commands.test.ts`
Expected: FAIL — `onGuildEvent` only handles `guild-roster`

**Step 3: Implement formatters and refactor onGuildEvent**

In `src/daemon/commands.ts`, replace the `onGuildEvent` function (lines 672-686) with:

```ts
function formatGuildEvent(event: GuildEvent): string | undefined {
  switch (event.type) {
    case "guild-roster":
      return `[guild] Roster updated: ${event.roster.members.length} members`;
    case "promotion":
      return `[guild] ${event.officer} promoted ${event.member} to ${event.rank}`;
    case "demotion":
      return `[guild] ${event.officer} demoted ${event.member} to ${event.rank}`;
    case "motd":
      return `[guild] MOTD: ${event.text}`;
    case "joined":
      return `[guild] ${event.name} has joined the guild`;
    case "left":
      return `[guild] ${event.name} has left the guild`;
    case "removed":
      return `[guild] ${event.officer} removed ${event.member} from the guild`;
    case "leader_is":
      return `[guild] ${event.name} is the guild leader`;
    case "leader_changed":
      return `[guild] ${event.oldLeader} has made ${event.newLeader} the new guild leader`;
    case "disbanded":
      return "[guild] Guild has been disbanded";
    case "signed_on":
      return `[guild] ${event.name} has come online`;
    case "signed_off":
      return `[guild] ${event.name} has gone offline`;
  }
}

function formatGuildEventObj(
  event: GuildEvent,
): Record<string, unknown> | undefined {
  switch (event.type) {
    case "guild-roster":
      return {
        type: "GUILD_ROSTER_UPDATED",
        sender: "",
        message: `${event.roster.members.length} members`,
      };
    case "promotion":
      return {
        type: "GUILD_PROMOTION",
        officer: event.officer,
        member: event.member,
        rank: event.rank,
      };
    case "demotion":
      return {
        type: "GUILD_DEMOTION",
        officer: event.officer,
        member: event.member,
        rank: event.rank,
      };
    case "motd":
      return { type: "GUILD_MOTD", text: event.text };
    case "joined":
      return { type: "GUILD_JOINED", name: event.name };
    case "left":
      return { type: "GUILD_LEFT", name: event.name };
    case "removed":
      return {
        type: "GUILD_REMOVED",
        member: event.member,
        officer: event.officer,
      };
    case "leader_is":
      return { type: "GUILD_LEADER_IS", name: event.name };
    case "leader_changed":
      return {
        type: "GUILD_LEADER_CHANGED",
        oldLeader: event.oldLeader,
        newLeader: event.newLeader,
      };
    case "disbanded":
      return { type: "GUILD_DISBANDED" };
    case "signed_on":
      return { type: "GUILD_SIGNED_ON", name: event.name };
    case "signed_off":
      return { type: "GUILD_SIGNED_OFF", name: event.name };
  }
}

export function onGuildEvent(
  event: GuildEvent,
  events: RingBuffer<EventEntry>,
  log: SessionLog,
): void {
  const text = formatGuildEvent(event);
  const obj = formatGuildEventObj(event);
  if (obj) {
    events.push({ text, json: JSON.stringify(obj) });
    log.append(obj as LogEntry).catch(() => {});
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `mise test src/daemon/commands.test.ts`
Expected: All PASS (including existing guild-roster tests — the roster branch is preserved)

**Step 5: Commit**

```
feat: Add guild event formatters

Text and JSON formatters for all 11 guild event types plus
the existing roster event, following the duel event pattern.
```

---

### Task 6: Full test suite + typecheck

**Step 1: Run full test suite**

Run: `mise ci`
Expected: typecheck, test, and format all PASS

**Step 2: Fix any issues**

If stubs.test.ts fails because SMSG_GUILD_EVENT is no longer in the dispatch, remove that assertion.

**Step 3: Commit** (if any fixes needed)

---

### Task 7: Mark README done

**Files:**

- Modify: `README.md:171`

**Step 1: Update README**

Change line 171 from:

```
| Guild events                          | ❌     |
```

To:

```
| Guild events                          | ✅     |
```

**Step 2: Commit**

```
docs: Mark guild events as done
```

---

### Task 8: Live test

**Step 1: Run live test**

Run: `mise test:live`
Expected: PASS — guild event packets from the real server are now handled instead of triggering the stub warning.

If the live server is unreachable, note it and move on — the mock integration tests cover correctness.

---

### Execution Order Summary

Tasks 1-5 have dependencies:

- Task 1 (parser) is independent
- Task 2 (type expansion) + Task 5 (formatters) must be done together to compile
- Task 3 (handler) depends on Task 1 (parser) and Task 2 (types)
- Task 4 (stub removal) depends on Task 3 (handler registered)
- Task 6 (full CI) depends on all above
- Task 7 (README) is independent
- Task 8 (live test) depends on Task 6

Recommended order: 1 → 2+5 → 3 → 4 → 6 → 7 → 8
