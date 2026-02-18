# Party Management Design

Branch B of the v0.3 feature set. Depends on nothing. Branch C (emotes) builds
on this by sharing the GroupEvent union and onGroupEvent callback.

## Opcodes

Added to GameOpcode:

    CMSG_GROUP_INVITE:            0x006e
    SMSG_GROUP_INVITE:            0x006f
    CMSG_GROUP_ACCEPT:            0x0072
    CMSG_GROUP_DECLINE:           0x0073
    SMSG_GROUP_DECLINE:           0x0074
    CMSG_GROUP_UNINVITE:          0x0075
    SMSG_GROUP_UNINVITE:          0x0077
    CMSG_GROUP_SET_LEADER:        0x0078
    SMSG_GROUP_SET_LEADER:        0x0079
    CMSG_GROUP_DISBAND:           0x007b
    SMSG_GROUP_DESTROYED:         0x007c
    SMSG_GROUP_LIST:              0x007d
    SMSG_PARTY_MEMBER_STATS:      0x007e
    SMSG_PARTY_COMMAND_RESULT:    0x007f
    SMSG_PARTY_MEMBER_STATS_FULL: 0x02f2

Also add PartyResult const for SMSG_PARTY_COMMAND_RESULT result codes:
SUCCESS=0, BAD_PLAYER_NAME=1, TARGET_NOT_IN_GROUP=2, TARGET_NOT_IN_INSTANCE=3,
GROUP_FULL=4, ALREADY_IN_GROUP=5, NOT_IN_GROUP=6, NOT_LEADER=7,
PLAYER_WRONG_FACTION=8, IGNORING_YOU=9, LFG_PENDING=12, INVITE_RESTRICTED=13.

## Group Protocol -- src/wow/protocol/group.ts

### Outgoing Builders

- buildGroupInvite(name) -- CString name + u32 0
- buildGroupAccept() -- u32 0
- buildGroupDecline() -- empty
- buildGroupUninvite(name) -- CString name
- buildGroupDisband() -- empty
- buildGroupSetLeader(guidLow, guidHigh) -- u32 LE low + u32 LE high

### Incoming Parsers

- parsePartyCommandResult(r) -- u32 operation, CString member, u32 result, u32 val
- parseGroupInvite(r) -- u8 status, CString name (skip u32 + u8 + u32 trailer)
- parseGroupSetLeader(r) -- CString name
- parseGroupDecline(r) -- CString name
- parseGroupList(r) -- u8 groupType, u8 groupId, u8 flags, u8 roles, 8-byte
  group GUID, u32 counter, u32 memberCount, then per member: CString name,
  8-byte GUID, u8 online, u8 groupId, u8 flags, u8 roles. Then 8-byte leader
  GUID. Skip remaining loot/difficulty fields.
- parsePartyMemberStats(r) -- packed GUID + u32 bitmask. Conditionally read
  STATUS (u16), CUR_HP (u32), MAX_HP (u32), LEVEL (u16). Skip all other
  flagged fields by correct byte counts. Same logic for
  SMSG_PARTY_MEMBER_STATS_FULL but skip the leading u8 unknown first.

Wire format notes (3.3.5 specifics):

- SMSG_PARTY_COMMAND_RESULT has 4 fields including the trailing u32 val not in
  all wowm specs but confirmed in AzerothCore GroupHandler.cpp:59
- SMSG_PARTY_MEMBER_STATS STATUS is u16 (not u8), HP fields are u32 (not u16),
  aura mask is u64 with u32+u8 per entry
- SMSG_PARTY_MEMBER_STATS_FULL is identical but prefixed with u8 unknown=0

## WorldConn / WorldHandle Changes

### New WorldConn State

- partyMembers: Map<string, { guidLow: number, guidHigh: number }> -- from
  SMSG_GROUP_LIST, cleared on SMSG_GROUP_DESTROYED
- onGroupEvent?: (event: GroupEvent) => void

### New WorldHandle Methods

- invite(name) -- CMSG_GROUP_INVITE
- uninvite(name) -- CMSG_GROUP_UNINVITE
- leaveGroup() -- CMSG_GROUP_DISBAND
- setLeader(name) -- looks up name in partyMembers, sends CMSG_GROUP_SET_LEADER.
  If name not found, delivers synthetic SYSTEM error via onMessage
- acceptInvite() -- CMSG_GROUP_ACCEPT
- declineInvite() -- CMSG_GROUP_DECLINE
- onGroupEvent(cb) -- registers group event listener

### Persistent Opcode Handlers

- SMSG_PARTY_COMMAND_RESULT -- parse, deliver via onGroupEvent
- SMSG_GROUP_INVITE -- deliver via onGroupEvent
- SMSG_GROUP_SET_LEADER -- deliver via onGroupEvent
- SMSG_GROUP_LIST -- update partyMembers map, deliver via onGroupEvent
- SMSG_GROUP_DESTROYED -- clear partyMembers, deliver via onGroupEvent
- SMSG_GROUP_UNINVITE -- deliver via onGroupEvent
- SMSG_GROUP_DECLINE -- deliver via onGroupEvent
- SMSG_PARTY_MEMBER_STATS / FULL -- minimal parse, deliver via onGroupEvent

### GroupEvent Union Type

    | { type: "invite_received"; from: string }
    | { type: "invite_result"; target: string; result: number }
    | { type: "leader_changed"; name: string }
    | { type: "group_list"; members: Array<{ name, guidLow, guidHigh, online }>; leader: string }
    | { type: "group_destroyed" }
    | { type: "kicked" }
    | { type: "invite_declined"; name: string }
    | { type: "member_stats"; name: string; online: boolean; hp?: number; maxHp?: number; level?: number }

## TUI Changes

New Command union members: invite, kick, leave, leader, accept, decline.

Slash commands: /invite, /kick, /leave, /leader, /accept, /decline. Each calls
the corresponding WorldHandle method in executeCommand.

Group event display: startTui registers handle.onGroupEvent alongside
handle.onMessage. Events formatted as human-readable strings:

- [group] Voidtrix invites you to a group
- [group] Xia is now the group leader
- [group] Group has been disbanded

## Daemon Changes

New IPC verbs: INVITE, KICK, LEAVE, LEADER, ACCEPT, DECLINE. Each calls
the corresponding WorldHandle method and responds OK.

Group events pushed into the RingBuffer<EventEntry> via onGroupEvent callback.
Human format: [group] Voidtrix invites you to a group.
JSON format: { "type": "GROUP_INVITE", "from": "Voidtrix" } etc.
READ/READ_JSON/READ_WAIT return group events interleaved with chat.

## Files Changed

- src/wow/protocol/opcodes.ts -- new GameOpcode entries, PartyResult const
- src/wow/protocol/group.ts -- new file, builders + parsers
- src/wow/protocol/group.test.ts -- new file, parser/builder tests
- src/wow/client.ts -- partyMembers state, onGroupEvent callback, new WorldHandle
  methods, wire handlers in worldSession
- src/ui/tui.ts -- new Command variants, new slash commands, group event display
- src/ui/tui.test.ts -- test new commands
- src/daemon/commands.ts -- new IPC verbs, group event ring buffer integration
- src/daemon/commands.test.ts -- test new verbs
