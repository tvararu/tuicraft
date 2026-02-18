# Daemon CLI: Single-Binary, LLM-Friendly Interface

**Date**: 2026-02-18

## Problem

Pipe mode works for one-shot commands (`echo '/s hello' | tuicraft`) but
bidirectional sessions are painful. Named pipes (mkfifo) are unreliable across
shell invocations, subprocess stdin management is fragile, and the current
approach requires `mise start` with Bun installed. LLMs and scripts need a
simpler interface to a persistent WoW session.

## Solution

A self-contained binary that manages a background daemon. The daemon holds the
WoW session. The CLI sends commands and reads events over a unix domain socket.
No pipes, no Bun runtime, no mise on the target machine.

```
tuicraft                          # interactive TUI, or reattach if daemon running
tuicraft setup                    # config wizard, or:
tuicraft setup --account x --password y --character Xia --host t1
tuicraft "hello"                  # say via daemon (boots daemon if needed)
tuicraft -w Xiara "follow me"    # whisper
tuicraft -y "HELLO"              # yell
tuicraft -g "guild msg"          # guild
tuicraft -p "party msg"          # party
tuicraft --who                   # /who query
tuicraft --who mage              # /who with filter
tuicraft read                    # drain buffered events
tuicraft read --wait 5           # drain, wait 5s for more, drain again
tuicraft read --json             # drain as JSONL
tuicraft tail                    # stream events continuously
tuicraft logs                    # view persistent session log
tuicraft status                  # is daemon running? connected?
tuicraft stop                    # graceful daemon shutdown
tuicraft help                    # full usage reference
tuicraft --help                  # same
```

An LLM discovers the full interface by running `tuicraft --help`.

## Architecture

```
┌──────────────┐         ┌─────────────────────────┐
│  CLI          │  unix   │  Daemon                 │
│  tuicraft     │──sock──▶│  tuicraft --daemon      │
│  "hello"      │◀────────│                         │
└──────────────┘         │  ┌─────────┐  ┌───────┐ │
                         │  │Protocol │──│Session │ │
                         │  │ Layer   │  │ Layer  │ │
                         │  └─────────┘  └───────┘ │
                         │       │                  │
                         │  TCP to WoW server       │
                         └─────────────────────────┘
```

Two execution modes from the same binary:

**Interactive TUI** (`tuicraft` with no args, no daemon running): Connects
directly to the WoW server, runs the existing readline loop with ANSI
formatting. Current behavior preserved.

**Interactive reattach** (`tuicraft` with no args, daemon running): Opens a
readline prompt that reads and writes through the daemon socket. Same user
experience as the direct TUI, but shares the session started by one-shot
commands.

**Daemon CLI** (any args or subcommand): Communicates with a background daemon
over a unix domain socket. If no daemon is running, the first invocation spawns
one.

The existing protocol layer (`client.ts`, `crypto/`, `protocol/`) is unchanged.

## Daemon Lifecycle

**Startup**: A one-shot CLI command detects no socket file and spawns
`tuicraft --daemon` as a detached child. The daemon:

1. Reads `$XDG_CONFIG_HOME/tuicraft/config.toml`
2. Runs the auth handshake and world session
3. Creates the unix socket at `$RUNTIME_DIR/sock`
4. Writes a pidfile at `$RUNTIME_DIR/pid`
5. Starts accepting CLI connections

The spawning CLI polls for the socket (up to ~15s for auth) before sending its
command.

**Idle timeout**: The daemon tracks the timestamp of the last CLI interaction. A
periodic check fires every minute. If no interaction for `timeout_minutes`
(configurable, default 30), it disconnects from WoW and exits.

**Shutdown**: `tuicraft stop` sends a STOP message over the socket. The daemon
closes the WoW connection, removes the socket and pidfile, exits. SIGTERM and
SIGINT trigger the same cleanup.

**Crash recovery**: If the pidfile exists but the process is dead, the CLI
cleans up stale files and spawns a fresh daemon.

## File Locations

**Config**: `$XDG_CONFIG_HOME/tuicraft/config.toml` (defaults to
`~/.config/tuicraft/config.toml`)

**Runtime** (socket, pidfile): `${os.tmpdir()}/tuicraft-${process.getuid()}/`
Resolves to `/var/folders/.../T/tuicraft-501/` on macOS,
`/tmp/tuicraft-1000/` on Linux. Cleaned on reboot, which is correct for
ephemeral runtime state.

**Logs**: `$XDG_STATE_HOME/tuicraft/session.log` (defaults to
`~/.local/state/tuicraft/session.log`). Persistent across daemon restarts.

## Config File

`~/.config/tuicraft/config.toml`:

```toml
account = "x"
password = "xwow2026"
character = "Xia"
host = "t1"
port = 3724
language = 1
timeout_minutes = 30
```

Created by `tuicraft setup` (interactive wizard when TTY, flag-based when not).
Flags and environment variables override config values. If no config exists and
the CLI is invoked non-interactively, it exits with a clear error:
`No config found. Run 'tuicraft setup' or 'tuicraft' interactively.`

## IPC Protocol

Line-based protocol over the unix domain socket.

**CLI → Daemon** (one line per request):

```
SAY hello
WHISPER Xiara follow Deity
YELL HELLO
GUILD guild msg
PARTY party msg
CHANNEL General hello
WHO mage
READ
READ_WAIT 3000
STOP
STATUS
```

**Daemon → CLI** (response lines, terminated by empty line):

Event lines use the human-readable format internally. The CLI reformats to
JSONL when `--json` is passed.

```
[say] Deity: hello back
[whisper from Xiara] Following Deity

```

The empty line signals end-of-response. For READ_WAIT, the daemon holds the
connection open for the specified milliseconds, streaming events as they arrive,
then sends the terminator.

## Output Formats

Two output modes. No tab-delimited format.

| Context             | Format         | How selected  |
| ------------------- | -------------- | ------------- |
| Human (TTY or pipe) | Bracketed text | Default       |
| Programmatic / LLM  | JSONL          | `--json` flag |

**Human-readable** (default):

```
[say] Deity: hello
[whisper from Xiara] Following Deity
[system] No player named Bob is currently playing.
```

**JSONL** (`--json`):

```json
{"type":"SAY","sender":"Deity","message":"hello"}
{"type":"WHISPER_FROM","sender":"Xiara","message":"Following Deity"}
{"type":"SYSTEM","sender":"","message":"No player named Bob is currently playing."}
```

## Event Buffer

The daemon keeps a ring buffer of the last 1000 events (configurable). Each
`read` drains from a cursor that advances on every read. Calling `read` twice
with no new events returns nothing. Clean idempotent semantics: events are
delivered exactly once per reader.

## Session Log

The daemon appends every event to `$XDG_STATE_HOME/tuicraft/session.log` as
JSONL as it arrives. This log persists across daemon restarts and provides a
full history. `tuicraft logs` reads this file. The in-memory ring buffer is for
fast drain via `read`; the log file is for history.

## Single Binary

`bun build --compile src/index.ts --outfile tuicraft` produces a self-contained
executable. No Bun runtime, no node_modules, no mise needed on the target
machine. The mise tasks remain for development (`mise test`, `mise ci`).

## Prior Art

- **claude CLI**: `claude` for interactive, `claude -p "msg"` for one-shot.
  Same TTY-detection pattern.
- **ssh-agent / gpg-agent**: Daemon holds credentials, CLI commands interact
  via socket.
- **docker**: Thin CLI talks to dockerd daemon over unix socket.
- **steipete/oracle**: Detach-by-default for long operations, `--wait` flag for
  blocking, session reattach by ID. `--json` for structured output.
- **steipete's "Just Talk To It"**: CLIs are the universal agent interface.
  Zero context tax vs MCP schemas. Self-documenting via `--help`.

## What Changes

The existing protocol and session layers are untouched. Changes are:

- New CLI entry point with subcommand/flag parsing
- Daemon process (socket server wrapping WorldHandle)
- IPC client (socket client for one-shot commands)
- Interactive reattach mode (readline over socket)
- Setup wizard and config file reader/writer
- Session log writer
- `bun build --compile` step in mise
- `help` subcommand and `--help` flag
- Updated docs (pipe-mode.md replaced by this CLI reference)

The existing interactive TUI (`tui.ts`) stays as-is for the bare `tuicraft`
direct-connection mode.

## What This Enables

An LLM can control a WoW character with zero setup beyond the binary:

```sh
tuicraft setup --account x --password y --character Xia --host t1
tuicraft -w Xiara "follow Deity"
tuicraft read --wait 5
tuicraft -w Xiara "attack target"
tuicraft read --wait 5 --json
tuicraft stop
```

Each invocation is a single shell command with deterministic output. No session
management, no pipe juggling, no runtime dependencies.
