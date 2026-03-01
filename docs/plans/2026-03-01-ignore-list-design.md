# Ignore List Design

Server-side ignore list using WoW's native protocol, mirroring the friend
system pattern. Flat WoW-native command syntax. Silently drops messages from
ignored players with no session log entry.

## Data Model

New `IgnoreStore` class in `src/wow/ignore-store.ts`, mirroring `FriendStore`:

    IgnoreEntry = { guid: bigint, name: string }

    IgnoreEvent =
      | { type: "ignore-list"; entries: IgnoreEntry[] }
      | { type: "ignore-added"; entry: IgnoreEntry }
      | { type: "ignore-removed"; guid: bigint; name: string }
      | { type: "ignore-error"; result: number; name: string }

    class IgnoreStore:
      private ignored: Map<bigint, IgnoreEntry>
      onEvent(cb): void
      set(entries): void       // bulk replace from contact list
      add(entry): void
      remove(guid): void
      all(): IgnoreEntry[]
      has(guid): boolean       // O(1) lookup for message filtering

Entries are simpler than friends — no status, level, class, or area fields.

## Protocol Integration

`WorldConn` gets `ignoreStore: IgnoreStore` alongside `friendStore`.

`handleContactList` already parses contacts with `SocialFlag.IGNORED` via
`parseContactList()`. Currently filters to `FRIEND` only. Add a second pass
extracting `IGNORED` contacts and calling `ignoreStore.set()`.

Ignore add/remove responses come via `SMSG_FRIEND_STATUS` (same opcode as
friend operations). The result byte distinguishes ignore results from friend
results. `handleFriendStatus` routes ignore-specific result codes to
`ignoreStore` instead of `friendStore`.

New `WorldHandle` methods:

- `getIgnored(): IgnoreEntry[]`
- `addIgnored(name: string): void` — sends `CMSG_ADD_IGNORE`
- `removeIgnored(name: string): void` — sends `CMSG_DEL_IGNORE`
- `onIgnoreEvent(cb: (event: IgnoreEvent) => void): void`

## Message Filtering

In `deliverMessage()` (world-handlers.ts), before calling
`conn.onMessage?.(msg)`, check `conn.ignoreStore.has(senderGuidLow)`. If the
sender is ignored, return early. No session log entry, no display.

## Commands

UI commands (`src/ui/commands.ts`):

- `/ignore <name>` → `{ type: "ignore"; target: string }`
- `/unignore <name>` → `{ type: "unignore"; target: string }`
- `/ignorelist` → `{ type: "ignorelist" }`

IPC commands (`src/daemon/commands.ts`):

- `IGNORE <name>` / `/ignore <name>` → `{ type: "add_ignore"; target: string }`
- `UNIGNORE <name>` / `/unignore <name>` → `{ type: "del_ignore"; target: string }`
- `IGNORELIST` / `/ignorelist` → `{ type: "ignore_list" }`

Dispatch:

- `add_ignore`: calls `handle.addIgnored(target)`, writes `OK`
- `del_ignore`: calls `handle.removeIgnored(target)`, writes `OK`
- `ignore_list`: calls `handle.getIgnored()`, formats names list or
  `Ignore list is empty.`

## TUI

`executeCommand` handles `ignore`, `unignore`, `ignorelist`. `onIgnoreEvent`
callback displays server feedback: "Ignoring Foo", "No longer ignoring Foo",
or error messages.

## Documentation

Update all four locations per CLAUDE.md: `src/cli/help.ts`, `docs/manual.md`,
`.claude/skills/tuicraft/SKILL.md`, and `README.md`.

## Testing

- `ignore-store.test.ts`: set/add/remove/has, event emission, error handling
- `commands.test.ts` (both UI and daemon): parse all three commands
- `world-handlers.test.ts`: contact list extraction, message filtering
- `client.test.ts`: WorldHandle method wiring
- Live test: `mise test:live` after protocol changes
