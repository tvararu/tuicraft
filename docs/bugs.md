# Known Bugs

- [ ] No reconnect challenge/proof handling — quick reconnects fail
- [ ] No SMSG_CONTACT_LIST handler — friend list unavailable

---

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
