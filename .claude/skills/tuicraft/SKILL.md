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
    tuicraft send "/1 message"            # channel 1
    tuicraft send "/2 message"            # channel 2

## Reading Events

    tuicraft read                  # buffered events since last read
    tuicraft read --wait 5         # wait 5 seconds, then return events
    tuicraft tail                  # continuous stream (blocks)

Add `--json` for structured output. Each JSON line:

    {"type":"PARTY","sender":"PlayerName","message":"hello"}

## Event Types

| Type         | Meaning                                          |
| ------------ | ------------------------------------------------ |
| SAY          | Nearby /say chat                                 |
| YELL         | /yell chat                                       |
| PARTY        | Party member message                             |
| PARTY_LEADER | Party leader message                             |
| GUILD        | Guild chat                                       |
| OFFICER      | Officer chat                                     |
| RAID         | Raid chat                                        |
| RAID_LEADER  | Raid leader message                              |
| RAID_WARNING | Raid warning                                     |
| WHISPER      | Incoming whisper                                 |
| WHISPER_TO   | Outgoing whisper confirmation                    |
| CHANNEL      | Custom channel message                           |
| EMOTE        | Player emote                                     |
| SYSTEM       | System messages and unimplemented packet notices |

The `channel` field appears on CHANNEL events only.

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
