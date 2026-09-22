# tuicraft(1)

WoW 3.3.5a chat client

## Synopsis

```
tuicraft
tuicraft <message>
tuicraft [-w <name> | -y | -g | -p] <message>
tuicraft [--who [filter]] [--json]
tuicraft setup [--account NAME] [--password PASS] [--character NAME]
tuicraft start | status | stop
tuicraft read [--wait N] [--json]
tuicraft tail [--json]
tuicraft control [--json] | nearby [--all] [--json]
tuicraft combat [--json] | spells [--json] | tactics [--json] | navigation [--json]
tuicraft cast <id> <guid> | attack <guid> | cancel-cast | stop-attack
tuicraft fight [--framing <variant>] <guid> [instruction...] | goto <x> <y> <z>
tuicraft cycle <guid...> [--instruction ...] [--max N] | cycling [--json]
tuicraft follow <guid> [distance] | following [--json]
tuicraft recovery [--json] | query-corpse | release-spirit | reclaim-corpse
tuicraft resurrect accept|decline
tuicraft quests [--json] | talk <guid> | query-quest <id>
tuicraft select-option <id> [code] | select-quest <id> | accept-quest
tuicraft complete-quest <id> | request-reward | choose-reward <index>
tuicraft abandon-quest <slot> | cancel-interaction
tuicraft inventory [--json] | loot [--json] | open-loot <guid>
tuicraft take-loot <slot> | take-money | release-loot
tuicraft move <dir> [ms] | face <radians> | target <guid> | halt
```

## Description

tuicraft is a single binary that connects to a WoW 3.3.5a server as a player
character. It runs in three modes: interactive TUI (no args), background daemon
(`--daemon`), or one-shot CLI client (subcommands and flags).

CLI commands auto-start a background daemon that holds the WoW connection and
buffers events in a ring buffer. The daemon listens on a unix domain socket. CLI
clients connect, send one command, read the response, and disconnect. The daemon
idles out after 30 minutes of inactivity.

## Gameplay configuration

Add optional data paths to the existing account config:

- `spell_data_dir`: a directory containing build-12340 `Spell.dbc`,
  `SpellRange.dbc`, `SpellCastTimes.dbc`, `SpellDuration.dbc`, and
  `SpellRadius.dbc`. Jev tactics also requires `FactionTemplate.dbc` there.
- `navigation_data_dir`: the compatible Namigator data root.
- `navigation_library`: the compatible Namigator shared library.

The current ground planner supports Expansion01/map 530. Unsupported or
ambiguous geometry fails explicitly.

Set `TYPESAFE_API_KEY` in the daemon environment, not in the account config.
Restart the daemon after changing data paths or its environment. Chat and
manual casting by learned spell ID do not require these data paths or a Jev key.

## Commands

`tuicraft`
: Interactive TUI with a readline prompt. Type slash commands or plain text.

`tuicraft` _message_
: Send a say message. Auto-starts the daemon if needed.

`tuicraft setup` [*flags*]
: Configure account credentials. With no flags, runs an interactive wizard.

`tuicraft start`
:: Start the background daemon explicitly.
If the daemon is already running, prints `Daemon is already running.` and exits with status 0.
On a successful new daemon start, prints `CONNECTED` and exits with status 0. Note that `CONNECTED` verifies only that the daemon IPC socket answered the STATUS probe, not that the server-side world session is healthy.
If the daemon fails to connect (missing configuration, invalid credentials, unreachable server, or startup timeout), prints the error and exits with status 1.

`tuicraft read` [`--wait` *N*] [`--json`]
: Read buffered events. With `--json`, emits JSONL (one JSON object per event, or empty). `--wait` polls for _N_ seconds before returning.

`tuicraft tail` [`--json`]
: Continuous event stream. Blocks and prints events as they arrive. With `--json`, emits JSONL (one JSON object per line).

`tuicraft status`
: Print daemon connection status (`CONNECTED` or `Daemon is not running.`).

`tuicraft stop`
:: Graceful daemon shutdown. Disconnects the session.

`tuicraft control` [`--json`]
:: Print control state. With `--json`, emits a single JSON object (`pose`, `serverPose`, `target`, `requestedTarget`, `moving`, `direction`, `owner`). `pose.source` is `predicted` or `server`. `serverPose`
is the last server-observed pose. `target` is the last server-observed self
target. `requestedTarget` is the last GUID this client sent. Predicted pose is
not server confirmation. Relog to read the pose the server accepted.

`tuicraft nearby` [`--all`] [`--json`]
:: List nearby entities ordered nearest first. By default, entities beyond 100
yards or on a different map are filtered when player position is known; pass `--all`
to list all tracked entities, including transports the server sends map-wide.
With `--json`, emits JSONL (one JSON object per nearby entity line, or empty).
GUIDs are hexadecimal (`0x…`). JSON includes 3D
`distance` in yards (`0` for self, `null` if off-map or unestablished) and `self`
true only for the observed self GUID. `mapId` is the map this client was on when
the entity was parsed, not a property the server states per entity.

`tuicraft move` _direction_ [*ms*]
:: Walk `forward`, `backward`, `left`, or `right` for *ms* milliseconds.
`left`/`right` strafe. *ms* is an integer 1–10000. Default 1000. The walk
ends when the duration ends. Repeating the same direction renews the duration.

`tuicraft face` _radians_
:: Set facing. The value is a finite number in radians. Empty input is rejected.

`tuicraft target` _guid_
:: Select a unit. *guid* is an unsigned 64-bit integer in `0x` hex or decimal.
`0` clears the target and does not attack.

`tuicraft halt`
:: Stop motion, cast, attack, tactics, navigation, follow, and cycle. The daemon stays connected.
HALT on a connection cancels a pending read or query and does not run older queued
MOVE/FACE/TARGET/CAST/ATTACK/FIGHT/GOTO/FOLLOW/RELEASE_SPIRIT/RECLAIM_CORPSE/RESURRECT.
Readonly corpse queries remain queued. Newer commands after HALT still run.
HALT also drops older queued TALK/SELECT_OPTION/SELECT_QUEST/ACCEPT_QUEST/COMPLETE_QUEST/REQUEST_REWARD/CHOOSE_REWARD/ABANDON_QUEST/CANCEL_INTERACTION.
HALT drops older OPEN_LOOT/TAKE_LOOT/TAKE_MONEY/RELEASE_LOOT commands as well.
Metadata queries and inventory/loot inspections remain queued. HALT cannot undo sent requests or prove dialog/loot closure.

`tuicraft combat` [`--json`]
:: Print combat state. With `--json`, emits a single JSON object. GUIDs are hex. Predicted poses keep `source=predicted`.

`tuicraft spells` [`--json`]
:: Print the learned spellbook joined to client metadata. With `--json`, emits a single JSON array of spell objects.

`tuicraft cast` _id_ _guid_
:: Cast a learned spell. _id_ is a positive integer. _guid_ is uint64 hex or
decimal. `0` is self/none.

`tuicraft attack` _guid_
:: Start auto-attack on _guid_.

`tuicraft cancel-cast`
:: Interrupt the current cast.

`tuicraft stop-attack`
:: Stop auto-attack.

`tuicraft fight` [`--framing` _none_|_minimal_|_mechanics_] _guid_ [_instruction_...]
::: Run Jev tactics to its terminal outcome. Default instruction is to defeat the selected target while
keeping the character alive. The command returns after the encounter completes, blocks, fails, or is halted; use `halt` to stop a running fight. Framing defaults to `none` (or `WOW_JEV_FRAMING`).
`minimal` frames the game, class and observed level; `mechanics` adds non-refilling
resource pool, damage-over-time and cast disruption mechanics. Missing Jev key
fails with `ERR`.
The instruction must be a single line. Daemon `ERR` replies, including inspection failures, make the CLI exit with status 1.
The spell kit requires observed normal form (`combat.self.shapeshiftForm=0`). A complete server CREATE defines omitted public fields as zero. An absent entity or incomplete observation does not establish that baseline.
Unknown or nonzero forms are not supported. Structurally unsupported combat
capabilities stop with `no_supported_combat_actions`; cooldowns and pending
server responses remain waits. Facing and supported melee remain available.
Jev may choose directional movement during a fight under a renewable lease:
`wait` holds the current direction, `stop_moving` releases it, and choosing a
standing-required spell releases the lease before casting. The observation
carries target separation and facing for those choices.

`tuicraft tactics` [`--json`]
:: Print tactics loop state. `lastOutcome.observation` retains the actual
terminal observation when one was available, including blocks before inference.
`lastRequest` is not populated without a real Jev request.

`tuicraft cycle` _guid..._ [`--instruction` _text_] [`--max` _N_]
:: Run the fight-loot-next-target loop over an explicit GUID queue: `fight`
each target in order, auto-loot any offered items and money, then advance.
`--instruction` applies to every target and defaults to the same instruction
as `fight`; unlike `fight`, `cycle` does not accept `--framing`. `--max`
caps tactics-loop starts for the whole run, a positive integer, default 10.
At least one nonzero GUID is required. Starting a new cycle replaces any
running cycle; `halt` stops it.
A target that dies, is unreachable, or fails to fight is skipped with a
recorded cause instead of stopping the loop. A mid-fight death runs bounded
recovery (release, corpse query, reclaim-delay wait, one direct travel leg)
before resuming the queue; the loop stops instead of retrying indefinitely
if recovery does not clear.
The loop stops on queue exhaustion (`queue_exhausted`), the starts cap
(`max_starts_reached`), `halt`, a denied or blocked loot window
(`loot_denied:*`, `loot_inventory_full`,
`loot_release_only_reconnect_required`), or an unrecovered death
(`corpse_absent`, `reclaim_delayed`, `corpse_out_of_range`,
`corpse_unreachable`, among other recovery causes). Inspect `cycling` for
the stop cause, detail, and per-target queue status.

`tuicraft cycling` [`--json`]
:: Print cycle state: `active`, `phase`, the GUID `queue` with per-target
`status` (`queued`, `done`, or `skipped`) and skip `cause`, `startsUsed`,
`stopCause`, `stopDetail`, `startedAt`, and `lastLoot`. This is the same
snapshot the `CYCLE` event carries in `read`/`tail`.

`tuicraft goto` _x_ _y_ _z_
:: Request a ground route. Missing navigation data fails with `ERR`.

`tuicraft navigation` [`--json`]
:: Print navigation state.

`tuicraft follow` _guid_ [_distance_]
:: Request bounded following of an observed unit on Expansion01/map 530.
_guid_ is a nonzero unsigned 64-bit integer in `0x` hex or decimal.
_distance_ is a finite number from 1 through 20 yards. The default is 3.
Distance measures horizontal ground-route length behind the target, not a straight-line radius.
The command requires compatible navigation data and supported recent target motion.
Destination height comes from unambiguous native ground, never from the target altitude.

A request lasts at most 30 seconds and allows at most 32 native planning calls.
The runtime limits target separation to 100 yards and planned routes to 150 yards.
It observes motion every 100ms. Replans require meaningful displacement and at least 500ms between plans.
Motion receive age must not exceed 5 seconds. Quiet stationary targets can therefore expire.
Loss, unsupported or stale motion, unsafe control, correction, planning failure, and manual override stop follow without retries.
Use `halt` to stop follow while keeping the daemon connected.

`tuicraft following` [`--json`]
:: Print follow state, including `active`, `status`, target `guid`, requested `distance`, and terminal `reason`.
`attempts` counts native planner calls. `separation` is the observed/predicted 3D pose distance.
`targetPose.source` distinguishes predicted positions from server observations.
`observedAt` is the original motion receive time, not a refreshed prediction timestamp.
`OK` confirms request intent only. `holding` means predicted grounded standoff, not server-confirmed arrival.
Use `control --json` to compare the current predicted pose with the last server pose.
Both command failures and inspection failures print `ERR` and exit with status 1.

`tuicraft recovery` [`--json`]
:: Print observed life, health, flags, death epoch, corpse/query state, reclaim guards, delay, offer, and pending request intent.
Ghost flags take precedence over positive ghost health. A release request or graveyard marker does not establish ghost state.
`corpse.status=unknown` differs from an observed `absent` reply. Unanswered query state does not imply no corpse.
Corpse `mapId` describes displayed coordinates. `corpseMapId` is the actual corpse map and can differ at instance entrances.
`reclaim.pose.source` labels server versus predicted position. A predicted position is not server acceptance.
Unknown delay has no `remainingMs`. `readiness=unverified` is not a claim that the delay expired.

`tuicraft query-corpse`
:: Request corpse information without a manual control override. Only one unresolved query is allowed.
A new death invalidates old corpse authorization. A stale unanswered reply cannot authorize the new death.

`tuicraft release-spirit`
:: Request spirit release from authoritative dead state. Already-observed ghost state does not permit another release request.
Inspect subsequent life facts instead of treating `OK` as a confirmed release.

`tuicraft reclaim-corpse`
:: Request reclaim while observed ghost, using a freshly queried found corpse and the current labeled pose.
The actual and displayed corpse maps must match the pose map. Distance must be at most 39 yards in three dimensions.
A known future delay blocks the request. Missing delay remains unknown.
If all other guards pass, one explicit request is allowed with unknown timing and retains `request.timing=unknown`.
This command takes no corpse GUID. The server finds the authenticated player's corpse.

`tuicraft resurrect` `accept`|`decline`
:: Answer the current server-observed resurrection offer once. No offer means the command fails.
A known future offer delay blocks acceptance, but not decline. Response intent does not establish resurrection.

Guided corpse run:

1. Inspect `recovery --json`. Use observed `life` and `epoch`, not health alone. Stop if life is unknown.
2. If dead, issue `release-spirit` once and wait for observed ghost state. If already ghost, skip release.
3. Check `query` before requesting the corpse. Wait if a query is unanswered or stale. Use a found corpse from this epoch without another query. Stop if the reply says absent. Otherwise issue `query-corpse` once and require a found corpse from this epoch. Check displayed `corpse.mapId` against actual `corpse.corpseMapId` and `reclaim.pose.mapId`. If the maps match but the corpse is distant, use short `face` and `move forward` legs. Recheck `recovery --json` after each leg. Do not use `goto` from a ghost; the ground planner has refused ghost poses. Stop if motion makes no progress.
4. Require `reclaim.canRequest=true` and a 3D distance of at most 39 yards. Wait out a known positive `remainingMs`. Unknown timing permits one explicit request but does not prove readiness. A predicted pose is not server confirmation. It does not by itself block reclaim. Reclaim can restore life beside the killer at partial health. Check `nearby --all --json` before reclaim near a killer. Its distance may use a stale self position after walking. Compare killer coordinates with the current `reclaim.pose` and choose a clear escape heading. If no clear heading is known, report the risk. After `reclaim-corpse` returns `OK`, flee with `face` and a short `move forward` before inspecting life. Require observed `life=alive`. Never treat `OK` as proof or retry an unanswered request.

After reconnect, `combat --json` may list every learned spell in `unknownLearned` while the catalog is cold. Run `spells` once. Inspect `combat --json` again before diagnosing a broken spell kit.

Mutating recovery actions stop prior tactics, follow, and motion through the manual override path.
`OK` acknowledges intent only. Confirm recovery through subsequent authoritative life/ghost-flag observations.
Do not retry unanswered actions automatically. Recovery command and inspection errors print `ERR` and exit with status 1.

`tuicraft quests` [`--json`]
:: Print the current offered dialog/giver, observed quest log, metadata queries, pending/uncertain intent, errors, progress, and reward facts.
A sent acceptance request is not an accepted quest. Acceptance and removal require authoritative same-lifetime quest-log observations.
Log counters are server quest words, not inferred inventory counts. Unknown quest IDs stay unknown.
A query with no reply remains unanswered, not missing. Metadata never authorizes quest mutation.

`tuicraft talk` _guid_
:: Request a conversation with an observed giver. _guid_ is a nonzero uint64 in decimal or `0x` hex.

`tuicraft query-quest` _id_
:: Request metadata for a positive uint32 quest ID. This readonly query does not select or authorize the quest.

`tuicraft select-option` _id_ [_code_]
:: Select an option ID from the current offered gossip menu. IDs are decimal uint32 and may be zero.
If the option requires a code, pass exactly one shell argument. Quote spaces, for example `select-option 0 'two words'`.
Omitted code and empty code (`''`) differ. Extra arguments and embedded NUL are rejected.
IPC encodes the optional code as JSON. `SELECT_OPTION 0 null` omits a code, while `SELECT_OPTION 0 ""` supplies empty code.
Escaped newlines and quotes stay inside the code instead of creating another IPC command.

`tuicraft select-quest` _id_
:: Select a positive uint32 quest ID from the current offered quest menu.

`tuicraft accept-quest`
:: Request acceptance of the currently offered quest details. Inspect subsequent log state for actual acceptance.

`tuicraft complete-quest` _id_
:: Request completion for a currently offered quest. Log membership or queried metadata alone does not authorize this action.

`tuicraft request-reward`
:: Request the reward offer for the current dialog. Server prerequisites still apply.

`tuicraft choose-reward` _index_
:: Choose a currently offered reward using a zero-based index from 0 through 5.
The actual offered choice count limits valid indices. Use index 0 when the offer has no selectable reward choices.
Only a server quest-complete reward notification establishes a reward fact. It does not prove a particular inventory gain.

`tuicraft abandon-quest` _slot_
:: Request abandonment from zero-based quest-log slot 0 through 24. Unknown or empty slots cannot authorize abandonment.
The quest remains until an authoritative log observation removes it. Removal alone is not a reward fact.

`tuicraft cancel-interaction`
:: Request close of the current interaction and revoke its authorization. The prior unanswered intent remains uncertain.
Wait for observed close or a confirmed world reset before another mutation. Late menu/error packets do not unlock a pending cancel.

All conversational mutations use the current offered dialog and giver. Only one unanswered mutation can be pending.
`OK` is request intent only. It does not establish acceptance, completion, reward, abandonment, or cancellation success.
Quest action and inspection errors print `ERR` and exit with status 1. Do not retry an unanswered interaction automatically.

`tuicraft inventory` [`--json`]
:: Print observed carried inventory, coinage, slots, equipped bags, physical free slots, and observation issues.
Scope excludes bank and buyback. Unknown GUID halves, counts, ownership, bag capacity, and private metadata stay unknown.
An observed item identity does not imply count 1. Slot state distinguishes unknown, empty, and occupied.
`freeSlots` counts physical empty backpack/equipped-bag cells only. It does not prove bag-family eligibility or stack capacity.

`tuicraft loot` [`--json`]
:: Print loot phase/offer, unanswered intent, inventory observations, inventory/loot errors, and item/money/release notices.
The JSON object separates `loot`, `pending`, `inventory`, `lastItemPush`, `lastMoneyNotice`, and `lastRelease`.
Slot removal proves removal from the offer, not inventory gain. Window money clearance is not an observed coinage increment.
An item-push slot of `0xFFFFFFFF` means stacking, not a physical slot. Compare actual slot/count/coinage observations before claiming gain.

`tuicraft open-loot` _guid_
:: Request loot from an observed UNIT corpse with an explicitly observed lootable flag while self is authoritatively alive.
_guid_ is a nonzero uint64 in decimal or `0x` hex. The server still checks range and loot rights.
Only a matching successful full loot response creates an actionable offer.

`tuicraft take-loot` _slot_
:: Request an offered loot slot. The protocol slot is a decimal integer from 0 through 255, not a guessed list position.
Only offered allow/owner slots are actionable. A single take or money request can be unanswered at a time.
Inventory-full and other inventory errors remain visible. They do not prove that a particular take request resolved.

`tuicraft take-money`
:: Request money from the current offer. Confirm actual coinage changes separately from notices and window money clearance.

`tuicraft release-loot`
:: Request closure of an open window, including one with an unanswered take. Replacement waits for the matching successful release notification.
It does not close an unanswered opening and does not establish an inventory gain.

A release notification during opening can precede its full response. It records `lastRelease` but leaves `loot.phase=opening` and `pending.status=unanswered`.
If the server sends only that release, the opening remains unanswered. This includes ordinary out-of-range opening rejection.
There is no inferred denial, timeout unlock, replacement open, or automatic retry.
If no full response follows, explicitly reconnect using `tuicraft stop`, then `tuicraft inventory --json`.
The ordinary reconnect creates a new runtime. It does not prove what happened to the previous request.

Loot mutations use the manual override path. Readonly inventory/loot inspections do not change control ownership.
All acknowledgements are intent only. Action and inspection errors print `ERR` and exit with status 1.

`tuicraft logs`
:: Print the JSONL session log to stdout.

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

`--who` [*filter*]
: Who query. Optional name/class/level filter.

## Options

`--json`
:: Output as structured JSON. Commands require different parsing strategies:

- **Single document (parse full stdout with `JSON.parse` / `json.loads`):**
  - Object: `control`, `combat`, `tactics`, `navigation`, `following`, `recovery`, `quests`, `inventory`, `loot`, `who` (`{"type":"WHO","count":N,"results":[...]}`), and `chat` / `send` without `--wait` (`{"status":"ok"}`).
  - Array: `spells` (`[{"spellId":...,"name":...},...]`).
- **Line-by-line / JSONL (parse line-by-line):**
  `nearby`, `read`, and `tail`. Each line is a separate JSON object (or 0 lines if empty). `read --wait N` emits pure JSONL without an acknowledgment line. Parsing full output as a single JSON document will fail with `Extra data`.
- **Mixed shape trap (`send --wait N --json`, `-w`, `-y`, `-g`, `-p`):**
  Emits an acknowledgment object `{"status":"ok"}` on line 1, followed by 0 or more JSONL event lines received during the wait window. Parsing full stdout as a single document fails if any event arrives during the wait. Parse line-by-line: line 1 is the acknowledgment object, and lines 2+ are event objects.

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

`tuicraft stop` disconnects the daemon. `tuicraft halt` cancels movement,
navigation, tactics, and follow, and requests cast and auto-attack cancellation without
disconnecting. A sent request is not server-confirmed completion; inspect combat
state and events for the outcome.

`move`, `face`, and `target` do not enable tactics. Use `fight` for Jev control.
The server does not echo your own movement. Treat `pose.source=predicted` as a
local estimate. After `stop` and a new login, `control` shows the last
server-accepted pose.

Control commands and combat/spellbook/tactics/navigation/following/recovery/quest/inventory/loot inspections print daemon
`ERR` lines and exit with status 1.
