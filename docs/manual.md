# tuicraft(1)

WoW 3.3.5a chat client

## Synopsis

```
tuicraft
tuicraft send [-w <name> | -y | -g | -p] <message> [--wait N] [--json]
tuicraft [-w <name> | -y | -g | -p] <message> [--wait N] [--json]
tuicraft who [filter] [--json]
tuicraft setup [--account NAME] [--password PASS] [--character NAME] [flags]
tuicraft start [--json] | status [--json] | stop [--json]
tuicraft read [--wait N] [--json]
tuicraft tail [--json]
tuicraft control [--json] | nearby [--all] [--json]
tuicraft combat [--json] | spells [--json] | tactics [--json] | navigation [--json]
tuicraft cast <id> <guid> | attack <guid> | cancel-cast | stop-attack
tuicraft fight [--framing <variant>] <guid> [instruction...] | goto <x> <y> <z>
tuicraft cycle <guid...> [--instruction ...] [--max N] [--json] | cycling [--json]
tuicraft recovery [--json] | query-corpse | release-spirit | reclaim-corpse
tuicraft spirit-healer <guid> | resurrect accept|decline
tuicraft quests [--json] | talk <guid> | query-quest <id>
tuicraft select-option <id> [code] | select-quest <id> | accept-quest
tuicraft complete-quest <id> | request-reward | choose-reward <index>
tuicraft abandon-quest <slot> | cancel-interaction
tuicraft inventory [--json] | loot [--json] | open-loot <guid>
tuicraft take-loot <slot> | take-money | release-loot
tuicraft move <dir> [ms] | face <radians> | target <guid> | halt
tuicraft face-guid <guid> | walk-toward <yards> <guid>|<x> <y> <z>
tuicraft logs | skill | help | version
```

All daemon-backed commands above accept optional `--json`, including mutating
gameplay actions. `logs` and `skill` keep their raw output and reject `--json`.

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

`tuicraft send` [`-w` _name_ | `-y` | `-g` | `-p`] _message_ [`--wait` _N_] [`--json`]
: Send a chat message. Say is the default. Auto-starts the daemon if needed.
A message that starts with `/` runs as a slash command, for example
`tuicraft send "/roll 50"`. The chat flags also work without `send`.
`--wait` _N_ returns events received during the next _N_ seconds.

`tuicraft who` [_filter_] [`--json`]
: Who query. Optional name/class/level filter.

`tuicraft setup` [*flags*]
: Configure account credentials. With no flags, runs an interactive wizard.

`tuicraft start` [`--json`]
:: Start the background daemon explicitly.
Without `--json`, an existing daemon prints `Daemon is already running.` and exits
with status 0. A new daemon prints `CONNECTED` and exits with status 0.
`CONNECTED` confirms that the daemon socket answered its probe, not that the
world session is healthy. Startup failure (missing configuration, invalid
credentials, unreachable server, or timeout) prints an error in human mode
and exits with status 1. With `--json`, `data` is
`{"socket":"responsive","started":true}` for a new daemon, or
`{"socket":"responsive","started":false}` for an existing daemon.

`tuicraft read` [`--wait` *N*] [`--json`]
:: Read buffered events. With `--json`, returns one envelope with event objects
in `events`, including `events: []` when empty. `--wait` polls for _N_ seconds.

`tuicraft tail` [`--json`]
:: Continuous event stream. Blocks and prints events as they arrive. With
`--json`, emits JSONL with one envelope per event and no line for an empty poll.

`tuicraft status` [`--json`]
:: Print daemon socket status. Human output is `CONNECTED` or
`Daemon is not running.`. With `--json`, `data.socket` is `responsive` or
`not_running`; this does not verify world-session health.

`tuicraft stop` [`--json`]
:: Graceful daemon shutdown. Disconnects the session. With `--json`, a
successful stop is intent; an absent daemon returns a result with
`data: {"socket":"not_running"}`.

`tuicraft control` [`--json`]
:: Print control state. JSON `data` includes `pose`, `serverPose`, `target`, `requestedTarget`, motion, and `blockedReason`. `pose` is the current control estimate. Its `source` is `predicted` after local movement or `server` after a server observation.
`serverPose` is the last server-observed pose, not the current position after ordinary movement. Each pose has `updatedAt`, the time that pose was last updated; a recent prediction is not server confirmation. Text labels these poses as current and last server. `nextStep` is conservative guidance when a known ground refusal occurs, or `null`.
`target` is the last server-observed self target; `requestedTarget` is the last GUID this client sent. For either field, `0x0` means a clear and `null` means no observation or request yet. A sent selection is not server confirmation. Matching values alone do not acknowledge a new request: the observation may predate it.
Ordinary self movement is not echoed. A server correction can update the observed pose; relog to confirm the position the server accepted after a walk.

`tuicraft nearby` [`--all`] [`--json`]
:: List nearby entities ordered by raw 3D distance from the current `control.pose`, before display rounding. When no control pose exists, the last self-entity position is a fallback. By default, entities beyond 100 yards or on another map are filtered when self position is known; `--all` lists all tracked entities, including map-wide transports. The 100-yard limit derives from `DEFAULT_VISIBILITY_DISTANCE 100.0f` in AzerothCore's `src/server/game/Entities/Object/ObjectDefines.h:39` ('100 yards on continents'). Because `Map::GetVisibilityRange()` is per-map configurable (e.g. 170 yards in instances, 250 yards in battlegrounds and arenas), 100 yards is a continent default rather than universal across all maps.
Text lists each GUID, 3D and XY yards, absolute face angle, signed turn angle, and origin source. The self row uses the current control pose when available, not its older entity position.
With `--json`, `data` is an array of entity objects, or `[]` when empty. `distance` is 3D yards and `horizontalDistance` is XY yards, both rounded to two decimals for output. Self has 3D distance zero by identity, and XY distance zero only when self position is known; its angles are `null`.
`bearingRadians` is the absolute angle from +X toward +Y in [0, 2π); use it with `face`. `turnRadians` is the shortest signed rotation from current facing in [-π, π); positive rotates from +X toward +Y. Both angles are `null` when direction is undefined, including zero XY displacement.
Non-self distances and angles are `null` if either position is unknown or off-map. `originSource` is `predicted`, `server`, `self_entity`, or `null`. `originUpdatedAt` is the control pose update time, or `null` for fallback. Other entity positions are last observations, not guaranteed current. `mapId` is the map at entity parsing, not a server field per entity. Straight-line distance and bearing do not prove a safe or reachable route.
For `fight` and `cycle`, choose current non-self creature GUIDs from this JSON output. A stored GUID or an old spawn position does not establish a current target.

`tuicraft move` _direction_ [*ms*]
:: Walk `forward`, `backward`, `left`, or `right` for *ms* milliseconds.
`left`/`right` strafe. *ms* is an integer 1–10000. Default 1000. The walk
ends when the duration ends. Repeating the same direction while manual movement
is active renews the lease without a stop. A manual command takes over from
Jev or cycle immediately instead of refreshing their movement.

`tuicraft face` _radians_
:: Set facing. The value is a finite number in radians. Empty input is rejected.

`tuicraft face-guid` _guid_
:: Face a currently observed entity on the same map without selecting it.
The GUID must have a usable observed position; a missing, unsupported, or stale
unit pose is refused. A moving GUID is sampled once, not tracked.

`tuicraft walk-toward` _yards_ _guid_
`tuicraft walk-toward` _yards_ _x_ _y_ _z_
:: Walk a direct leg toward one sampled observed GUID or an explicitly
grounded coordinate, for at most _yards_ (finite, greater than 0 and at most
20). The leg stops at the closer of the distance limit and target position.
A coordinate needs a native ground-height match within 0.25 yards; ambiguous,
missing, or mismatched ground refuses before movement. The daemon checks the
starting ground, connected heights in both directions, and low/headroom rays
at each step of at most 0.5 yards. It stops on an obstruction, unsafe state,
correction, client disconnect, `halt`, or takeover. The 10-second safety lease
renews only while the leg makes progress; a stalled leg stops. It does not
route around obstacles; use `goto` for a checked route.
The command waits for a terminal JSON object: `status` is `completed` or
`stopped`, `traveled` is predicted horizontal yards, `pose` has
`source=predicted` for motion, and a stop has `reason`. Exit status is 1 on
`stopped` or `ERR`, 0 on predicted completion. Completion is not server
confirmation; ordinary self movement is not echoed by the server.

`tuicraft target` _guid_
:: Request selection of a unit. *guid* is an unsigned 64-bit integer in `0x`
hex or decimal. `0` sends a clear request and does not attack. A syntactically
valid GUID is sent even if the entity is stale. Refresh `nearby --json` before
use. Inspect `control --json`: `requestedTarget` is intent, `target` is the last
server observation.

`tuicraft halt`
:: Stop motion, cast, attack, tactics, navigation, and cycle. The daemon stays connected.
HALT on one IPC socket interrupts pending work and drops older queued
RELEASE_SPIRIT/RECLAIM_CORPSE/SPIRIT_HEALER/RESURRECT. Older queued read waits
are dropped. Corpse and metadata queries remain queued; newer requests run.
HALT also drops older queued TALK/SELECT_OPTION/SELECT_QUEST/ACCEPT_QUEST/COMPLETE_QUEST/REQUEST_REWARD/CHOOSE_REWARD/ABANDON_QUEST/CANCEL_INTERACTION.
HALT drops older OPEN_LOOT/TAKE_LOOT/TAKE_MONEY/RELEASE_LOOT commands as well.
Metadata queries and inventory/loot inspections remain queued. HALT cannot undo sent requests or prove dialog/loot closure.
An enemy already attacking can continue after `halt`; stopping client actions
does not disengage combat.

`tuicraft combat` [`--json`]
:: Print combat state. With `--json`, `data` is an object. GUIDs are hex. Predicted poses keep `source=predicted`.

`tuicraft spells` [`--json`]
:: Print the learned spellbook joined to client metadata. With `--json`, `data` is an array of spell objects.

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
:: Run Jev tactics to its terminal outcome. Default instruction is to defeat the selected target while
keeping the character alive. The command returns after the encounter completes, blocks, fails, or is halted; use `halt` to stop a running fight. Framing defaults to `none` (or `WOW_JEV_FRAMING`).
`minimal` frames the game, class and observed level; `mechanics` adds non-refilling
resource pool, damage-over-time and cast disruption mechanics. Missing Jev key
fails with `ERR`.
The instruction must be a single line. Daemon `ERR` replies, including inspection failures, make the CLI exit with status 1.
The spell kit requires observed normal form (`combat.self.shapeshiftForm=0`). A complete server CREATE defines omitted public fields as zero. An absent entity or incomplete observation does not establish that baseline.
Unknown or nonzero forms make spells unsupported, not melee automatically.
`no_supported_combat_actions` is a structural block when no supported spell
and no current melee or attack progress are available. Cooldowns and pending
server responses remain waits. An unverified hostile relation refuses `fight`
unless faction data or current attack evidence establishes hostility. Inspect
`tactics.lastOutcome.observation.unavailable` for spell reasons.
Jev may choose directional movement during a fight under a renewable lease:
`wait` holds the current direction, `stop_moving` releases it, and choosing a
standing-required spell releases the lease before casting. The observation
carries target separation and facing for those choices.

`tuicraft tactics` [`--json`]
:: Print tactics loop state. `lastOutcome.observation` retains the actual
terminal observation when one was available, including blocks before inference.
`lastRequest` is not populated without a real Jev request.

`tuicraft cycle` _guid..._ [`--instruction` _text_] [`--max` _N_] [`--json`]
:: Run the fight-loot-next-target loop over an explicit GUID queue: `fight`
each target in order, auto-loot any offered items and money, then advance.
`--instruction` applies to every target and defaults to the same instruction
as `fight`; unlike `fight`, `cycle` does not accept `--framing`. `--max`
caps tactics-loop starts for the whole run, a positive integer, default 10.
At least one nonzero GUID is required. Starting a new cycle replaces any
running cycle; `halt` stops it.
Choose the queued creature GUIDs from a current `nearby --json` result. The
cycle never acquires targets itself.
A target that dies, is unreachable, or fails to fight is skipped with a
recorded cause instead of stopping the loop. A mid-fight death runs bounded
recovery (release, corpse query, reclaim-delay wait, one direct travel leg)
before resuming the queue; the loop stops instead of retrying indefinitely
if recovery does not clear.
After a kill the loop waits for the server update that shows the corpse at
zero health. A corpse without the lootable flag, or one that despawns first,
is recorded as `loot: "none"` on its queue entry and the loop continues.
If no death update arrives within the loot settle time, the loop stops with
`corpse_unconfirmed`.
The loop stops on queue exhaustion (`queue_exhausted`), the starts cap
(`max_starts_reached`), `halt`, a denied or blocked loot window
(`loot_denied:*`, `loot_inventory_full`,
`loot_release_only_reconnect_required`, `loot_release_unconfirmed`), an
unanswered loot take (`loot_denied:timeout`), or an unrecovered death
(`corpse_absent`, `reclaim_delayed`, `corpse_out_of_range`,
`corpse_unreachable`, among other recovery causes). The loop waits for the
server release acknowledgement after close before recording loot; an
unconfirmed close stops instead of reporting a gain. Inspect `cycling` for
the stop cause, detail, and per-target queue status.
`stopCause` is not a closed list: `loot_denied:*` includes a reason, and
recovery can report other causes. Inspect `stopDetail` instead of guessing.

`tuicraft cycling` [`--json`]
:: Print cycle state: `active`, `phase`, the GUID `queue` with per-target
`status` (`queued`, `done`, or `skipped`), skip `cause`, and `loot`
(`looted` or `none`, set after a kill), `startsUsed`,
`stopCause`, `stopDetail`, `startedAt`, and `lastLoot`. This is the same
snapshot the `CYCLE` event carries in `data.state` in `read`/`tail`.
`lastLoot.slotsTaken` records take requests and `moneyTaken` records the offered
amount, not verified item or money gains. `coinageBefore` and `coinageAfter`
record observed values when known. Confirm stored items through actual
inventory slot or count changes.
Without `--json`, `cycling` prints the cycle phase, each target outcome,
server kill XP when observed, `no loot` for a kill without loot, requested loot, observed coinage changes, and
the stop reason. A request for money or an item slot does not prove a gain.

`tuicraft goto` _x_ _y_ _z_
:: Request a ground route. Missing navigation data fails with `ERR`.
An entity's observed Z need not be a unique ground height. Do not pass
`nearby` coordinates to `goto` without ground validation.

`tuicraft navigation` [`--json`]
:: Print navigation state, including raw `blockedReason`, `refusal` and
`nextStep`. For `obstructed`, choose another route and inspect the ground.
For `height_unresolved`, choose a different short heading or a known
grounded waypoint; do not repeat the failed heading. For `ambiguous ground
column`, choose a destination with one ground height; do not guess Z.
`nextStep` is advice, not a verified detour or an automatic retry.

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

`tuicraft spirit-healer` `<guid>`
:: Request resurrection from one observed creature whose NPC flags carry the healer bit (0x4000). Requires observed ghost state and rejects an unanswered duplicate request. Never auto-activates and never reports success on intent. Server spirit resurrection may incur durability loss. Gossip selection stays silent for this path. After `OK`, inspect `recovery --json` for observed `life=alive`.

`tuicraft resurrect` `accept`|`decline`
:: Answer the current unanswered resurrection offer once. It requires observed dead or ghost state. A known future offer delay blocks `accept`, not `decline`. `OK` is request intent; confirm observed `life=alive` after an accept.

Guided corpse run:

1. Inspect `recovery --json`. Use observed `life` and `epoch`, not health alone. Stop if life is unknown.
2. If dead, issue `release-spirit` once and wait for observed ghost state. If already ghost, skip release.
3. Check `query` before requesting the corpse. Wait if a query is unanswered or stale. Use a found corpse from this epoch without another query. Stop if the reply says absent. Otherwise issue `query-corpse` once and require a found corpse from this epoch. Check displayed `corpse.mapId` against actual `corpse.corpseMapId` and `reclaim.pose.mapId`. If the maps match but the corpse is distant, use short `face` and `move forward` legs. Recheck `recovery --json` after each leg. Do not use `goto` from a ghost; the ground planner has refused ghost poses. Stop if motion makes no progress.
4. Require `reclaim.canRequest=true` and a 3D distance of at most 39 yards. Wait out a known positive `remainingMs`. Unknown timing permits one explicit request but does not prove readiness. A predicted pose is not server confirmation. It does not by itself block reclaim. Reclaim can restore life beside the killer at partial health. Check `nearby --all --json` before reclaim near a killer. Its distances use the current control pose when available, but creature positions are last observations. Compare killer coordinates with the current `reclaim.pose` and choose a clear escape heading. If no clear heading is known, report the risk. After `reclaim-corpse` returns `OK`, flee with `face` and a short `move forward` before inspecting life. Require observed `life=alive`. Never treat `OK` as proof or retry an unanswered request.

After reconnect, `combat --json` may list every learned spell in `unknownLearned` while the catalog is cold. Run `spells` once. Inspect `combat --json` again before diagnosing a broken spell kit.

Mutating recovery actions stop prior tactics and motion through the manual override path.
`OK` acknowledges intent only. Confirm recovery through subsequent authoritative life/ghost-flag observations.
Do not retry unanswered actions automatically. Recovery command and inspection
errors exit with status 1. Human mode prints `ERR`; JSON mode returns an error envelope.

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
Quest action and inspection errors exit with status 1. Human mode prints `ERR`;
JSON mode returns an error envelope. Do not retry an unanswered interaction automatically.

`tuicraft inventory` [`--json`]
:: Print observed carried inventory, coinage, slots, equipped bags, physical free slots, and observation issues.
Scope excludes bank and buyback. Unknown GUID halves, counts, ownership, bag capacity, and private metadata stay unknown.
An observed item identity does not imply count 1. Slot state distinguishes unknown, empty, and occupied.
`freeSlots` counts physical empty backpack/equipped-bag cells only. It does not prove bag-family eligibility or stack capacity.

`tuicraft loot` [`--json`]
:: Print loot phase/offer, unanswered intent, inventory observations, inventory/loot errors, and item/money/release notices.
The `data` object separates `loot`, `pending`, `inventory`, `lastItemPush`, `lastMoneyNotice`, and `lastRelease`.
Slot removal proves removal from the offer, not inventory gain. Window money clearance is not an observed coinage increment.
An item-push slot of `0xFFFFFFFF` means stacking, not a physical slot. Compare actual slot/count/coinage observations before claiming gain.
Without `--json`, `inventory` lists occupied item stacks, coinage, free
slots, and unknown slot counts. `loot` shows the offer, pickup permission,
pending request, and carried coinage. Use `--json` for all observation fields.

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
All acknowledgements are intent only. Action and inspection errors exit with status 1.
Human mode prints `ERR`; JSON mode returns an error envelope.

`tuicraft logs`
:: Print the raw JSONL session log to stdout. Does not accept `--json`.

`tuicraft skill`
: Print the raw SKILL.md reference for AI agents. Includes command usage, event types, and integration examples. Does not accept `--json`.

`tuicraft help`
: Print usage summary.

`tuicraft version`
: Print the version and exit. Does not accept `--json`.

## Chat Flags

These flags work with `send` or on their own.

`-w` _name_ _message_
: Whisper to a player.

`-y` _message_
: Yell.

`-g` _message_
: Guild chat.

`-p` _message_
: Party chat.

## Options

`--json`
:: Request a five-field JSON envelope. Every finite daemon-backed command
prints exactly one document, including empty results, waited events, and errors.
Parse complete stdout with `JSON.parse` or `json.loads`. Only `tail --json` is
continuous JSONL: parse one envelope per line. See [Output Format](#output-format).

Supported commands include `read`, `tail`, `who`, `nearby`, `control`, `combat`,
`spells`, `tactics`, `cycling`, `navigation`, `recovery`, `quests`,
`inventory`, `loot`, `send` and chat flags, and `start`, `status`, `stop`.
All daemon-backed gameplay actions also accept `--json`: `move`, `face`,
`face-guid`, `walk-toward`, `target`, `halt`, `cast`, `attack`, `cancel-cast`, `stop-attack`, `fight`, `cycle`,
`goto`, `query-corpse`, `release-spirit`, `reclaim-corpse`, `spirit-healer`, `resurrect`,
`talk`, `query-quest`, `select-option`, `select-quest`, `accept-quest`,
`complete-quest`, `request-reward`, `choose-reward`, `abandon-quest`,
`cancel-interaction`, `open-loot`, `take-loot`, `take-money`, and `release-loot`.
`logs` and `skill` remain raw. `--json` is unsupported for them, `setup`,
`help`, `version`, interactive mode, and internal daemon mode.

`--wait` _N_
: Wait _N_ seconds for events before returning. For use with `read` and `send`.

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

`--language` _ID_
: Chat language code. Default: `1` (Orcish). Use `7` for Alliance.

`--timeout_minutes` _N_
: Daemon idle timeout in minutes. Default: `30`.

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

With `--json`, every finite command prints exactly one JSON object and a
newline on stdout. It has exactly five top-level fields:

| Field | Value |
| ----- | ----- |
| `command` | Public command name; chat aliases use `send`. `null` if argument parsing cannot identify it. |
| `kind` | `intent`, `result`, `events`, or `error`. |
| `data` | Inspection JSON object or array, slash-command text `{"lines":[...]}`, or `null`. |
| `events` | Array of event objects; never encoded JSON strings. |
| `error` | `null` or an object with `stage` and `message`. |

An empty `nearby --json` has `data: []`. An empty `read --json` has
`events: []`. Both print a complete envelope. `send --wait N --json` includes
its waited event objects in the same envelope, not on separate lines.
`kind: "intent"` means daemon acknowledgment, not server acceptance or a
game-world outcome. Inspect later state and events. A result does not turn
predicted or unknown state into server-observed state.

Finite request:

```json
{"command":"fight","kind":"intent","data":null,"events":[],"error":null}
```

Only `tail --json` is continuous JSONL. It writes one envelope for each event,
and none for an empty poll:

```json
{"command":"tail","kind":"events","data":null,"events":[{"type":"SAY","sender":"Xi","message":"hello world"}],"error":null}
```

An error uses `stage: "arguments"`, `"startup"`, `"command"`, or `"wait"` and
exits with status 1. An error before acknowledgment has `kind: "error"`.
After a `send --wait` acknowledgment, a wait error keeps the initial `kind`
and `data`; it sets `error.stage: "wait"` and exits with status 1.
JSON errors print to stdout as one envelope. Human output remains unchanged.
`logs` prints the raw JSONL session log. `skill` prints the raw reference text.
Neither command accepts `--json`.

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
tuicraft send "hello world"
tuicraft read --wait 3
```

Script integration:

```sh
tuicraft send -p "ready"
tuicraft read --wait 3 --json | jq .
tuicraft who mage --json
```

## Notes

Horde characters use Orcish (language 1) by default. Alliance characters should
set `language = 7` in the config file.

The daemon buffers up to 1000 events. The idle timeout is configurable via
`timeout_minutes` in the config file.

`tuicraft stop` disconnects the daemon. `tuicraft halt` cancels movement,
navigation, and tactics, and requests cast and auto-attack cancellation without
disconnecting. A sent request is not server-confirmed completion; inspect combat
state and events for the outcome.

`move`, `face`, and `target` do not enable tactics. Use `fight` for Jev control.
The server does not echo your own movement. Treat `pose.source=predicted` as a
local estimate. After `stop` and a new login, `control` shows the last
server-accepted pose.

Without `--json`, control commands and inspections print daemon `ERR` lines
and exit with status 1. With `--json`, they print one error envelope on stdout
and exit with status 1. Human control actions print daemon request acceptance,
not a server result. `fight` and `cycle` reply when the run ends and print
that it ended; `tactics` or `cycling` holds the outcome. `cycling`,
`recovery`, `inventory`, and `loot` print readable summaries.
