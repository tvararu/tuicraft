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
tuicraft status | stop | logs | skill | help
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

`tuicraft setup` [_flags_]
: Configure account credentials. With no flags, runs an interactive wizard.

`tuicraft read` [`--wait` _N_] [`--json`]
: Read buffered events. `--wait` polls for _N_ seconds before returning.

`tuicraft tail` [`--json`]
: Continuous event stream. Blocks and prints events as they arrive.

`tuicraft status`
: Print daemon connection status (`CONNECTED` or error).

`tuicraft stop`
: Graceful daemon shutdown.

`tuicraft logs`
: Print the JSONL session log to stdout.

`tuicraft skill`
: Print a SKILL.md reference for AI agents. Includes command usage, event types, and integration examples.

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

`--who` [_filter_]
: Who query. Optional name/class/level filter.

## Options

`--json`
: Output events as JSONL instead of human-readable format. Works with `read`,
`tail`, `--who`, and chat commands.

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

## Movement

`tuicraft goto` _x_ _y_ _z_ [`--wait` _N_]
: Walk to coordinates on a navmesh path, or a straight line if nav is not
configured. `--wait` prints events for _N_ seconds after the command starts.

`tuicraft follow` _player_ [`--wait` _N_]
: Follow a nearby player or NPC by name. Re-paths as the target moves, stops
within 4 yd, and resumes once the target is 5 yd away.

`tuicraft face` _radians_
: Face an orientation, in WoW radians (0 = north/+X, counterclockwise).

`tuicraft halt`
: Stop moving or stop following.

`tuicraft pos` [`--json`]
: Print your own position: map, x/y/z, orientation, run speed, and movement
state.

Movement is also available over the daemon's unix socket, using the same IPC
verbs as other commands:

```sh
echo "GOTO x y z" | nc -U $TMPDIR/tuicraft-$(id -u)/sock
echo "FOLLOW name" | nc -U $TMPDIR/tuicraft-$(id -u)/sock
echo "FACE radians" | nc -U $TMPDIR/tuicraft-$(id -u)/sock
echo "HALT" | nc -U $TMPDIR/tuicraft-$(id -u)/sock
echo "POS" | nc -U $TMPDIR/tuicraft-$(id -u)/sock
echo "POS_JSON" | nc -U $TMPDIR/tuicraft-$(id -u)/sock
```

`--json` events add five movement types:

| Type           | Meaning                                             |
| -------------- | --------------------------------------------------- |
| MOVE_STARTED   | Movement began (x, y, z, waypoints)                 |
| FOLLOW_STARTED | Following a target (name)                           |
| MOVE_PROGRESS  | Periodic progress while moving (x, y, z, remaining) |
| MOVE_ARRIVED   | Reached the destination (x, y, z)                   |
| MOVE_STOPPED   | Movement ended early (reason)                       |

`MOVE_STOPPED`'s `reason` is one of `command`, `root`, `teleport`,
`target_lost`, or `no_path`.

Teleports also produce `SYSTEM` messages: `Teleported to (x, y, z)` for a
near teleport, or `Transferring to map N...` followed by `Entered map N at
(x, y, z)` for a far teleport (map change).

`nav_lib` and `nav_data` in the config file enable navmesh pathfinding for
`goto` and `follow`:

`nav_lib`
: Path to `libnamigator.so`.

`nav_data`
: Path to a MapBuilder output directory.

With both set, movement paths through the navmesh with on-demand ADT
streaming and ground-height snapping. Without them, movement falls back to
straight lines.

Navmesh data is generated offline with namigator's MapBuilder from a 3.3.5a
client `Data` directory:

```sh
MapBuilder -d <client>/Data -m Expansion01 -o <outdir> -t 12
```

Map names: `Azeroth` (0), `Kalimdor` (1), `Expansion01` (530), `Northrend`
(571).

## Interactive Commands

When running in TUI mode, the following slash commands are available:

| Command                      | Action                                     |
| ---------------------------- | ------------------------------------------ |
| _text_                       | Say (no slash needed)                      |
| `/s` _msg_                   | Say (explicit)                             |
| `/y` _msg_                   | Yell                                       |
| `/w` _name_ _msg_            | Whisper                                    |
| `/r` _msg_                   | Reply to last whisper                      |
| `/g` _msg_                   | Guild chat                                 |
| `/p` _msg_                   | Party chat                                 |
| `/raid` _msg_                | Raid chat                                  |
| `/e` _msg_                   | Text emote                                 |
| `/dnd` [_msg_]               | Toggle Do Not Disturb                      |
| `/afk` [_msg_]               | Toggle Away From Keyboard                  |
| `/1` _msg_                   | Channel 1 (usually General)                |
| `/2` _msg_                   | Channel 2 (usually Trade)                  |
| `/join` _channel_            | Join a chat channel                        |
| `/leave` _channel_           | Leave a chat channel                       |
| `/who` _query_               | Who search                                 |
| `/invite` _name_             | Invite player to group                     |
| `/kick` _name_               | Remove player from group                   |
| `/leave`                     | Leave the current group                    |
| `/leader` _name_             | Transfer group leadership                  |
| `/accept`                    | Accept pending invitation (group or duel)  |
| `/decline`                   | Decline pending invitation (group or duel) |
| `/roll` [_N_] [_M_]          | Roll random number (1-100)                 |
| `/friends`                   | Show your friends list                     |
| `/friend add` _name_         | Add a player to friends                    |
| `/friend remove` _name_      | Remove from friends                        |
| `/ignore` _name_             | Add a player to ignore list                |
| `/unignore` _name_           | Remove from ignore list                    |
| `/ignorelist`                | Show your ignore list                      |
| `/groster`                   | Show guild roster                          |
| `/ginvite` _name_            | Invite player to guild                     |
| `/gkick` _name_              | Remove player from guild                   |
| `/gleave`                    | Leave the guild                            |
| `/gpromote` _name_           | Promote guild member                       |
| `/gdemote` _name_            | Demote guild member                        |
| `/gleader` _name_            | Transfer guild leadership                  |
| `/gmotd` [_msg_]             | Set guild message of the day               |
| `/gaccept`                   | Accept guild invitation                    |
| `/gdecline`                  | Decline guild invitation                   |
| `/tuicraft entities on\|off` | Toggle entity event display                |
| `/quit`                      | Disconnect and exit                        |

## Output Format

Human-readable (default):

```
[say] Xi: hello world
[whisper from Xiara] Following Deity
[guild] Xiara: heading out
[who] 3 results: Xiara (80), Hemet (74), Sanu (14)
[group] Voidtrix invites you to a group
[group] Xia is now the group leader
[world] Young Wolf appeared (NPC, level 6)
[world] Young Wolf left range
[friends] 2/3 online — Arthas — Online, Level 80 Death Knight | Jaina — AFK
[friends] Arthas is now online (Level 80 Death Knight)
[ignore] Spammer added to ignore list
[ignore] Spammer removed from ignore list
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
