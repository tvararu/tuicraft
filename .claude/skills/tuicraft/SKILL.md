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

These commands move, face, or select.

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
- `halt` stops walking, casting, auto-attack, tactics, navigation, and follow. `status` still returns CONNECTED. On one IPC socket, HALT cancels a pending read or query and does not run older queued MOVE/FACE/TARGET/CAST/ATTACK/FIGHT/GOTO/FOLLOW/RELEASE_SPIRIT/RECLAIM_CORPSE/RESURRECT. Readonly corpse queries remain queued. HALT cannot undo a request already sent.
- Daemon `ERR` replies for MOVE, FACE, TARGET, HALT, CAST, ATTACK, FIGHT, GOTO, and FOLLOW exit the CLI with status 1.

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
| `owner` | `manual` for direct movement. `follow` or `jev` while that runtime owns control, including stationary waits. `none` when unowned. |

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

## Combat and tactics

These commands inspect or act. They do not invent a spell rotation.

    tuicraft combat [--json]
    tuicraft spells [--json]
    tuicraft cast <learned-spell-id> <observed-target-guid>
    tuicraft attack <observed-hostile-guid>
    tuicraft cancel-cast
    tuicraft stop-attack
    tuicraft fight <observed-hostile-guid>
    tuicraft fight <observed-hostile-guid> conserve mana and stay alive
    tuicraft tactics [--json]
    tuicraft goto <grounded-x> <grounded-y> <grounded-z>
    tuicraft navigation [--json]

Rules:

- `cast` takes a positive integer spell id and one uint64 GUID. `0`/`0x0` is self/none.
- `fight` requires a GUID. Extra words are the instruction. If omitted, the instruction is to defeat the selected target while keeping the character alive.
- Use a current observed PvE opponent, not a GUID copied from an example or an old spawn position.
- The Jev spell kit requires observed normal form (`combat.self.shapeshiftForm=0`). Complete server CREATE defines omitted public fields as zero; absent entities and incomplete observations remain unknown. Other forms are unsupported.
- A structurally unsupported kit ends with `no_supported_combat_actions`. Cooldown and server-response waits are not that failure. Supported melee and facing remain available.
- For a blocked kit, inspect `tactics.lastOutcome.observation.unavailable`. A missing `lastRequest` means no Jev request was made; terminal observations are separate evidence.
- This increment cannot chase or kite. Approach with a checked ground route before `fight`; never copy a flying creature's Z as ground height.
- The fight instruction must be one line. CR or LF is rejected before IPC.
- `goto` takes three finite coordinates. It is not a named-place planner.
- JSON GUIDs are `0x` hex. Predicted poses use `source=predicted`.
- `spells` requires spell data. `fight` requires spell/faction data and a Jev key. `goto` requires navigation data and its native library. Missing prerequisites return ERR; inspection errors also exit with status 1. Do not retry as if the request succeeded.
- Configure `spell_data_dir`, `navigation_data_dir`, and `navigation_library` in the account config as needed. Supply `TYPESAFE_API_KEY` through the daemon environment, never through config or logs. Restart the daemon after changes. See `docs/manual.md` for the required build-12340 tables.

IPC: COMBAT, COMBAT_JSON, SPELLS, SPELLS_JSON, CAST, ATTACK, CANCEL_CAST, STOP_ATTACK, FIGHT, TACTICS, TACTICS_JSON, GOTO, NAVIGATION, NAVIGATION_JSON.

## Bounded ground follow

    tuicraft follow <observed-guid> [distance]
    tuicraft following [--json]
    tuicraft halt

Rules:

- Use a nonzero uint64 GUID in decimal or `0x` hex. Do not reuse an old spawn GUID.
- Distance is 1–20 yards along the horizontal ground route behind the target. The default is 3 yards.
- Follow requires supported, recently observed target motion, compatible native navigation data, and map 530.
- Ground height must be unambiguous. Do not substitute the target altitude or retry with nudged coordinates.
- Each request lasts at most 30 seconds and uses at most 32 native planning calls.
- Target separation is limited to 100 yards. Planned routes are limited to 150 yards.
- Replans require meaningful displacement and at least 500ms between plans. The runtime stops current motion before sampling the next origin.
- Receive age must not exceed 5 seconds. A quiet stationary target can expire. Predictions do not refresh receive age.
- Loss, unsupported motion, correction, unsafe control, or failed planning stops follow without retries. Manual commands and `halt` also stop follow.
- `OK` acknowledges intent only. `following.status=holding` means predicted standoff, not server-confirmed arrival.
- Inspect `following.reason` after stopping. Compare `targetPose.source`, original `observedAt`, and `control.serverPose` before claiming arrival.
- `following.separation` is 3D pose distance, not the requested horizontal route distance. GUIDs use hex in JSON.
- FOLLOW and FOLLOWING inspection errors print `ERR` and make the CLI exit with status 1.

IPC: FOLLOW <guid> [distance], FOLLOWING, FOLLOWING_JSON.

## Ordinary death recovery

    tuicraft recovery [--json]
    tuicraft query-corpse
    tuicraft release-spirit
    tuicraft reclaim-corpse
    tuicraft resurrect accept
    tuicraft resurrect decline

Rules:

- Read observed life first. Positive ghost health does not mean alive. Release intent and graveyard markers do not establish ghost state.
- `release-spirit` requires authoritative dead state. Do not issue it when the state already says ghost.
- `query-corpse` is readonly for control ownership. Only one unanswered query is allowed.
- Unknown corpse information is not an absent corpse. A stale query or old offer cannot authorize a new death.
- `reclaim-corpse` takes no GUID. It requires observed ghost state, a freshly queried found corpse, and matching actual/displayed/pose maps.
- Corpse `mapId` is the displayed map. `corpseMapId` is the actual map. An instance entrance is not the corpse location.
- Reclaim distance must be at most 39 yards in three dimensions. Inspect `reclaim.pose.source` before treating its position as observed.
- A known future delay blocks reclaim. Missing `remainingMs` is unknown, never zero.
- With other guards satisfied, one explicit reclaim request can use unknown timing. `readiness=unverified` does not mean ready.
- `resurrect accept|decline` answers the current offer once. A known offer delay blocks accept but does not block decline.
- Mutating recovery actions stop tactics, follow, and motion. `halt` drops older queued recovery mutations but cannot reverse a sent request.
- `OK` is request intent, not ghost/alive confirmation. Inspect subsequent authoritative life and ghost flags for the outcome.
- Do not retry unanswered actions automatically. Command and inspection errors print `ERR` and exit with status 1.

IPC: RECOVERY, RECOVERY_JSON, QUERY_CORPSE, RELEASE_SPIRIT, RECLAIM_CORPSE, RESURRECT accept|decline.

## Offered quest interactions

    tuicraft quests [--json]
    tuicraft talk <observed-giver-guid>
    tuicraft query-quest <quest-id>
    tuicraft select-option <offered-option-id> [code]
    tuicraft select-quest <offered-quest-id>
    tuicraft accept-quest
    tuicraft complete-quest <offered-quest-id>
    tuicraft request-reward
    tuicraft choose-reward <index>
    tuicraft abandon-quest <slot>
    tuicraft cancel-interaction

Rules:

- Inspect the current dialog and giver before each mutation. Metadata and old menus do not authorize actions.
- `talk` requires a nonzero uint64 GUID in hex or decimal. Quest IDs are positive decimal uint32 values.
- Gossip option IDs are decimal uint32 values and can be zero. Use the offered ID, not a guessed row number.
- A coded option needs exactly one code argument. Quote spaces. Omitted code and empty code differ. Embedded NUL and extra arguments are rejected.
- IPC uses `SELECT_OPTION <id> <JSON-string-or-null>`. Null or absence means no code. `""` means empty code.
- JSON escapes prevent code text, including line breaks, from injecting another IPC command. Do not send raw unencoded code text.
- Only one unanswered conversation mutation can be pending. `quest_reply_unanswered` is not permission to retry.
- `accept-quest` requests acceptance of offered details. Acceptance is established only by an authoritative log-ID addition, not by OK.
- Log flags/counters are server quest facts, not inferred inventory item counts. Initial/recreated log state does not fabricate acceptance.
- Unanswered query metadata stays unknown, not missing. Querying does not select a quest or permit mutation.
- Reward indices are zero-based, at most 5, and must exist in the current offer. Use 0 when there are no selectable choices.
- A server quest-complete reward notification establishes a reward fact. It does not prove that a requested inventory item was gained.
- Abandonment slots are zero-based 0–24. An unknown or empty slot cannot authorize abandonment. The log must later show removal.
- `cancel-interaction` revokes current authorization and requests close. The old pending intent remains uncertain.
- Pending cancel blocks another mutation until observed close or a confirmed world reset. A late error/menu is not sufficient.
- HALT drops older queued conversational mutations, abandonment and cancellation. It retains quest metadata queries and newer requests.
- HALT cannot undo an already-sent request and is not proof of dialog closure.
- `OK` always means intent, never accepted/completed/rewarded/removed state. Inspect actual log and server notifications for those facts.
- Quest action and inspection errors print `ERR` and exit with status 1.

IPC: QUESTS, QUESTS_JSON, TALK, QUERY_QUEST, SELECT_OPTION, SELECT_QUEST, ACCEPT_QUEST, COMPLETE_QUEST, REQUEST_REWARD, CHOOSE_REWARD, ABANDON_QUEST, CANCEL_INTERACTION.

## Observed inventory and creature loot

    tuicraft inventory [--json]
    tuicraft loot [--json]
    tuicraft open-loot <observed-lootable-corpse-guid>
    tuicraft take-loot <offered-slot>
    tuicraft take-money
    tuicraft release-loot

Rules:

- Inventory scope is carried equipment, equipped bags, backpack, keyring and currency. Bank and buyback are excluded.
- Unknown counts, ownership, GUID halves, or capacity stay unknown. Item identity does not imply count 1.
- `freeSlots` counts physical empty backpack/bag cells, not bag-family eligibility, stacking space, or guaranteed storage.
- Open requires authoritative alive self and an observed lootable UNIT corpse. Use a nonzero uint64 GUID in decimal or hex.
- A sent open request is not a loot offer. Wait for a matching full successful response before taking items or money.
- Loot slots are decimal uint8 values 0–255. Use an actually offered allow/owner slot, not a guessed row index.
- Only one take/money request can be unanswered. Errors do not authorize another automatic attempt.
- `OK` is intent. Slot removal only removes an offer. Money clearance only clears the window amount.
- Confirm stored gain with actual raw slot/count or stack-count changes. Confirm money gain with actual coinage changes.
- Item/money notices are separate evidence. An item-push slot of `0xFFFFFFFF` is a stacking sentinel, not a physical inventory address.
- Inventory-full/bag-full errors retain their raw result/details. They do not prove that a particular pending take resolved.
- `release-loot` requests close of an open window and can replace an unanswered take with close intent. Wait for observed release before replacement.
- A release-only notification during opening does not prove denial or closure. `loot.phase` stays opening and `pending.status` stays unanswered.
- That release can precede a valid full response. Do not take, replace, timeout-reset, or automatically retry while opening remains unanswered.
- If no full response follows, explicitly reconnect with `tuicraft stop`, then `tuicraft inventory --json`. This is ordinary reconnect recovery, not completed denial/retry support.
- `release-loot` cannot close an unanswered opening. Reconnect does not prove the previous request outcome.
- HALT drops older queued loot mutations but retains inspections and newer requests. It cannot undo an already-sent request.
- Mutations stop prior control ownership through the manual override path. Inspections are readonly.
- Action and inspection errors print `ERR` and exit with status 1.

IPC: INVENTORY, INVENTORY_JSON, LOOT, LOOT_JSON, OPEN_LOOT, TAKE_LOOT, TAKE_MONEY, RELEASE_LOOT.

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
