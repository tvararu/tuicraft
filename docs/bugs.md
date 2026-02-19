# Known Bugs

- [ ] WoW color codes displayed raw in chat messages
- [ ] `/invite` treated as a say message instead of a command
- [ ] Playerbot commands from non-party GM only partially work
- [ ] Chat mode not sticky like in-game client
- [x] SPECIFY_BUILD flag skips wrong byte count in realm parsing
- [ ] Auth error codes are incomplete (6 of 19)
- [ ] World auth failure codes are unnamed
- [ ] No SMSG_MOTD handler — message-of-the-day silently dropped
- [ ] No reconnect challenge/proof handling — quick reconnects fail
- [ ] No SMSG_CONTACT_LIST handler — friend list unavailable

---

## WoW color codes displayed raw in chat messages

Server messages contain WoW's inline color escape sequences (`|cAARRGGBB` to
start colored text, `|r` to reset). These are passed through to the terminal
verbatim instead of being stripped or converted to ANSI colors.

Example output:

    [system] |cff00ff00Individual Progression: |cffccccccenabled|r
    [system] |cff00ff00This server runs with |cff00ccffmod-playerbots|r

`formatMessage` in `src/tui.ts` renders `msg.message` as-is. Either strip the
WoW color markup entirely, or translate `|cAARRGGBB` sequences to ANSI 24-bit
color escapes (`\x1b[38;2;R;G;Bm`) and `|r` to reset (`\x1b[0m`).

## `/invite` treated as a say message instead of a command

Typing `/invite Deity` sends the literal text as a say message instead of
issuing a party invite. `parseCommand` in `src/tui.ts` doesn't recognize
`/invite`, so the `default` branch falls through to `{ type: "say", message: input }`.

Need to add `/invite` (and likely other slash commands like `/kick`, `/leave`,
`/join`, etc.) as recognized commands that send the appropriate opcodes.

## Playerbot commands from non-party GM only partially work

Xiara is a playerbot in Deity's party. Xia (GM, not in the party) can whisper
commands like "stay" which Xiara respects, but commands like "los" get routed to
Deity (the party leader who invited her) instead.

This is likely server-side behavior rather than a client bug — playerbots route
some commands through the party leader. Workaround might be smarter party
management: have Xia join the party, or issue commands through Deity's session
directly.

## Chat mode not sticky like in-game client

Bare text (no `/` prefix) always sends as `/say`. In the real WoW client, the
chat mode is sticky — after `/w Deity hello`, the next bare message continues as
a whisper to Deity. Same for `/g`, `/p`, `/raid`, `/1`, etc.

`TuiState` already tracks `lastWhisperFrom` for `/r`. This needs to generalize
to a `lastChatMode` that `parseCommand` consults when there's no slash prefix.
The prompt could also reflect the current mode (e.g. `[whisper: Deity] >`).

## SPECIFY_BUILD flag skips wrong byte count in realm parsing

`src/protocol/auth.ts` — when a realm has flag `0x04` (SPECIFY_BUILD) set, the
parser skips 4 bytes (3 + 1). The correct layout is 3x uint8 (major, minor,
patch) + 1x uint16 (build) = 5 bytes. This misaligns the reader and corrupts
all subsequent realm entries.

Reference: `../wowser/src/lib/realms/handler.js` lines 55-62.

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
