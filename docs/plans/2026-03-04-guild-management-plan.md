# Guild Management Commands Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement 9 guild management slash commands (/ginvite, /gkick, /gleave, /gpromote, /gdemote, /gleader, /gmotd, /gaccept, /gdecline) as fire-and-forget packets, plus handle SMSG_GUILD_COMMAND_RESULT and SMSG_GUILD_INVITE from the server.

**Architecture:** Fire-and-forget pattern matching existing /invite, /kick, /friend, /ignore. UI parses command → IPC dispatches → WorldHandle method sends CMSG packet → returns "OK". Server errors arrive asynchronously via SMSG_GUILD_COMMAND_RESULT routed through GuildEvent. Incoming guild invites via SMSG_GUILD_INVITE also route through GuildEvent.

**Tech Stack:** TypeScript, Bun test runner, PacketWriter/PacketReader for protocol serialization.

---

### Task 1: Protocol — Build Functions and Enums

**Files:**

- Modify: `src/wow/protocol/guild.ts:136` (append after buildGuildQuery)
- Test: `src/wow/protocol/guild.test.ts:449` (append new describe blocks)

**Step 1: Write failing tests for build functions and enums**

Add to `src/wow/protocol/guild.test.ts` after line 449:

```typescript
import {
  GuildMemberStatus,
  GuildEventCode,
  parseGuildRoster,
  parseGuildQueryResponse,
  parseGuildEvent,
  buildGuildQuery,
  buildGuildInvite,
  buildGuildRemove,
  buildGuildPromote,
  buildGuildDemote,
  buildGuildLeader,
  buildGuildMotd,
  GuildCommand,
  GuildCommandResult,
  parseGuildCommandResult,
  parseGuildInvitePacket,
} from "wow/protocol/guild";
```

Then append test blocks:

```typescript
describe("buildGuildInvite", () => {
  test("writes player name as CString", () => {
    const buf = buildGuildInvite("Thrall");
    const r = new PacketReader(buf);
    expect(r.cString()).toBe("Thrall");
    expect(r.remaining).toBe(0);
  });
});

describe("buildGuildRemove", () => {
  test("writes player name as CString", () => {
    const buf = buildGuildRemove("Garrosh");
    const r = new PacketReader(buf);
    expect(r.cString()).toBe("Garrosh");
    expect(r.remaining).toBe(0);
  });
});

describe("buildGuildPromote", () => {
  test("writes player name as CString", () => {
    const buf = buildGuildPromote("Jaina");
    const r = new PacketReader(buf);
    expect(r.cString()).toBe("Jaina");
    expect(r.remaining).toBe(0);
  });
});

describe("buildGuildDemote", () => {
  test("writes player name as CString", () => {
    const buf = buildGuildDemote("Arthas");
    const r = new PacketReader(buf);
    expect(r.cString()).toBe("Arthas");
    expect(r.remaining).toBe(0);
  });
});

describe("buildGuildLeader", () => {
  test("writes player name as CString", () => {
    const buf = buildGuildLeader("Sylvanas");
    const r = new PacketReader(buf);
    expect(r.cString()).toBe("Sylvanas");
    expect(r.remaining).toBe(0);
  });
});

describe("buildGuildMotd", () => {
  test("writes motd as CString", () => {
    const buf = buildGuildMotd("Raid tonight at 8pm");
    const r = new PacketReader(buf);
    expect(r.cString()).toBe("Raid tonight at 8pm");
    expect(r.remaining).toBe(0);
  });

  test("writes empty motd", () => {
    const buf = buildGuildMotd("");
    const r = new PacketReader(buf);
    expect(r.cString()).toBe("");
    expect(r.remaining).toBe(0);
  });
});

describe("GuildCommand", () => {
  test("INVITE is 1", () => {
    expect(GuildCommand.INVITE).toBe(1);
  });

  test("QUIT is 2", () => {
    expect(GuildCommand.QUIT).toBe(2);
  });

  test("PROMOTE is 3", () => {
    expect(GuildCommand.PROMOTE).toBe(3);
  });

  test("FOUNDER is 0x0C", () => {
    expect(GuildCommand.FOUNDER).toBe(0x0c);
  });
});

describe("GuildCommandResult", () => {
  test("PLAYER_NO_MORE_IN_GUILD is 0", () => {
    expect(GuildCommandResult.PLAYER_NO_MORE_IN_GUILD).toBe(0);
  });

  test("PLAYER_NOT_FOUND_S is 0x0B", () => {
    expect(GuildCommandResult.PLAYER_NOT_FOUND_S).toBe(0x0b);
  });

  test("GUILD_LEADER_LEAVE_OR_PERMISSIONS is 0x08", () => {
    expect(GuildCommandResult.GUILD_LEADER_LEAVE_OR_PERMISSIONS).toBe(0x08);
  });
});

describe("parseGuildCommandResult", () => {
  test("parses command, name, and result", () => {
    const w = new PacketWriter();
    w.uint32LE(GuildCommand.INVITE);
    w.cString("Thrall");
    w.uint32LE(GuildCommandResult.ALREADY_IN_GUILD_S);
    const result = parseGuildCommandResult(new PacketReader(w.finish()));
    expect(result).toEqual({
      command: GuildCommand.INVITE,
      name: "Thrall",
      result: GuildCommandResult.ALREADY_IN_GUILD_S,
    });
  });

  test("parses result with empty name", () => {
    const w = new PacketWriter();
    w.uint32LE(GuildCommand.QUIT);
    w.cString("");
    w.uint32LE(GuildCommandResult.GUILD_LEADER_LEAVE_OR_PERMISSIONS);
    const result = parseGuildCommandResult(new PacketReader(w.finish()));
    expect(result.command).toBe(GuildCommand.QUIT);
    expect(result.name).toBe("");
    expect(result.result).toBe(
      GuildCommandResult.GUILD_LEADER_LEAVE_OR_PERMISSIONS,
    );
  });

  test("consumes all bytes", () => {
    const w = new PacketWriter();
    w.uint32LE(0);
    w.cString("X");
    w.uint32LE(0);
    const r = new PacketReader(w.finish());
    parseGuildCommandResult(r);
    expect(r.remaining).toBe(0);
  });
});

describe("parseGuildInvitePacket", () => {
  test("parses inviter name and guild name", () => {
    const w = new PacketWriter();
    w.cString("Thrall");
    w.cString("Horde Heroes");
    const result = parseGuildInvitePacket(new PacketReader(w.finish()));
    expect(result).toEqual({
      inviterName: "Thrall",
      guildName: "Horde Heroes",
    });
  });

  test("consumes all bytes", () => {
    const w = new PacketWriter();
    w.cString("A");
    w.cString("B");
    const r = new PacketReader(w.finish());
    parseGuildInvitePacket(r);
    expect(r.remaining).toBe(0);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `mise test src/wow/protocol/guild.test.ts`
Expected: FAIL — imports not found

**Step 3: Implement build functions, enums, and parse functions**

Append to `src/wow/protocol/guild.ts` after line 135:

```typescript
export function buildGuildInvite(name: string): Uint8Array {
  const w = new PacketWriter();
  w.cString(name);
  return w.finish();
}

export function buildGuildRemove(name: string): Uint8Array {
  const w = new PacketWriter();
  w.cString(name);
  return w.finish();
}

export function buildGuildPromote(name: string): Uint8Array {
  const w = new PacketWriter();
  w.cString(name);
  return w.finish();
}

export function buildGuildDemote(name: string): Uint8Array {
  const w = new PacketWriter();
  w.cString(name);
  return w.finish();
}

export function buildGuildLeader(name: string): Uint8Array {
  const w = new PacketWriter();
  w.cString(name);
  return w.finish();
}

export function buildGuildMotd(motd: string): Uint8Array {
  const w = new PacketWriter();
  w.cString(motd);
  return w.finish();
}

export const GuildCommand = {
  CREATE: 0,
  INVITE: 1,
  QUIT: 2,
  PROMOTE: 3,
  FOUNDER: 0x0c,
  MEMBER: 0x0d,
  PUBLIC_NOTE_CHANGED: 0x13,
  OFFICER_NOTE_CHANGED: 0x14,
} as const;

export const GuildCommandResult = {
  PLAYER_NO_MORE_IN_GUILD: 0x00,
  GUILD_INTERNAL: 0x01,
  ALREADY_IN_GUILD: 0x02,
  ALREADY_IN_GUILD_S: 0x03,
  INVITED_TO_GUILD: 0x04,
  ALREADY_INVITED_TO_GUILD_S: 0x05,
  GUILD_NAME_INVALID: 0x06,
  GUILD_NAME_EXISTS_S: 0x07,
  GUILD_LEADER_LEAVE_OR_PERMISSIONS: 0x08,
  GUILD_PLAYER_NOT_IN_GUILD: 0x09,
  GUILD_PLAYER_NOT_IN_GUILD_S: 0x0a,
  GUILD_PLAYER_NOT_FOUND_S: 0x0b,
  GUILD_NOT_ALLIED: 0x0c,
  GUILD_RANK_TOO_HIGH_S: 0x0d,
  GUILD_RANK_TOO_LOW_S: 0x0e,
  GUILD_RANKS_LOCKED: 0x11,
  GUILD_RANK_IN_USE: 0x12,
  GUILD_IGNORING_YOU_S: 0x13,
} as const;

export type GuildCommandResultPacket = {
  command: number;
  name: string;
  result: number;
};

export function parseGuildCommandResult(
  r: PacketReader,
): GuildCommandResultPacket {
  return {
    command: r.uint32LE(),
    name: r.cString(),
    result: r.uint32LE(),
  };
}

export type GuildInvitePacket = {
  inviterName: string;
  guildName: string;
};

export function parseGuildInvitePacket(r: PacketReader): GuildInvitePacket {
  return {
    inviterName: r.cString(),
    guildName: r.cString(),
  };
}

export function formatGuildCommandError(
  command: number,
  name: string,
  result: number,
): string | undefined {
  switch (result) {
    case GuildCommandResult.PLAYER_NO_MORE_IN_GUILD:
      return undefined;
    case GuildCommandResult.GUILD_INTERNAL:
      return "[guild] Internal guild error";
    case GuildCommandResult.ALREADY_IN_GUILD:
      return "[guild] You are already in a guild";
    case GuildCommandResult.ALREADY_IN_GUILD_S:
      return `[guild] ${name} is already in a guild`;
    case GuildCommandResult.INVITED_TO_GUILD:
      return "[guild] You have already been invited to a guild";
    case GuildCommandResult.ALREADY_INVITED_TO_GUILD_S:
      return `[guild] ${name} has already been invited to a guild`;
    case GuildCommandResult.GUILD_NAME_INVALID:
      return "[guild] Invalid guild name";
    case GuildCommandResult.GUILD_NAME_EXISTS_S:
      return `[guild] Guild name "${name}" already exists`;
    case GuildCommandResult.GUILD_LEADER_LEAVE_OR_PERMISSIONS:
      return "[guild] You don't have permission to do that";
    case GuildCommandResult.GUILD_PLAYER_NOT_IN_GUILD:
      return "[guild] You are not in a guild";
    case GuildCommandResult.GUILD_PLAYER_NOT_IN_GUILD_S:
      return `[guild] ${name} is not in your guild`;
    case GuildCommandResult.GUILD_PLAYER_NOT_FOUND_S:
      return `[guild] Player "${name}" not found`;
    case GuildCommandResult.GUILD_NOT_ALLIED:
      return `[guild] ${name} is not the same alliance as you`;
    case GuildCommandResult.GUILD_RANK_TOO_HIGH_S:
      return `[guild] ${name} has a rank too high for that`;
    case GuildCommandResult.GUILD_RANK_TOO_LOW_S:
      return `[guild] ${name} has a rank too low for that`;
    case GuildCommandResult.GUILD_RANKS_LOCKED:
      return "[guild] Guild ranks are locked";
    case GuildCommandResult.GUILD_RANK_IN_USE:
      return "[guild] That guild rank is in use";
    case GuildCommandResult.GUILD_IGNORING_YOU_S:
      return `[guild] ${name} is ignoring you`;
    default:
      return `[guild] Guild command error (${result})`;
  }
}
```

**Step 4: Update the import in the test file**

Replace the existing import at line 3-10 of `guild.test.ts` with the expanded import shown in Step 1.

**Step 5: Run tests to verify they pass**

Run: `mise test src/wow/protocol/guild.test.ts`
Expected: PASS

**Step 6: Commit**

```
feat: Add guild management packet builders and parsers

Build functions for CMSG_GUILD_INVITE, REMOVE, PROMOTE, DEMOTE,
LEADER, MOTD. Parse functions for SMSG_GUILD_COMMAND_RESULT and
SMSG_GUILD_INVITE. Enums for GuildCommand and GuildCommandResult.
```

---

### Task 2: GuildEvent Union — Add New Event Types

**Files:**

- Modify: `src/wow/guild-store.ts:35` (extend union before line 36)

**Step 1: Add new GuildEvent variants**

In `src/wow/guild-store.ts`, extend the `GuildEvent` union (before line 36, the semicolon):

```typescript
  | { type: "command_result"; command: number; name: string; result: number }
  | { type: "guild_invite"; inviter: string; guildName: string };
```

The full union at lines 23-37 should end:

```typescript
  | { type: "signed_on"; name: string }
  | { type: "signed_off"; name: string }
  | { type: "command_result"; command: number; name: string; result: number }
  | { type: "guild_invite"; inviter: string; guildName: string };
```

**Step 2: Run typecheck**

Run: `mise typecheck`
Expected: PASS (no consumers of these new variants yet, so no exhaustiveness errors)

**Step 3: Commit**

```
feat: Extend GuildEvent with command_result and guild_invite

These variants will carry SMSG_GUILD_COMMAND_RESULT errors and
SMSG_GUILD_INVITE prompts through the existing event pipeline.
```

---

### Task 3: World Handlers — SMSG_GUILD_COMMAND_RESULT and SMSG_GUILD_INVITE

**Files:**

- Modify: `src/wow/world-handlers.ts` (add two new exported handler functions after handleGuildEvent, around line 778)

**Step 1: Add the two handler functions**

After the `handleGuildEvent` function (which ends around line 778), add:

```typescript
export function handleGuildCommandResult(
  conn: WorldConn,
  r: PacketReader,
): void {
  const packet = parseGuildCommandResult(r);
  const msg = formatGuildCommandError(
    packet.command,
    packet.name,
    packet.result,
  );
  if (msg) {
    conn.onGuildEvent?.({
      type: "command_result",
      command: packet.command,
      name: packet.name,
      result: packet.result,
    });
  }
}

export function handleGuildInvitePacket(
  conn: WorldConn,
  r: PacketReader,
): void {
  const packet = parseGuildInvitePacket(r);
  conn.onGuildEvent?.({
    type: "guild_invite",
    inviter: packet.inviterName,
    guildName: packet.guildName,
  });
}
```

Add imports at the top of `world-handlers.ts`:

```typescript
import {
  parseGuildCommandResult,
  parseGuildInvitePacket,
  formatGuildCommandError,
} from "wow/protocol/guild";
```

(Alongside the existing guild imports from that file.)

**Step 2: Run typecheck**

Run: `mise typecheck`
Expected: PASS

**Step 3: Commit**

```
feat: Handle SMSG_GUILD_COMMAND_RESULT and SMSG_GUILD_INVITE

Parse incoming guild command results and fire GuildEvent for error
display. Parse incoming guild invite prompts for /gaccept /gdecline.
```

---

### Task 4: Client — WorldHandle Methods and Handler Registration

**Files:**

- Modify: `src/wow/client.ts:177-224` (WorldHandle type — add 9 method signatures)
- Modify: `src/wow/client.ts:509-511` (handler registrations — add 2 SMSG handlers)
- Modify: `src/wow/client.ts:847-849` (worldSession implementation — add 9 methods after onGuildEvent)

**Step 1: Add method signatures to WorldHandle type**

In `src/wow/client.ts`, after `onDuelEvent` (line 223) and before the closing `};` (line 224), add:

```typescript
  guildInvite(name: string): void;
  guildRemove(name: string): void;
  guildLeave(): void;
  guildPromote(name: string): void;
  guildDemote(name: string): void;
  guildLeader(name: string): void;
  guildMotd(motd: string): void;
  acceptGuildInvite(): void;
  declineGuildInvite(): void;
```

**Step 2: Register SMSG handlers**

After the SMSG_GUILD_EVENT handler registration (line 509-511), add:

```typescript
conn.dispatch.on(GameOpcode.SMSG_GUILD_COMMAND_RESULT, (r) =>
  handleGuildCommandResult(conn, r),
);
conn.dispatch.on(GameOpcode.SMSG_GUILD_INVITE, (r) =>
  handleGuildInvitePacket(conn, r),
);
```

Add `handleGuildCommandResult` and `handleGuildInvitePacket` to the existing import from `"wow/world-handlers"`.

**Step 3: Implement WorldHandle methods**

After the `onGuildEvent` method implementation (line 847-849), add:

```typescript
        guildInvite(name) {
          sendPacket(
            conn,
            GameOpcode.CMSG_GUILD_INVITE,
            buildGuildInvite(name),
          );
        },
        guildRemove(name) {
          sendPacket(
            conn,
            GameOpcode.CMSG_GUILD_REMOVE,
            buildGuildRemove(name),
          );
        },
        guildLeave() {
          sendPacket(
            conn,
            GameOpcode.CMSG_GUILD_LEAVE,
            new Uint8Array(0),
          );
        },
        guildPromote(name) {
          sendPacket(
            conn,
            GameOpcode.CMSG_GUILD_PROMOTE,
            buildGuildPromote(name),
          );
        },
        guildDemote(name) {
          sendPacket(
            conn,
            GameOpcode.CMSG_GUILD_DEMOTE,
            buildGuildDemote(name),
          );
        },
        guildLeader(name) {
          sendPacket(
            conn,
            GameOpcode.CMSG_GUILD_LEADER,
            buildGuildLeader(name),
          );
        },
        guildMotd(motd) {
          sendPacket(
            conn,
            GameOpcode.CMSG_GUILD_MOTD,
            buildGuildMotd(motd),
          );
        },
        acceptGuildInvite() {
          sendPacket(
            conn,
            GameOpcode.CMSG_GUILD_ACCEPT,
            new Uint8Array(0),
          );
        },
        declineGuildInvite() {
          sendPacket(
            conn,
            GameOpcode.CMSG_GUILD_DECLINE,
            new Uint8Array(0),
          );
        },
```

Add imports at the top:

```typescript
import {
  buildGuildInvite,
  buildGuildRemove,
  buildGuildPromote,
  buildGuildDemote,
  buildGuildLeader,
  buildGuildMotd,
} from "wow/protocol/guild";
```

**Step 4: Run typecheck**

Run: `mise typecheck`
Expected: FAIL — mock handles don't implement the new methods yet. That's expected; Task 5 fixes this.

**Step 5: Commit** (skip until mocks are fixed in Task 5)

---

### Task 5: Mock Handles — Add New Methods

**Files:**

- Modify: `src/test/mock-handle.ts:91` (add 9 jest.fn() methods before requestGuildRoster)
- Modify: `src/daemon/start.test.ts:86-87` (add 9 jest.fn() methods before requestGuildRoster)

**Step 1: Update shared mock handle**

In `src/test/mock-handle.ts`, after `removeIgnore: jest.fn(),` (line 88) and before `onIgnoreEvent(cb) {` (line 89), add:

```typescript
    guildInvite: jest.fn(),
    guildRemove: jest.fn(),
    guildLeave: jest.fn(),
    guildPromote: jest.fn(),
    guildDemote: jest.fn(),
    guildLeader: jest.fn(),
    guildMotd: jest.fn(),
    acceptGuildInvite: jest.fn(),
    declineGuildInvite: jest.fn(),
```

**Step 2: Update inline mock in start.test.ts**

In `src/daemon/start.test.ts`, after `onGuildEvent: jest.fn(),` (line 87) and before the closing `}),` (line 88), add:

```typescript
        guildInvite: jest.fn(),
        guildRemove: jest.fn(),
        guildLeave: jest.fn(),
        guildPromote: jest.fn(),
        guildDemote: jest.fn(),
        guildLeader: jest.fn(),
        guildMotd: jest.fn(),
        acceptGuildInvite: jest.fn(),
        declineGuildInvite: jest.fn(),
```

**Step 3: Run typecheck**

Run: `mise typecheck`
Expected: PASS

**Step 4: Commit (Tasks 4+5 together)**

```
feat: Add guild management methods to WorldHandle

Nine fire-and-forget methods: guildInvite, guildRemove, guildLeave,
guildPromote, guildDemote, guildLeader, guildMotd, acceptGuildInvite,
declineGuildInvite. Register SMSG_GUILD_COMMAND_RESULT and
SMSG_GUILD_INVITE handlers.
```

---

### Task 6: UI Command Parsing

**Files:**

- Modify: `src/ui/commands.ts:1-33` (add 9 new Command types to union)
- Modify: `src/ui/commands.ts:128-132` (replace unimplemented stubs)
- Test: `src/ui/commands.test.ts` (append new tests)

**Step 1: Write failing tests**

Append to `src/ui/commands.test.ts`:

```typescript
test("/ginvite parses target", () => {
  expect(parseCommand("/ginvite Thrall")).toEqual({
    type: "guild-invite",
    target: "Thrall",
  });
});

test("/ginvite without target becomes say", () => {
  expect(parseCommand("/ginvite")).toEqual({
    type: "say",
    message: "/ginvite",
  });
});

test("/gkick parses target", () => {
  expect(parseCommand("/gkick Garrosh")).toEqual({
    type: "guild-kick",
    target: "Garrosh",
  });
});

test("/gkick without target becomes say", () => {
  expect(parseCommand("/gkick")).toEqual({
    type: "say",
    message: "/gkick",
  });
});

test("/gleave parses", () => {
  expect(parseCommand("/gleave")).toEqual({ type: "guild-leave" });
});

test("/gpromote parses target", () => {
  expect(parseCommand("/gpromote Jaina")).toEqual({
    type: "guild-promote",
    target: "Jaina",
  });
});

test("/gpromote without target becomes say", () => {
  expect(parseCommand("/gpromote")).toEqual({
    type: "say",
    message: "/gpromote",
  });
});

test("/gdemote parses target", () => {
  expect(parseCommand("/gdemote Arthas")).toEqual({
    type: "guild-demote",
    target: "Arthas",
  });
});

test("/gdemote without target becomes say", () => {
  expect(parseCommand("/gdemote")).toEqual({
    type: "say",
    message: "/gdemote",
  });
});

test("/gleader parses target", () => {
  expect(parseCommand("/gleader Sylvanas")).toEqual({
    type: "guild-leader",
    target: "Sylvanas",
  });
});

test("/gleader without target becomes say", () => {
  expect(parseCommand("/gleader")).toEqual({
    type: "say",
    message: "/gleader",
  });
});

test("/gmotd parses message", () => {
  expect(parseCommand("/gmotd Raid tonight at 8pm")).toEqual({
    type: "guild-motd",
    message: "Raid tonight at 8pm",
  });
});

test("/gmotd with empty message clears motd", () => {
  expect(parseCommand("/gmotd")).toEqual({
    type: "guild-motd",
    message: "",
  });
});

test("/gaccept parses", () => {
  expect(parseCommand("/gaccept")).toEqual({ type: "guild-accept" });
});

test("/gdecline parses", () => {
  expect(parseCommand("/gdecline")).toEqual({ type: "guild-decline" });
});
```

**Step 2: Run tests to verify they fail**

Run: `mise test src/ui/commands.test.ts`
Expected: FAIL

**Step 3: Add new types to Command union**

In `src/ui/commands.ts`, add to the Command union (before `| { type: "unimplemented"; feature: string }`):

```typescript
  | { type: "guild-invite"; target: string }
  | { type: "guild-kick"; target: string }
  | { type: "guild-leave" }
  | { type: "guild-promote"; target: string }
  | { type: "guild-demote"; target: string }
  | { type: "guild-leader"; target: string }
  | { type: "guild-motd"; message: string }
  | { type: "guild-accept" }
  | { type: "guild-decline" }
```

**Step 4: Replace unimplemented stubs in parseCommand**

Replace lines 128-132:

```typescript
    case "/ginvite":
    case "/gkick":
    case "/gleave":
    case "/gpromote":
      return { type: "unimplemented", feature: "Guild management" };
```

With:

```typescript
    case "/ginvite":
      return rest
        ? { type: "guild-invite", target: rest }
        : { type: "say", message: input };
    case "/gkick":
      return rest
        ? { type: "guild-kick", target: rest }
        : { type: "say", message: input };
    case "/gleave":
      return { type: "guild-leave" };
    case "/gpromote":
      return rest
        ? { type: "guild-promote", target: rest }
        : { type: "say", message: input };
    case "/gdemote":
      return rest
        ? { type: "guild-demote", target: rest }
        : { type: "say", message: input };
    case "/gleader":
      return rest
        ? { type: "guild-leader", target: rest }
        : { type: "say", message: input };
    case "/gmotd":
      return { type: "guild-motd", message: rest };
    case "/gaccept":
      return { type: "guild-accept" };
    case "/gdecline":
      return { type: "guild-decline" };
```

**Step 5: Run tests to verify they pass**

Run: `mise test src/ui/commands.test.ts`
Expected: PASS

**Step 6: Commit**

```
feat: Parse guild management slash commands

/ginvite, /gkick, /gleave, /gpromote, /gdemote, /gleader, /gmotd,
/gaccept, /gdecline now parse into typed Command objects instead
of returning unimplemented.
```

---

### Task 7: Daemon Commands — IPC Parsing and Dispatch

**Files:**

- Modify: `src/daemon/commands.ts:47-86` (add IpcCommand types)
- Modify: `src/daemon/commands.ts:88-141` (slash-to-IPC mapping in parseIpcCommand)
- Modify: `src/daemon/commands.ts:244-248` (replace verb stubs)
- Modify: `src/daemon/commands.ts:471-493` (add dispatch cases before "unimplemented")
- Test: `src/daemon/commands.test.ts` (add tests)

**Step 1: Write failing tests for IPC parsing and dispatch**

Add tests to `src/daemon/commands.test.ts` for the new commands. Follow existing patterns (search for "INVITE" test in that file):

```typescript
test("GINVITE parses guild invite", () => {
  expect(parseIpcCommand("GINVITE Thrall")).toEqual({
    type: "guild_invite",
    target: "Thrall",
  });
});

test("GINVITE without target returns undefined", () => {
  expect(parseIpcCommand("GINVITE")).toBeUndefined();
});

test("GKICK parses guild kick", () => {
  expect(parseIpcCommand("GKICK Garrosh")).toEqual({
    type: "guild_kick",
    target: "Garrosh",
  });
});

test("GLEAVE parses guild leave", () => {
  expect(parseIpcCommand("GLEAVE")).toEqual({ type: "guild_leave" });
});

test("GPROMOTE parses guild promote", () => {
  expect(parseIpcCommand("GPROMOTE Jaina")).toEqual({
    type: "guild_promote",
    target: "Jaina",
  });
});

test("GDEMOTE parses guild demote", () => {
  expect(parseIpcCommand("GDEMOTE Arthas")).toEqual({
    type: "guild_demote",
    target: "Arthas",
  });
});

test("GLEADER parses guild leader", () => {
  expect(parseIpcCommand("GLEADER Sylvanas")).toEqual({
    type: "guild_leader",
    target: "Sylvanas",
  });
});

test("GMOTD parses guild motd", () => {
  expect(parseIpcCommand("GMOTD Raid tonight")).toEqual({
    type: "guild_motd",
    message: "Raid tonight",
  });
});

test("GMOTD with empty message clears motd", () => {
  expect(parseIpcCommand("GMOTD")).toEqual({
    type: "guild_motd",
    message: "",
  });
});

test("GACCEPT parses guild accept", () => {
  expect(parseIpcCommand("GACCEPT")).toEqual({ type: "guild_accept" });
});

test("GDECLINE parses guild decline", () => {
  expect(parseIpcCommand("GDECLINE")).toEqual({ type: "guild_decline" });
});

test("/ginvite via slash parses guild invite", () => {
  expect(parseIpcCommand("/ginvite Thrall")).toEqual({
    type: "guild_invite",
    target: "Thrall",
  });
});

test("/gaccept via slash parses guild accept", () => {
  expect(parseIpcCommand("/gaccept")).toEqual({ type: "guild_accept" });
});

test("/gdecline via slash parses guild decline", () => {
  expect(parseIpcCommand("/gdecline")).toEqual({ type: "guild_decline" });
});
```

**Step 2: Run tests to verify they fail**

Run: `mise test src/daemon/commands.test.ts`
Expected: FAIL

**Step 3: Add IpcCommand types**

In `src/daemon/commands.ts`, add to the IpcCommand union (before `| { type: "unimplemented"; feature: string }`):

```typescript
  | { type: "guild_invite"; target: string }
  | { type: "guild_kick"; target: string }
  | { type: "guild_leave" }
  | { type: "guild_promote"; target: string }
  | { type: "guild_demote"; target: string }
  | { type: "guild_leader"; target: string }
  | { type: "guild_motd"; message: string }
  | { type: "guild_accept" }
  | { type: "guild_decline" }
```

**Step 4: Update slash-to-IPC mapping in parseIpcCommand**

In the `switch (parsed.type)` block (around lines 91-141), add cases for the new UI command types. After the `"guild-roster"` case (line 135-136), add:

```typescript
      case "guild-invite":
        return { type: "guild_invite", target: parsed.target };
      case "guild-kick":
        return { type: "guild_kick", target: parsed.target };
      case "guild-leave":
        return { type: "guild_leave" };
      case "guild-promote":
        return { type: "guild_promote", target: parsed.target };
      case "guild-demote":
        return { type: "guild_demote", target: parsed.target };
      case "guild-leader":
        return { type: "guild_leader", target: parsed.target };
      case "guild-motd":
        return { type: "guild_motd", message: parsed.message };
      case "guild-accept":
        return { type: "guild_accept" };
      case "guild-decline":
        return { type: "guild_decline" };
```

**Step 5: Replace IPC verb stubs**

Replace lines 244-248:

```typescript
    case "GINVITE":
    case "GKICK":
    case "GLEAVE":
    case "GPROMOTE":
      return { type: "unimplemented", feature: "Guild management" };
```

With:

```typescript
    case "GINVITE":
      return rest ? { type: "guild_invite", target: rest } : undefined;
    case "GKICK":
      return rest ? { type: "guild_kick", target: rest } : undefined;
    case "GLEAVE":
      return { type: "guild_leave" };
    case "GPROMOTE":
      return rest ? { type: "guild_promote", target: rest } : undefined;
    case "GDEMOTE":
      return rest ? { type: "guild_demote", target: rest } : undefined;
    case "GLEADER":
      return rest ? { type: "guild_leader", target: rest } : undefined;
    case "GMOTD":
      return { type: "guild_motd", message: rest };
    case "GACCEPT":
      return { type: "guild_accept" };
    case "GDECLINE":
      return { type: "guild_decline" };
```

**Step 6: Add dispatch cases**

In `dispatchCommand()`, before the `"unimplemented"` case (line 491), add:

```typescript
    case "guild_invite":
      handle.guildInvite(cmd.target);
      writeLines(socket, ["OK"]);
      return false;
    case "guild_kick":
      handle.guildRemove(cmd.target);
      writeLines(socket, ["OK"]);
      return false;
    case "guild_leave":
      handle.guildLeave();
      writeLines(socket, ["OK"]);
      return false;
    case "guild_promote":
      handle.guildPromote(cmd.target);
      writeLines(socket, ["OK"]);
      return false;
    case "guild_demote":
      handle.guildDemote(cmd.target);
      writeLines(socket, ["OK"]);
      return false;
    case "guild_leader":
      handle.guildLeader(cmd.target);
      writeLines(socket, ["OK"]);
      return false;
    case "guild_motd":
      handle.guildMotd(cmd.message);
      writeLines(socket, ["OK"]);
      return false;
    case "guild_accept":
      handle.acceptGuildInvite();
      writeLines(socket, ["OK"]);
      return false;
    case "guild_decline":
      handle.declineGuildInvite();
      writeLines(socket, ["OK"]);
      return false;
```

**Step 7: Run tests**

Run: `mise test src/daemon/commands.test.ts`
Expected: PASS

**Step 8: Commit**

```
feat: Wire guild management commands through IPC

GINVITE, GKICK, GLEAVE, GPROMOTE, GDEMOTE, GLEADER, GMOTD, GACCEPT,
GDECLINE IPC verbs now dispatch to WorldHandle methods. Slash
commands route through the same pipeline.
```

---

### Task 8: Guild Event Formatting — command_result and guild_invite

**Files:**

- Modify: `src/daemon/commands.ts:672-749` (formatGuildEvent and formatGuildEventObj)

**Step 1: Add formatting for new GuildEvent types**

In `formatGuildEvent()` (line 672), add cases before the closing `}`:

```typescript
    case "command_result": {
      const msg = formatGuildCommandError(
        event.command,
        event.name,
        event.result,
      );
      return msg ?? "[guild] Command succeeded";
    }
    case "guild_invite":
      return `[guild] ${event.inviter} has invited you to join ${event.guildName}. Use /gaccept or /gdecline`;
```

In `formatGuildEventObj()` (line 701), add cases before the closing `}`:

```typescript
    case "command_result":
      return {
        type: "GUILD_COMMAND_RESULT",
        command: event.command,
        name: event.name,
        result: event.result,
      };
    case "guild_invite":
      return {
        type: "GUILD_INVITE_RECEIVED",
        inviter: event.inviter,
        guildName: event.guildName,
      };
```

Add import at the top of commands.ts:

```typescript
import { formatGuildCommandError } from "wow/protocol/guild";
```

**Step 2: Run typecheck and tests**

Run: `mise typecheck && mise test`
Expected: PASS

**Step 3: Commit**

```
feat: Format guild command results and invite prompts

SMSG_GUILD_COMMAND_RESULT errors display as human-readable text.
SMSG_GUILD_INVITE shows inviter and guild name with accept/decline
hint.
```

---

### Task 9: Remove Stubs

**Files:**

- Modify: `src/wow/protocol/stubs.ts:104-169` (remove implemented guild stubs)

**Step 1: Remove guild stubs that are now implemented**

Remove these stub entries from `src/wow/protocol/stubs.ts`:

- `SMSG_GUILD_COMMAND_RESULT` (lines 104-109)
- `CMSG_GUILD_INVITE` (lines 110-115)
- `SMSG_GUILD_INVITE` (lines 116-121)
- `CMSG_GUILD_ACCEPT` (lines 122-127)
- `CMSG_GUILD_DECLINE` (lines 128-133)
- `CMSG_GUILD_LEAVE` (lines 134-139)
- `CMSG_GUILD_REMOVE` (lines 140-145)
- `CMSG_GUILD_MOTD` (lines 146-151)
- `CMSG_GUILD_PROMOTE` (lines 152-157)
- `CMSG_GUILD_DEMOTE` (lines 158-163)
- `CMSG_GUILD_LEADER` (lines 164-169)

Keep `SMSG_GUILD_INFO` (lines 170-175) and `SMSG_GUILD_BANK_LIST` (lines 176-181) — those are not part of this implementation.

**Step 2: Run typecheck and tests**

Run: `mise typecheck && mise test`
Expected: PASS

**Step 3: Commit**

```
chore: Remove guild management stubs

All 11 guild management opcodes now have real handlers or send
functions. SMSG_GUILD_INFO and SMSG_GUILD_BANK_LIST remain stubbed.
```

---

### Task 10: Documentation

**Files:**

- Modify: `src/cli/help.ts:59` (add guild commands after /groster)
- Modify: `docs/manual.md:145` (add guild management rows to table)
- Modify: `.claude/skills/tuicraft/SKILL.md:142` (add guild management section)
- Modify: `README.md:170` (flip ❌ to ✅)

**Step 1: Update help.ts**

After `/groster        Show guild roster` (line 59), add:

```
  /ginvite <name> Invite player to guild
  /gkick <name>   Remove player from guild
  /gleave         Leave the guild
  /gpromote <name> Promote guild member
  /gdemote <name> Demote guild member
  /gleader <name> Transfer guild leadership
  /gmotd [msg]    Set guild message of the day
  /gaccept        Accept guild invitation
  /gdecline       Decline guild invitation
```

**Step 2: Update manual.md**

After the `/groster` row (line 145), add rows to the Interactive Commands table:

```
| `/ginvite` _name_            | Invite player to guild                     |
| `/gkick` _name_              | Remove player from guild                   |
| `/gleave`                    | Leave the guild                            |
| `/gpromote` _name_           | Promote guild member                       |
| `/gdemote` _name_            | Demote guild member                        |
| `/gleader` _name_            | Transfer guild leadership                  |
| `/gmotd` [_msg_]             | Set guild message of the day               |
| `/gaccept`                   | Accept guild invitation                    |
| `/gdecline`                  | Decline guild invitation                   |
```

Also add a "Guild Management" section after the "Guild Roster" section (around line 142):

```markdown
## Guild Management

    tuicraft send "/ginvite PlayerName"  # invite to guild
    tuicraft send "/gkick PlayerName"    # remove from guild
    tuicraft send "/gleave"              # leave guild
    tuicraft send "/gpromote PlayerName" # promote member
    tuicraft send "/gdemote PlayerName"  # demote member
    tuicraft send "/gleader PlayerName"  # transfer leadership
    tuicraft send "/gmotd New MOTD"      # set message of the day
    tuicraft send "/gaccept"             # accept guild invite
    tuicraft send "/gdecline"            # decline guild invite

IPC verbs:

    echo "GINVITE PlayerName" | nc -U $TMPDIR/tuicraft-$(id -u)/sock
    echo "GKICK PlayerName" | nc -U $TMPDIR/tuicraft-$(id -u)/sock
    echo "GLEAVE" | nc -U $TMPDIR/tuicraft-$(id -u)/sock
    echo "GPROMOTE PlayerName" | nc -U $TMPDIR/tuicraft-$(id -u)/sock
    echo "GDEMOTE PlayerName" | nc -U $TMPDIR/tuicraft-$(id -u)/sock
    echo "GLEADER PlayerName" | nc -U $TMPDIR/tuicraft-$(id -u)/sock
    echo "GMOTD New MOTD" | nc -U $TMPDIR/tuicraft-$(id -u)/sock
    echo "GACCEPT" | nc -U $TMPDIR/tuicraft-$(id -u)/sock
    echo "GDECLINE" | nc -U $TMPDIR/tuicraft-$(id -u)/sock
```

And add new event types to the event type table:

```
| GUILD_COMMAND_RESULT | Guild command error (permissions, not found)     |
| GUILD_INVITE_RECEIVED| Incoming guild invitation prompt                 |
```

**Step 3: Update SKILL.md**

After the Guild Roster section (around line 142), add:

```markdown
## Guild Management

    tuicraft send "/ginvite PlayerName"  # invite to guild
    tuicraft send "/gkick PlayerName"    # remove from guild
    tuicraft send "/gleave"              # leave guild
    tuicraft send "/gpromote PlayerName" # promote member
    tuicraft send "/gdemote PlayerName"  # demote member
    tuicraft send "/gleader PlayerName"  # transfer leadership
    tuicraft send "/gmotd New MOTD"      # set message of the day
    tuicraft send "/gaccept"             # accept guild invite
    tuicraft send "/gdecline"            # decline guild invite

IPC verbs:

    echo "GINVITE PlayerName" | nc -U $TMPDIR/tuicraft-$(id -u)/sock
    echo "GKICK PlayerName" | nc -U $TMPDIR/tuicraft-$(id -u)/sock
    echo "GLEAVE" | nc -U $TMPDIR/tuicraft-$(id -u)/sock
    echo "GPROMOTE PlayerName" | nc -U $TMPDIR/tuicraft-$(id -u)/sock
    echo "GDEMOTE PlayerName" | nc -U $TMPDIR/tuicraft-$(id -u)/sock
    echo "GLEADER PlayerName" | nc -U $TMPDIR/tuicraft-$(id -u)/sock
    echo "GMOTD New MOTD" | nc -U $TMPDIR/tuicraft-$(id -u)/sock
    echo "GACCEPT" | nc -U $TMPDIR/tuicraft-$(id -u)/sock
    echo "GDECLINE" | nc -U $TMPDIR/tuicraft-$(id -u)/sock
```

**Step 4: Update README.md**

Change line 170 from:

```
| Guild invite / kick / leave / promote | ❌     |
```

To:

```
| Guild invite / kick / leave / promote | ✅     |
```

**Step 5: Run full CI**

Run: `mise ci`
Expected: PASS

**Step 6: Commit**

```
docs: Document guild management commands

Update help text, manual, SKILL.md, and README feature matrix
with all 9 guild management commands and their IPC verbs.
```

---

### Task 11: Live Server Validation

**Step 1: Run live tests**

Run: `mise test:live`
Expected: PASS (guild commands are fire-and-forget; existing tests should still pass)

**Step 2: If tests fail, investigate and fix**

If live tests fail due to new handler registrations conflicting with stubs, check that the stub removal in Task 9 was complete and that no duplicate handler registrations exist.
