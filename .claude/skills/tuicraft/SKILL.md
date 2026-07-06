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

| Type                  | Meaning                                                                   |
| --------------------- | ------------------------------------------------------------------------- |
| SAY                   | Nearby /say chat                                                          |
| YELL                  | /yell chat                                                                |
| PARTY                 | Party member message                                                      |
| PARTY_LEADER          | Party leader message                                                      |
| GUILD                 | Guild chat                                                                |
| OFFICER               | Officer chat                                                              |
| RAID                  | Raid chat                                                                 |
| RAID_LEADER           | Raid leader message                                                       |
| RAID_WARNING          | Raid warning                                                              |
| WHISPER               | Incoming whisper                                                          |
| WHISPER_TO            | Outgoing whisper confirmation                                             |
| CHANNEL               | Custom channel message                                                    |
| EMOTE                 | Player emote                                                              |
| SYSTEM                | System messages and unimplemented packet notices                          |
| ENTITY_APPEAR         | NPC/player/object appeared nearby (--json only)                           |
| ENTITY_DISAPPEAR      | Entity left range (--json only)                                           |
| ENTITY_UPDATE         | Entity field changed (--json only)                                        |
| FRIEND_ONLINE         | Friend came online                                                        |
| FRIEND_OFFLINE        | Friend went offline                                                       |
| FRIEND_ADDED          | Friend added to list                                                      |
| FRIEND_REMOVED        | Friend removed from list                                                  |
| FRIEND_ERROR          | Friend operation error                                                    |
| IGNORE_ADDED          | Player added to ignore list                                               |
| IGNORE_REMOVED        | Player removed from ignore list                                           |
| IGNORE_ERROR          | Ignore operation error                                                    |
| GUILD_ROSTER_UPDATED  | Guild roster data received                                                |
| GUILD_COMMAND_RESULT  | Guild command error (permissions, not found)                              |
| GUILD_INVITE_RECEIVED | Incoming guild invitation prompt                                          |
| MOVE_STARTED          | Movement began (x, y, z, waypoints)                                       |
| FOLLOW_STARTED        | Following a target (name)                                                 |
| MOVE_PROGRESS         | Periodic move progress (x, y, z, remaining)                               |
| MOVE_ARRIVED          | Reached the destination (x, y, z)                                         |
| MOVE_STOPPED          | Movement ended early (reason)                                             |
| AGGRO                 | A mob started attacking you (name)                                        |
| MELEE_START           | Auto-attack began (attacker, victim)                                      |
| MELEE_STOP            | Auto-attack ended (attacker, victim, dead)                                |
| DAMAGE                | Damage dealt or taken (kind, source, target, amount, crit, miss, spellId) |
| HEAL                  | Healing done (target, amount, crit, spellId)                              |
| CAST_STARTED          | Spell cast began (spellId)                                                |
| CAST_GO               | Spell cast completed (spellId)                                            |
| CAST_FAILED           | Spell cast failed (spellId, resultName)                                   |
| SPELLBOOK_LOADED      | Spellbook received at login (spells)                                      |
| AURA                  | Aura gained/lost on self or target (unit, spellId, applied, timeLeftMs)   |
| LOOT_WINDOW           | Loot window opened (items)                                                |
| LOOT_ITEM             | Item looted (name once resolved)                                          |
| LOOT_MONEY            | Money looted (copper)                                                     |
| LOOT_ERROR            | Loot operation error                                                      |
| XP_GAIN               | Experience gained (amount, kill)                                          |
| LEVEL_UP              | Character leveled up (level)                                              |
| DIED                  | Character died                                                            |
| RELEASED              | Spirit released to the graveyard                                          |
| CORPSE_LOCATION       | Corpse coordinates, in response to CORPSE query                           |
| RECLAIM_DELAY         | Corpse cannot be reclaimed yet (time remaining)                           |
| RESURRECT_OFFER       | Someone offered a resurrect                                               |
| SWING_ERROR           | Melee swing problem (not_in_range, bad_facing, dead_target, cant_attack)  |
| HUNT_STARTED          | Hunt macro started (name)                                                 |
| HUNT_PHASE            | Hunt macro entered a phase (approach, fight, loot)                        |
| HUNT_COMPLETE         | Hunt macro finished successfully                                          |
| HUNT_ABORTED          | Hunt macro aborted (reason)                                               |

The `channel` field appears on CHANNEL events only.

`MOVE_STOPPED`'s `reason` is one of `command`, `root`, `teleport`,
`target_lost`, or `no_path`.

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

## Entity Queries

The daemon exposes `NEARBY` and `NEARBY_JSON` IPC verbs for querying tracked entities:

    echo "NEARBY" | nc -U $TMPDIR/tuicraft-$(id -u)/sock
    echo "NEARBY_JSON" | nc -U $TMPDIR/tuicraft-$(id -u)/sock

In the TUI, toggle entity event display with `/tuicraft entities on|off`.

## Movement

    tuicraft goto X Y Z            # walk to coordinates
    tuicraft goto X Y Z --wait 5   # then print events for 5 seconds
    tuicraft follow PlayerName     # follow a nearby player or NPC
    tuicraft follow PlayerName --wait 5
    tuicraft face 1.57             # face an orientation (WoW radians)
    tuicraft halt                  # stop moving / stop following
    tuicraft pos                   # show your own position
    tuicraft pos --json            # position as JSON

`goto` and `follow` walk a straight line unless `nav_lib` and `nav_data` are
configured, in which case they path through a namigator navmesh. `follow`
re-paths as the target moves, stops within 4 yd, and resumes once the target
is 5 yd away.

IPC verbs:

    echo "GOTO x y z" | nc -U $TMPDIR/tuicraft-$(id -u)/sock
    echo "FOLLOW PlayerName" | nc -U $TMPDIR/tuicraft-$(id -u)/sock
    echo "FACE radians" | nc -U $TMPDIR/tuicraft-$(id -u)/sock
    echo "HALT" | nc -U $TMPDIR/tuicraft-$(id -u)/sock
    echo "POS" | nc -U $TMPDIR/tuicraft-$(id -u)/sock
    echo "POS_JSON" | nc -U $TMPDIR/tuicraft-$(id -u)/sock

## Combat

    tuicraft target Wolf            # select a nearby unit by name
    tuicraft attack                 # auto-attack the current target
    tuicraft attack --wait 5
    tuicraft cast 585               # cast a spell at the current target
    tuicraft cast 585 --self        # cast a spell on yourself
    tuicraft loot                   # loot the current target's corpse
    tuicraft loot --wait 5
    tuicraft hunt Wolf               # full kill loop: approach, pull, fight, loot
    tuicraft hunt Wolf --wait 60
    tuicraft release                 # release spirit to the graveyard
    tuicraft reclaim                 # reclaim corpse once within 39 yd of it
    tuicraft spells                  # list known spell IDs
    tuicraft auras                   # active auras on yourself
    tuicraft auras target            # active auras on the current target
    tuicraft vitals                  # HP/mana/level/dead + combat engine state
    tuicraft vitals --json
    tuicraft sit                     # sit down (boosts health regen)
    tuicraft stand                   # stand up

`hunt` runs the whole kill loop against a nearby target: it navigates to the
target on the navmesh, pulls with Shadow Word: Pain, keeps a wand
auto-repeating, casts Mind Blast to finish, heals or shields itself if health
drops, then loots the corpse. Watch `HUNT_PHASE` events for progress.

IPC verbs:

    echo "TARGET name" | nc -U $TMPDIR/tuicraft-$(id -u)/sock
    echo "ATTACK" | nc -U $TMPDIR/tuicraft-$(id -u)/sock
    echo "STOPATTACK" | nc -U $TMPDIR/tuicraft-$(id -u)/sock
    echo "CAST id" | nc -U $TMPDIR/tuicraft-$(id -u)/sock
    echo "CAST id SELF" | nc -U $TMPDIR/tuicraft-$(id -u)/sock
    echo "LOOT" | nc -U $TMPDIR/tuicraft-$(id -u)/sock
    echo "HUNT name" | nc -U $TMPDIR/tuicraft-$(id -u)/sock
    echo "RELEASE" | nc -U $TMPDIR/tuicraft-$(id -u)/sock
    echo "RECLAIM" | nc -U $TMPDIR/tuicraft-$(id -u)/sock
    echo "CORPSE" | nc -U $TMPDIR/tuicraft-$(id -u)/sock
    echo "RESACCEPT" | nc -U $TMPDIR/tuicraft-$(id -u)/sock
    echo "SIT" | nc -U $TMPDIR/tuicraft-$(id -u)/sock
    echo "STAND" | nc -U $TMPDIR/tuicraft-$(id -u)/sock
    echo "SPELLS" | nc -U $TMPDIR/tuicraft-$(id -u)/sock
    echo "AURAS" | nc -U $TMPDIR/tuicraft-$(id -u)/sock
    echo "AURAS TARGET" | nc -U $TMPDIR/tuicraft-$(id -u)/sock
    echo "VITALS" | nc -U $TMPDIR/tuicraft-$(id -u)/sock
    echo "VITALS_JSON" | nc -U $TMPDIR/tuicraft-$(id -u)/sock

### Grinding Workflow

Complete example: find a nearby target, hunt it, watch events, and sit to
regen mana between kills. Repeat while mana holds up; recover from death with
`release` → `goto` the corpse → `reclaim`.

    name=$(echo "NEARBY_JSON" | nc -U $TMPDIR/tuicraft-$(id -u)/sock \
      | jq -r '.[] | select(.objectType == "Unit") | .name' | head -1)
    tuicraft hunt "$name" --wait 60
    tuicraft read --json | jq -c 'select(.type | startswith("HUNT_"))'
    tuicraft vitals --json | jq '.mana < .maxMana / 2' \
      && tuicraft sit && sleep 10 && tuicraft stand

On `DIED`, recover before hunting again:

    tuicraft release
    coords=$(echo "CORPSE" | nc -U $TMPDIR/tuicraft-$(id -u)/sock \
      | jq -r 'select(.type == "CORPSE_LOCATION") | "\(.x) \(.y) \(.z)"')
    tuicraft goto $coords --wait 30
    tuicraft reclaim

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
