# Party Management Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add group invite/kick/leave/leader opcodes, incoming group event handling, and minimal party member stats parsing.

**Architecture:** New `group.ts` protocol file with builders and parsers. GroupEvent union type and onGroupEvent callback on WorldHandle, parallel to onMessage for chat. Party member tracking via SMSG_GROUP_LIST for GUID lookups needed by setLeader.

**Tech Stack:** Bun/TypeScript, bun:test, PacketWriter/PacketReader for protocol tests.

**Style:** Follow `/typescript-style` skill. No comments. Strict TypeScript.

---

### Task 1: Group Opcodes + Constants

**Files:**

- Modify: `src/wow/protocol/opcodes.ts`

**Step 1: Add group opcodes to GameOpcode**

Add these entries to the GameOpcode const (keep sorted by value):

```ts
CMSG_GROUP_INVITE: 0x006e,
SMSG_GROUP_INVITE: 0x006f,
CMSG_GROUP_ACCEPT: 0x0072,
CMSG_GROUP_DECLINE: 0x0073,
SMSG_GROUP_DECLINE: 0x0074,
CMSG_GROUP_UNINVITE: 0x0075,
SMSG_GROUP_UNINVITE: 0x0077,
CMSG_GROUP_SET_LEADER: 0x0078,
SMSG_GROUP_SET_LEADER: 0x0079,
CMSG_GROUP_DISBAND: 0x007b,
SMSG_GROUP_DESTROYED: 0x007c,
SMSG_GROUP_LIST: 0x007d,
SMSG_PARTY_MEMBER_STATS: 0x007e,
SMSG_PARTY_COMMAND_RESULT: 0x007f,
SMSG_PARTY_MEMBER_STATS_FULL: 0x02f2,
```

**Step 2: Add PartyResult constant**

```ts
export const PartyResult = {
  SUCCESS: 0x00,
  BAD_PLAYER_NAME: 0x01,
  TARGET_NOT_IN_GROUP: 0x02,
  TARGET_NOT_IN_INSTANCE: 0x03,
  GROUP_FULL: 0x04,
  ALREADY_IN_GROUP: 0x05,
  NOT_IN_GROUP: 0x06,
  NOT_LEADER: 0x07,
  PLAYER_WRONG_FACTION: 0x08,
  IGNORING_YOU: 0x09,
  LFG_PENDING: 0x0c,
  INVITE_RESTRICTED: 0x0d,
} as const;
```

**Step 3: Add PartyOperation constant**

```ts
export const PartyOperation = {
  INVITE: 0x00,
  UNINVITE: 0x01,
  LEAVE: 0x02,
  SWAP: 0x03,
} as const;
```

**Step 4: Add GroupUpdateFlag constant**

```ts
export const GroupUpdateFlag = {
  NONE: 0x00000000,
  STATUS: 0x00000001,
  CUR_HP: 0x00000002,
  MAX_HP: 0x00000004,
  POWER_TYPE: 0x00000008,
  CUR_POWER: 0x00000010,
  MAX_POWER: 0x00000020,
  LEVEL: 0x00000040,
  ZONE: 0x00000080,
  POSITION: 0x00000100,
  AURAS: 0x00000200,
  PET_GUID: 0x00000400,
  PET_NAME: 0x00000800,
  PET_MODEL_ID: 0x00001000,
  PET_CUR_HP: 0x00002000,
  PET_MAX_HP: 0x00004000,
  PET_POWER_TYPE: 0x00008000,
  PET_CUR_POWER: 0x00010000,
  PET_MAX_POWER: 0x00020000,
  PET_AURAS: 0x00040000,
  VEHICLE_SEAT: 0x00080000,
} as const;
```

**Step 5: Run typecheck**

Run: `mise typecheck`
Expected: PASS

**Step 6: Commit**

```
Add group management opcodes and constants

Opcodes for invite, accept, decline, uninvite, set leader, disband,
group list, party member stats, and party command result. Constants
for PartyResult, PartyOperation, and GroupUpdateFlag enums.
```

---

### Task 2: Group Packet Builders

**Files:**

- Create: `src/wow/protocol/group.ts`
- Create: `src/wow/protocol/group.test.ts`

**Step 1: Write failing tests for builders**

```ts
// src/wow/protocol/group.test.ts
import { test, expect, describe } from "bun:test";
import { PacketReader, PacketWriter } from "wow/protocol/packet";
import {
  buildGroupInvite,
  buildGroupAccept,
  buildGroupDecline,
  buildGroupUninvite,
  buildGroupDisband,
  buildGroupSetLeader,
} from "wow/protocol/group";

describe("buildGroupInvite", () => {
  test("writes name and trailing u32 zero", () => {
    const body = buildGroupInvite("Voidtrix");
    const r = new PacketReader(body);
    expect(r.cString()).toBe("Voidtrix");
    expect(r.uint32LE()).toBe(0);
    expect(r.remaining).toBe(0);
  });
});

describe("buildGroupAccept", () => {
  test("writes u32 zero", () => {
    const body = buildGroupAccept();
    const r = new PacketReader(body);
    expect(r.uint32LE()).toBe(0);
    expect(r.remaining).toBe(0);
  });
});

describe("buildGroupDecline", () => {
  test("returns empty body", () => {
    expect(buildGroupDecline().byteLength).toBe(0);
  });
});

describe("buildGroupUninvite", () => {
  test("writes name as CString", () => {
    const body = buildGroupUninvite("Voidtrix");
    const r = new PacketReader(body);
    expect(r.cString()).toBe("Voidtrix");
    expect(r.remaining).toBe(0);
  });
});

describe("buildGroupDisband", () => {
  test("returns empty body", () => {
    expect(buildGroupDisband().byteLength).toBe(0);
  });
});

describe("buildGroupSetLeader", () => {
  test("writes 8-byte GUID", () => {
    const body = buildGroupSetLeader(0x42, 0x01);
    const r = new PacketReader(body);
    expect(r.uint32LE()).toBe(0x42);
    expect(r.uint32LE()).toBe(0x01);
    expect(r.remaining).toBe(0);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `mise test src/wow/protocol/group.test.ts`
Expected: FAIL — module not found

**Step 3: Write implementations**

```ts
// src/wow/protocol/group.ts
import { PacketWriter } from "wow/protocol/packet";

export function buildGroupInvite(name: string): Uint8Array {
  const w = new PacketWriter();
  w.cString(name);
  w.uint32LE(0);
  return w.finish();
}

export function buildGroupAccept(): Uint8Array {
  const w = new PacketWriter();
  w.uint32LE(0);
  return w.finish();
}

export function buildGroupDecline(): Uint8Array {
  return new Uint8Array(0);
}

export function buildGroupUninvite(name: string): Uint8Array {
  const w = new PacketWriter();
  w.cString(name);
  return w.finish();
}

export function buildGroupDisband(): Uint8Array {
  return new Uint8Array(0);
}

export function buildGroupSetLeader(
  guidLow: number,
  guidHigh: number,
): Uint8Array {
  const w = new PacketWriter();
  w.uint32LE(guidLow);
  w.uint32LE(guidHigh);
  return w.finish();
}
```

**Step 4: Run test to verify it passes**

Run: `mise test src/wow/protocol/group.test.ts`
Expected: PASS — all 6 tests

**Step 5: Commit**

```
Add group packet builders

Builders for CMSG_GROUP_INVITE (name + u32 pad), CMSG_GROUP_ACCEPT
(u32 pad), CMSG_GROUP_DECLINE (empty), CMSG_GROUP_UNINVITE (name),
CMSG_GROUP_DISBAND (empty), and CMSG_GROUP_SET_LEADER (8-byte GUID).
```

---

### Task 3: Simple Group Packet Parsers

**Files:**

- Modify: `src/wow/protocol/group.ts`
- Modify: `src/wow/protocol/group.test.ts`

**Step 1: Write failing tests for parsers**

Add to `src/wow/protocol/group.test.ts`:

```ts
import {
  // ... existing imports
  parsePartyCommandResult,
  parseGroupInvite,
  parseGroupSetLeader,
  parseGroupDecline,
} from "wow/protocol/group";
import { PartyResult, PartyOperation } from "wow/protocol/opcodes";

describe("parsePartyCommandResult", () => {
  test("parses invite success", () => {
    const w = new PacketWriter();
    w.uint32LE(PartyOperation.INVITE);
    w.cString("Voidtrix");
    w.uint32LE(PartyResult.SUCCESS);
    w.uint32LE(0);

    const result = parsePartyCommandResult(new PacketReader(w.finish()));
    expect(result.operation).toBe(PartyOperation.INVITE);
    expect(result.member).toBe("Voidtrix");
    expect(result.result).toBe(PartyResult.SUCCESS);
    expect(result.val).toBe(0);
  });

  test("parses player not found", () => {
    const w = new PacketWriter();
    w.uint32LE(PartyOperation.INVITE);
    w.cString("Nobody");
    w.uint32LE(PartyResult.BAD_PLAYER_NAME);
    w.uint32LE(0);

    const result = parsePartyCommandResult(new PacketReader(w.finish()));
    expect(result.result).toBe(PartyResult.BAD_PLAYER_NAME);
  });
});

describe("parseGroupInvite", () => {
  test("parses incoming invite", () => {
    const w = new PacketWriter();
    w.uint8(1);
    w.cString("Voidtrix");
    w.uint32LE(0);
    w.uint8(0);
    w.uint32LE(0);

    const result = parseGroupInvite(new PacketReader(w.finish()));
    expect(result.status).toBe(1);
    expect(result.name).toBe("Voidtrix");
  });
});

describe("parseGroupSetLeader", () => {
  test("parses leader name", () => {
    const w = new PacketWriter();
    w.cString("Xia");

    const result = parseGroupSetLeader(new PacketReader(w.finish()));
    expect(result.name).toBe("Xia");
  });
});

describe("parseGroupDecline", () => {
  test("parses declining player name", () => {
    const w = new PacketWriter();
    w.cString("Voidtrix");

    const result = parseGroupDecline(new PacketReader(w.finish()));
    expect(result.name).toBe("Voidtrix");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `mise test src/wow/protocol/group.test.ts`
Expected: FAIL — functions not exported

**Step 3: Write implementations**

Add to `src/wow/protocol/group.ts`:

```ts
import { PacketReader } from "wow/protocol/packet";

export type PartyCommandResult = {
  operation: number;
  member: string;
  result: number;
  val: number;
};

export function parsePartyCommandResult(r: PacketReader): PartyCommandResult {
  return {
    operation: r.uint32LE(),
    member: r.cString(),
    result: r.uint32LE(),
    val: r.uint32LE(),
  };
}

export type GroupInviteReceived = {
  status: number;
  name: string;
};

export function parseGroupInvite(r: PacketReader): GroupInviteReceived {
  const status = r.uint8();
  const name = r.cString();
  r.uint32LE();
  r.uint8();
  r.uint32LE();
  return { status, name };
}

export function parseGroupSetLeader(r: PacketReader): { name: string } {
  return { name: r.cString() };
}

export function parseGroupDecline(r: PacketReader): { name: string } {
  return { name: r.cString() };
}
```

**Step 4: Run tests**

Run: `mise test src/wow/protocol/group.test.ts`
Expected: PASS

**Step 5: Commit**

```
Add simple group packet parsers

Parsers for SMSG_PARTY_COMMAND_RESULT (operation + member + result +
val), SMSG_GROUP_INVITE (status + inviter name), SMSG_GROUP_SET_LEADER
(new leader name), and SMSG_GROUP_DECLINE (decliner name).
```

---

### Task 4: Group List + Party Member Stats Parsers

**Files:**

- Modify: `src/wow/protocol/group.ts`
- Modify: `src/wow/protocol/group.test.ts`

**Step 1: Write failing test for parseGroupList**

```ts
describe("parseGroupList", () => {
  test("parses two-member group", () => {
    const w = new PacketWriter();
    w.uint8(0);
    w.uint8(0);
    w.uint8(0);
    w.uint8(0);
    w.uint32LE(0);
    w.uint32LE(0);
    w.uint32LE(1);
    w.uint32LE(2);
    // member 1
    w.cString("Xia");
    w.uint32LE(0x10);
    w.uint32LE(0x00);
    w.uint8(1);
    w.uint8(0);
    w.uint8(0);
    w.uint8(0);
    // member 2
    w.cString("Voidtrix");
    w.uint32LE(0x20);
    w.uint32LE(0x00);
    w.uint8(1);
    w.uint8(0);
    w.uint8(0);
    w.uint8(0);
    // leader GUID
    w.uint32LE(0x10);
    w.uint32LE(0x00);

    const result = parseGroupList(new PacketReader(w.finish()));
    expect(result.members).toHaveLength(2);
    expect(result.members[0]!.name).toBe("Xia");
    expect(result.members[0]!.guidLow).toBe(0x10);
    expect(result.members[0]!.online).toBe(true);
    expect(result.members[1]!.name).toBe("Voidtrix");
    expect(result.leaderGuidLow).toBe(0x10);
  });

  test("parses empty group", () => {
    const w = new PacketWriter();
    w.uint8(0);
    w.uint8(0);
    w.uint8(0);
    w.uint8(0);
    w.uint32LE(0);
    w.uint32LE(0);
    w.uint32LE(0);
    w.uint32LE(0);
    w.uint32LE(0);
    w.uint32LE(0);

    const result = parseGroupList(new PacketReader(w.finish()));
    expect(result.members).toHaveLength(0);
  });
});
```

**Step 2: Write failing test for parsePartyMemberStats**

```ts
import { GroupUpdateFlag } from "wow/protocol/opcodes";

describe("parsePartyMemberStats", () => {
  test("parses status + hp + level", () => {
    const w = new PacketWriter();
    // packed guid: mask=0x01, one byte 0x42 (guidLow=0x42)
    w.uint8(0x01);
    w.uint8(0x42);
    // mask: STATUS | CUR_HP | MAX_HP | LEVEL
    const mask =
      GroupUpdateFlag.STATUS |
      GroupUpdateFlag.CUR_HP |
      GroupUpdateFlag.MAX_HP |
      GroupUpdateFlag.LEVEL;
    w.uint32LE(mask);
    w.uint16LE(0x01); // status: ONLINE
    w.uint32LE(12000); // cur hp
    w.uint32LE(15000); // max hp
    w.uint16LE(80); // level

    const result = parsePartyMemberStats(new PacketReader(w.finish()));
    expect(result.guidLow).toBe(0x42);
    expect(result.online).toBe(true);
    expect(result.hp).toBe(12000);
    expect(result.maxHp).toBe(15000);
    expect(result.level).toBe(80);
  });

  test("parses status-only update", () => {
    const w = new PacketWriter();
    w.uint8(0x01);
    w.uint8(0x10);
    w.uint32LE(GroupUpdateFlag.STATUS);
    w.uint16LE(0x04); // DEAD

    const result = parsePartyMemberStats(new PacketReader(w.finish()));
    expect(result.guidLow).toBe(0x10);
    expect(result.online).toBe(false);
    expect(result.hp).toBeUndefined();
  });

  test("skips power and zone fields correctly", () => {
    const w = new PacketWriter();
    w.uint8(0x01);
    w.uint8(0x10);
    const mask =
      GroupUpdateFlag.STATUS |
      GroupUpdateFlag.POWER_TYPE |
      GroupUpdateFlag.CUR_POWER |
      GroupUpdateFlag.MAX_POWER |
      GroupUpdateFlag.LEVEL |
      GroupUpdateFlag.ZONE;
    w.uint32LE(mask);
    w.uint16LE(0x01); // status
    w.uint8(0); // power type
    w.uint16LE(5000); // cur power
    w.uint16LE(8000); // max power
    w.uint16LE(80); // level
    w.uint16LE(1); // zone

    const result = parsePartyMemberStats(new PacketReader(w.finish()));
    expect(result.level).toBe(80);
    expect(result.online).toBe(true);
  });

  test("skips auras correctly", () => {
    const w = new PacketWriter();
    w.uint8(0x01);
    w.uint8(0x10);
    const mask = GroupUpdateFlag.STATUS | GroupUpdateFlag.AURAS;
    w.uint32LE(mask);
    w.uint16LE(0x01); // status
    // aura mask: u64 with bit 0 and bit 2 set (2 auras)
    w.uint32LE(0x05); // lo: bits 0 and 2
    w.uint32LE(0x00); // hi: none
    // aura 0: spellId + flags
    w.uint32LE(12345);
    w.uint8(0);
    // aura 2: spellId + flags
    w.uint32LE(67890);
    w.uint8(0);

    const result = parsePartyMemberStats(new PacketReader(w.finish()));
    expect(result.online).toBe(true);
  });

  test("handles full stats variant with leading byte", () => {
    const w = new PacketWriter();
    w.uint8(0); // unknown prefix byte
    w.uint8(0x01);
    w.uint8(0x42);
    w.uint32LE(GroupUpdateFlag.STATUS | GroupUpdateFlag.CUR_HP);
    w.uint16LE(0x01);
    w.uint32LE(10000);

    const result = parsePartyMemberStats(new PacketReader(w.finish()), true);
    expect(result.guidLow).toBe(0x42);
    expect(result.hp).toBe(10000);
  });
});
```

**Step 3: Run tests to verify they fail**

Run: `mise test src/wow/protocol/group.test.ts`
Expected: FAIL — functions not exported

**Step 4: Write parseGroupList**

Add to `src/wow/protocol/group.ts`:

```ts
export type GroupMember = {
  name: string;
  guidLow: number;
  guidHigh: number;
  online: boolean;
};

export type GroupList = {
  members: GroupMember[];
  leaderGuidLow: number;
  leaderGuidHigh: number;
};

export function parseGroupList(r: PacketReader): GroupList {
  r.uint8();
  r.uint8();
  r.uint8();
  r.uint8();
  r.uint32LE();
  r.uint32LE();
  r.uint32LE();
  const memberCount = r.uint32LE();
  const members: GroupMember[] = [];
  for (let i = 0; i < memberCount; i++) {
    const name = r.cString();
    const guidLow = r.uint32LE();
    const guidHigh = r.uint32LE();
    const online = r.uint8() !== 0;
    r.uint8();
    r.uint8();
    r.uint8();
    members.push({ name, guidLow, guidHigh, online });
  }
  const leaderGuidLow = r.uint32LE();
  const leaderGuidHigh = r.uint32LE();
  return { members, leaderGuidLow, leaderGuidHigh };
}
```

**Step 5: Write parsePartyMemberStats**

Add to `src/wow/protocol/group.ts`:

```ts
import { GroupUpdateFlag } from "wow/protocol/opcodes";

export type PartyMemberStats = {
  guidLow: number;
  guidHigh: number;
  online?: boolean;
  hp?: number;
  maxHp?: number;
  level?: number;
};

function skipAuras(r: PacketReader): void {
  const lo = r.uint32LE();
  const hi = r.uint32LE();
  for (let i = 0; i < 32; i++) {
    if (lo & (1 << i)) {
      r.uint32LE();
      r.uint8();
    }
  }
  for (let i = 0; i < 32; i++) {
    if (hi & (1 << i)) {
      r.uint32LE();
      r.uint8();
    }
  }
}

export function parsePartyMemberStats(
  r: PacketReader,
  isFull = false,
): PartyMemberStats {
  if (isFull) r.uint8();
  const { low: guidLow, high: guidHigh } = r.packedGuid();
  const mask = r.uint32LE();
  const result: PartyMemberStats = { guidLow, guidHigh };

  if (mask & GroupUpdateFlag.STATUS) {
    const status = r.uint16LE();
    result.online = (status & 0x01) !== 0;
  }
  if (mask & GroupUpdateFlag.CUR_HP) result.hp = r.uint32LE();
  if (mask & GroupUpdateFlag.MAX_HP) result.maxHp = r.uint32LE();
  if (mask & GroupUpdateFlag.POWER_TYPE) r.uint8();
  if (mask & GroupUpdateFlag.CUR_POWER) r.uint16LE();
  if (mask & GroupUpdateFlag.MAX_POWER) r.uint16LE();
  if (mask & GroupUpdateFlag.LEVEL) result.level = r.uint16LE();
  if (mask & GroupUpdateFlag.ZONE) r.uint16LE();
  if (mask & GroupUpdateFlag.POSITION) {
    r.uint16LE();
    r.uint16LE();
  }
  if (mask & GroupUpdateFlag.AURAS) skipAuras(r);
  if (mask & GroupUpdateFlag.PET_GUID) {
    r.uint32LE();
    r.uint32LE();
  }
  if (mask & GroupUpdateFlag.PET_NAME) r.cString();
  if (mask & GroupUpdateFlag.PET_MODEL_ID) r.uint16LE();
  if (mask & GroupUpdateFlag.PET_CUR_HP) r.uint32LE();
  if (mask & GroupUpdateFlag.PET_MAX_HP) r.uint32LE();
  if (mask & GroupUpdateFlag.PET_POWER_TYPE) r.uint8();
  if (mask & GroupUpdateFlag.PET_CUR_POWER) r.uint16LE();
  if (mask & GroupUpdateFlag.PET_MAX_POWER) r.uint16LE();
  if (mask & GroupUpdateFlag.PET_AURAS) skipAuras(r);
  if (mask & GroupUpdateFlag.VEHICLE_SEAT) r.uint32LE();

  return result;
}
```

**Step 6: Run tests**

Run: `mise test src/wow/protocol/group.test.ts`
Expected: PASS

**Step 7: Commit**

```
Add group list and party member stats parsers

parseGroupList extracts member names, GUIDs, and online status from
SMSG_GROUP_LIST. parsePartyMemberStats does a minimal parse of the
bitmask-driven differential update (status, HP, level) while correctly
skipping all other fields including variable-length aura arrays.
```

---

### Task 5: GroupEvent Type + WorldHandle Group Methods

**Files:**

- Modify: `src/wow/client.ts` — GroupEvent type, partyMembers state, onGroupEvent, new methods
- Modify: `src/test/mock-handle.ts` — add group mocks

**Step 1: Add GroupEvent type to client.ts**

After the ChatMessage type:

```ts
export type GroupEvent =
  | { type: "invite_received"; from: string }
  | { type: "invite_result"; target: string; result: number }
  | { type: "leader_changed"; name: string }
  | {
      type: "group_list";
      members: Array<{
        name: string;
        guidLow: number;
        guidHigh: number;
        online: boolean;
      }>;
      leader: string;
    }
  | { type: "group_destroyed" }
  | { type: "kicked" }
  | { type: "invite_declined"; name: string }
  | {
      type: "member_stats";
      guidLow: number;
      online?: boolean;
      hp?: number;
      maxHp?: number;
      level?: number;
    };
```

**Step 2: Add new WorldConn fields**

```ts
partyMembers: Map<string, { guidLow: number; guidHigh: number }>;
onGroupEvent?: (event: GroupEvent) => void;
```

Initialize in worldSession:

```ts
partyMembers: new Map(),
```

**Step 3: Add new WorldHandle methods**

Add to WorldHandle type:

```ts
invite(name: string): void;
uninvite(name: string): void;
leaveGroup(): void;
setLeader(name: string): void;
acceptInvite(): void;
declineInvite(): void;
onGroupEvent(cb: (event: GroupEvent) => void): void;
```

Implement in the worldSession resolve block. Import builders from group.ts:

```ts
invite(name) {
  sendPacket(conn, GameOpcode.CMSG_GROUP_INVITE, buildGroupInvite(name));
},
uninvite(name) {
  sendPacket(
    conn,
    GameOpcode.CMSG_GROUP_UNINVITE,
    buildGroupUninvite(name),
  );
},
leaveGroup() {
  sendPacket(conn, GameOpcode.CMSG_GROUP_DISBAND, buildGroupDisband());
},
setLeader(name) {
  const member = conn.partyMembers.get(name);
  if (!member) {
    conn.onMessage?.({
      type: ChatType.SYSTEM,
      sender: "",
      message: `"${name}" is not in your party.`,
    });
    return;
  }
  sendPacket(
    conn,
    GameOpcode.CMSG_GROUP_SET_LEADER,
    buildGroupSetLeader(member.guidLow, member.guidHigh),
  );
},
acceptInvite() {
  sendPacket(conn, GameOpcode.CMSG_GROUP_ACCEPT, buildGroupAccept());
},
declineInvite() {
  sendPacket(conn, GameOpcode.CMSG_GROUP_DECLINE, buildGroupDecline());
},
onGroupEvent(cb) {
  conn.onGroupEvent = cb;
},
```

**Step 4: Wire SMSG handlers**

Add handler functions and register them in worldSession. Import parsers from
group.ts:

```ts
function handlePartyCommandResult(conn: WorldConn, r: PacketReader): void {
  const result = parsePartyCommandResult(r);
  conn.onGroupEvent?.({
    type: "invite_result",
    target: result.member,
    result: result.result,
  });
}

function handleGroupInvite(conn: WorldConn, r: PacketReader): void {
  const invite = parseGroupInvite(r);
  conn.onGroupEvent?.({ type: "invite_received", from: invite.name });
}

function handleGroupSetLeader(conn: WorldConn, r: PacketReader): void {
  const { name } = parseGroupSetLeaderPkt(r);
  conn.onGroupEvent?.({ type: "leader_changed", name });
}

function handleGroupList(conn: WorldConn, r: PacketReader): void {
  const list = parseGroupListPkt(r);
  conn.partyMembers.clear();
  let leaderName = "";
  for (const m of list.members) {
    conn.partyMembers.set(m.name, {
      guidLow: m.guidLow,
      guidHigh: m.guidHigh,
    });
    if (
      m.guidLow === list.leaderGuidLow &&
      m.guidHigh === list.leaderGuidHigh
    ) {
      leaderName = m.name;
    }
  }
  conn.onGroupEvent?.({
    type: "group_list",
    members: list.members,
    leader: leaderName,
  });
}

function handleGroupDestroyed(conn: WorldConn): void {
  conn.partyMembers.clear();
  conn.onGroupEvent?.({ type: "group_destroyed" });
}

function handleGroupUninvite(conn: WorldConn): void {
  conn.partyMembers.clear();
  conn.onGroupEvent?.({ type: "kicked" });
}

function handleGroupDecline(conn: WorldConn, r: PacketReader): void {
  const { name } = parseGroupDeclinePkt(r);
  conn.onGroupEvent?.({ type: "invite_declined", name });
}

function handlePartyMemberStats(
  conn: WorldConn,
  r: PacketReader,
  isFull = false,
): void {
  const stats = parsePartyMemberStatsPkt(r, isFull);
  conn.onGroupEvent?.({
    type: "member_stats",
    guidLow: stats.guidLow,
    online: stats.online,
    hp: stats.hp,
    maxHp: stats.maxHp,
    level: stats.level,
  });
}
```

Register in worldSession (after existing handler registrations):

```ts
conn.dispatch.on(GameOpcode.SMSG_PARTY_COMMAND_RESULT, (r) =>
  handlePartyCommandResult(conn, r),
);
conn.dispatch.on(GameOpcode.SMSG_GROUP_INVITE, (r) =>
  handleGroupInvite(conn, r),
);
conn.dispatch.on(GameOpcode.SMSG_GROUP_SET_LEADER, (r) =>
  handleGroupSetLeader(conn, r),
);
conn.dispatch.on(GameOpcode.SMSG_GROUP_LIST, (r) => handleGroupList(conn, r));
conn.dispatch.on(GameOpcode.SMSG_GROUP_DESTROYED, () =>
  handleGroupDestroyed(conn),
);
conn.dispatch.on(GameOpcode.SMSG_GROUP_UNINVITE, () =>
  handleGroupUninvite(conn),
);
conn.dispatch.on(GameOpcode.SMSG_GROUP_DECLINE, (r) =>
  handleGroupDecline(conn, r),
);
conn.dispatch.on(GameOpcode.SMSG_PARTY_MEMBER_STATS, (r) =>
  handlePartyMemberStats(conn, r),
);
conn.dispatch.on(GameOpcode.SMSG_PARTY_MEMBER_STATS_FULL, (r) =>
  handlePartyMemberStats(conn, r, true),
);
```

Note: the parser function names imported from group.ts may collide with handler
names. Use distinct names — e.g. import as `parseGroupSetLeader as
parseGroupSetLeaderPkt` or name the handlers differently. The implementing agent
should pick non-colliding names.

**Step 5: Update mock-handle**

Add all new methods as jest.fn() mocks:

```ts
invite: jest.fn(),
uninvite: jest.fn(),
leaveGroup: jest.fn(),
setLeader: jest.fn(),
acceptInvite: jest.fn(),
declineInvite: jest.fn(),
onGroupEvent(cb) {
  groupEventCb = cb;
},
```

Add a `triggerGroupEvent` helper alongside `triggerMessage`:

```ts
let groupEventCb: ((event: GroupEvent) => void) | undefined;

// in the returned object:
triggerGroupEvent(event: GroupEvent) {
  groupEventCb?.(event);
},
```

Update the return type to include `triggerGroupEvent`.

**Step 6: Run typecheck and tests**

Run: `mise ci`
Expected: All pass

**Step 7: Commit**

```
Add group event handling and WorldHandle group methods

GroupEvent union type covers invite, kick, leader change, group list,
disband, member stats. WorldHandle gains invite, uninvite, leaveGroup,
setLeader (GUID lookup via partyMembers), acceptInvite, declineInvite.
Nine SMSG handlers wired for the full group lifecycle.
```

---

### Task 6: TUI Group Commands

**Files:**

- Modify: `src/ui/tui.ts` — new Command variants, parseCommand, executeCommand, group event display
- Modify: `src/ui/tui.test.ts` — tests for new commands

**Step 1: Write failing tests**

```ts
describe("parseCommand group commands", () => {
  test("/invite", () => {
    expect(parseCommand("/invite Voidtrix")).toEqual({
      type: "invite",
      target: "Voidtrix",
    });
  });

  test("/kick", () => {
    expect(parseCommand("/kick Voidtrix")).toEqual({
      type: "kick",
      target: "Voidtrix",
    });
  });

  test("/leave", () => {
    expect(parseCommand("/leave")).toEqual({ type: "leave" });
  });

  test("/leader", () => {
    expect(parseCommand("/leader Voidtrix")).toEqual({
      type: "leader",
      target: "Voidtrix",
    });
  });

  test("/accept", () => {
    expect(parseCommand("/accept")).toEqual({ type: "accept" });
  });

  test("/decline", () => {
    expect(parseCommand("/decline")).toEqual({ type: "decline" });
  });
});

describe("startTui group commands", () => {
  test("/invite calls handle.invite", async () => {
    const handle = createMockHandle();
    const input = new PassThrough();

    const done = startTui(handle, false, { input, write: () => {} });
    writeLine(input, "/invite Voidtrix");
    await flush();

    expect(handle.invite).toHaveBeenCalledWith("Voidtrix");

    input.end();
    await done;
  });

  test("/kick calls handle.uninvite", async () => {
    const handle = createMockHandle();
    const input = new PassThrough();

    const done = startTui(handle, false, { input, write: () => {} });
    writeLine(input, "/kick Voidtrix");
    await flush();

    expect(handle.uninvite).toHaveBeenCalledWith("Voidtrix");

    input.end();
    await done;
  });

  test("/leave calls handle.leaveGroup", async () => {
    const handle = createMockHandle();
    const input = new PassThrough();

    const done = startTui(handle, false, { input, write: () => {} });
    writeLine(input, "/leave");
    await flush();

    expect(handle.leaveGroup).toHaveBeenCalled();

    input.end();
    await done;
  });
});
```

**Step 2: Run test to verify fails**

Run: `mise test src/ui/tui.test.ts`
Expected: FAIL

**Step 3: Add Command variants and parseCommand cases**

Add to Command union:

```ts
| { type: "invite"; target: string }
| { type: "kick"; target: string }
| { type: "leave" }
| { type: "leader"; target: string }
| { type: "accept" }
| { type: "decline" }
```

Add cases to parseCommand switch:

```ts
case "/invite":
  return { type: "invite", target: rest };
case "/kick":
  return { type: "kick", target: rest };
case "/leave":
  return { type: "leave" };
case "/leader":
  return { type: "leader", target: rest };
case "/accept":
  return { type: "accept" };
case "/decline":
  return { type: "decline" };
```

**Step 4: Add executeCommand handlers**

```ts
case "invite":
  state.handle.invite(cmd.target);
  break;
case "kick":
  state.handle.uninvite(cmd.target);
  break;
case "leave":
  state.handle.leaveGroup();
  break;
case "leader":
  state.handle.setLeader(cmd.target);
  break;
case "accept":
  state.handle.acceptInvite();
  break;
case "decline":
  state.handle.declineInvite();
  break;
```

**Step 5: Add group event display to startTui**

In `startTui`, after `handle.onMessage(...)`, register group event handler:

```ts
handle.onGroupEvent((event) => {
  const line = formatGroupEvent(event);
  if (!line) return;
  write(interactive ? `\r\x1b[K${line}\n` : line + "\n");
  if (interactive) rl.prompt(true);
});
```

Add formatGroupEvent helper. Import PartyResult from opcodes:

```ts
export function formatGroupEvent(event: GroupEvent): string | undefined {
  switch (event.type) {
    case "invite_received":
      return `[group] ${event.from} invites you to a group`;
    case "invite_result": {
      const label =
        event.result === PartyResult.SUCCESS
          ? `Invited ${event.target}`
          : `Cannot invite ${event.target}: ${partyResultLabel(event.result)}`;
      return `[group] ${label}`;
    }
    case "leader_changed":
      return `[group] ${event.name} is now the group leader`;
    case "group_destroyed":
      return "[group] Group has been disbanded";
    case "kicked":
      return "[group] You have been removed from the group";
    case "invite_declined":
      return `[group] ${event.name} has declined your invitation`;
    case "group_list":
    case "member_stats":
      return undefined;
  }
}

function partyResultLabel(result: number): string {
  switch (result) {
    case PartyResult.BAD_PLAYER_NAME:
      return "player not found";
    case PartyResult.GROUP_FULL:
      return "group is full";
    case PartyResult.ALREADY_IN_GROUP:
      return "already in a group";
    case PartyResult.NOT_LEADER:
      return "you are not the leader";
    case PartyResult.PLAYER_WRONG_FACTION:
      return "wrong faction";
    case PartyResult.IGNORING_YOU:
      return "player is ignoring you";
    default:
      return `error ${result}`;
  }
}
```

**Step 6: Run tests**

Run: `mise test`
Expected: All pass

**Step 7: Commit**

```
Add group slash commands and event display to TUI

/invite, /kick, /leave, /leader, /accept, /decline call the
corresponding WorldHandle methods. Incoming group events display
as [group] lines (invite received, leader changed, disbanded, etc).
```

---

### Task 7: Daemon Group Commands

**Files:**

- Modify: `src/daemon/commands.ts` — new IpcCommand variants, parseIpcCommand, dispatchCommand, group events in ring buffer
- Modify: `src/daemon/commands.test.ts` — tests
- Modify: `src/daemon/server.ts` — wire onGroupEvent

**Step 1: Write failing tests**

Add to parseIpcCommand describe:

```ts
test("INVITE", () => {
  expect(parseIpcCommand("INVITE Voidtrix")).toEqual({
    type: "invite",
    target: "Voidtrix",
  });
});

test("KICK", () => {
  expect(parseIpcCommand("KICK Voidtrix")).toEqual({
    type: "kick",
    target: "Voidtrix",
  });
});

test("LEAVE", () => {
  expect(parseIpcCommand("LEAVE")).toEqual({ type: "leave" });
});

test("LEADER", () => {
  expect(parseIpcCommand("LEADER Voidtrix")).toEqual({
    type: "leader",
    target: "Voidtrix",
  });
});

test("ACCEPT", () => {
  expect(parseIpcCommand("ACCEPT")).toEqual({ type: "accept" });
});

test("DECLINE", () => {
  expect(parseIpcCommand("DECLINE")).toEqual({ type: "decline" });
});
```

Add dispatchCommand tests:

```ts
test("invite calls handle.invite and writes OK", async () => {
  const handle = createMockHandle();
  const events = new RingBuffer<EventEntry>(10);
  const socket = createMockSocket();
  const cleanup = jest.fn();

  await dispatchCommand(
    { type: "invite", target: "Voidtrix" },
    handle,
    events,
    socket,
    cleanup,
  );

  expect(handle.invite).toHaveBeenCalledWith("Voidtrix");
  expect(socket.written()).toBe("OK\n\n");
});
```

**Step 2: Run tests to verify they fail**

Run: `mise test src/daemon/commands.test.ts`
Expected: FAIL

**Step 3: Add IpcCommand variants**

```ts
| { type: "invite"; target: string }
| { type: "kick"; target: string }
| { type: "leave" }
| { type: "leader"; target: string }
| { type: "accept" }
| { type: "decline" }
```

**Step 4: Add parseIpcCommand cases**

```ts
case "INVITE":
  return { type: "invite", target: rest };
case "KICK":
  return { type: "kick", target: rest };
case "LEAVE":
  return { type: "leave" };
case "LEADER":
  return { type: "leader", target: rest };
case "ACCEPT":
  return { type: "accept" };
case "DECLINE":
  return { type: "decline" };
```

**Step 5: Add dispatchCommand handlers**

```ts
case "invite":
  handle.invite(cmd.target);
  writeLines(socket, ["OK"]);
  return false;
case "kick":
  handle.uninvite(cmd.target);
  writeLines(socket, ["OK"]);
  return false;
case "leave":
  handle.leaveGroup();
  writeLines(socket, ["OK"]);
  return false;
case "leader":
  handle.setLeader(cmd.target);
  writeLines(socket, ["OK"]);
  return false;
case "accept":
  handle.acceptInvite();
  writeLines(socket, ["OK"]);
  return false;
case "decline":
  handle.declineInvite();
  writeLines(socket, ["OK"]);
  return false;
```

**Step 6: Wire group events into ring buffer**

In `src/daemon/commands.ts`, add a `onGroupEventMessage` function alongside
`onChatMessage`:

```ts
export function onGroupEvent(
  event: GroupEvent,
  events: RingBuffer<EventEntry>,
  log: SessionLog,
): void {
  const text = formatGroupEvent(event);
  if (!text) return;
  const json = JSON.stringify(formatGroupEventObj(event));
  events.push({ text, json });
  log.append(formatGroupEventObj(event)).catch(() => {});
}
```

Add `formatGroupEventObj` to produce JSON-friendly objects:

```ts
function formatGroupEventObj(event: GroupEvent): Record<string, unknown> {
  switch (event.type) {
    case "invite_received":
      return { type: "GROUP_INVITE", from: event.from };
    case "invite_result":
      return {
        type: "GROUP_INVITE_RESULT",
        target: event.target,
        result: event.result,
      };
    case "leader_changed":
      return { type: "GROUP_LEADER_CHANGED", name: event.name };
    case "group_destroyed":
      return { type: "GROUP_DESTROYED" };
    case "kicked":
      return { type: "GROUP_KICKED" };
    case "invite_declined":
      return { type: "GROUP_INVITE_DECLINED", name: event.name };
    case "group_list":
      return {
        type: "GROUP_LIST",
        members: event.members.map((m) => ({
          name: m.name,
          online: m.online,
        })),
        leader: event.leader,
      };
    case "member_stats":
      return {
        type: "PARTY_MEMBER_STATS",
        guidLow: event.guidLow,
        online: event.online,
        hp: event.hp,
        maxHp: event.maxHp,
        level: event.level,
      };
  }
}
```

Import `formatGroupEvent` from `ui/tui` (where we added it in Task 6).

**Step 7: Wire in server.ts**

In `startDaemonServer`, after `handle.onMessage(...)`:

```ts
handle.onGroupEvent((event) => onGroupEvent(event, events, log));
```

**Step 8: Run tests**

Run: `mise test`
Expected: All pass

**Step 9: Commit**

```
Add group IPC verbs and event ring buffer integration

INVITE, KICK, LEAVE, LEADER, ACCEPT, DECLINE verbs in the daemon
IPC protocol. Group events pushed to the ring buffer alongside chat
messages, readable via READ/READ_JSON.
```

---

### Task 8: Verification

**Step 1: Run full CI**

Run: `mise ci`
Expected: typecheck, test, format all pass

**Step 2: Run live tests**

Run: `MISE_TASK_TIMEOUT=60s mise test:live`
Expected: Live tests pass

**Step 3: Manual party test (optional)**

If a second account/character is available:

1. Start daemon as Xia
2. `INVITE Voidtrix` via IPC
3. Accept on Voidtrix's client
4. `READ` to see GROUP_LIST event
5. `LEADER Voidtrix` to transfer lead
6. `LEAVE` to disband
