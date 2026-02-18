# Chat UX Fixes Design

Branch A of the v0.3 feature set. Independent of party management and emotes.

## Sticky Chat Mode

ChatMode type stored in WorldConn, exposed via WorldHandle:

    | { type: "say" }
    | { type: "yell" }
    | { type: "guild" }
    | { type: "party" }
    | { type: "raid" }
    | { type: "whisper"; target: string }
    | { type: "channel"; channel: string }

Default: `{ type: "say" }`. Updates every time a chat message is sent through
any WorldHandle send method. sendWhisper sets target, sendParty sets party, etc.

### TUI

Bare text (no `/` prefix) sends using lastChatMode instead of always SAY. For
whisper mode the stored target is used, for channel mode the stored channel.

Prompt reflects current mode dynamically: `[say] > `, `[party] > `,
`[whisper: Voidtrix] > `, `[guild] > `. Updated after every command execution
and after receiving a whisper (which updates lastWhisperFrom but does NOT
auto-switch mode -- only explicit /r or /w switches mode).

### Daemon

When parseIpcCommand returns undefined (unrecognized verb), treat the entire
line as a message body and send using lastChatMode. Explicit verbs (SAY,
WHISPER, PARTY, etc.) still work and update the sticky mode.

Response includes the mode used: `OK SAY`, `OK WHISPER Voidtrix`, `OK PARTY`.
This lets the AI agent confirm what mode its bare text went to.

## Color Code Stripping

Function `stripColorCodes(text: string): string` in `src/lib/strip-colors.ts`.

Patterns removed:

- `|cAARRGGBB` -- 10 chars: literal `|c` + 8 hex digits
- `|r` -- color reset
- `|H...|h` and `|h` -- hyperlink wrapper delimiters (keep bracketed display text)

Applied in formatMessage and formatMessageObj on `msg.message` before formatting.
Covers both TUI display and daemon ring buffer paths. Raw packet bytes untouched.

## Files Changed

- `src/wow/protocol/opcodes.ts` -- no changes needed
- `src/wow/client.ts` -- add lastChatMode to WorldConn, add getLastChatMode/setLastChatMode to WorldHandle, update all send methods to set mode
- `src/ui/tui.ts` -- bare text uses sticky mode, dynamic prompt, apply stripColorCodes in formatMessage/formatMessageObj
- `src/daemon/commands.ts` -- bare text fallback, mode in OK response, apply stripColorCodes
- `src/lib/strip-colors.ts` -- new file, stripColorCodes function
- `src/lib/strip-colors.test.ts` -- new file, tests for color stripping
