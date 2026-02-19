# tuicraft

A headless WoW 3.3.5a client that speaks the binary protocol from a terminal.
Authenticate via SRP-6, enter the world as a character via your account. Built
with Bun and TypeScript, zero runtime dependencies.

tuicraft targets AzerothCore private servers and is designed to be both human
and LLM friendly.

## Features

🔐 **Authentication** — SRP-6 login, Arc4-encrypted world session, realm
selection, character select

💬 **Chat** — Say, yell, whisper, guild, party, raid, and channel messages with
`/r` reply support

👥 **Party Management** — Invite, kick, leave, leader transfer, accept/decline
invitations, live group roster with member stats

🔍 **Who Search** — Query online players with filters, human and JSON output

🖥️ **Interactive TUI** — Readline-based terminal UI with slash commands and
channel switching

🤖 **CLI & Daemon** — Auto-starting background daemon with Unix socket IPC, pipe
mode, JSONL output for scripting

📝 **Session Logging** — Persistent session log with `tuicraft logs` playback

⚡ **Zero Dependencies** — Pure TypeScript on Bun, compiles to a single binary

## Development

Requires [Bun](https://bun.sh) and [mise](https://mise.jdx.dev).

```
mise trust -y
mise bundle
mise build
```

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
./dist/tuicraft help                # show help
./dist/tuicraft setup
./dist/tuicraft                     # interactive TUI
./dist/tuicraft "Hello world"       # send a say message (auto-starts daemon)
./dist/tuicraft -w Hemet "Hey"      # whisper
./dist/tuicraft read --wait 5       # read events, wait up to 5s
./dist/tuicraft tail                # continuous event stream
./dist/tuicraft status              # daemon status
./dist/tuicraft stop                # stop daemon
```

## Roadmap

- [x] 🔐 **0.1 — Auth & Connect:** SRP-6 auth, Arc4-encrypted world session,
      character select, keepalive
- [x] 💬 **0.2 — Chat:** Send/receive whispers, say, guild chat. TUI with
      interactive and pipe modes
- [x] 👥 **0.3 — Party Management:** Invite, kick, leave, leader transfer,
      group roster, member stats
- [ ] 🌍 **0.4 — World State:** Parse `SMSG_UPDATE_OBJECT` to track nearby
      entities
- [ ] 🏃 **0.5 — Movement:** Send `CMSG_MOVE_*` opcodes, pathfinding via mmaps
- [ ] 🤖 **0.6 — Automation:** Scriptable command sequences and event
      subscriptions

## Prior Art

[wow-chat-client](https://github.com/swiftmatt/wow-chat-client): TypeScript WoW
3.3.5a protocol implementation, used as reference for packet formats and SRP-6
flow

## License

[MIT](LICENSE).
