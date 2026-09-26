# tuicraft(1)

WoW 3.3.5a chat client

## Synopsis

```
tuicraft
tuicraft send [-s | -w <name> | -y | -g | -p] <message> [--wait N] [--json]
tuicraft [-w <name> | -y | -g | -p] <message> [--wait N] [--json]
tuicraft who [filter] [--json] | group [--json]
tuicraft setup [--account NAME] [--password PASS] [--character NAME] [flags]
tuicraft start [--json] | status [--json] | stop [--json]
tuicraft read [--wait N] [--json]
tuicraft tail [--json]
tuicraft control [--json] | nearby [--all] [--json]
tuicraft combat [--json] | spells [--json] | tactics [--json] | navigation [--json]
tuicraft cast <id> <guid> | attack <guid> | cancel-cast | stop-attack
tuicraft fight [--framing <variant>] <guid> [instruction...] | goto <x> <y> [<z>]
tuicraft cycle <guid...> [--instruction ...] [--max N] [--json] | cycle --resume [--instruction ...] [--max N] [--json] | cycling [--json]
tuicraft cycle --quest <id> [--source <entry>...] [--instruction ...] [--max N] [--json]
tuicraft defend on [instruction...] | defend off | defense [--json]
tuicraft recovery [--json] | query-corpse | release-spirit | reclaim-corpse
tuicraft spirit-healer <guid> | resurrect accept|decline
tuicraft quests [--json] | talk <guid> | query-quest <id>
tuicraft select-option <id> [code] | select-quest <id> | accept-quest
tuicraft complete-quest <id> | request-reward | choose-reward <index>
tuicraft abandon-quest <slot> | cancel-interaction
tuicraft inventory [--json] | experience [--json] | loot [--json] | open-loot <guid>
tuicraft take-loot <slot> | take-money | release-loot | use <bag> <slot>
tuicraft trainer [--json] | open-trainer <guid> | train <spell-id>
tuicraft vendor [--json] | open-vendor <guid> | sell <bag> <slot> [count]
tuicraft buy <vendor-slot> [count] | repair
tuicraft move <dir> [ms] | face <radians> | target <guid> | halt
tuicraft face-guid <guid> | walk-toward <yards> <guid>|<x> <y> <z>
tuicraft logs | record [--since MS] | skill | help | version
```

All daemon-backed commands above accept optional `--json`, including mutating
gameplay actions. `logs` and `skill` keep their raw output and reject `--json`;
`record` always prints JSON and rejects `--json`.

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
  `mise namigator:build` builds one from upstream Namigator with the
  default patches in `vendor/namigator/` and prints its path under
  `tmp/namigator/`. `NAMIGATOR_ADT_EDGES=1` also applies the opt-in
  ADT-edge patch, which changes some heights that already succeed.

The current ground planner supports Expansion01/map 530. Unsupported or
ambiguous geometry fails explicitly.

Set `TYPESAFE_API_KEY` in the daemon environment, not in the account config.
Restart the daemon after changing data paths or its environment. Chat and
manual casting by learned spell ID do not require these data paths or a Jev key.

### Environment variables

The daemon (or the interactive TUI) reads the Jev variables when it logs in;
a CLI command that auto-starts the daemon passes its own environment on.

`XDG_CONFIG_HOME`, `XDG_STATE_HOME`, `XDG_RUNTIME_DIR`, `TMPDIR`
: Choose where the config, session log, socket and pidfile live. See
[Files](#files).

`TYPESAFE_API_KEY`
: Jev API key. Without it, starting tactics fails with `missing_jev_key`.

`JEV_ENDPOINT_URL`
: Send Jev requests to this URL instead of
`https://api.typesafe.ai/v1/systemone`. `TYPESAFE_ENDPOINT_URL` is used when
`JEV_ENDPOINT_URL` is unset.

`JEV_FAULT`
: Test-only fault injection at the Jev boundary, used by the
[fault runbook](evidence/m2/fault-runbook.md). `delay:<ms>` holds each Jev
result until at least _ms_ milliseconds after the request started, and the
request is not cancelled meanwhile. `http:<status>` (100-599) fails every
request with `TypeSafe HTTP <status>` without contacting the endpoint.
`transport` fails every request with `fetch failed`. `tactics --json` and the
tactics `started` event record the fault as `fault` (`delay:<ms>ms`,
`http:<status>` or `transport:network`). Any other non-empty value stops the
world session from starting.

`WOW_JEV_FRAMING`
: Default `--framing` for `tuicraft fight`: `none`, `minimal` or `mechanics`;
unset or empty means `none`. The `tuicraft` CLI process reads it, not the
daemon, so it does not apply to a raw `FIGHT` socket command. An unknown
value fails `fight` as an argument error. `--framing` overrides it.

## Commands

`tuicraft`
: Interactive TUI with a readline prompt. Type slash commands or plain text.

`tuicraft send` [`-s` | `-w` _name_ | `-y` | `-g` | `-p`] _message_ [`--wait` _N_] [`--json`]
: Send a chat message. Say is the default; `-s` selects it explicitly.
Auto-starts the daemon if needed. A message that starts with `/` is sent to
the daemon as a slash command, for example `tuicraft send "/roll 50"`. The
daemon handles the chat, social, group, channel, guild and `/mail` commands
listed in [Interactive Commands](#interactive-commands). `/r`, `/raid`,
`/`_N_ channel messages, `/quit`, `/tuicraft`, `/join` without a channel,
and unknown commands are said as plain text, slash included. The chat flags
except `-s` also work without `send`.
`--wait` _N_ then returns only events that arrived after the message was sent,
waiting up to _N_ seconds for the first one. Events that were already unread
stay unread for the next `read`.

`tuicraft who` [_filter_] [`--json`]
: Who query. Optional name/class/level filter.

`tuicraft group` [`--json`]
: Print the current party: whether you are in a group, the leader, the loot
method and threshold (and master looter) from the last `SMSG_GROUP_LIST`, and
each other member's online state, health, max health and level. While the
member is in view these come from its observed unit (`source: "unit"`, printed
`in view`); out of range the server sends party stats instead
(`source: "party_stats"`, printed with their age). Human output reads
`Group: 2 members`, `Leader: Xia`, `Loot: round_robin, threshold uncommon`,
`Member Bob (0xa40): online, health 79/217, level 10, 3s ago`, or
`Group: none`. With `--json`, `data` has `inGroup`, `leader`, `loot`
(`method`, `masterLooter`, `threshold`, or `null` before a list arrives) and
`members[]` (`name`, `guid`, `online`, `health`, `maxHealth`, `level`,
`statsAt`, `source`); unobserved values are `null`. `members` lists the other members,
not you. Party chat stays `tuicraft party <message>`.

Human `read` prints group list changes: `[group] Joined a group led by Xia:
Bob`, `[group] Bob joined the group`, `[group] Bob left the group`, and
`[group] You are no longer in a group`, next to the existing invite, leader
and disband lines. `GROUP_LIST` events add `formed`, `added`, `removed` and
`loot`.

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
:: Read buffered events since the last `read`, then mark them read. With
`--json`, returns one envelope with event objects in `events`, including
`events: []` when empty. With `--wait` _N_, returns at once if unread events
exist, otherwise waits up to _N_ seconds and returns as soon as one arrives.
`tail` does not consume events, so `read` still sees them.

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
Other players' rows may carry `remotePose`, the last movement received for that player from `MSG_MOVE_*` broadcasts, `SMSG_COMPRESSED_MOVES`, or object create/update blocks. It holds `x`, `y`, `z`, `orientation`, `mapId`, the exact movement `flags` and `extraFlags` (unknown bits kept), the mover's own clock `moverTime`, the local `receivedAt` time, `ageMs` since receipt, and `source` (`observer`, `create`, or `update`). The pose is never extrapolated. `motion` is `moving` or `stationary` only for ground movement the client accepts; otherwise `motion` is `null` and `invalid` names why: unknown, contradictory, or pending flags; a transport, flying, gravity, hover, falling, swimming, or spline mode; `flags_unobserved` when a block carried a position without flags; `teleport` or `knockback`; and `time_skipped`, `malformed`, `transfer`, `map_changed`, or `dead`. The last five keep the previous position and `receivedAt`, so `ageMs` keeps growing. A player that leaves range or is re-created loses its old pose.
For `fight` and `cycle`, choose current non-self creature GUIDs from this JSON output. A stored GUID or an old spawn position does not establish a current target.

`tuicraft move` _direction_ [*ms*]
:: Walk `forward`, `backward`, `left`, or `right` for *ms* milliseconds.
`left`/`right` strafe. *ms* is an integer 1–10000. Default 1000. The walk
ends when the duration ends. Repeating the same direction while manual movement
is active renews the lease without a stop. A manual command takes over from
Jev or cycle immediately instead of refreshing their movement.
`move` needs navigation data. The daemon walks the ground a half yard at a time
and keeps the character on the highest surface it can reach: a rise of at most
0.25 yd (one navmesh cell) plus the navmesh's 50° walkable slope, or a drop of up to 13 yd (under the server's 13.48 yd fall-damage distance). If the first half yard cannot
be walked, `move` sends nothing and fails with `ERR <reason>` (JSON: an error
envelope): `obstructed`, `height_unresolved`, `too_steep` (rise or drop beyond
those limits) or `ground_height_unavailable`. Without navigation data it fails with
`missing_navigation`. `rooted` also means a dead
character. A leg that stops later keeps the reason in `control` as
`blockedReason`, with a `nextStep` hint. Manual moves do not check walls.

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
With `--json` the outcome is the envelope's `data`, `kind` is `result`, and a
stop also sets `error` while keeping `data`:

    {"command":"walk-toward","data":{"status":"completed","traveled":3,"pose":{"mapId":530,"x":8715.2,"y":-6653.1,"z":72.8,"orientation":5.08,"source":"predicted","updatedAt":1790382964703}},"error":null,"events":[],"kind":"result"}
    {"command":"walk-toward","data":{"status":"stopped","reason":"target_stale","traveled":0,"pose":{...}},"error":{"message":"walk stopped without completion","stage":"command"},"events":[],"kind":"result"}

An `ERR` refusal has no outcome: `kind` is `error` and `data` is null.

`tuicraft target` _guid_
:: Request selection of a unit. *guid* is an unsigned 64-bit integer in `0x`
hex or decimal. `0` sends a clear request and does not attack. A syntactically
valid GUID is sent even if the entity is stale. Refresh `nearby --json` before
use. Inspect `control --json`: `requestedTarget` is intent, `target` is the last
server observation.

`tuicraft halt`
:: Stop motion, cast, attack, tactics, navigation, and cycle, and clear an unanswered spirit-healer request. The daemon stays connected.
HALT on one IPC socket interrupts pending work and drops older queued
RELEASE_SPIRIT/RECLAIM_CORPSE/SPIRIT_HEALER/RESURRECT. Older queued read waits
are dropped. Corpse and metadata queries remain queued; newer requests run.
HALT also drops older queued TALK/SELECT_OPTION/SELECT_QUEST/ACCEPT_QUEST/COMPLETE_QUEST/REQUEST_REWARD/CHOOSE_REWARD/ABANDON_QUEST/CANCEL_INTERACTION.
HALT drops older OPEN_LOOT/TAKE_LOOT/TAKE_MONEY/RELEASE_LOOT/USE, OPEN_TRAINER/TRAIN and OPEN_VENDOR/SELL/BUY/REPAIR commands as well.
Metadata queries and inventory/loot/vendor inspections remain queued. HALT cannot undo sent requests or prove dialog/loot closure.
An enemy already attacking can continue after `halt`; stopping client actions
does not disengage combat.

`tuicraft combat` [`--json`]
:: Print combat state. With `--json`, `data` is an object. GUIDs are hex. Predicted poses keep `source=predicted`.
Without `--json` it prints a summary: self name, level, health and power,
whether auto-attack is on and at which GUID, the selected target, active self
aura spell IDs, cooldowns, the last XP award, the last cast or attack result,
and the learned spell count with how many lack spell metadata. Unresolved
spells resolve once `spells` or `fight` loads the spell data.

`tuicraft spells` [`--json`]
:: Print the learned spellbook joined to client metadata. With `--json`, `data` is an array of spell objects.

`tuicraft cast` _id_ _guid_
:: Cast a learned spell. _id_ is a positive integer. _guid_ is uint64 hex or
decimal. `0` is self/none. The reply only confirms that the daemon sent the
cast. The server's answer lands in `combat --json` `.data.lastOutcome`:
`status` is `succeeded`, `failed` or `interrupted`, and a failure keeps the
raw AzerothCore `SpellCastResult` code in `result` with its name in `reason`
(for example `result: 97`, `reason: "out_of_range"`; `bad_targets`,
`not_infront`, `no_power` for not enough mana, `interrupted`). A code outside
the 3.3.5a enum gives `reason: "unknown"`. The COMBAT `cast_failed` and
`cast_interrupted` events in `read --json` carry the same outcome in
`data.state.lastOutcome` and the name in their own `reason`
(`cast_failed:out_of_range`). A fight blocked by a rejected cast ends as
`server_action_rejected:<reason>`.

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
server responses remain waits. `fight` classifies the target from
`FactionTemplate.dbc` in both directions: friendly if either side is friendly,
hostile if either side is hostile, otherwise neutral, and unknown without
faction data. Hostile and neutral creatures are engaged. A friendly creature is
refused with `target_friendly`, a player with `target_not_pve_creature`, and an
unknown relation with `unverified_hostile_relation`, unless the creature is
currently attacking the character. `tactics --json` reports the classification
as `lastOutcome.observation.targetRelation`: `hostile`, `neutral`, `friendly`
or `unknown`. Inspect `tactics.lastOutcome.observation.unavailable` for spell
reasons.
A fight that makes no progress for 30 s blocks with `no_progress`. Progress is
the target's observed health falling below its lowest value so far in the fight,
or the separation to the target shrinking at least 1 yd below its closest value
so far; an unobserved separation never counts. Casting, shielding, healing,
waiting and facing are not progress on their own; a target that leashes back to
full health does not reset the bound. In `cycle`, the target is skipped with
cause `no_progress` and the loop continues.
Jev may choose directional movement during a fight under a renewable lease:
`wait` holds the current direction, `stop_moving` releases it, and choosing a
standing-required spell releases the lease before casting. The observation
carries target separation and facing for those choices.
A Jev request that takes longer than 5 s is discarded as `jev_timeout`; no
action is taken for it and the loop asks again. The run stops with
`failed`/`jev_timeout` only after 3 timeouts in a row, and any answered request
resets that count. Other Jev failures (HTTP errors, network errors, malformed
replies) stop the run at once. When Jev fails a run, the stop keeps or starts
auto-attack on the target if it is alive and attacking the character
(`tactics.defense: auto_attack`). Otherwise it releases control and reports
`uncontrolled_in_combat` if the character is still in combat, or `none`.

`tuicraft tactics` [`--json`]
:: Print tactics loop state. `lastOutcome.observation` retains the actual
terminal observation when one was available, including blocks before inference.
`lastRequest` is not populated without a real Jev request. `timeouts` holds the
run's `consecutive` and `total` Jev timeouts and the stop `limit` (3); `defense`
is set only when a Jev failure stopped the run.
Without `--json` it prints a short summary: status, run ID, target (name, GUID,
level, health), outcome status and reason, stop reason, self health and power
at the end, last XP award, last cast or attack result, the count of
unavailable actions, Jev timeouts when any occurred, and the defense taken. The
summary reads the terminal observation, or the last Jev request when a failure
carries none. Use `--json` for the full state.

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
recovery: release, one corpse query, then up to 40 `face` + `move forward`
legs toward the corpse. Each leg takes its heading from the current pose and
shortens so the ghost stops about 30 yd from the corpse, inside the 39 yd
reclaim radius and away from a killer standing on it. A leg that gains less
than 1 yd toward the corpse, for example one stopped at once by
`height_unresolved`, retries at heading offsets of +/-0.3, 0.6, 0.9, 1.2 and
1.5 rad; a leg that gains ground returns to the direct heading. After the reclaim delay the loop sends
`reclaim-corpse`, waits for `alive`, records `lastRecovery`
(`outcome: "reclaimed"`, `detail` with `pose`, `range` and `legs`, and
`at`), emits a `recovered` CYCLE event, and continues with the next queued
target. An accepted resurrection offer records `outcome: "resurrected"` and
continues the same way. The target that was being fought is recorded
`skipped` with cause `died`; it is not fought again. Life returns at partial
health, possibly near the killer, and the next fight starts from there. A
cycle started or resumed while dead or a ghost recovers first. A death on the
last target is still recovered before `queue_exhausted`. A loot failure after
the character died keeps the target `done`, records the loot cause on it, and
recovers instead of stopping. The leg bound stops
with `corpse_out_of_range`, and exhausted offsets stop with
`corpse_unreachable`.
After a kill the loop waits for the server update that shows the corpse at
zero health. A corpse without the lootable flag, or one that despawns first,
is recorded as `loot: "none"` on its queue entry and the loop continues,
as is one that despawns while its loot is opening.
If no death update arrives within the loot settle time, the loop stops with
`target_death_unconfirmed`.
The loop stops on queue exhaustion (`queue_exhausted`), the starts cap
(`max_starts_reached`), `halt`, a denied or blocked loot window
(`loot_denied:*`, `loot_inventory_full`,
`loot_denied:release_only`, `loot_release_unconfirmed`), an
unanswered loot take (`loot_denied:timeout`), or an unrecovered death
(`corpse_absent`, `reclaim_delayed`, `corpse_out_of_range`,
`corpse_unreachable`, among other recovery causes). A recovered death does
not stop the loop. The loop waits for the
server release acknowledgement after close before recording loot; an
unconfirmed close stops instead of reporting a gain. Inspect `cycling` for
the stop cause, detail, and per-target queue status.
`stopCause` is not a closed list: `loot_denied:*` includes a reason, and
recovery can report other causes. Inspect `stopDetail` instead of guessing.

`tuicraft cycle --resume` [`--instruction` _text_] [`--max` _N_] [`--json`]
:: Resume a stopped cycle. The loop continues from the first target at or
after `currentIndex` that is still `queued`: a target halted mid-fight is
fought again, and a target already `done` (for example after a `halt` during
loot) is not. With `--instruction` the new instruction applies to every
remaining target; without it the previous instruction stays. `--max` sets
the starts cap for the resumed run, which counts from zero; without it the
previous cap stays. Resume works after any stop cause, not only `halt`, and
emits a `resumed` CYCLE event. It fails with `cycle_active` while a cycle
runs and with `cycle_nothing_to_resume` when no queued target remains,
except while the character is dead or a ghost: then it recovers first (for
example after a recovery on the last target stopped with
`corpse_unreachable`) and stops with `queue_exhausted`.
Nothing is repaired between the stop and the resume; check `nearby` and
`recovery` first if the stop was not a `halt`.

`tuicraft cycle` `--quest` _id_ [`--source` _entry_...] [`--instruction` _text_] [`--max` _N_] [`--json`]
:: Pursue a logged quest's objectives instead of an explicit queue. GUIDs and
`--quest` are mutually exclusive. The daemon queries the quest once and derives
the objective creatures and counts from the server's quest data. Before each
fight it re-reads the quest log slot, then picks the nearest live creature of
a still-needed entry that it has not tried, that is not tapped by someone else,
and that is within 50 yd. Jev fights it exactly as in a GUID cycle, then the
loop loots and picks again; a death is recovered as in a GUID cycle and the
run continues. The quest query names required items but not the creatures
that drop them, so item objectives need one `--source` creature entry per
dropping creature; without one the start fails with
`objective_item_sources_unknown`. GameObject objectives are refused with
`objective_gameobject_unsupported`. `--max` defaults to twice the total
required count. The run stops with `objective_complete` once the server marks
the quest log slot complete, and otherwise with `quest_not_in_log`,
`quest_failed`, `objective_targets_absent` (no candidate observed; `stopDetail`
lists the entries), `objective_targets_out_of_reach` (`stopDetail` has the
nearest GUID and distance), `self_pose_unobserved`, or any GUID-cycle cause.
`cycle --resume` continues a stopped quest run and never re-picks a creature
it already tried. Travel toward more creatures and resume or start again after
an `objective_targets_*` stop. Travel to and from the quest giver, acceptance
and turn-in stay explicit supervisor steps. `cycling` shows the server
counters in `objective`.

`tuicraft defend on` [_instruction_...] | `tuicraft defend off`
:: Arm or disarm opt-in self-defence. It is off by default and ends with the
daemon. While armed, the daemon checks twice a second and on every incoming
`SMSG_ATTACKSTART`. If a live creature is attacking the character, the
character is alive, and nothing owns combat or movement (no `cycle`, no
`fight` or other tactics run, no manual movement lease or route), it fights
the attacker. With a Jev key it runs Jev tactics against the attacker with the
instruction (default: the `fight` default). Without a key it faces the
attacker and auto-attacks. It picks one attacker at a time, and the next
attacker after the fight ends.
Ownership rules: `halt` ends the engagement and **disarms** self-defence
(`disarmReason: "halt"`); arm it again with `defend on`. Any manual command,
a new `cycle` or `cycle --resume` ends the engagement with `manual_override`,
and a new `fight` ends it with `replaced`; self-defence then leaves that
attacker alone while it keeps attacking, so it never fights the new owner or
pulls the character back into a fight the operator took over. A new attacker
still triggers it. `defend off` disarms with reason `command`.
DEFENSE events in `read`/`tail` and the session log: `armed`, `started`
(`attacker`), `stopped` (`attacker`, `reason`: the tactics outcome such as
`server_kill_credit`, `no_progress` or `self_dead`, or `halt`,
`manual_override`, `replaced`, `attacker_gone`), and `disarmed` (`reason`).
`tuicraft record` counts them under `defense`, and a HALT that disarms it is an
intervention with scope `defense`.

`tuicraft defense` [`--json`]
:: Print self-defence state: `armed`, `mode` (`jev` or `auto_attack`),
`instruction`, the `active` engagement, `engagements`, `yielded` attackers,
`lastStop` and `disarmReason`.

`tuicraft cycling` [`--json`]
:: Print cycle state: `active`, `phase`, the GUID `queue` with per-target
`status` (`queued`, `done`, or `skipped`), skip `cause`, and `loot`
(`looted` or `none`, set after a kill), `instruction`, `startsUsed`,
`resumes`,
`stopCause`, `stopDetail`, `startedAt`, `lastLoot`, `lastRecovery`, and
`objective` (quest runs only: slot, `complete`, per-kill server counters
`current`/`required`, and required items). This is the same
snapshot the `CYCLE` event carries in `data.state` in `read`/`tail`.
`lastLoot.slotsTaken` records take requests and `moneyTaken` records the offered
amount, not verified item or money gains. `coinageBefore` and `coinageAfter`
record observed values when known. Confirm stored items through actual
inventory slot or count changes.
Without `--json`, `cycling` prints the cycle phase, instruction, starts,
resumes, each target outcome,
server kill XP when observed, `no loot` for a kill without loot, requested loot, observed coinage changes, and
the stop reason. A request for money or an item slot does not prove a gain.

`tuicraft goto` _x_ _y_ [_z_] | _guid_
:: Request a ground route. Missing navigation data fails with `ERR`.
Without _z_, the destination height comes from the native ground column at
_x_ _y_; a column with more than one floor refuses with
`pick_destination` before any movement. With _z_, it must match the one
ground height there. An entity's observed Z need not be a unique ground
height. Do not pass `nearby` coordinates to `goto` without ground validation;
prefer the two-coordinate form. The start and destination must each have one
ground height. Along the route, a column may also hold surfaces below the
walked ground or more than 1.6 yards (the agent height) above it, such as a
canopy or a bridge overhead. A route still refuses a surface within 1.6 yards
above the walked ground and a step of more than 1 yard between 0.5-yard
samples (`ambiguous ground column at route`). A native path corner may sit up
to 1.25 yards above the ground (the navmesh's climb plus one cell), but no
other surface may be closer to it. A `goto` while a route is active stops the
old route with a `movement_stopped` CONTROL event whose reason is
`navigation_replaced`, then plans from the stopped pose. If that plan is
refused, the character stays stopped.

With a _guid_, the route goes once to the ground under that observed
creature's current position; `navigation --json` carries it as `target`. The
route does not follow the creature. If the creature disappears from the
entity store while the route is active, for example by leaving visibility
range, the route stops with `blockedReason=target_lost` and is not replanned.

`tuicraft navigation` [`--json`]
:: Print navigation state, including raw `blockedReason`, `refusal` and
`nextStep`. For `obstructed`, choose another route and inspect the ground.
For `height_unresolved`, choose a different short heading or a known
grounded waypoint; do not repeat the failed heading. For `ambiguous ground
column at destination` (`refusal=pick_destination`), choose a destination
with one ground height; do not guess Z. `ambiguous ground column at start`
means the character stands where the column has more than one floor, such as
inside a building; move to open ground first. `at route` means the route
crosses such ground; choose another destination or waypoint. Both stop.
`refusal=unreachable` means the navigation mesh cannot connect the start to
the destination: native `UNKNOWN_PATH`, a path that ends away from the
requested point, or a path that omits it. Choose another destination; the
daemon never retries it.
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
:: Request resurrection from one observed creature whose NPC flags carry the healer bit (0x4000). Requires observed ghost state and rejects a duplicate while the previous request is unanswered, for 10 s or until `halt`. After 10 s a new request replaces the unanswered one; `halt` clears it at once. Either way `recovery --json` records `spiritHealerCleared` (`guid`, `requestedAt`, `clearedAt`, `reason` `timeout` or `halt`) and a `spirit_healer_cleared` RECOVERY event. The server silently ignores a request from out of interaction range, so move within a few yards before retrying. Never auto-activates and never reports success on intent. Server spirit resurrection may incur durability loss. Gossip option 0 (`select-option 0` after `talk`) is answered by a server confirmation, recorded in `recovery --json` as `spiritHealerConfirm` (`guid`, `receivedAt`) and a `spirit_healer_confirm_observed` RECOVERY event. tuicraft does not answer it for you: send `spirit-healer <guid>` from within a few yards to revive. After `OK`, inspect `recovery --json` for observed `life=alive`.

`tuicraft resurrect` `accept`|`decline`
:: Answer the current unanswered resurrection offer once. It requires observed dead or ghost state. A known future offer delay blocks `accept`, not `decline`. `OK` is request intent; confirm observed `life=alive` after an accept.
Human `recovery` shows the offer as `Resurrection offer: Fgklhcnkmic (0xa47), accept or decline with tuicraft resurrect accept|decline`, then `Resurrection accept allowed:` with `yes`, `no (wait N ms)`, `no (answered)` or the blocking life state, or `Resurrection offer: none`. A release throws the offer away, so check before releasing.
In `--json`, `resurrection.name` comes from the packet or, when the packet leaves it empty (as it does for players), from the observed caster; it stays `""` when neither is known.

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
:: Print the current offered dialog/giver, observed quest log, metadata queries, pending intent, unresolved intents (each with `reason` `cancelled`, `closed`, `reset` or `no_reply`), errors, progress, and reward facts.
A sent acceptance request is not an accepted quest. Acceptance and removal require authoritative same-lifetime quest-log observations.
Log counters are server quest words, not inferred inventory counts. Unknown quest IDs stay unknown.
Item objectives never appear in the log counters (AzerothCore sends no SMSG_QUESTUPDATE_ADD_ITEM). `items` lists each required item of a logged quest whose query is known, with the carried count read from the bags. Each item push for such an item waits in `itemPushes` until the bags hold its server total, then emits a QUEST `progress` event (source `inventory`) whose `lastProgress` is `{kind: "collect", questId, itemId, required, carried, pushed, totalCount, bag, slot}`. Query the quest first; pushes for unknown objectives are not correlated.
A query with no reply remains unanswered, not missing. Metadata never authorizes quest mutation.
Without `--json` it prints a summary: the dialog kind, giver GUID and quest,
its gossip options (`Option <id>: <text>`), offered quests
(`Quest <id> (level N): <title>`), required items, or reward choices
(`Reward choice <index>: item <entry> xN`) and fixed rewards, then
`Next: tuicraft <verb>` for the step that advances that dialog. It follows with
any unanswered request and each unresolved one (`Unresolved: <action> <quest>`),
the held log slots only
(`Slot 0: quest 8325 Reclaiming Sunstrider Isle, in progress, 3/8`, with
required counts once the quest metadata is known, and carried items as
`item 20797 5/8` from `items`), the last error with its reason named, and the
last reward. `--json` is unchanged.

QUEST lines in human `read`/`tail` name the quest and its facts:
`[quest] accepted 8325 Reclaiming Sunstrider Isle`,
`[quest] progress 8325 Reclaiming Sunstrider Isle: creature 15274 4/8` (or the
log counts, or `item 20797 3/8` for a collected item),
`[quest] rewarded 8325 … +100 XP +30 copper`,
`[quest] error invalid: already on that quest`, and
`[quest] dialog requestItems 8326 …, next: request-reward`. Titles appear once
the server has answered the quest query.

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
Auto-accept quests (for example 8325) enter the log when `select-quest` opens their details. The details stay open, but `accept-quest` then fails with `quest_already_in_log` instead of sending a request the server rejects.

`tuicraft complete-quest` _id_
:: Send `CMSG_QUESTGIVER_COMPLETE_QUEST` for a quest in the current dialog. This is the request `select-quest` already sends for a quest you can turn in. The server answers with a `requestItems` dialog when the quest needs items, even if you carry them, and with `offer` otherwise. On an open `requestItems` dialog it only re-sends the same dialog, with no error; use `request-reward` there. Log membership or queried metadata alone does not authorize this action.

`tuicraft request-reward`
:: The Continue button of a `requestItems` dialog: send `CMSG_QUESTGIVER_REQUEST_REWARD`. The server checks the required items and money, completes the quest and answers with the `offer` dialog. It sends nothing when they are missing, and tuicraft refuses the request with `quest_requirements_unmet` while the dialog's completion flags say so.

### Accept and turn-in sequences

Each step depends on the current dialog kind, `quests --json` `.data.dialog.kind`:

| Kind | What it is | Advance with |
| ---- | ---------- | ------------ |
| `gossip`, `list` | The giver's menu: options, offered and returnable quests | `select-quest <id>` (or `select-option <id>`) |
| `details` | A new quest's text | `accept-quest`; an auto-accept quest is already in the log, so `cancel-interaction` |
| `requestItems` | Turn-in of a quest that needs items or money | `request-reward` |
| `offer` | The reward offer | `choose-reward <index>` (0 without choices) |

Accept: `talk <giver>` → `gossip` → `select-quest <id>` → `details` →
`accept-quest` → the log shows it accepted.

Turn in: `talk <giver>` → `gossip` → `select-quest <id>`. For a quest that
needs items (8326 Unfortunate Measures, 8 Lynx Collars) the server opens
`requestItems`; `request-reward` moves it to `offer`. A kill or talk quest
(8325, 8564) goes straight to `offer`. Then `choose-reward <index>`, and the
server sends the reward (`rewarded`, and the quest leaves the log).

Check the log before `accept-quest`: this server accepts many quests (8325,
8326) as soon as `select-quest` opens their `details`, and `accept-quest` on
one of those fails. Close such a dialog with `cancel-interaction`. After a
reward, the giver can open the follow-up quest's `details` at once (8326 opens
8327, already accepted), so the dialog is not closed yet. Item objectives show carried counts from
the inventory (`items` in `quests --json`).

`tuicraft choose-reward` _index_
:: Choose a currently offered reward using a zero-based index from 0 through 5.
The actual offered choice count limits valid indices. Use index 0 when the offer has no selectable reward choices.
Only a server quest-complete reward notification establishes a reward fact. It does not prove a particular inventory gain.

`tuicraft abandon-quest` _slot_
:: Request abandonment from zero-based quest-log slot 0 through 24. Unknown or empty slots cannot authorize abandonment.
The quest remains until an authoritative log observation removes it. Removal alone is not a reward fact.

`tuicraft cancel-interaction`
:: Request close of the current interaction and revoke its authorization. The prior unanswered intent stays in `unresolved` until the quest log or a reward packet settles it; later cancels never drop it.
Wait for observed close or a confirmed world reset before another mutation. Late menu/error packets do not unlock a pending cancel.

All conversational mutations use the current offered dialog and giver. Only one unanswered mutation can be pending; another verb fails with `quest_reply_unanswered: <action> <guid> unanswered for <s>s; it expires as no_reply after 5s, or run cancel-interaction`.
A request the server has not answered within 5 s expires: QUEST `expired no_reply`, and it moves to `unresolved` with `reason` `no_reply`. A trainer list from the same giver answers a `talk` or `select-option` with QUEST `window trainer` and opens the offer in `trainer`; a vendor list answers it with QUEST `window vendor` and opens the goods in `vendor`. A bank or flight-master window answers it with QUEST `window unsupported_window:<kind>` and `lastError` `{kind: "unsupported_window", window, guid}`; tuicraft does not handle those windows. An expired request is not a failure or a success; the quest log or a reward packet can still settle it, and a reply that arrives after expiry is a stale dialog.
`OK` is request intent only. It does not establish acceptance, completion, reward, abandonment, or cancellation success.
Quest action and inspection errors exit with status 1. Human mode prints `ERR`;
JSON mode returns an error envelope. Do not retry an unanswered interaction automatically.

`tuicraft inventory` [`--json`]
:: Print observed carried inventory, coinage, slots, equipped bags, physical free slots, and observation issues.
Scope excludes bank and buyback. Unknown GUID halves, counts, ownership, bag capacity, and private metadata stay unknown.
An observed item identity does not imply count 1. Slot state distinguishes unknown, empty, and occupied.
`freeSlots` counts physical empty backpack/equipped-bag cells only. It does not prove bag-family eligibility or stack capacity.

`tuicraft experience` [`--json`]
:: Print the observed self level, `xp` and `nextLevelXp` fields, the last XP-gain notice (`lastXp`, kill or other), and the last level-up notice (`lastLevelUp`: level with health, power and stat deltas).
Fields are unknown until the self player is observed. A notice is not a field change; compare `xp`/`level` before and after a kill or quest turn-in.

`tuicraft loot` [`--json`]
:: Print loot phase/offer, unanswered intent, inventory observations, inventory/loot errors, and item/money/release notices.
The `data` object separates `loot`, `pending`, `inventory`, `lastItemPush`, `lastMoneyNotice`, and `lastRelease`.
Slot removal proves removal from the offer, not inventory gain. Window money clearance is not an observed coinage increment.
An item-push slot of `0xFFFFFFFF` means stacking, not a physical slot. Compare actual slot/count/coinage observations before claiming gain.
Without `--json`, `inventory` lists occupied item stacks, coinage, free
slots, and unknown slot counts. `loot` shows the offer, pickup permission,
pending request, and carried coinage. Use `--json` for all observation fields.

Item rows name the item next to its entry, for example
`Item 858 Lesser Healing Potion x11 at bag 255 slot 32` and
`Slot 0: item 4813 Small Leather Collar x1 (pickup allowed)`. The daemon asks
the server for each item template when the item appears in the inventory or a
loot window opens, and caches the answer for the session (the same cache `use`
reads). An entry is asked again only if the server has not answered within 5
seconds. Replies never wait
for it: a row shows only the entry until the server answers. In `--json`,
inventory slot items and loot items carry `name` and `quality` (the server's
0–7 quality code) next to `entry`/`itemId`; both stay `null` until answered or
when the server has no such item.

`tuicraft open-loot` _guid_
:: Request loot from an observed UNIT corpse with an explicitly observed lootable flag while self is authoritatively alive.
_guid_ is a nonzero uint64 in decimal or `0x` hex. The server still checks range and loot rights.
Only a matching successful full loot response creates an actionable offer.

`tuicraft take-loot` _slot_
:: Request an offered loot slot. The protocol slot is a decimal integer from 0 through 255, not a guessed list position.
Only offered allow/owner slots are actionable. A single take or money request can be unanswered at a time.
Inventory-full and other inventory errors remain visible. They do not prove that a particular take request resolved.
When a slot removal or money clearance leaves the window with no items and no money, tuicraft sends the release itself, as the real client does.
`loot.phase` becomes `closing`, then `closed` on the server's release notification. Taking a subset leaves the window open.

`tuicraft take-money`
:: Request money from the current offer. Confirm actual coinage changes separately from notices and window money clearance.

`tuicraft release-loot`
:: Request closure of an open window, including one with an unanswered take. Replacement waits for the matching successful release notification.
It does not close an unanswered opening and does not establish an inventory gain.
On a window that is already closing or closed, including one released automatically after the last take, it sends nothing and returns OK.

A release notification during opening can precede its full response. It records `lastRelease` and leaves `loot.phase=opening` for up to 3 seconds.
If no full response follows in that time, as with an out-of-range rejection, the open fails: `loot.phase` returns to `closed`, `pending` clears, and `lastOpenFailure` records the GUID and `reason: "release_only"`.
An opening whose corpse despawns or leaves view fails the same way with `loot_source_unavailable`, and one interrupted by your own death or a world change with `self_unavailable`.
Human `loot` prints `Last open failed:` with the reason. The next `open-loot` clears it and needs no reconnect. There is no automatic retry.

Loot mutations use the manual override path. Readonly inventory/loot inspections do not change control ownership.

`tuicraft trainer` [`--json`]
:: Print the trainer offer the server sent (SMSG_TRAINER_LIST), the unanswered
trainer request, the last settled one, and carried coinage. Each spell row is
`Spell 1243 Power Word: Fortitude (Rank 1): available, 9 copper, level 1`:
spell ID, name and rank from the build-12340 spell data (omitted without
`spell_data_dir`), state, cost in copper after reputation discount, and
required level. The state is `available`, `too_low` (character level below
the required level), `unavailable` (another requirement, such as a lower rank
or skill, is missing) or `known`. States come from the server's list; a spell
learned since then shows as `known`, and anything else changes only with a
new list. In `--json`, `data` holds `offer` (`guid`, `trainerType`,
`greeting`, `spells` with `spellId`, `name`, `rank`, `state`, `usable`,
`cost`, `requiredLevel`, `requiredSkill`, `requiredSkillValue`,
`requiredSpells`), `pending`, `lastOutcome` (`action`, `status`, `reason`,
`request`, `learnedSpells`, `coinageAfter`, `moneyDelta`), `level` and
`coinage`.

`tuicraft open-trainer` _guid_
:: Ask an observed creature with the trainer NPC flag for its spells
(CMSG_TRAINER_LIST). Choosing a trainer option after `talk` (for example
"I require priest training.") sends the same list, and it opens the same offer.

`tuicraft train` _spell-id_
:: Learn an offered spell whose state is `available`
(CMSG_TRAINER_BUY_SPELL). The outcome is confirmed only when the server
answers SMSG_TRAINER_BUY_SUCCEEDED, a newly learned spell appears in the
spellbook (`spells`, `combat --json` `learned`), and coinage has fallen by the
cost. Server refusals are named: `unavailable`, `not_enough_money` or
`not_enough_skill`. With no answer after 5 seconds the outcome is
`unanswered`. Local refusals print `ERR`: `No listed trainer`,
`Spell is not offered by this trainer`, `Spell is too_low` (or `unavailable`,
`known`) and `Previous trainer request remains unanswered`.

`tuicraft vendor` [`--json`]
:: Print the listed vendor's goods, the unanswered vendor request, the last
settled request with its observed money change, and carried coinage. Goods
keep the server's 1-based vendor slot, which can skip numbers:
`Slot 2: item 159 Refreshing Spring Water x5 for 23 copper (stock unlimited)`.
`x5` is how many items one purchase gives, and the price is what one purchase
costs this character after any reputation discount. The last request reads
`Last: sell item 4813 x1 from bag 255 slot 28: confirmed, +33 copper (coinage 49979 -> 50012)`,
and a purchase reads `Last: buy 1 purchase of item 159 from slot 2 for 23 copper`.
In `--json`, `data` holds `window` (`guid`, `items`, `emptyReason`,
`openedAt`, `invalidatedReason`), `pending`, `lastOutcome` and `coinage`. Each
item has `slot`, `itemId`, `name`, `quality`, `price`, `stock` (`null` when
unlimited), `buyCount`, `maxDurability`, `displayId` and `extendedCost`.
`lastOutcome` has `action` (`list`, `sell`, `buy` or `repair`), `status`,
`reason`, the original `request` with its `coinageBefore`, `coinageAfter`
and `moneyDelta`. A buy `request.count` counts purchases, not items; one
purchase gives the good's `buyCount` items.

`tuicraft open-vendor` _guid_
:: Ask an observed creature with the vendor NPC flag for its goods
(CMSG_LIST_INVENTORY). The window opens when the server's list arrives. A list
that arrives after choosing a vendor option in `talk` gossip opens the window
too. Stand within interaction range: from further away the server refuses with
`cant_find_vendor`.

`tuicraft sell` _bag_ _slot_ [_count_]
:: Sell the carried stack at _bag_ _slot_, as `inventory` prints them, to the
listed vendor. Without _count_ the whole stack is sold. The sale is confirmed
only when the stack leaves the slot (or shrinks by _count_) and coinage rises.
The money can be below the item's sell price when the item was damaged.

`tuicraft buy` _vendor-slot_ [_count_]
:: Buy _count_ purchases (default 1, at most 255) from a listed vendor slot.
The purchase is confirmed by the server's purchase reply together with the
coinage falling by the paid amount.

`tuicraft repair`
:: Repair every damaged carried and equipped item at the listed vendor, which
must have the repair NPC flag. The repair is confirmed when every item that was
damaged is back at full durability and coinage has fallen.

Vendor outcomes have a `status` of `confirmed`, `refused`, `partial` or
`unanswered`. Server refusals are named: selling gives `cant_find_item`,
`cant_sell_item`, `cant_find_vendor`, `you_dont_own_that_item`,
`only_empty_bag`, `cant_sell_to_this_merchant` or `must_repair_item`; buying
gives `cant_find_item`, `item_already_sold`, `not_enough_money`,
`seller_dont_like_you`, `distance_too_far`, `item_sold_out`,
`cant_carry_more`, `rank_require`, `reputation_require`, `inventory_full`,
`bag_full` or `inventory_result_<code>`. The server sends no reply for a
repair it cannot pay for, so a repair still pending after 5 seconds ends as
`partial` (some items repaired) or `unanswered`, both with reason
`not_repaired`. Any other request still pending after 5 seconds ends as
`unanswered` with `server_unanswered`. One vendor request can be pending at a
time. Local refusals print `ERR`: `Creature is not an observed vendor`,
`No listed vendor`, `No carried bag item at bag B slot S`,
`Sell count exceeds the stack`, `Vendor slot was not offered`,
`Vendor does not repair`, `Nothing needs repair`, and
`Previous vendor request remains unanswered`. Vendor actions use the manual
override path; `vendor` inspection does not change control ownership.
All acknowledgements are intent only. Action and inspection errors exit with status 1.
Human mode prints `ERR`; JSON mode returns an error envelope.

`tuicraft use` _bag_ _slot_
:: Use a carried item, such as food, drink or a potion, from the bag/slot shown in
`inventory --json` (bag 255 for backpack slots 23–38, 19–22 for equipped bags).
Both values are decimal integers from 0 through 255. The daemon asks the server
for the item template once, then sends `CMSG_USE_ITEM` with the item's on-use
spell on self. It refuses `unknown_slot`, `slot_unobserved`, `empty_slot`,
`item_entry_unobserved`, `unknown_item`, `no_use_spell`, `slot_changed`,
`item_query_timeout` and `cast_in_progress`. `OK` is intent only.
The result appears in `combat --json`: `lastOutcome` has `kind: "cast"`, the
item spell id and `item` (`entry`, `bag`, `slot`, `guid`), with `status`
`succeeded`, or `failed` with a spell cast `result` or an inventory error
`inventoryResult` (60 means not usable in combat). Food and drink auras appear in
`auras`, and `self.health`/`self.power` show the recovery. The stack count drops
in `inventory --json`, and `loot --json` keeps the raw `lastInventoryError`.
Food and drink cannot be used in combat; potions can. Sending the use stops a
running `fight` or `cycle` like other manual actions, and otherwise leaves
movement and auto-attack alone. A refused `use` leaves a running fight alone.

`tuicraft logs`
:: Print the raw JSONL session log to stdout. Does not accept `--json`.

`tuicraft record` [`--since` _epoch-ms_]
:: Print one JSON session record derived from the session log, from the first
entry at or after `--since` (default: the whole log). It reads the CYCLE,
TACTICS and RECOVERY events the daemon already logs; nothing in it is
hand-written. Needs no daemon and does not accept `--json`. Fields:
`window` (`from`, `to`, `durationMs`) and `entries`; `cycles`, one entry per
`cycle` start or `cycle --resume` with `instruction`, per-target `status`,
`cause`, `outcome` and `loot`, `recoveries`, `startsUsed`, `stopCause` and
`stopDetail`; `fights` (tactics runs started and outcomes by status and
reason, including lone `fight` runs); `completions` (`targetsDone`,
`serverKillCredit`); `blocked` (`targetsSkipped`, `skipsByCause`, and
`cycleStops` for every stop other than `queue_exhausted`,
`max_starts_reached`, `halt` or `manual_override`); `recoveries` (`deaths`
counted per transition to dead, `recovered`, `byOutcome`); `interventions`
(`halt`, `manual_override`, `resume`, `instruction_change`, each with `at`
and `scope` `cycle`, `fight` or `defense`); `defense` (`armed`,
`started`, `stoppedByReason`, `disarmedByReason`); `staleActions` (Jev results discarded, by
reason such as `stale_age`, `aborted`, `unavailable`); and `latency`.
`latency` gives two rates that must be quoted together: `loopRatePerSec`,
Jev requests per second of active tactics time (`activeMs`, from each run's
`started` to `stopped`), with `meanRequestMs` and `p95RequestMs`; and
`decisionRatePerSec`, requests that offered any candidate other than `wait`
and `cancel` (`decisionRequests`) per active second. `appliedDecisions`
(applied actions other than `wait`, including `cancel`) and `appliedWaits` are
reported alongside. A target resumed across
runs counts once. GM or chat commands are not in these events; record them
separately.

`tuicraft skill`
: Print the raw SKILL.md reference for AI agents. Includes command usage, event types, and integration examples. Does not accept `--json`.

`tuicraft help`
: Print usage summary.

`tuicraft version`
: Print the version and exit. Does not accept `--json`.

## Chat Flags

These flags work with `send` or on their own, except `-s`, which needs `send`.

`-s` _message_
: Say. Same as no flag.

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
`inventory`, `experience`, `loot`, `trainer`, `vendor`, `send` and chat flags, and `start`, `status`, `stop`.
All daemon-backed gameplay actions also accept `--json`: `move`, `face`,
`face-guid`, `walk-toward`, `target`, `halt`, `cast`, `attack`, `cancel-cast`, `stop-attack`, `fight`, `cycle`,
`goto`, `query-corpse`, `release-spirit`, `reclaim-corpse`, `spirit-healer`, `resurrect`,
`talk`, `query-quest`, `select-option`, `select-quest`, `accept-quest`,
`complete-quest`, `request-reward`, `choose-reward`, `abandon-quest`,
`cancel-interaction`, `open-loot`, `take-loot`, `take-money`, `release-loot`,
`use`, `open-trainer`, `train`, `open-vendor`, `sell`, `buy`, and `repair`.
`logs` and `skill` remain raw. `--json` is unsupported for them, `setup`,
`help`, `version`, interactive mode, and internal daemon mode.

`--wait` _N_
: With `read` and `send`: return unread events, waiting up to _N_ seconds for
the first one. The events count as read.

`--framing` _variant_, `--framing=`_variant_
: `fight` only. Jev situation framing: `none`, `minimal` or `mechanics`.
Defaults to `WOW_JEV_FRAMING`, then `none`. See `tuicraft fight`.

`--instruction` _text_, `--instruction=`_text_
: `cycle` only. Instruction for every target. The spaced form takes the
following words up to the next `--max`, `--instruction` or `--resume`, so
put GUIDs before it. Defaults to the `fight` default instruction (with
`--resume`, to the stopped cycle's instruction). Line breaks are rejected.

`--max` _N_, `--max=`_N_
: `cycle` only. Cap tactics-loop starts for the whole run. Positive integer,
default 10.

`--resume`
: `cycle` only. Resume the stopped cycle's remaining queue instead of starting
a new one; GUIDs are rejected. See `tuicraft cycle --resume`.

`-h`, `--help`
: Print usage summary.

`-v`, `--version`
: Print the version and exit.

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

When running in TUI mode, the following slash commands are available.
`tuicraft send "/..."` accepts the same commands except those the
[`send`](#commands) entry lists as said as plain text.

| Command                      | Action                                     |
| ---------------------------- | ------------------------------------------ |
| _text_                       | Send in the last chat mode (say at first)  |
| `/s`, `/say` _msg_           | Say (explicit)                             |
| `/y`, `/yell` _msg_          | Yell                                       |
| `/w`, `/whisper` _name_ _msg_ | Whisper                                   |
| `/r` _msg_                   | Reply to last whisper                      |
| `/g`, `/guild` _msg_         | Guild chat                                 |
| `/p`, `/party` _msg_         | Party chat                                 |
| `/raid` _msg_                | Raid chat                                  |
| `/e`, `/emote` _msg_         | Text emote                                 |
| `/dnd` [_msg_]               | Toggle Do Not Disturb                      |
| `/afk` [_msg_]               | Toggle Away From Keyboard                  |
| `/`_N_ _msg_                 | Channel _N_ (`/1` usually General, `/2` usually Trade) |
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
| `/friends`, `/f`, `/friend`  | Show your friends list                     |
| `/friend add` _name_         | Add a player to friends                    |
| `/friend remove` _name_      | Remove from friends                        |
| `/ignore` _name_             | Add a player to ignore list                |
| `/unignore` _name_           | Remove from ignore list                    |
| `/ignorelist`, `/ignore`     | Show your ignore list                      |
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
| `/mail`                      | Report that mail reading is unimplemented  |
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
[monster yell] Darkwraith: For the Scourge!
[monster emote] Darkwraith goes into a frenzy!
[combat] +40 XP (kill 0xf130003d2307401f)
[combat] Smite (591) failed: out of range
[rewards] loot opened: 12 copper, slot 0 item 4775 x1
[rewards] share of loot: 6 copper
[rewards] received item 6889 x2 (now 5)
[tactics] outcome completed: server_kill_credit
```

Creature chat has its own labels and JSON event types: `MONSTER_SAY`
(`[monster say]`), `MONSTER_YELL` (`[monster yell]`), `MONSTER_WHISPER`
(`[monster whisper]`), `MONSTER_PARTY` (`[monster party]`), `MONSTER_EMOTE`
(`[monster emote]`), `RAID_BOSS_EMOTE` (`[boss emote]`) and
`RAID_BOSS_WHISPER` (`[boss whisper]`). In both emote types the `%s`
placeholder is replaced by the creature's name, in human and JSON output.

Human gameplay lines carry their key fact: XP amount and source, the failed or
interrupted spell (by name once spell data is loaded) with the server's failure
reason, current self auras, money looted or a party share, the pushed item and
count, and the offer when a loot window opens. Per-step tactics lines
(`activated`, `request`, `result`, `applied`) and predicted movement steps
(`movement_started`, `facing_changed`, and a stop by lease or direction change)
are left out of human `read`/`tail`; `--json` keeps every event unchanged, and
COMBAT cast events add `spellName` when spell data is loaded.

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
and `data`; it sets `error.stage: "wait"` and exits with status 1. A stopped
`walk-toward` keeps `kind: "result"` and its outcome in `data` beside
`error.stage: "command"`.
JSON errors print to stdout as one envelope. Human output remains unchanged.
`logs` prints the raw JSONL session log. `skill` prints the raw reference text.
Neither command accepts `--json`.

## Socket Protocol

CLI commands talk to the daemon over its unix socket, `sock` in the runtime
directory (see [Files](#files)). Each request is one line; each reply is zero
or more lines followed by an empty line. For example:

```sh
SOCK=${XDG_RUNTIME_DIR:+$XDG_RUNTIME_DIR/tuicraft/sock}
SOCK=${SOCK:-${TMPDIR:-/tmp}/tuicraft-$(id -u)/sock}
echo "WHO_JSON mage" | nc -U "$SOCK"
```

A line that starts with `/` is a slash command, handled as described under
[`tuicraft send`](#commands). Otherwise the first word is the verb. A line
whose first word is not a verb is sent as chat in the last chat mode and
answered `OK <MODE>`. A known verb with missing or invalid arguments answers
`ERR <reason>`.

- Chat: `SAY`, `YELL`, `GUILD`, `PARTY`, `EMOTE`, `DND`, `AFK` _message_;
  `WHISPER` _name_ _message_; `ROLL` [_N_ [_M_]]; `JOIN` _channel_
  [_password_]; `LEAVE` [_channel_] (without a channel, leaves the group).
- Events and daemon: `READ`, `READ_JSON`, `READ_WAIT` _ms_,
  `READ_WAIT_JSON` _ms_ (return unread events, waiting up to _ms_ for the
  first), `TAIL_WAIT` _ms_, `TAIL_WAIT_JSON` _ms_ (wait _ms_, then return the
  events that arrived meanwhile without marking them read), `STATUS`, `STOP`.
  Wait verbs cap _ms_ at 60000.
- Players and entities: `WHO` [_filter_], `WHO_JSON` [_filter_],
  `NEARBY` [`all`], `NEARBY_JSON` [`all`].
- Group: `INVITE`, `KICK`, `LEADER` _name_; `ACCEPT`, `DECLINE`.
- Friends and ignore: `FRIENDS`, `FRIENDS_JSON`, `ADD_FRIEND`, `DEL_FRIEND`
  _name_; `IGNORED`, `IGNORED_JSON`, `ADD_IGNORE`, `DEL_IGNORE` _name_.
- Guild: `GUILD_ROSTER`, `GUILD_ROSTER_JSON`, `GLEAVE`, `GACCEPT`,
  `GDECLINE`; `GINVITE`, `GKICK`, `GPROMOTE`, `GDEMOTE`, `GLEADER` _name_;
  `GMOTD` [_message_].
- `MAIL` answers `UNIMPLEMENTED Mail reading`.
- Inspections: `CONTROL`, `COMBAT`, `SPELLS`, `TACTICS`, `CYCLING`,
  `NAVIGATION`, `RECOVERY`, `QUESTS`, `INVENTORY`, `EXPERIENCE`, `LOOT`,
  each with a `_JSON` variant.
- Actions take the same arguments as the CLI command of the same name:
  `MOVE`, `FACE`, `FACE_GUID`, `WALK_TOWARD`, `TARGET`, `HALT`, `CAST`,
  `ATTACK`, `CANCEL_CAST`, `STOP_ATTACK`, `FIGHT`, `CYCLE`, `GOTO`,
  `QUERY_CORPSE`, `RELEASE_SPIRIT`, `RECLAIM_CORPSE`, `SPIRIT_HEALER`,
  `RESURRECT`, `TALK`, `QUERY_QUEST`, `SELECT_OPTION`, `SELECT_QUEST`,
  `ACCEPT_QUEST`, `COMPLETE_QUEST`, `REQUEST_REWARD`, `CHOOSE_REWARD`,
  `ABANDON_QUEST`, `CANCEL_INTERACTION`, `OPEN_LOOT`, `TAKE_LOOT`,
  `TAKE_MONEY`, `RELEASE_LOOT`. `SELECT_OPTION` takes its optional code as
  JSON (see `tuicraft select-option`). `CYCLE_RESUME` [`--instruction`
  _text_] [`--max` _N_] is `tuicraft cycle --resume`.

## Files

The runtime directory is `$XDG_RUNTIME_DIR/tuicraft` when `XDG_RUNTIME_DIR`
is set, otherwise `<tmpdir>/tuicraft-<uid>`, where _tmpdir_ is `$TMPDIR` or
`/tmp`.

`${XDG_CONFIG_HOME:-~/.config}/tuicraft/config.toml`
: Account credentials and settings.

`<runtime directory>/sock`
: Daemon unix domain socket.

`<runtime directory>/pid`
: Daemon pidfile.

`${XDG_STATE_HOME:-~/.local/state}/tuicraft/session.log`
: Persistent JSONL session log.

To find the socket for raw IPC under either layout:

```sh
SOCK="${XDG_RUNTIME_DIR:+$XDG_RUNTIME_DIR/tuicraft/sock}"
SOCK="${SOCK:-${TMPDIR:-/tmp}/tuicraft-$(id -u)/sock}"
echo "STATUS" | nc -U "$SOCK"
```

### Two characters at once

One daemon serves one character. To play two, give each character its own
`XDG_CONFIG_HOME`, `XDG_RUNTIME_DIR` and `XDG_STATE_HOME`. Each then has its
own config, socket, pidfile and session log. Prefix every command for that
character with its variables:

```sh
A="XDG_CONFIG_HOME=$HOME/tc/a/config XDG_RUNTIME_DIR=$HOME/tc/a/run XDG_STATE_HOME=$HOME/tc/a/state"
B="XDG_CONFIG_HOME=$HOME/tc/b/config XDG_RUNTIME_DIR=$HOME/tc/b/run XDG_STATE_HOME=$HOME/tc/b/state"
env $A tuicraft setup --account ACC_A --password PASS_A --character NameA
env $B tuicraft setup --account ACC_B --password PASS_B --character NameB
env $A tuicraft start && env $B tuicraft start
env $A tuicraft send "/invite NameB"
env $B tuicraft send "/accept"
```

Without separate directories, the second `start` reaches the first daemon and
prints `Daemon is already running.`

## Testing

`mise test` runs the unit suite. `mise test:live` runs `src/test/live.ts`
against a real server with two game accounts, read from `WOW_ACCOUNT_1`,
`WOW_PASSWORD_1`, `WOW_CHARACTER_1`, `WOW_ACCOUNT_2`, `WOW_PASSWORD_2` and
`WOW_CHARACTER_2`. `WOW_HOST` (default `t1`), `WOW_PORT` (default `3724`) and
`WOW_LANGUAGE` (default `1`) are optional. Use throwaway accounts: create
account 1 with `bun src/factory/main.ts soap create fresh --gm 2` (GM level 2
for the `.freeze` and `.tele` checks) and account 2 with
`bun src/factory/main.ts soap create eversong10`, set the variables from the
JSON each prints, and delete both with `soap delete <ACCOUNT>` afterwards.
[AGENTS.md](../AGENTS.md) has the details.

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
not a server result. `fight` replies when the run ends and prints its outcome
line, for example `completed: server_kill_credit, XP 60`. `cycle` replies when
the run ends and prints that it ended; `cycling` holds the outcome. `combat`,
`tactics`, `cycling`, `recovery`, `inventory`, `experience`, `loot`,
`trainer`, and `vendor` print readable summaries.
