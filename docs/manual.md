# tuicraft Manual

tuicraft is a single binary WoW 3.3.5a chat client. It runs as an interactive
TUI (no args), background daemon (`--daemon`), or one-shot CLI client
(subcommands/flags). Same interface for humans and scripts.

## Quick Start

```sh
tuicraft setup --account XI --password pass --character Xi
tuicraft                        # interactive TUI
tuicraft "hello world"          # say (auto-starts daemon)
tuicraft read --wait 5          # read events, wait 5s
tuicraft stop                   # stop daemon
```

## Interactive TUI

Run `tuicraft` with no arguments for a readline prompt. Type commands or plain
text:

| Command                | Action                          |
| ---------------------- | ------------------------------- |
| `hello everyone`       | Say "hello everyone" (no slash) |
| `/s hello`             | Say (explicit)                  |
| `/y HELLO`             | Yell                            |
| `/w Xiara follow me`   | Whisper to Xiara                |
| `/r on my way`         | Reply to last whisper           |
| `/g anyone online?`    | Guild chat                      |
| `/p inv please`        | Party chat                      |
| `/raid pull in 10`     | Raid chat                       |
| `/1 looking for group` | Channel 1 (usually General)     |
| `/2 WTS sword`         | Channel 2 (usually Trade)       |
| `/who mage`            | Search for online players       |
| `/quit`                | Disconnect and exit             |

Incoming messages appear above the prompt:

```
[whisper from Xiara] Following Deity
[say] Xi: hello
[guild] Xiara: heading out
[yell] Xi: HELLO
[party] Xiara: inv
[General] Xi: anyone around?
[system] Welcome to AzerothCore
```

## CLI Subcommands

| Command              | Description                   |
| -------------------- | ----------------------------- |
| `tuicraft`           | Interactive TUI mode          |
| `tuicraft setup`     | Configure account credentials |
| `tuicraft "message"` | Send a say message            |
| `tuicraft read`      | Read buffered events          |
| `tuicraft tail`      | Continuous event stream       |
| `tuicraft status`    | Show daemon connection status |
| `tuicraft stop`      | Stop the daemon               |
| `tuicraft logs`      | Print session log (JSONL)     |
| `tuicraft help`      | Show help text                |

## Chat Flags

| Flag              | Description |
| ----------------- | ----------- |
| `-w <name> "msg"` | Whisper     |
| `-y "message"`    | Yell        |
| `-g "message"`    | Guild chat  |
| `-p "message"`    | Party chat  |
| `--who [filter]`  | Who query   |

## Options

| Flag       | Description                              |
| ---------- | ---------------------------------------- |
| `--json`   | Output events as JSONL (read, tail, who) |
| `--wait N` | Wait N seconds for events (read)         |
| `--daemon` | Start as background daemon (internal)    |
| `--help`   | Show help text                           |

## Setup

```sh
tuicraft setup --account XI --password pass --character Xi
tuicraft setup --host t1 --port 3724
tuicraft setup                  # interactive wizard
```

| Flag               | Default |
| ------------------ | ------- |
| `--account NAME`   | —       |
| `--password PASS`  | —       |
| `--character NAME` | —       |
| `--host HOST`      | t1      |
| `--port PORT`      | 3724    |

## Output Formats

### Human (default)

```
[say] Xi: hello world
[whisper from Xiara] Following Deity
[guild] Xiara: heading out
[who] 3 results: Xiara (80), Hemet (74), Sanu (14)
```

### JSON (`--json`)

```jsonl
{"type":"SAY","sender":"Xi","message":"hello world"}
{"type":"WHISPER_FROM","sender":"Xiara","message":"Following Deity"}
```

## Daemon Lifecycle

The daemon starts automatically on the first CLI command and stays running for
30 minutes of inactivity (configurable via `timeout_minutes` in config). It
maintains the WoW connection and buffers up to 1000 events in a ring buffer.

```
tuicraft "hello"    # starts daemon if not running
tuicraft status     # → CONNECTED
tuicraft stop       # graceful shutdown
```

The daemon listens on a unix domain socket. CLI commands connect, send one line,
read the response, and disconnect.

## Files

| Path                                  | Description    |
| ------------------------------------- | -------------- |
| `~/.config/tuicraft/config.toml`      | Account config |
| `/tmp/tuicraft-<uid>/sock`            | Daemon socket  |
| `/tmp/tuicraft-<uid>/pid`             | Daemon pidfile |
| `~/.local/state/tuicraft/session.log` | Session log    |

## Tips

- Plain text (no `/` prefix) is sent as say in both TUI and CLI mode
- `/r` tracks the last person who whispered you (TUI only)
- Channel numbers (`/1`, `/2`) map to the channels you joined on login (TUI only)
- Ctrl+C or `/quit` to exit the TUI cleanly
- Horde characters use language 1 (Orcish) by default — Alliance should set
  language to 7 in config
- Add `--json` for machine-readable output from CLI commands
