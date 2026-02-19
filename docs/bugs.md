# Known Bugs

- [ ] No SMSG_CONTACT_LIST handler — friend list unavailable

---

## No SMSG_CONTACT_LIST handler — friend list unavailable

Server sends SMSG_CONTACT_LIST (0x0067) at login. Format: uint32 flags, uint32
count, then per entry: packed GUID, name (cstring), note (cstring), various
uint8/uint32 fields for status, area, level, class. Parsing this would enable a
`/friends` command.
