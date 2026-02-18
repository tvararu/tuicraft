# Emotes Design

Branch C of the v0.3 feature set. Builds on Branch B (party management) by
extending the GroupEvent union and onGroupEvent callback.

## Opcodes

    CMSG_TEXT_EMOTE:  0x0104
    SMSG_TEXT_EMOTE:  0x0105

CMSG_EMOTE (0x0102) and SMSG_EMOTE (0x0103) are visual-only animations with no
chat text — skip for now, add if needed later.

## TextEmote Enum

Map common emote names to IDs. Start with: DANCE(34), WAVE(101), BOW(2),
KISS(57), LAUGH(60), FLIRT(19), CRY(3), CHEER(4), RUDE(77), CHICKEN(14).

## Wire Format

CMSG_TEXT_EMOTE: u32 textEmote + u32 0xFFFFFFFF (default anim) + u64 target GUID
(0 for untargeted).

SMSG_TEXT_EMOTE: u64 performer GUID + u32 textEmote + u32 emote + SizedCString
target name (u32 length + bytes, not null-terminated CString). Empty target is
length=1 with a single null byte.

## Protocol File

New `src/wow/protocol/emote.ts` with buildTextEmote and parseTextEmote, same
pattern as chat.ts and group.ts.

## WorldHandle

Add `sendTextEmote(emote: number): void`. Sends with target GUID 0 (untargeted).

Extend GroupEvent with:
`| { type: "text_emote"; sender: string; textEmote: number; targetName: string }`

Wire SMSG_TEXT_EMOTE handler — resolve performer GUID via nameCache, deliver via
onGroupEvent.

## Display

Build client-side verb table: DANCE→"dances", WAVE→"waves at", BOW→"bows",
etc. Format as `[emote] Xia dances` or `[emote] Xia waves at Voidtrix`.

## TUI

Slash commands: /dance, /wave, /bow, /kiss, /laugh, /flirt, /cry, /cheer,
/rude, /chicken. Each maps to the corresponding TextEmote ID. Unknown emote
names still fall through to say.

## Daemon

EMOTE verb: `EMOTE DANCE`, `EMOTE WAVE`, etc. Same name→ID mapping as TUI.
Emote events in ring buffer alongside chat and group events.
