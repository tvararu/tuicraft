# Known Bugs

- [ ] WoW color codes displayed raw in chat messages
- [ ] `/invite` treated as a say message instead of a command
- [ ] Playerbot commands from non-party GM only partially work
- [ ] Chat mode not sticky like in-game client

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
