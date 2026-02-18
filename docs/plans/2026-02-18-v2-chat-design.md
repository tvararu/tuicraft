# tuicraft v2 Design: Chat, Session API, and TUI

**Date**: 2026-02-18

## Goal

Add chat messaging to tuicraft. Send and receive all chat types (whisper, say,
guild, yell, party, raid, channel). Resolve sender names via GUID lookups.
Support /who queries. Present it all through a terminal interface with
interactive and pipe modes. Zero new dependencies.

## Architecture

Three layers of new code, built bottom-up on v1's protocol foundation:

```
Protocol layer (src/protocol/chat.ts)
  → pure parsers/builders for SMSG/CMSG_MESSAGE_CHAT, name query, /who

Session layer (src/client.ts)
  → WorldHandle gains chat callbacks and send methods
  → WorldConn gains name cache and dispatch handlers

TUI layer (src/tui.ts)
  → node:readline for interactive, raw stdin for pipe mode
  → command parsing, formatted output
```

## Protocol Layer

### New Opcodes

```
CMSG_MESSAGE_CHAT           0x0095
SMSG_MESSAGE_CHAT           0x0096
SMSG_GM_MESSAGECHAT         0x03b3
CMSG_NAME_QUERY             0x0050
SMSG_NAME_QUERY_RESPONSE    0x0051
CMSG_WHO                    0x0062
SMSG_WHO                    0x0063
SMSG_CHAT_PLAYER_NOT_FOUND  0x02a9
```

### Chat Types

```
SYSTEM=0x00  SAY=0x01  PARTY=0x02  RAID=0x03  GUILD=0x04  OFFICER=0x05
YELL=0x06  WHISPER=0x07  WHISPER_INFORM=0x09  EMOTE=0x0a  CHANNEL=0x11
PARTY_LEADER=0x33  RAID_LEADER=0x27  RAID_WARNING=0x28
BATTLEGROUND=0x2c  BATTLEGROUND_LEADER=0x2d
```

### SMSG_MESSAGE_CHAT Format

```
uint8    chatType
uint32LE language
uint64LE senderGuid (low + high as two uint32LE)
uint32LE unknown (0)
[if channel: cString channelName]
uint64LE targetGuid (low + high as two uint32LE)
uint32LE messageLength
bytes    message (messageLength bytes)
uint8    chatFlags
```

GM variant (SMSG_GM_MESSAGECHAT) inserts a uint32LE sender name length and
the sender name bytes after the unknown field, before the target GUID.

### CMSG_MESSAGE_CHAT Format

```
uint32LE chatType
uint32LE language (LANG_UNIVERSAL = 0)
[if whisper: cString recipientName]
[if channel: cString channelName]
cString  message
```

### CMSG_NAME_QUERY / SMSG_NAME_QUERY_RESPONSE

Request: uint64LE guid (low + high).

Response: packed GUID, uint8 found (0=found), cString name, cString realm,
uint32LE race, uint32LE gender, uint32LE class. If not found, uint8 is nonzero
and no further fields.

### CMSG_WHO / SMSG_WHO

Request: uint32LE minLevel, uint32LE maxLevel, cString playerName,
cString guildName, uint32LE raceMask, uint32LE classMask, uint32LE zoneCount,
uint32LE stringCount.

Response: uint32LE displayCount, uint32LE matchCount, then for each result:
cString name, cString guild, uint32LE level, uint32LE class, uint32LE race,
uint8 gender, uint32LE zone.

### New File: src/protocol/chat.ts

Pure functions, no side effects:

- `parseChatMessage(r: PacketReader)` → `ChatMessage`
- `buildChatMessage(type, language, message, target?)` → `Uint8Array`
- `buildNameQuery(guidLow, guidHigh)` → `Uint8Array`
- `parseNameQueryResponse(r: PacketReader)` → `NameQueryResult`
- `buildWhoRequest(opts)` → `Uint8Array`
- `parseWhoResponse(r: PacketReader)` → `WhoResult[]`

## Session Layer

### WorldHandle Extensions

```typescript
type ChatMessage = {
  type: number;
  sender: string;
  message: string;
  channel?: string;
};

type WhoResult = {
  name: string;
  guild: string;
  level: number;
  race: number;
  classId: number;
  gender: number;
  zone: number;
};

type WorldHandle = {
  closed: Promise<void>;
  close(): void;
  onMessage(cb: (msg: ChatMessage) => void): void;
  sendWhisper(target: string, message: string): void;
  sendSay(message: string): void;
  sendYell(message: string): void;
  sendGuild(message: string): void;
  sendParty(message: string): void;
  sendRaid(message: string): void;
  sendChannel(channel: string, message: string): void;
  who(opts?: {
    name?: string;
    minLevel?: number;
    maxLevel?: number;
  }): Promise<WhoResult[]>;
};
```

The `send*` methods are fire-and-forget wrappers over `buildChatMessage` +
`sendPacket`. `who()` uses `dispatch.expect(SMSG_WHO)` and returns a Promise.
`onMessage` sets a single callback — there is only one consumer (the TUI).

### Name Resolution

A `Map<number, string>` on WorldConn, keyed by guidLow.

Two persistent dispatch handlers cooperate:

1. `SMSG_MESSAGE_CHAT` handler: parses the packet, checks name cache. On hit,
   calls the onMessage callback immediately. On miss, sends CMSG_NAME_QUERY and
   stores the parsed message in a pending list keyed by guidLow.

2. `SMSG_NAME_QUERY_RESPONSE` handler: caches the name, flushes any pending
   messages for that GUID through the onMessage callback.

No async in the hot path. No EventEmitter.

### Player Not Found

`SMSG_CHAT_PLAYER_NOT_FOUND` handler: parses the cString player name, delivers
it through onMessage as a system-type message like "No player named X is
currently playing."

## TUI Layer

### New File: src/tui.ts

```typescript
function startTui(handle: WorldHandle, interactive: boolean): Promise<void>;
```

Returns a promise that resolves when `/quit` is typed or the connection closes.

### Interactive Mode (isTTY)

Uses `node:readline` with `createInterface(stdin, stdout)`. Prompt: `> `.

Incoming messages printed above the prompt:

```
[whisper from Xiara] follow Deity
[whisper to Xiara] follow Deity
[say] Xi: hello
[guild] Xiara: heading out
[yell] Xi: HELLO
[party] Xiara: inv
[General] Xi: anyone around?
[system] Welcome to AzerothCore
```

No colors for now. Colors can come in a follow-up.

### Pipe Mode (!isTTY)

Raw lines, tab-delimited, no prompt, no formatting:

```
WHISPER_FROM\tXiara\tfollow Deity
SAY\tXi\thello
GUILD\tXiara\theading out
```

### Commands

| Input                        | Action                |
| ---------------------------- | --------------------- |
| `/w <name> <msg>`            | Whisper               |
| `/whisper <name> <msg>`      | Whisper               |
| `/r <msg>`                   | Reply to last whisper |
| `/s <msg>` or `/say <msg>`   | Say                   |
| `/y <msg>` or `/yell <msg>`  | Yell                  |
| `/g <msg>` or `/guild <msg>` | Guild                 |
| `/p <msg>` or `/party <msg>` | Party                 |
| `/raid <msg>`                | Raid                  |
| `/1 <msg>`, `/2 <msg>`, etc. | Channel by number     |
| `/who [name]`                | Who query             |
| `/quit`                      | Disconnect and exit   |

Bare text (no `/` prefix) is sent as say.

`/r` tracks `lastWhisperFrom` — updated on each incoming WHISPER. Errors if
nobody has whispered yet.

### Entry Point Change

```typescript
const handle = await worldSession(config, auth);
console.log("Logged in.");
await startTui(handle, process.stdin.isTTY ?? false);
```

## Testing Strategy

1. Build protocol + session + TUI.
2. Test against the live server with two clients (config1 whispers config2,
   config2 receives and verifies, etc.). Two accounts configured via
   `WOW_ACCOUNT_1`/`WOW_ACCOUNT_2` env vars in mise.local.toml.
3. Once behavior is confirmed live, encode it in mock-server integration tests
   for regression safety.

### Unit Tests

- `src/protocol/chat.test.ts` — parsers and builders for all chat types, name
  query, who query. Hand-built packets as fixtures.
- `src/tui.test.ts` — command parsing logic. Mock WorldHandle with stubs.

### Integration Tests

- Extend mock world server to handle CMSG_MESSAGE_CHAT (echo back),
  CMSG_NAME_QUERY (canned response), CMSG_WHO (canned response).
- Extend client.test.ts to verify send/receive through the full stack.

### Live Tests

- Two-client tests in src/test/live.ts using config1 and config2.
- One client sends a whisper, the other verifies receipt. Say within range.
  /who queries. Closes the loop without human involvement.

## Constraints

- Zero runtime dependencies. node:readline, node:crypto, node:zlib all built
  into Bun.
- Same AzerothCore 3.3.5a target, same build 12340.
- WorldHandle remains the sole public API surface for game interaction.
