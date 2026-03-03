# Guild Events Design

Handle SMSG_GUILD_EVENT (0x0092) — a read-only opcode that broadcasts guild
activity notifications (promotions, sign-ons, MOTD changes, etc.) to online
guild members.

## Packet Structure

From AzerothCore source (GuildPackets.cpp):

```
u8   eventType      GuildEvents enum (0-19)
u8   paramCount     number of string params (0-3)
CString[paramCount] event-specific string parameters
u64LE guid          only present for JOINED/LEFT/SIGNED_ON/SIGNED_OFF
```

## Scope

Social events only — tabard, rank admin, and bank events are silently ignored.

| Event (enum)       | Params                | Trailing GUID | Display |
| ------------------ | --------------------- | ------------- | ------- |
| PROMOTION (0)      | officer, member, rank | no            | yes     |
| DEMOTION (1)       | officer, member, rank | no            | yes     |
| MOTD (2)           | text                  | no            | yes     |
| JOINED (3)         | name                  | yes           | yes     |
| LEFT (4)           | name                  | yes           | yes     |
| REMOVED (5)        | member, officer       | no            | yes     |
| LEADER_IS (6)      | name                  | no            | yes     |
| LEADER_CHANGED (7) | oldLeader, newLeader  | no            | yes     |
| DISBANDED (8)      | (none)                | no            | yes     |
| TABARD_CHANGED (9) | —                     | —             | ignored |
| RANK_UPDATED (10)  | —                     | —             | ignored |
| RANK_DELETED (11)  | —                     | —             | ignored |
| SIGNED_ON (12)     | name                  | yes           | yes     |
| SIGNED_OFF (13)    | name                  | yes           | yes     |
| 14-19 (bank)       | —                     | —             | ignored |

## Approach

Expand the existing `GuildEvent` discriminated union in `guild-store.ts`.
Reuse the existing `onGuildEvent` callback pipeline through WorldHandle,
server.ts, ring buffer, and session log. No new callbacks or wiring needed.

## GuildEvent Union

```ts
type GuildEvent =
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

## Text Formatting

All displayed with `[guild]` prefix:

- promotion: `[guild] Officer promoted Member to Rank`
- demotion: `[guild] Officer demoted Member to Rank`
- motd: `[guild] MOTD: text`
- joined: `[guild] Name has joined the guild`
- left: `[guild] Name has left the guild`
- removed: `[guild] Officer removed Member from the guild`
- leader_is: `[guild] Name is the guild leader`
- leader_changed: `[guild] OldLeader has made NewLeader the new guild leader`
- disbanded: `[guild] Guild has been disbanded`
- signed_on: `[guild] Name has come online`
- signed_off: `[guild] Name has gone offline`

## JSON Formatting

Each event maps to a typed object for structured logging:

```ts
{
  type: ("GUILD_PROMOTION", officer, member, rank);
}
{
  type: ("GUILD_DEMOTION", officer, member, rank);
}
{
  type: ("GUILD_MOTD", text);
}
{
  type: ("GUILD_JOINED", name);
}
{
  type: ("GUILD_LEFT", name);
}
{
  type: ("GUILD_REMOVED", member, officer);
}
{
  type: ("GUILD_LEADER_IS", name);
}
{
  type: ("GUILD_LEADER_CHANGED", oldLeader, newLeader);
}
{
  type: "GUILD_DISBANDED";
}
{
  type: ("GUILD_SIGNED_ON", name);
}
{
  type: ("GUILD_SIGNED_OFF", name);
}
```

## Files Modified

- `src/wow/protocol/guild.ts` — add `parseGuildEvent`, `GuildEventCode` enum
- `src/wow/guild-store.ts` — expand `GuildEvent` union
- `src/wow/world-handlers.ts` — add `handleGuildEvent`
- `src/wow/client.ts` — register handler, remove stub
- `src/ui/format.ts` — add `formatGuildEvent`
- `src/daemon/commands.ts` — update `onGuildEvent`, add `formatGuildEventObj`
- `src/wow/protocol/stubs.ts` — remove SMSG_GUILD_EVENT entry
- `README.md` — mark "Guild events" as done
