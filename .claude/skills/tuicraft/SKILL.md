---
name: tuicraft
description: Use when interacting with a WoW 3.3.5a game world — sending chat messages, reading events, querying players, or managing groups via the tuicraft CLI
---

# tuicraft

CLI client for World of Warcraft 3.3.5a. A background daemon maintains the game connection and buffers events. The daemon starts automatically on first use and stays running for 30 minutes of inactivity.

## Status

    tuicraft status

Returns CONNECTED or an error. Check this before other commands.

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

| Type             | Meaning                                          |
| ---------------- | ------------------------------------------------ |
| SAY              | Nearby /say chat                                 |
| YELL             | /yell chat                                       |
| PARTY            | Party member message                             |
| PARTY_LEADER     | Party leader message                             |
| GUILD            | Guild chat                                       |
| OFFICER          | Officer chat                                     |
| RAID             | Raid chat                                        |
| RAID_LEADER      | Raid leader message                              |
| RAID_WARNING     | Raid warning                                     |
| WHISPER          | Incoming whisper                                 |
| WHISPER_TO       | Outgoing whisper confirmation                    |
| CHANNEL          | Custom channel message                           |
| EMOTE            | Player emote                                     |
| SYSTEM           | System messages and unimplemented packet notices |
| ENTITY_APPEAR    | NPC/player/object appeared nearby (--json only)  |
| ENTITY_DISAPPEAR | Entity left range (--json only)                  |
| ENTITY_UPDATE    | Entity field changed (--json only)               |
| FRIEND_ONLINE    | Friend came online                               |
| FRIEND_OFFLINE   | Friend went offline                              |
| FRIEND_ADDED     | Friend added to list                             |
| FRIEND_REMOVED   | Friend removed from list                         |
| FRIEND_ERROR     | Friend operation error                           |

The `channel` field appears on CHANNEL events only.

Entity events include `guid`, `objectType`, `name`, and type-specific fields like `level`, `health`, `maxHealth`, `x`, `y`, `z`.

## Who Queries

    tuicraft who              # all online players
    tuicraft who "warrior"    # filter by name/class/etc

## Group Commands

    tuicraft send "/invite PlayerName"   # invite to group
    tuicraft send "/kick PlayerName"     # remove from group
    tuicraft send "/leave"               # leave group
    tuicraft send "/leader PlayerName"   # transfer leadership
    tuicraft send "/accept"              # accept group invite
    tuicraft send "/decline"             # decline group invite

## Friends List

    tuicraft send "/friends"                # show friends list
    tuicraft send "/friend add PlayerName"  # add friend
    tuicraft send "/friend remove PlayerName" # remove friend

IPC verbs:

    echo "FRIENDS" | nc -U $TMPDIR/tuicraft-$(id -u)/sock
    echo "FRIENDS_JSON" | nc -U $TMPDIR/tuicraft-$(id -u)/sock
    echo "ADD_FRIEND PlayerName" | nc -U $TMPDIR/tuicraft-$(id -u)/sock
    echo "DEL_FRIEND PlayerName" | nc -U $TMPDIR/tuicraft-$(id -u)/sock

## Entity Queries

The daemon exposes `NEARBY` and `NEARBY_JSON` IPC verbs for querying tracked entities:

    echo "NEARBY" | nc -U $TMPDIR/tuicraft-$(id -u)/sock
    echo "NEARBY_JSON" | nc -U $TMPDIR/tuicraft-$(id -u)/sock

In the TUI, toggle entity event display with `/tuicraft entities on|off`.

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
