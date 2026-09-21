# tuicraft

Chat in WoW 3.3.5a from your terminal. Targets AzerothCore private servers and
is designed to be both human and LLM friendly.

```sh
curl -fsSL tuicraft.vararu.org/install.sh | sh
```

![Terminal showing tuicraft running](docs/screenshot.png)

## Features

🔐 **Authentication** - Secure login, realm selection, and character select

💬 **Chat** - Say, yell, whisper, guild, party, raid, and channel messages with
`/r` reply support

👥 **Party Management** - Invite, kick, leave, leader transfer, accept/decline
invitations, live group roster with member stats

👫 **Friends List** - View online/offline friends, add/remove friends, real-time
online status notifications

🚫 **Ignore List** - Server-side ignore list, messages from ignored players
filtered from chat

🔍 **Who Search** - Query online players with filters, human and JSON output

🖥️ **Interactive TUI** - Full terminal UI with slash commands and channel
switching

🤖 **CLI & Daemon** - Background daemon, pipe mode, and JSONL output for
scripting

**Direct control** - Bounded walk, face, target, and halt through the CLI.
Ordinary walking is predicted locally; control state keeps the last server pose
separate. Not combat, pathfinding, or autonomous play.

📝 **Session Logging** - Persistent session log with `tuicraft logs` playback

⚡ **Zero Dependencies** - Pure TypeScript on Bun, compiles to a single binary

## Install

```sh
curl -fsSL tuicraft.vararu.org/install.sh | sh
```

Override the install directory (default: `/usr/local/bin`):

```sh
TUICRAFT_INSTALL_DIR=~/.local/bin curl -fsSL tuicraft.vararu.org/install.sh | sh
```

Pre-built binaries are available on the [releases
page](https://github.com/tvararu/tuicraft/releases).

## Compatibility

| Platform | Architecture         | Status                        |
| -------- | -------------------- | ----------------------------- |
| Linux    | x64, ARM64           | Supported                     |
| macOS    | Apple Silicon, Intel | Supported                     |
| Windows  | WSL2                 | Supported (uses Linux binary) |

## Development

Requires [mise](https://mise.jdx.dev), which installs `bun`:

```
mise trust -y
mise bundle
mise build
```

Agents own engineering, review, and integration. Verified changes land on
`main`; pull requests, force-pushes, hook bypass, and releases are not used.
Frameworks such as Superpowers are optional. Keep typecheck, format, and
meaningful tests; coverage is diagnostic, not a percentage gate. Repository
rules are in [AGENTS.md](AGENTS.md).

## Testing

```
mise test
```

To run live integration tests against a real server, copy the example config and
fill in your credentials:

```
cp mise.local.toml.example mise.local.toml
# edit mise.local.toml with your account details
mise test:live
```

## Usage

```
tuicraft help              # show help
tuicraft setup
tuicraft                   # interactive TUI
tuicraft send "Hello"      # send a say message (auto-starts daemon)
tuicraft send -w Hemet "x" # whisper
tuicraft send -g "lfm"     # guild chat
tuicraft who               # who query
tuicraft read --wait 5     # read events, wait up to 5s
tuicraft tail              # continuous event stream
tuicraft control [--json]  # predicted pose vs last server pose, targets
tuicraft nearby [--all] [--json] # nearby entities, nearest first (within 100yd, or --all)
tuicraft move forward 1000 # walk 1-10000ms (default 1000); left/right strafe
tuicraft face 1.57         # facing in radians
tuicraft target 0xabc      # select (0 clears); uint64 hex or decimal
tuicraft combat [--json]   # vitals, cast, learned IDs
tuicraft spells [--json]   # learned spellbook
tuicraft cast 585 0xabc    # cast learned spell at guid (0 = self)
tuicraft attack 0xabc      # auto-attack
tuicraft fight 0xabc       # Jev tactics; optional --framing none|minimal|mechanics
tuicraft goto 1 2 3        # ground route
tuicraft follow 0xabc 3    # bounded follow of an observed unit
tuicraft following --json # follow state and terminal reason
tuicraft recovery --json  # observed life, corpse, delay and pending intent
tuicraft query-corpse      # request corpse information
tuicraft release-spirit    # request release while observed dead
tuicraft reclaim-corpse    # request guarded reclaim near the actual corpse
tuicraft resurrect accept # answer a current offer; decline is also supported
tuicraft quests --json     # offered dialog, observed log and unanswered intent
tuicraft talk 0xabc        # request conversation with an observed giver
tuicraft query-quest 42    # request metadata, not permission to accept
tuicraft select-quest 42   # choose only a currently offered quest
tuicraft accept-quest      # request acceptance of current offered details
tuicraft cancel-interaction # request dialog close; wait for observed closure
tuicraft inventory --json # observed carried items, counts and coinage
tuicraft loot --json       # current offer, pending requests and reward notices
tuicraft open-loot 0xabc   # request loot from an observed lootable corpse
tuicraft take-loot 0       # request a slot actually present in that offer
tuicraft take-money        # request offered money
tuicraft release-loot      # request closure of the open window
tuicraft halt              # stop motion, cast, attack, tactics, navigation, follow
tuicraft start             # start background daemon and connect
tuicraft status            # daemon status
tuicraft stop              # stop daemon
tuicraft skill             # print SKILL.md for AI agents
```

Spellbook/tactics require compatible client tables; ground routes require
Namigator data and its native library. Set their optional config paths and the
daemon's `TYPESAFE_API_KEY` as described in
[gameplay configuration](docs/manual.md#gameplay-configuration).

The narrow Jev spell kit requires observed normal form, including protocol-defined
zero fields in a complete server CREATE. Absent entities remain unknown.
Unsupported kits stop with a reason and retain terminal observations; cooldown and
server-response waits do not. This increment does not provide tactical chasing
or kiting.

`follow` requests a bounded ground route behind an observed unit on map 530.
The optional distance is 1–20 yards along the ground route, with a default of 3.
It requires compatible navigation data and supported, recent target motion.
Each request lasts at most 30 seconds and allows at most 32 native planning calls.
Loss, stale or unsupported motion, unsafe ground, correction, or manual override
stops following without retries. `halt` also stops following.
`OK` acknowledges the request, not arrival. Inspect `following --json` and
`control --json` for stop reasons and separate predicted versus server poses.
The `holding` state is predicted standoff, not server-confirmed arrival.

Recovery commands use observed life and corpse facts. `query-corpse` requests
information without changing control ownership. Reclaim requires observed ghost
state, matching actual/displayed corpse maps, and a position within 39 yards in 3D.
A known remaining delay blocks reclaim. Missing timing remains unknown, not zero.
An explicitly requested reclaim can proceed with unknown timing if the other guards pass.
`resurrect accept|decline` answers only the current offer. `OK` is request intent,
not proof of release or resurrection. Inspect `recovery --json` and subsequent
observed life updates. Do not retry unanswered requests automatically.

Quest actions use the current server-offered dialog and giver. Inspect `quests`
between actions instead of assuming that a sent request changed the quest log.
Use `select-option <id> [code]` for offered gossip, or `select-quest <id>` for an
offered quest. Quote a code as one shell argument. Empty code differs from no code.
The IPC representation uses JSON to preserve spaces without command injection.
`complete-quest`, `request-reward`, and `choose-reward` require the corresponding
offered dialog. Reward indices and abandonment slots are zero-based.
`OK` is intent only. Acceptance/progress/removal require observed log changes,
and rewards require a server reward notification. Unanswered metadata is unknown,
not missing. `cancel-interaction` requests closure and does not immediately unlock
another mutation. Do not retry before an observed close or authoritative outcome.

`inventory` exposes observed carried items, bag capacity and coinage. Unknown
counts and capacity remain unknown. `loot` separates the current offer, pending
intent, errors, item/money notices and actual inventory evidence.
Opening requires an observed lootable creature corpse and authoritative alive
self state. Take only offered slots. `OK`, slot removal and money clearance do
not prove stored items or a coinage gain. Inspect raw inventory changes separately.

A release-only notification during opening leaves the open request unanswered.
It can precede a later full response and is not proof of denial or closure.
If no full response follows, explicitly reconnect with `tuicraft stop`, then
`tuicraft inventory --json`. This is an ordinary reconnect, not timeout-based
retry support. `release-loot` cannot close an unanswered opening.

## Roadmap

See [docs/roadmap.md](docs/roadmap.md) for current direction. That document is
ambition, not a claim that those capabilities already exist.

## Feature coverage

Based on the list of all possible opcodes. Might still be missing some things
that the official game client does.

### 🔐 Authentication

| Feature               | Status |
| --------------------- | ------ |
| SRP-6 login           | ✅     |
| Reconnect proof       | ✅     |
| Realm selection       | ✅     |
| Character select      | ✅     |
| Arc4 encryption       | ✅     |
| Keepalive / time sync | ✅     |
| Warden anticheat      | ❌     |

### 💬 Chat

| Feature                                 | Status |
| --------------------------------------- | ------ |
| Say, yell                               | ✅     |
| Whisper (`/w`, `/r`)                    | ✅     |
| Guild, officer                          | ✅     |
| Party, raid                             | ✅     |
| Channels (`/1`, `/2`, …)                | ✅     |
| MOTD                                    | ✅     |
| Server broadcast messages               | ✅     |
| Chat restricted / wrong faction notices | ✅     |
| Text emotes (`/e`, `/emote`)            | ✅     |
| DND / AFK status                        | ✅     |

### 👥 Social

| Feature                              | Status |
| ------------------------------------ | ------ |
| Who search                           | ✅     |
| Party invite / kick / leave / leader | ✅     |
| Group roster + member stats          | ✅     |
| Friends list                         | ✅     |
| Ignore list                          | ✅     |
| Channel join / leave                 | ✅     |
| Duel accept / decline                | ✅     |

### 🏰 Guild

| Feature                               | Status |
| ------------------------------------- | ------ |
| Guild chat                            | ✅     |
| Guild roster                          | ✅     |
| Guild events                          | ✅     |
| Guild invite / kick / leave / promote | ✅     |
| Guild bank                            | ❌     |

### ✉️ Mail

| Feature             | Status |
| ------------------- | ------ |
| Send / receive mail | ❌     |
| Mail notifications  | ✅     |

### 🏪 Economy

| Feature       | Status |
| ------------- | ------ |
| Auction house | ❌     |
| Vendors       | ❌     |
| Trade         | ❌     |

### 🌍 World

| Feature           | Status |
| ----------------- | ------ |
| Bounded walk / face / target | ✅     |
| Pathfinding / navigation     | ❌     |
| Spells / auras    | ❌     |
| Combat log        | ❌     |
| Loot              | Bounded creature offers |
| Items / inventory | Observed carried state |

### 📜 PvE

| Feature              | Status |
| -------------------- | ------ |
| Quests               | ❌     |
| NPC gossip           | ❌     |
| Trainers             | ❌     |
| Taxi                 | ❌     |
| Instances / dungeons | ❌     |

### ⚔️ PvP

| Feature               | Status |
| --------------------- | ------ |
| Battlegrounds         | ❌     |
| Arena                 | ❌     |
| Random roll (`/roll`) | ✅     |

### 📊 Progression

| Feature              | Status |
| -------------------- | ------ |
| Achievements         | ❌     |
| Talents              | ❌     |
| LFG / dungeon finder | ❌     |
| Calendar             | ❌     |

## Prior art

- [swiftmatt/wow-chat-client](https://github.com/swiftmatt/wow-chat-client) -
  Node.js WoW 3.3.5a chat client, primary reference for packet formats and
  SRP-6 auth flow
- [azerothcore/azerothcore-wotlk](https://github.com/azerothcore/azerothcore-wotlk) -
  open-source WoW 3.3.5a server emulator, used as the canonical reference for
  handler implementations and update field definitions
- [mod-playerbots/mod-playerbots](https://github.com/mod-playerbots/mod-playerbots) -
  AzerothCore playerbot module, the target server environment for tuicraft
- [wowserhq/wowser](https://github.com/wowserhq/wowser) - browser-based WoW
  3.3.5a client in JS/React/WebGL, useful for cross-referencing opcodes, auth
  error codes, and realm parsing
- [gtker/wow_messages](https://github.com/gtker/wow_messages) - auto-generated
  WoW protocol definitions in `.wowm` format, machine-readable spec for every
  opcode across Vanilla/TBC/WotLK
- [namreeb/namigator](https://github.com/namreeb/namigator) - C++ pathfinding
  and line-of-sight library for WoW, reads MPQ files and generates navmesh via
  Recast/Detour
- [gtker/namigator-rs](https://github.com/gtker/namigator-rs) - Rust FFI
  bindings for namigator, API reference for the pathfinding integration

## License

[AGPLv3](LICENSE).
