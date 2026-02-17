# tuicraft: A Headless WoW 3.3.5a Text Client

**Date**: 2026-02-17

## What It Is

tuicraft is a headless WoW 3.3.5a client written in Bun/TypeScript that connects to an AzerothCore private server as a real player character. It presents the game as a text interface — a MUD-like experience layered on top of a graphical MMO.

A human can play WoW from a terminal. An LLM can play WoW via tool-use. Same interface, different driver.

tuicraft is not a server-side module. Not tied to any specific fork. Not an LLM integration. It's a client that speaks the WoW binary protocol.

## Motivation

mod-playerbots provides excellent procedural AI for bot characters (combat rotations, pathing, quest completion). But controlling bots from outside the game is clunky — the existing TCP interface (port 8888) is request-response only, lacks event streaming, and misses critical game state (chat, emotes, quest objectives, buffs/debuffs, loot).

Instead of patching the server further, tuicraft approaches the problem from the client side: log in as a real character, see everything the game sends, and send commands back. No server modifications required.

## Usage Model

```
WoW Client  →  Deity (human player)
                  ↕ party/whisper
mod-playerbots → Xiara (bot, full procedural AI)
                  ↕ whisper commands
tuicraft     →  Xi (GM puppetmaster, sits in town)
                  ↕
              Terminal / Claude / script
```

Xi is a GM character logged in via tuicraft. Xi whispers bot commands to Xiara, who executes them using mod-playerbots' procedural AI. Xi receives whisper responses and game events. The human or LLM drives Xi from the terminal.

This works on any AzerothCore 3.3.5a server running mod-playerbots. No fork patches, no custom modules.

## Architecture

```
┌─────────────────────────────────────────┐
│  tuicraft (Bun process)                 │
│                                         │
│  ┌──────────┐  ┌──────────┐  ┌───────┐ │
│  │ Protocol │  │ Session  │  │  TUI  │ │
│  │  Layer   │──│  Layer   │──│ Layer │ │
│  └──────────┘  └──────────┘  └───────┘ │
│       │                          │      │
│  SRP-6, Arc4,              stdin/stdout │
│  packet framing                         │
└───────┼─────────────────────────┼───────┘
        │                         │
   TCP 3724 (auth)          Terminal / pipe
   TCP 8085 (world)
        │
┌───────┴──────────┐
│  AzerothCore     │
│  (any 3.3.5a)    │
└──────────────────┘
```

**Protocol Layer** — WoW 3.3.5a binary protocol. SRP-6 authentication against authserver (port 3724), Arc4-encrypted session with worldserver (port 8085), packet serialization/deserialization. Pure data in, data out.

**Session Layer** — Game state and logic. Tracks character state, manages the character list, handles incoming opcodes (chat, notifications), exposes an API for sending commands. Importable as a library: `import { TuicraftClient } from 'tuicraft'`.

**TUI Layer** — Human/LLM interface. Interactive readline mode or non-interactive pipe mode. Just one consumer of the session layer.

## Protocol Implementation

### Authentication flow

1. Connect to authserver (port 3724)
2. Send `LOGON_CHALLENGE` with account name, client build 12340 (3.3.5a)
3. Receive SRP-6 parameters (B, g, N, salt)
4. Compute SRP-6 proof (A, M1) using SHA-1 and BigInt math
5. Send `LOGON_PROOF`, validate server's M2, get session key K
6. Request realm list, select realm
7. Connect to worldserver (port 8085)
8. Receive `SMSG_AUTH_CHALLENGE`, compute SHA-1 proof using session key
9. Send `CMSG_AUTH_SESSION` with compressed addon info
10. Enable Arc4 header encryption (HMAC-SHA1 derived keys, drop-1024)
11. Request character list, select character, send `CMSG_PLAYER_LOGIN`

### Packet format

- Outgoing: 6-byte header (2 bytes size BE + 4 bytes opcode LE), Arc4-encrypted
- Incoming: 4-byte header (2 bytes size BE + 2 bytes opcode LE), Arc4-encrypted
- Body is always plaintext

### v1 opcodes (chat-only MVP)

| Direction | Opcode | Purpose |
|---|---|---|
| → | `CMSG_MESSAGECHAT` | Send whisper/say/channel |
| ← | `SMSG_MESSAGECHAT` | Receive chat messages |
| ← | `SMSG_GM_MESSAGECHAT` | Receive GM messages |
| → | `CMSG_WHO` | /who query |
| ← | `SMSG_WHO` | /who response |
| → | `CMSG_NAME_QUERY` | Resolve GUID to name |
| ← | `SMSG_NAME_QUERY_RESPONSE` | Name result |
| ↔ | `SMSG_TIME_SYNC_REQ` / `CMSG_TIME_SYNC_RESP` | Keepalive |
| ↔ | `CMSG_PING` / `SMSG_PONG` | Keepalive |
| ← | `SMSG_CHAT_PLAYER_NOT_FOUND` | Error handling |
| ← | `SMSG_CHANNEL_NOTIFY` | Channel join/leave events |

~14 opcodes for a working chat client. Hundreds more exist but are not implemented in v1.

## TUI Interface

### Interactive mode

```
$ tuicraft --host 100.73.138.96 --account XI --character Xi
Password: ****
Connecting to authserver...
Authenticating...
Realm: AzerothCore (1 character)
Logging in as Xi...

Xi logged in. Goldshire, Elwynn Forest.
Type /help for commands.

> /w Xiara follow Deity
[whisper to Xiara] follow Deity
[whisper from Xiara] Following Deity

> /s hello
[say] Xi: hello

> /who priest 70-80
[who] 3 results: ...
```

### Pipe mode

```
$ tuicraft --host ... --account XI --character Xi --pipe
```

No prompt, no formatting. Raw lines in (commands) and out (events). For LLM/script consumption:

```
$ echo '/w Xiara follow Deity' | tuicraft --pipe --host ...
```

### Commands

| Command | What it does |
|---|---|
| `/w <name> <msg>` | Whisper |
| `/s <msg>` | Say |
| `/g <msg>` | Guild chat |
| `/who <query>` | /who query |
| `/help` | List commands |
| `/quit` | Disconnect and exit |

## Project Structure

```
tuicraft/
├── src/
│   ├── index.ts              — CLI entry point, arg parsing
│   ├── protocol/
│   │   ├── auth.ts           — SRP-6 handshake, realm list
│   │   ├── world.ts          — World session, Arc4 encryption
│   │   ├── packet.ts         — Packet framing, buffer read/write
│   │   └── opcodes.ts        — Opcode enum
│   ├── crypto/
│   │   ├── srp.ts            — SRP-6 math (BigInt, SHA-1)
│   │   └── arc4.ts           — RC4 header encryption
│   ├── session/
│   │   ├── client.ts         — TuicraftClient, orchestrates auth → world → login
│   │   ├── chat.ts           — Chat message parsing, sending, routing
│   │   └── handlers.ts       — Opcode handlers
│   └── tui/
│       ├── repl.ts           — Interactive readline interface
│       └── pipe.ts           — Non-interactive stdin/stdout mode
├── package.json
├── tsconfig.json
└── README.md
```

Zero runtime dependencies. Bun provides TCP, crypto, zlib, and readline natively.

## Prior Art

- **wow-chat-client** (`@timelostprototype/wow-chat-client`) — TypeScript WoW 3.3.5a protocol implementation. Used as reference for packet formats, SRP-6 flow, Arc4 encryption, and opcode structures. Not used as a dependency.
- **mod-ollama-bot-buddy** — AzerothCore module that shows what game state can be extracted server-side (nearby creatures, spells, quests, positions).
- **mod-ollama-chat** — AzerothCore module for LLM-powered bot chat with personality and sentiment systems.
- **namigator** / **AmeisenNavigation** — Client-side pathfinding libraries for WoW using Recast/Detour. Relevant for future movement support.

## Future Extensions (not v1)

**v2 — World State:** Parse `SMSG_UPDATE_OBJECT` to track nearby entities. Status bar, numbered target list. Transition from chat client to MUD client.

**v3 — Movement:** Send `CMSG_MOVE_*` opcodes. Raw coordinate movement, then pathfinding via mmaps (client-side or server helper).

**v4 — Automation:** Scriptable command sequences, event subscriptions, client-side strategy behaviors replacing mod-playerbots' procedural AI for the controlled character.

**v5 — Multi-bot:** Multiple characters per tuicraft instance or coordinated instances.

The three-layer architecture (protocol / session / TUI) accommodates all extensions without restructuring.
