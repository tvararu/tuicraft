# Server Broadcast Messages Design

## Problem

SMSG_CHAT_SERVER_MESSAGE (0x291) and SMSG_NOTIFICATION (0x1CB) are stubbed
out. When the server sends shutdown warnings, restart notices, or admin
broadcasts, users see a generic "unhandled opcode" stub instead of the
actual message.

## Approach

Route both opcodes through the existing ChatMessage pipeline with an
`origin` field that controls display formatting and JSON event type. This
reuses all existing infrastructure (ring buffer, session log, daemon
events, mock handles) while giving server broadcasts a distinct `[server]`
label in the TUI and separate JSON types for daemon consumers.

## Packet Formats

**SMSG_CHAT_SERVER_MESSAGE** (0x291):

- `int32 messageId` — server message type enum
- null-terminated string — parameter (time remaining, custom text, etc.)

Message ID mapping:

| ID | Meaning | Display |
|----|---------|---------|
| 1 | SERVER_MSG_SHUTDOWN_TIME | Server shutdown in {param} |
| 2 | SERVER_MSG_RESTART_TIME | Server restart in {param} |
| 3 | SERVER_MSG_STRING | {param} |
| 4 | SERVER_MSG_SHUTDOWN_CANCELLED | Server shutdown cancelled |
| 5 | SERVER_MSG_RESTART_CANCELLED | Server restart cancelled |

**SMSG_NOTIFICATION** (0x1CB):

- null-terminated string — the entire message

## ChatMessage Changes

Add optional `origin?: "server" | "notification"` to the ChatMessage type.
Both opcodes emit messages with `type: SYSTEM`, empty sender, and the
appropriate origin value. Existing messages have no origin and are
unaffected.

## Display Formatting

TUI: messages with `origin === "server"` or `origin === "notification"`
display as `[server] message`. Existing system messages remain `[system]`.

JSON: `origin === "server"` maps to `type: "SERVER_BROADCAST"`,
`origin === "notification"` maps to `type: "NOTIFICATION"`. This lets
daemon consumers filter server broadcasts from regular system chatter.

## What Changes

1. `src/wow/protocol/chat.ts` — add `origin` to ChatMessage, add two
   parse functions
2. `src/wow/client.ts` — register dispatch handlers
3. `src/ui/tui.ts` — add `[server]` formatting branch
4. `src/wow/protocol/stubs.ts` — remove both entries
5. Tests for parsers and integration
