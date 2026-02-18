# tuicraft(1)

WoW 3.3.5a chat client

## Synopsis

```
tuicraft
tuicraft <message>
tuicraft [-w <name> | -y | -g | -p] <message>
tuicraft [--who [filter]] [--json]
tuicraft setup [--account NAME] [--password PASS] [--character NAME]
tuicraft read [--wait N] [--json]
tuicraft tail [--json]
tuicraft status | stop | logs | help
```

## Description

tuicraft is a single binary that connects to a WoW 3.3.5a server as a player
character. It runs in three modes: interactive TUI (no args), background daemon
(`--daemon`), or one-shot CLI client (subcommands and flags).

CLI commands auto-start a background daemon that holds the WoW connection and
buffers events in a ring buffer. The daemon listens on a unix domain socket. CLI
clients connect, send one command, read the response, and disconnect. The daemon
idles out after 30 minutes of inactivity.

## Commands

`tuicraft`
: Interactive TUI with a readline prompt. Type slash commands or plain text.

`tuicraft` _message_
: Send a say message. Auto-starts the daemon if needed.

`tuicraft setup` [*flags*]
: Configure account credentials. With no flags, runs an interactive wizard.

`tuicraft read` [`--wait` *N*] [`--json`]
: Read buffered events. `--wait` polls for _N_ seconds before returning.

`tuicraft tail` [`--json`]
: Continuous event stream. Blocks and prints events as they arrive.

`tuicraft status`
: Print daemon connection status (`CONNECTED` or error).

`tuicraft stop`
: Graceful daemon shutdown.

`tuicraft logs`
: Print the JSONL session log to stdout.

`tuicraft help`
: Print usage summary.

## Chat Flags

`-w` _name_ _message_
: Whisper to a player.

`-y` _message_
: Yell.

`-g` _message_
: Guild chat.

`-p` _message_
: Party chat.

`--who` [*filter*]
: Who query. Optional name/class/level filter.

## Options

`--json`
: Output events as JSONL instead of human-readable format. Works with `read`,
`tail`, and chat commands.

`--wait` _N_
: Wait _N_ seconds for events before returning. For use with `read`.

`--help`
: Print usage summary.

`--daemon`
: Start as background daemon. Internal — not meant to be called directly.

## Setup Flags

`--account` _NAME_
: Account name (required).

`--password` _PASS_
: Account password (required).

`--character` _NAME_
: Character name (required).

`--host` _HOST_
: Auth server hostname. Default: `t1`.

`--port` _PORT_
: Auth server port. Default: `3724`.

## Interactive Commands

When running in TUI mode, the following slash commands are available:

| Command           | Action                      |
| ----------------- | --------------------------- |
| _text_            | Say (no slash needed)       |
| `/s` _msg_        | Say (explicit)              |
| `/y` _msg_        | Yell                        |
| `/w` _name_ _msg_ | Whisper                     |
| `/r` _msg_        | Reply to last whisper       |
| `/g` _msg_        | Guild chat                  |
| `/p` _msg_        | Party chat                  |
| `/raid` _msg_     | Raid chat                   |
| `/1` _msg_        | Channel 1 (usually General) |
| `/2` _msg_        | Channel 2 (usually Trade)   |
| `/who` _query_    | Who search                  |
| `/quit`           | Disconnect and exit         |

## Output Format

Human-readable (default):

```
[say] Xi: hello world
[whisper from Xiara] Following Deity
[guild] Xiara: heading out
[who] 3 results: Xiara (80), Hemet (74), Sanu (14)
```

JSONL (`--json`):

```jsonl
{"type":"SAY","sender":"Xi","message":"hello world"}
{"type":"WHISPER_FROM","sender":"Xiara","message":"Following Deity"}
```

## Files

`~/.config/tuicraft/config.toml`
: Account credentials and settings.

`$TMPDIR/tuicraft-<uid>/sock`
: Daemon unix domain socket.

`$TMPDIR/tuicraft-<uid>/pid`
: Daemon pidfile.

`~/.local/state/tuicraft/session.log`
: Persistent JSONL session log.

## Examples

First-time setup:

```sh
tuicraft setup --account XI --password pass --character Xi
```

Send a message and read the response:

```sh
tuicraft "hello world"
tuicraft read --wait 3
```

Script integration:

```sh
tuicraft "follow me"
tuicraft read --wait 3 --json | jq .
tuicraft --who mage --json
```

## Notes

Horde characters use Orcish (language 1) by default. Alliance characters should
set `language = 7` in the config file.

The daemon buffers up to 1000 events. The idle timeout is configurable via
`timeout_minutes` in the config file.
