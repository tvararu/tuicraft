# In-Game Mail Design

Text-only mail for WoW 3.3.5a. No attachments, COD, or items in v1.

## Mailbox GUID Requirement

Every mail operation requires a valid mailbox GUID. The server validates that the player is near the referenced mailbox. We handle `SMSG_SHOW_MAILBOX` to capture the GUID when the player interacts with a mailbox (via NPC gossip, gameobject click, or playerbot command). Commands error with a clear message when no mailbox is open.

## Commands

| Input | Action |
|-------|--------|
| `/mail` | List inbox (sequential indices) |
| `/mail read <n>` | Show full mail, mark as read |
| `/mail send <player> "<subject>" <body>` | Send text-only mail |
| `/mail delete <n>` | Delete mail by index |

Daemon IPC: `MAIL`, `MAIL_READ <n>`, `MAIL_SEND <player> "<subject>" <body>`, `MAIL_DELETE <n>`, plus `_JSON` variants for list/read.

## Packets

**Incoming:**

- `SMSG_SHOW_MAILBOX` (0x297) — 8-byte mailbox GUID. Store on WorldConn, auto-request mail list.
- `SMSG_MAIL_LIST_RESULT` (0x23B) — u32 total count, u8 displayed count, then per-mail: u16 size, u32 messageId, u8 messageType, conditional sender (u64 GUID for player, u32 entry for NPC/auction), u32 cod, u32 unknown, u32 stationery, u32 money, u32 flags, f32 expirationTime, u32 templateId, cString subject, cString body, u8 itemCount. Skip remaining bytes per entry using the size field.
- `SMSG_SEND_MAIL_RESULT` (0x239) — u32 mailId, u32 action, u32 result. Map action+result to user-facing messages.
- `SMSG_RECEIVED_MAIL` (0x285) — Already handled. Shows "You have new mail."

**Outgoing:**

- `CMSG_GET_MAIL_LIST` (0x23A) — u64 mailboxGuid.
- `CMSG_SEND_MAIL` (0x238) — u64 mailboxGuid, cString receiver, cString subject, cString body, u32 stationery=0, u32 unknown=0, u8 items=0, u32 money=0, u32 cod=0, u32 unknown=0, u32 unknown=0.
- `CMSG_MAIL_DELETE` (0x249) — u64 mailboxGuid, u32 mailId, u32 templateId=0.
- `CMSG_MAIL_MARK_AS_READ` (0x247) — u64 mailboxGuid, u32 mailId.

## State

On WorldConn (not a separate store — mail state is simpler than guilds/friends):

- `mailboxGuid: bigint | null` — set by SMSG_SHOW_MAILBOX, cleared on disconnect
- `mailCache: MailEntry[]` — populated by SMSG_MAIL_LIST_RESULT

## Display

Inbox:
```
=== Mailbox (3 messages) ===
 #1  Thrall         Guild meeting           2h
 #2  Jaina          Hey there               1d
*#3  Auction House  You won: [Hearthstone]  3d
```
`*` = unread. Columns: index, sender (padded), subject (truncated), relative time.

Reading:
```
From: Thrall
Subject: Guild meeting
Date: 2h ago

Don't forget about the raid tonight at 8pm. Bring flasks.
```

## Error Messages

| Code | Message |
|------|---------|
| 2 | Cannot send mail to yourself. |
| 3 | Not enough gold to send mail. |
| 4 | Player not found. |
| 5 | Cannot send mail to the opposite faction. |
| 14 | Trial accounts cannot send mail. |
| 15 | Recipient's mailbox is full. |
| 17 | Mail is suspended on this account. |
| Other | Mail error (code N). |

## Files

New: `src/wow/protocol/mail.ts`, `src/wow/protocol/mail.test.ts`

Modified: `src/wow/world-handlers.ts`, `src/wow/client.ts`, `src/ui/commands.ts`, `src/ui/tui.ts`, `src/daemon/commands.ts`, `src/daemon/commands.test.ts`, `src/ui/format.ts`, `src/cli/help.ts`, `src/wow/protocol/stubs.ts`, `src/test/mock-handle.ts`, `src/daemon/start.test.ts`, `docs/manual.md`, `README.md`, `.claude/skills/tuicraft/SKILL.md`
