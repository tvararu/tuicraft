---
name: tuicraft
description: Use when interacting with a WoW 3.3.5a game world — sending chat, reading events, querying players, managing groups, or issuing bounded walk, face, and target commands via the tuicraft CLI
---

# tuicraft

CLI client for World of Warcraft 3.3.5a. A background daemon maintains the game connection and buffers events. The daemon starts automatically on first use and stays running for 30 minutes of inactivity.

## Status

    tuicraft status

Returns CONNECTED or an error. Check this before other commands.

## Direct control

These commands move, face, or select. They do not fight, pathfind, or play the character for you.

    tuicraft control              # human text
    tuicraft control --json       # structured state
    tuicraft nearby               # nearby units and objects
    tuicraft nearby --json
    tuicraft move forward         # 1000ms default
    tuicraft move left 400        # strafe 400ms
    tuicraft face 1.57            # radians
    tuicraft target 0xf130003f520009e5
    tuicraft target 0             # clear target, do not attack
    tuicraft halt                 # stop motion, stay connected
    tuicraft stop                 # disconnect the daemon

Rules:

- `move` direction is exactly `forward`, `backward`, `left`, or `right`. `left` and `right` strafe.
- Duration is an integer millisecond value from 1 through 10000. Omit it to use 1000. Values outside that range are rejected and send no packets.
- `face` takes one finite radian number.
- `target` takes one unsigned 64-bit GUID in `0x` hexadecimal or decimal. `0` and `0x0` clear the target.
- Invalid direction, duration, facing, or GUID fails locally. The character does not move or retarget.
- `halt` stops walking. `status` still returns CONNECTED. On one IPC socket, HALT cancels a pending read or query and does not run older queued MOVE/FACE/TARGET.
- Daemon `ERR` replies for MOVE, FACE, TARGET, and HALT exit the CLI with status 1.

`control --json` fields you must not mix up:

| Field | Meaning |
| ----- | ------- |
| `pose` | Current pose used for control. Read `pose.source`. |
| `pose.source` | `predicted` is a local estimate. `server` is a server observation. Predicted is not server confirmation. |
| `serverPose` | Last pose the server reported. Unchanged during your own walk until a server correction or a new login. |
| `target` | Last server-observed self target GUID (`0x…`), or null. |
| `requestedTarget` | Last GUID this client sent with `target`. Can differ from `target` until the server observes the change. |
| `moving` | Whether a timed walk is active. |
| `direction` | `forward` / `backward` / `left` / `right`, or null. |
| `owner` | `manual` while a client walk is in effect. `none` when idle. |

Self movement is not echoed by the server. After a walk, `pose` is predicted. Relog (`stop`, then connect again) and read `control` to see the server-accepted position.

IPC verbs on the daemon socket:

    CONTROL
    CONTROL_JSON
    MOVE <forward|backward|left|right> [milliseconds]
    FACE <radians>
    TARGET <guid>
    HALT
    NEARBY
    NEARBY_JSON
    STOP
    STATUS

Control events appear in `read` / `tail` with JSON `type` `CONTROL`. The `event` field is one of `movement_started`, `movement_stopped`, `facing_changed`, `target_requested`, `target_observed`, `server_correction`, `control_changed`, `control_error`. The payload includes the same state fields as `control --json`.

## Sending Messages

    tuicraft send "message"               # say (nearby players)
    tuicraft send -y "message"            # yell (wider range)
    tuicraft send -p "message"            # party chat
    tuicraft send -g "message"            # guild chat
    tuicraft send -w PlayerName "message" # whisper to player

Slash commands work too:

    tuicraft send "/raid message"         # raid chat
    tuicraft send "/e waves hello"        # text emote
    tuicraft send "/dnd busy right now"   # toggle DND status
    tuicraft send "/afk grabbing coffee"  # toggle AFK status
    tuicraft send "/roll"                  # roll 1-100
    tuicraft send "/roll 50"               # roll 1-50
    tuicraft send "/roll 10 20"            # roll 10-20
    tuicraft send "/1 message"            # channel 1
    tuicraft send "/2 message"            # channel 2

## Reading Events

    tuicraft read                  # buffered events since last read
    tuicraft read --wait 5         # wait 5 seconds, then return events
    tuicraft tail                  # continuous stream (blocks)

Add `--json` for structured output. Each JSON line:

    {"type":"PARTY","sender":"PlayerName","message":"hello"}

## Event Types

| Type                  | Meaning                                          |
| --------------------- | ------------------------------------------------ |
| SAY                   | Nearby /say chat                                 |
| YELL                  | /yell chat                                       |
| PARTY                 | Party member message                             |
| PARTY_LEADER          | Party leader message                             |
| GUILD                 | Guild chat                                       |
| OFFICER               | Officer chat                                     |
| RAID                  | Raid chat                                        |
| RAID_LEADER           | Raid leader message                              |
| RAID_WARNING          | Raid warning                                     |
| WHISPER               | Incoming whisper                                 |
| WHISPER_TO            | Outgoing whisper confirmation                    |
| CHANNEL               | Custom channel message                           |
| EMOTE                 | Player emote                                     |
| SYSTEM                | System messages and unimplemented packet notices |
| ENTITY_APPEAR         | NPC/player/object appeared nearby (--json only)  |
| ENTITY_DISAPPEAR      | Entity left range (--json only)                  |
| ENTITY_UPDATE         | Entity field changed (--json only)               |
| CONTROL               | Movement, facing, target, or control-state change |
| FRIEND_ONLINE         | Friend came online                               |
| FRIEND_OFFLINE        | Friend went offline                              |
| FRIEND_ADDED          | Friend added to list                             |
| FRIEND_REMOVED        | Friend removed from list                         |
| FRIEND_ERROR          | Friend operation error                           |
| IGNORE_ADDED          | Player added to ignore list                      |
| IGNORE_REMOVED        | Player removed from ignore list                  |
| IGNORE_ERROR          | Ignore operation error                           |
| GUILD_ROSTER_UPDATED  | Guild roster data received                       |
| GUILD_COMMAND_RESULT  | Guild command error (permissions, not found)     |
| GUILD_INVITE_RECEIVED | Incoming guild invitation prompt                 |

The `channel` field appears on CHANNEL events only.

Entity events include `guid`, `objectType`, `name`, and type-specific fields like `level`, `health`, `maxHealth`, `x`, `y`, `z`.

## Who Queries

    tuicraft who              # all online players
    tuicraft who "warrior"    # filter by name/class/etc

## Channel Commands

    tuicraft send "/join ChannelName"    # join a chat channel
    tuicraft send "/leave ChannelName"   # leave a chat channel

## Group Commands

    tuicraft send "/invite PlayerName"   # invite to group
    tuicraft send "/kick PlayerName"     # remove from group
    tuicraft send "/leave"               # leave group
    tuicraft send "/leader PlayerName"   # transfer leadership
    tuicraft send "/accept"              # accept pending invite (group or duel)
    tuicraft send "/decline"             # decline pending invite (group or duel)

Duel events (SMSG_DUEL_REQUESTED, COUNTDOWN, COMPLETE, WINNER,
OUTOFBOUNDS, INBOUNDS) are surfaced in the event stream as `[duel]`
labeled messages. Use `/accept` or `/decline` to respond to incoming
duel requests.

## Friends List

    tuicraft send "/friends"                # show friends list
    tuicraft send "/friend add PlayerName"  # add friend
    tuicraft send "/friend remove PlayerName" # remove friend

IPC verbs:

    echo "FRIENDS" | nc -U $TMPDIR/tuicraft-$(id -u)/sock
    echo "FRIENDS_JSON" | nc -U $TMPDIR/tuicraft-$(id -u)/sock
    echo "ADD_FRIEND PlayerName" | nc -U $TMPDIR/tuicraft-$(id -u)/sock
    echo "DEL_FRIEND PlayerName" | nc -U $TMPDIR/tuicraft-$(id -u)/sock

## Ignore List

    tuicraft send "/ignore PlayerName"    # add to ignore list
    tuicraft send "/unignore PlayerName"  # remove from ignore list
    tuicraft send "/ignorelist"           # show ignore list

Messages from ignored players are filtered from chat display and daemon read output.

IPC verbs:

    echo "IGNORED" | nc -U $TMPDIR/tuicraft-$(id -u)/sock
    echo "IGNORED_JSON" | nc -U $TMPDIR/tuicraft-$(id -u)/sock
    echo "ADD_IGNORE PlayerName" | nc -U $TMPDIR/tuicraft-$(id -u)/sock
    echo "DEL_IGNORE PlayerName" | nc -U $TMPDIR/tuicraft-$(id -u)/sock

## Guild Roster

    tuicraft send "/groster"              # show guild roster

Displays MOTD, guild info, and all members sorted by online status. Shows rank, level, class, zone, and notes for each member.

IPC verbs:

    echo "GUILD_ROSTER" | nc -U $TMPDIR/tuicraft-$(id -u)/sock
    echo "GUILD_ROSTER_JSON" | nc -U $TMPDIR/tuicraft-$(id -u)/sock

## Guild Management

    tuicraft send "/ginvite PlayerName"  # invite to guild
    tuicraft send "/gkick PlayerName"    # remove from guild
    tuicraft send "/gleave"              # leave guild
    tuicraft send "/gpromote PlayerName" # promote member
    tuicraft send "/gdemote PlayerName"  # demote member
    tuicraft send "/gleader PlayerName"  # transfer leadership
    tuicraft send "/gmotd New MOTD"      # set message of the day
    tuicraft send "/gaccept"             # accept guild invite
    tuicraft send "/gdecline"            # decline guild invite

IPC verbs:

    echo "GINVITE PlayerName" | nc -U $TMPDIR/tuicraft-$(id -u)/sock
    echo "GKICK PlayerName" | nc -U $TMPDIR/tuicraft-$(id -u)/sock
    echo "GLEAVE" | nc -U $TMPDIR/tuicraft-$(id -u)/sock
    echo "GPROMOTE PlayerName" | nc -U $TMPDIR/tuicraft-$(id -u)/sock
    echo "GDEMOTE PlayerName" | nc -U $TMPDIR/tuicraft-$(id -u)/sock
    echo "GLEADER PlayerName" | nc -U $TMPDIR/tuicraft-$(id -u)/sock
    echo "GMOTD New MOTD" | nc -U $TMPDIR/tuicraft-$(id -u)/sock
    echo "GACCEPT" | nc -U $TMPDIR/tuicraft-$(id -u)/sock
    echo "GDECLINE" | nc -U $TMPDIR/tuicraft-$(id -u)/sock

## Nearby entities

    tuicraft nearby
    tuicraft nearby --json

JSON objects include `guid` (hex `0x…`), `self` (true only for the observed self GUID), `type`, `name`, `entry`, position (`x`, `y`, `z`, `mapId`, `orientation`), and for units `level`, `health`, `maxHealth`, `target`, `unitFlags`. Use `guid` with `tuicraft target`.

TUI: `/tuicraft entities on|off` toggles entity event display.

IPC:

    echo "NEARBY" | nc -U $TMPDIR/tuicraft-$(id -u)/sock
    echo "NEARBY_JSON" | nc -U $TMPDIR/tuicraft-$(id -u)/sock

## Openclaw Integration

Complete example: forward party chat to an openclaw agent, filtering out the
agent's own character to prevent feedback loops. Each agent turn runs in the
background so the pipeline doesn't block.

    tuicraft tail --json \
      | jq -r --unbuffered '
          select((.type == "PARTY" or .type == "PARTY_LEADER")
            and .sender != "Xia")
          | "\(.sender): \(.message)"' \
      | while IFS= read -r line; do
          openclaw agent --agent x \
            --message "$line" \
            </dev/null >/dev/null 2>&1 &
        done

Replace `Xia` with the agent's WoW character name and `x` with the openclaw
agent id. The agent can respond in-game with `tuicraft send -p "message"`.

To watch different event types, change the jq `select` filter:

| Filter               | Events                         |
| -------------------- | ------------------------------ |
| `.type == "WHISPER"` | Incoming whispers only         |
| `.type == "GUILD"`   | Guild chat only                |
| `.type != "SYSTEM"`  | Everything except system noise |
