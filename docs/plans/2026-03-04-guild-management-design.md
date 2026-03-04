# Guild Management Commands Design

## Overview

Implement 9 guild management commands as fire-and-forget CMSG packets, plus 2 incoming SMSG handlers for error reporting and guild invite prompts.

## Commands

| Command              | Opcode                     | Payload       |
| -------------------- | -------------------------- | ------------- |
| `/ginvite <player>`  | CMSG_GUILD_INVITE (0x082)  | CString(name) |
| `/gkick <player>`    | CMSG_GUILD_REMOVE (0x08E)  | CString(name) |
| `/gleave`            | CMSG_GUILD_LEAVE (0x08D)   | (empty)       |
| `/gpromote <player>` | CMSG_GUILD_PROMOTE (0x08B) | CString(name) |
| `/gdemote <player>`  | CMSG_GUILD_DEMOTE (0x08C)  | CString(name) |
| `/gleader <player>`  | CMSG_GUILD_LEADER (0x090)  | CString(name) |
| `/gmotd <message>`   | CMSG_GUILD_MOTD (0x091)    | CString(motd) |
| `/gaccept`           | CMSG_GUILD_ACCEPT (0x084)  | (empty)       |
| `/gdecline`          | CMSG_GUILD_DECLINE (0x085) | (empty)       |

All fire-and-forget: send the packet, return "OK" to IPC immediately. Errors arrive asynchronously via SMSG_GUILD_COMMAND_RESULT.

## Server Responses

### SMSG_GUILD_COMMAND_RESULT (0x093)

Fields: `command: u32 (GuildCommand)`, `name: CString`, `result: u32 (GuildCommandResult)`.

GuildCommand enum (3.3.5):

    CREATE = 0, INVITE = 1, QUIT = 2, PROMOTE = 3, FOUNDER = 0x0C,
    MEMBER = 0x0D, PUBLIC_NOTE_CHANGED = 0x13, OFFICER_NOTE_CHANGED = 0x14

GuildCommandResult enum (3.3.5):

    PLAYER_NO_MORE_IN_GUILD = 0x00, GUILD_INTERNAL = 0x01,
    ALREADY_IN_GUILD = 0x02, ALREADY_IN_GUILD_S = 0x03,
    INVITED_TO_GUILD = 0x04, ALREADY_INVITED_TO_GUILD_S = 0x05,
    GUILD_NAME_INVALID = 0x06, GUILD_NAME_EXISTS_S = 0x07,
    GUILD_LEADER_LEAVE_OR_PERMISSIONS = 0x08,
    GUILD_PLAYER_NOT_IN_GUILD = 0x09, GUILD_PLAYER_NOT_IN_GUILD_S = 0x0A,
    GUILD_PLAYER_NOT_FOUND_S = 0x0B, GUILD_NOT_ALLIED = 0x0C,
    GUILD_RANK_TOO_HIGH_S = 0x0D, GUILD_RANK_TOO_LOW_S = 0x0E,
    GUILD_RANKS_LOCKED = 0x11, GUILD_RANK_IN_USE = 0x12,
    GUILD_IGNORING_YOU_S = 0x13, GUILD_UNK1 = 0x14,
    GUILD_WITHDRAW_LIMIT = 0x19, GUILD_NOT_ENOUGH_MONEY = 0x1A,
    GUILD_BANK_FULL = 0x1C, GUILD_ITEM_NOT_FOUND = 0x1D

Routed through GuildEvent as `{ type: "command_result"; command: number; name: string; result: number }`. Displayed via `onGuildEvent` into the ring buffer and session log.

Result code 0x00 (PLAYER_NO_MORE_IN_GUILD) is the success case — no display needed. All other codes produce human-readable error text.

### SMSG_GUILD_INVITE (0x083)

Fields: `inviterName: CString`, `guildName: CString`.

Routed as GuildEvent `{ type: "guild_invite"; inviter: string; guildName: string }`. Displayed as `[guild] <inviter> has invited you to join <guildName>. Use /gaccept or /gdecline`.

No pending-invite state tracking needed — the server manages invite validity. `/gaccept` and `/gdecline` are stateless fire-and-forget packets.

## Architecture

Follows established fire-and-forget patterns from /invite, /kick, /friend, /ignore exactly.

### Protocol layer (src/wow/protocol/guild.ts)

- 6 build functions for CString CMSGs: `buildGuildInvite(name)`, `buildGuildRemove(name)`, `buildGuildPromote(name)`, `buildGuildDemote(name)`, `buildGuildLeader(name)`, `buildGuildMotd(motd)`
- 3 empty-body CMSGs sent directly via `sendPacket(conn, opcode, Buffer.alloc(0))`
- `parseGuildCommandResult(r)` returning `{ command, name, result }`
- `parseGuildInvitePacket(r)` returning `{ inviterName, guildName }`
- `GuildCommand` and `GuildCommandResult` enums
- `formatGuildCommandError(command, name, result)` returning human-readable string

### Client layer (src/wow/client.ts)

- 9 new methods on WorldHandle: `guildInvite`, `guildRemove`, `guildLeave`, `guildPromote`, `guildDemote`, `guildLeader`, `guildMotd`, `acceptGuildInvite`, `declineGuildInvite`
- 2 new handler registrations for SMSG_GUILD_COMMAND_RESULT and SMSG_GUILD_INVITE

### World handlers (src/wow/world-handlers.ts)

- `handleGuildCommandResult` — parse packet, skip result 0x00, fire `onGuildEvent` for errors
- `handleGuildInvite` — parse packet, fire `onGuildEvent`

### GuildEvent union (src/wow/guild-store.ts)

- Add `| { type: "command_result"; command: number; name: string; result: number }`
- Add `| { type: "guild_invite"; inviter: string; guildName: string }`

### Daemon commands (src/daemon/commands.ts)

- Replace "unimplemented" stubs with real dispatch for GINVITE, GKICK, GLEAVE, GPROMOTE
- Add new cases for GDEMOTE, GLEADER, GMOTD, GACCEPT, GDECLINE
- Format guild_invite events with `/gaccept` / `/gdecline` hint
- Format command_result events with human-readable error messages

### Stubs (src/wow/protocol/stubs.ts)

- Remove all 9 CMSG opcodes and both SMSG opcodes that are now implemented

### Mock handles

- Update `src/test/mock-handle.ts` and `src/daemon/start.test.ts` inline mock with the 9 new methods

### Documentation

- src/cli/help.ts, docs/manual.md, .claude/skills/tuicraft/SKILL.md, README.md
