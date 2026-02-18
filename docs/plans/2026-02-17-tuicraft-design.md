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

## 0.1 Scope: Authenticate and Stay Connected

0.1 proves the protocol works end-to-end. No chat, no TUI — just authenticate, enter the world, and stay alive.

### 0.1 Design Decisions

- **Opcode dispatch**: `Map<number, handler>` for persistent handlers + `expect(opcode): Promise<PacketReader>` for request-response. No EventEmitter.
- **Packet buffer**: Thin `PacketReader` / `PacketWriter` wrappers over `DataView` on `Uint8Array`. Cursor-based read/write. Writer grows dynamically.
- **Crypto**: Bun's `node:crypto` compat (`createHash`, `createHmac`, `createCipheriv`). Same API as the wow-chat-client reference.
- **TCP**: `Bun.connect` native TCP API. Data arrives as `Uint8Array`.
- **Testing**: Unit tests with known vectors for all modules. Integration test against live server. Tests colocated with implementation.
- **No session/TUI layer in 0.1**. `index.ts` drives the flow directly.

### 0.1 Project Structure

```
src/
├── index.ts                — CLI entry, arg parsing, orchestrates auth → world → keepalive
├── protocol/
│   ├── auth.ts             — SRP-6 handshake with authserver (port 3724), realm list
│   ├── auth.test.ts        — Challenge parsing, proof construction, realm list parsing
│   ├── world.ts            — World session: auth proof, Arc4 enable, packet dispatch, keepalive
│   ├── world.test.ts       — Auth proof construction, Arc4 timing, dispatch, TCP buffering
│   ├── packet.ts           — PacketReader / PacketWriter (thin DataView wrappers)
│   ├── packet.test.ts      — Round-trip read/write, edge cases, cString encoding
│   └── opcodes.ts          — Opcode constants enum
├── crypto/
│   ├── srp.ts              — SRP-6 math (BigInt + SHA-1)
│   ├── srp.test.ts         — Known challenge/response test vectors
│   ├── arc4.ts             — RC4 header encryption (HMAC-SHA1 key derivation, drop-1024)
│   └── arc4.test.ts        — Encrypt/decrypt against known ciphertext
```

### 0.1 Connection Flow

1. Parse CLI args: `--host`, `--port`, `--account`, `--password`, `--character`
2. Connect TCP to authserver (`host:3724`) via `Bun.connect`
3. Send `LOGON_CHALLENGE` with account name, client build 12340
4. Compute SRP-6 proof, send `LOGON_PROOF`, validate server's M2 → get session key K
5. Request realm list, pick first realm
6. Disconnect authserver, connect TCP to worldserver (`realm.host:realm.port`)
7. Receive `SMSG_AUTH_CHALLENGE`, compute SHA-1 proof with session key
8. Send `CMSG_AUTH_SESSION` with compressed addon info
9. Enable Arc4 encryption (immediately after send, before response)
10. Request character list (`CMSG_CHAR_ENUM`), pick character by name
11. Send `CMSG_PLAYER_LOGIN`, wait for `SMSG_LOGIN_VERIFY_WORLD`
12. Print "Logged in." and enter keepalive loop
13. Respond to `SMSG_TIME_SYNC_REQ` with `CMSG_TIME_SYNC_RESP`
14. Send `CMSG_PING` periodically, expect `SMSG_PONG`

### 0.1 Opcodes

| Direction | Opcode                                       | Purpose                 |
| --------- | -------------------------------------------- | ----------------------- |
| →         | `CMSG_AUTH_PROOF`                            | World auth session      |
| ←         | `SMSG_AUTH_CHALLENGE`                        | World auth challenge    |
| ←         | `SMSG_AUTH_RESPONSE`                         | World auth result       |
| →         | `CMSG_CHAR_ENUM`                             | Request character list  |
| ←         | `SMSG_CHAR_ENUM`                             | Character list response |
| →         | `CMSG_PLAYER_LOGIN`                          | Enter world             |
| ←         | `SMSG_LOGIN_VERIFY_WORLD`                    | World entry confirmed   |
| ↔         | `SMSG_TIME_SYNC_REQ` / `CMSG_TIME_SYNC_RESP` | Keepalive               |
| ↔         | `CMSG_PING` / `SMSG_PONG`                    | Keepalive               |

### Key Implementation Details

**PacketReader/PacketWriter**: Wraps `Uint8Array` with `DataView` and cursor. Reader methods: `uint8()`, `uint16LE()`, `uint16BE()`, `uint32LE()`, `bytes(n)`, `cString()`. Writer has matching write methods and grows its backing buffer dynamically.

**TCP buffering**: Incoming data arrives in chunks via `Bun.connect`. Accumulator buffer appends new data, tries to parse complete packets (header first to get size, then body), keeps leftovers for next chunk.

**Arc4 timing**: Arc4 is enabled immediately after sending `CMSG_AUTH_SESSION`, before receiving the response. The server's response is already encrypted.

**Password handling**: Read from `--password` flag or prompt via stdin if not provided. Account and password uppercased per WoW convention.

## Protocol Implementation

### Authentication flow (authserver)

1. Connect to authserver (port 3724)
2. Send `LOGON_CHALLENGE` with account name, client build 12340 (3.3.5a)
3. Receive SRP-6 parameters (B, g, N, salt)
4. Compute SRP-6 proof (A, M1) using SHA-1 and BigInt math
5. Send `LOGON_PROOF`, validate server's M2, get session key K
6. Request realm list, select realm

### Packet format

- Outgoing (client → server): 6-byte header (2 bytes size BE + 4 bytes opcode LE), Arc4-encrypted
- Incoming (server → client): 4-byte header (2 bytes size BE + 2 bytes opcode LE), Arc4-encrypted
- Body is always plaintext

### SRP-6 Implementation

BigInt-based. Key steps:

- Identity hash: `SHA1(account + ":" + password)`
- Private value `x` from `SHA1(salt || identity_hash)` (little-endian)
- Client public value `A = g^a mod N`
- Scrambler `u` from `SHA1(pad(A) || pad(B))` (little-endian)
- Session key `S` via interleaved hashing: split even/odd bytes of S, SHA1 each half, interleave back into 40-byte key K
- Proof `M1 = SHA1(H(N) xor H(g) || H(account) || salt || A || B || K)`
- Server proof `M2 = SHA1(A || M1 || K)` for validation
- All big numbers stored/transmitted little-endian (reversed from math representation)

### Arc4 Implementation

- HMAC-SHA1 derived keys from fixed seeds: encrypt key `C2B3723CC6AED9B5343C53EE2F4367CE`, decrypt key `CC98AE04E897EACA12DDC09342915357`
- RC4 cipher via `createCipheriv("rc4", key, "")`
- Drop first 1024 bytes of keystream (Arc4-drop1024)
- Only encrypts/decrypts packet headers, not body

## TUI Interface (post-0.1)

### Interactive mode

```
$ tuicraft --host t1 --account XI --character Xi
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
$ tuicraft --host t1 --account XI --character Xi --pipe
```

No prompt, no formatting. Raw lines in (commands) and out (events). For LLM/script consumption.

### Commands (post-0.1)

| Command           | What it does        |
| ----------------- | ------------------- |
| `/w <name> <msg>` | Whisper             |
| `/s <msg>`        | Say                 |
| `/g <msg>`        | Guild chat          |
| `/who <query>`    | /who query          |
| `/help`           | List commands       |
| `/quit`           | Disconnect and exit |

## Prior Art

- **wow-chat-client** (`@timelostprototype/wow-chat-client`) — TypeScript WoW 3.3.5a protocol implementation at `../wow-chat-client`. Used as reference for packet formats, SRP-6 flow, Arc4 encryption, and opcode structures. Not used as a dependency.
- **mod-ollama-bot-buddy** — AzerothCore module that shows what game state can be extracted server-side.
- **namigator** / **AmeisenNavigation** — Client-side pathfinding libraries for WoW. Relevant for future movement support.

## Future Extensions (not 0.1)

**0.2 — Chat:** Send/receive whispers, say, guild chat. TUI layer with interactive and pipe modes. Session layer with `TuicraftClient` API.

**0.3 — World State:** Parse `SMSG_UPDATE_OBJECT` to track nearby entities. Status bar, numbered target list.

**0.4 — Movement:** Send `CMSG_MOVE_*` opcodes. Raw coordinate movement, then pathfinding via mmaps.

**0.5 — Automation:** Scriptable command sequences, event subscriptions, client-side strategy behaviors.

**0.6 — Multi-bot:** Multiple characters per tuicraft instance or coordinated instances.

The three-layer architecture (protocol / session / TUI) accommodates all extensions without restructuring.

## Constraints

- Zero runtime dependencies. Bun provides TCP, crypto (node:crypto), zlib, and readline natively.
- Server: AzerothCore 3.3.5a on Tailnet host `t1` (ports 3724/8085).
- Client build: 12340 (WoW 3.3.5a 12340).
