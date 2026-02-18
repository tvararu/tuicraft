# tuicraft

A headless WoW 3.3.5a client that speaks the binary protocol from a terminal.
Authenticate via SRP-6, enter the world as a character via your account. Built
with Bun and TypeScript, zero runtime dependencies.

tuicraft targets AzerothCore private servers and is designed to be both human
and LLM friendly.

## Development

Requires [Bun](https://bun.sh) and [mise](https://mise.jdx.dev).

```
mise trust -y
mise bundle
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

## Usage (WIP)

```
mise start --account nesingwary --password hunter2 --character Hemet [--host t1] [--port 3724]
```

The client connects to the authserver, authenticates, picks the first realm,
logs in as the named character, and enters a keepalive loop responding to time
sync requests and sending pings.

Single binary distribution/packaging via `bun build --compile` is possible, TBD.

## Roadmap

- [x] 🔐 **0.1 — Auth & Connect:** SRP-6 auth, Arc4-encrypted world session,
      character select, keepalive
- [x] 💬 **0.2 — Chat:** Send/receive whispers, say, guild chat. TUI with
      interactive and pipe modes
- [ ] 🌍 **0.3 — World State:** Parse `SMSG_UPDATE_OBJECT` to track nearby
      entities
- [ ] 🏃 **0.4 — Movement:** Send `CMSG_MOVE_*` opcodes, pathfinding via mmaps
- [ ] 🤖 **0.5 — Automation:** Scriptable command sequences and event
      subscriptions

## Prior Art

[wow-chat-client](https://github.com/swiftmatt/wow-chat-client): TypeScript WoW
3.3.5a protocol implementation, used as reference for packet formats and SRP-6
flow

## License

[MIT](LICENSE).
