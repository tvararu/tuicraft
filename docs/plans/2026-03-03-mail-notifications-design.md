# Mail Notifications Design

## Summary

Handle the SMSG_RECEIVED_MAIL opcode (0x0285) to display a `[mail] You have new mail.` system message in chat. Receive-only — no mailbox reading or sending.

## Packet Handler

SMSG_RECEIVED_MAIL contains a single `u32` field (unknown/unused). The handler reads and discards it, then pushes a chat message via `conn.onMessage?.()` with `origin: "mail"`.

Follows the same pattern as `handleNotification` and `handleServerBroadcast`.

## Display Formatting

- Human-readable: `[mail] You have new mail.`
- JSON/log type: `MAIL`

Both `formatMessage()` and `formatMessageObj()` gain an `origin === "mail"` branch under `ChatType.SYSTEM`.

## /mail Command

Already exists as `{ type: "unimplemented", feature: "Mail" }`. Change the feature string to `"Mail reading"` so it displays as "Mail reading is not yet implemented" — clearer that the notification works but the mailbox doesn't.

## Files Modified

| File                             | Change                                                               |
| -------------------------------- | -------------------------------------------------------------------- |
| `src/wow/world-handlers.ts`      | Add `handleReceivedMail()`                                           |
| `src/wow/client.ts`              | Register handler on dispatch                                         |
| `src/wow/protocol/stubs.ts`      | Remove SMSG_RECEIVED_MAIL from stub list                             |
| `src/ui/format.ts`               | Add mail origin branch in `formatMessage()` and `formatMessageObj()` |
| `src/ui/commands.ts`             | Change `"Mail"` to `"Mail reading"`                                  |
| `src/daemon/commands.ts`         | Change `"Mail"` to `"Mail reading"`                                  |
| `src/wow/world-handlers.test.ts` | Handler test                                                         |
| `src/ui/format.test.ts`          | Format test                                                          |
| `src/ui/commands.test.ts`        | Update expected string if tested                                     |

No new files. No WorldHandle or mock-handle changes.
