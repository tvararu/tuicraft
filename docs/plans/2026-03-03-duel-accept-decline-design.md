# Duel Accept/Decline — Design

## Summary

Handle incoming duel requests and let users accept or decline them. This covers
all six SMSG*DUEL*\* server packets and wires accept/decline through the existing
context-aware `/accept` and `/decline` commands. Duel initiation (`/duel <name>`
via CMSG_CAST_SPELL) is deferred until spell casting infrastructure exists.

## Packet Handling

### Incoming (6 handlers, promote from stubs)

| Opcode                        | Fields                                   | Behavior                                                                                                                         |
| ----------------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| SMSG_DUEL_REQUESTED (0x167)   | u64 initiator, u64 arbiter               | Store arbiter GUID on conn, resolve initiator name from entity store, fire `duel_requested` event, set `pendingRequest = "duel"` |
| SMSG_DUEL_COUNTDOWN (0x2B7)   | u32 timeMs                               | Fire `duel_countdown` event                                                                                                      |
| SMSG_DUEL_COMPLETE (0x16A)    | u8 completed                             | Fire `duel_complete` event                                                                                                       |
| SMSG_DUEL_WINNER (0x16B)      | u8 reason, cstring loser, cstring winner | Fire `duel_winner` event, clear arbiter GUID                                                                                     |
| SMSG_DUEL_OUTOFBOUNDS (0x168) | (empty)                                  | Fire `duel_out_of_bounds` event                                                                                                  |
| SMSG_DUEL_INBOUNDS (0x169)    | (empty)                                  | Fire `duel_in_bounds` event                                                                                                      |

### Outgoing (2 builders)

| Opcode                      | Fields      | Trigger                                  |
| --------------------------- | ----------- | ---------------------------------------- |
| CMSG_DUEL_ACCEPTED (0x16C)  | u64 arbiter | `/accept` when pendingRequest is "duel"  |
| CMSG_DUEL_CANCELLED (0x16D) | u64 arbiter | `/decline` when pendingRequest is "duel" |

## Event Type

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

## Context-Aware Accept/Decline

`WorldConn` gets a `pendingRequest: "group" | "duel" | null` field (initially
null). The existing group invite handler sets it to `"group"`. The duel request
handler sets it to `"duel"`.

`acceptInvite()` / `declineInvite()` on WorldHandle check this field:

- `"group"` — send CMSG_GROUP_ACCEPT / CMSG_GROUP_DECLINE (current behavior)
- `"duel"` — send CMSG_DUEL_ACCEPTED / CMSG_DUEL_CANCELLED with stored arbiter
- `null` — fire a system message "Nothing to accept"

After dispatching, `pendingRequest` is cleared to null.

## Display Format

Text output uses `[duel]` labels:

- `[duel] Arthas challenges you to a duel`
- `[duel] Duel starting in 3 seconds`
- `[duel] Duel complete`
- `[duel] Arthas has defeated Thrall in a duel`
- `[duel] Arthas has fled from Thrall in a duel`
- `[duel] Out of bounds — return to the duel area`
- `[duel] Back in bounds`

JSON output uses structured objects with `DUEL_*` type prefixes, matching the
pattern used by group events.

## Files Changed

- `src/wow/protocol/duel.ts` — new: parse and build functions
- `src/wow/protocol/duel.test.ts` — new: parser/builder tests
- `src/wow/protocol/stubs.ts` — remove 3 duel stubs
- `src/wow/client.ts` — DuelEvent type, WorldHandle methods, handler
  registration, pendingRequest + duelArbiter on WorldConn
- `src/wow/world-handlers.ts` — 6 handler functions
- `src/wow/world-handlers.test.ts` — handler integration tests
- `src/daemon/commands.ts` — context-aware accept/decline dispatch
- `src/ui/format.ts` — formatDuelEvent / formatDuelEventObj
- `src/ui/format.test.ts` — format tests
- `src/test/mock-handle.ts` — add duel methods to shared mock
- `src/daemon/start.test.ts` — update inline mock
- `src/cli/help.ts` — mention duel in help text
- `docs/manual.md` — duel documentation
- `README.md` — update feature table (duel row + fix mail row to ✅)
- `.claude/skills/tuicraft/SKILL.md` — mention duel events

## Not In Scope

- Duel initiation (`/duel <name>`) — requires CMSG_CAST_SPELL infrastructure
- Duel forfeit mid-fight — same CMSG_DUEL_CANCELLED packet, can add later
- Mounted duels (spell 62875) — deferred with initiation
