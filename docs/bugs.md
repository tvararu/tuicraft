# Known Bugs

- [ ] Auth error codes are incomplete (6 of 19)
- [ ] World auth failure codes are unnamed
- [ ] No SMSG_MOTD handler — message-of-the-day silently dropped
- [ ] No reconnect challenge/proof handling — quick reconnects fail
- [ ] No SMSG_CONTACT_LIST handler — friend list unavailable

---

## Auth error codes are incomplete (6 of 19)

`src/protocol/opcodes.ts` `ChallengeResult` has 6 entries. The server can return
at least 19 different status codes including ACCOUNT_BANNED, ALREADY_ONLINE,
ACCOUNT_SUSPENDED, TRIAL_EXPIRED, and PARENTAL_CONTROL. Unknown codes surface as
a raw hex number instead of a human-readable reason.

Reference: `../wowser/src/lib/auth/challenge-opcode.js`.

## World auth failure codes are unnamed

`src/client.ts` checks for `status !== 0x0c` on SMSG_AUTH_RESPONSE but reports
failures as raw hex. At minimum 0x0D (system error) and 0x15 (account in use)
should be named — these are the two most common failure modes.

Reference: `../wowser/src/lib/game/handler.js` lines 157-167.

## No SMSG_MOTD handler — message-of-the-day silently dropped

The server sends SMSG_MOTD (0x033D) during login. Format: uint32 line count,
then N null-terminated strings. Should push into the ring buffer as a system
event. Currently silently dropped by `drainWorldPackets`.

## No reconnect challenge/proof handling — quick reconnects fail

If the server thinks a session is still alive, it sends RECONNECT_CHALLENGE
(0x02) instead of LOGON_CHALLENGE (0x00). The auth handler doesn't recognize
these opcodes and silently fails. This happens when reconnecting quickly after a
disconnect.

Reference: `../wowser/src/lib/auth/opcode.js`.

## No SMSG_CONTACT_LIST handler — friend list unavailable

Server sends SMSG_CONTACT_LIST (0x0067) at login. Format: uint32 flags, uint32
count, then per entry: packed GUID, name (cstring), note (cstring), various
uint8/uint32 fields for status, area, level, class. Parsing this would enable a
`/friends` command.
