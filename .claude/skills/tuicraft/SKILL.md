---
name: tuicraft
description: Use when interacting with a WoW 3.3.5a game world — sending chat, reading events, querying players, managing groups, or issuing bounded walk, face, and target commands via the tuicraft CLI
---

# tuicraft

CLI client for World of Warcraft 3.3.5a. A background daemon maintains the game connection and buffers events. The daemon starts automatically on first use and stays running for 30 minutes of inactivity.

## Daemon lifecycle

    tuicraft start                # connect daemon explicitly
    tuicraft status               # show connection status
    tuicraft stop                 # disconnect and stop daemon
    tuicraft start --json         # socket result (not world-session health)
    tuicraft status --json        # socket responsive or not_running
    tuicraft stop --json          # stop intent, or not_running result

- Without `--json`, `start` prints `Daemon is already running.` or `CONNECTED` on success. `CONNECTED` confirms only that the daemon socket answered the probe. It does not verify the world session. Startup failure exits with status 1.
- Without `--json`, `status` returns `CONNECTED` or `Daemon is not running.`
- `stop` gracefully disconnects the session and terminates the daemon. With `--json`, successful stop is intent; an absent daemon returns `data: {"socket":"not_running"}`.
- `tuicraft logs` prints the raw JSONL session log. `tuicraft record [--since MS]` prints one JSON session record built from the logged CYCLE, TACTICS and RECOVERY events (see Session record below). `tuicraft skill` prints this document. `tuicraft version` (`-v`, `--version`) prints the version. `tuicraft help` (`-h`, `--help`) prints usage. `tuicraft` with no arguments starts the interactive TUI, which is for humans.
- `tuicraft setup` configures the account. With no flags it runs an interactive wizard; non-interactively pass `--account NAME --password PASS --character NAME` and optionally `--host` (default `t1`), `--port` (`3724`), `--language` (`1`, Orcish; `7` for Alliance) and `--timeout_minutes` (`30`).

## JSON output

Use `--json` with these daemon-backed commands:

- Inspections: `who`, `control`, `nearby`, `combat`, `spells`, `tactics`, `cycling`, `navigation`, `recovery`, `quests`, `inventory`, `experience`, `loot`.
- Chat and events: `send`, chat flags, `read`, `tail`.
- Movement and combat actions: `move`, `face`, `face-guid`, `walk-toward`, `target`, `halt`, `cast`, `attack`, `cancel-cast`, `stop-attack`, `fight`, `cycle`, `goto`.
- Recovery, quest, and loot actions: `query-corpse`, `release-spirit`, `reclaim-corpse`, `spirit-healer`, `resurrect`, `talk`, `query-quest`, `select-option`, `select-quest`, `accept-quest`, `complete-quest`, `request-reward`, `choose-reward`, `abandon-quest`, `cancel-interaction`, `open-loot`, `take-loot`, `take-money`, `release-loot`.
- Daemon lifecycle: `start`, `status`, `stop`.

`logs` prints the raw session log. `skill` prints the raw reference document.
Neither accepts `--json`. `setup`, `help`, `version`, interactive mode, and
internal daemon mode do not accept `--json`.

For a finite `--json` command, parse complete stdout once with
`json.loads(stdout)` or `JSON.parse(stdout)`. The command prints one JSON object
and one newline. Empty results and errors also print one object.
`read --wait N --json` returns one envelope. `send --wait N --json` returns
one envelope with the waited events. Chat flags (`-w`, `-y`, `-g`, `-p`) use
`command: "send"`.

Each envelope has exactly these five top-level fields:

| Field | Meaning |
| ----- | ------- |
| `command` | Public command name, or `null` when argument parsing cannot identify it. |
| `kind` | `intent`, `result`, `events`, or `error`. |
| `data` | Inspection/query JSON value (object or array), slash-text `{"lines":[...]}`, or `null`. |
| `events` | Array of event objects, never encoded JSON strings. |
| `error` | `null`, or an object such as `{"stage":"command","message":"..."}`. |

The `error.stage` value is `arguments`, `startup`, `command`, or `wait`.
A non-null error exits with status 1. Before acknowledgment, an error uses
`kind: "error"`. After a `send --wait` acknowledgment, a wait failure keeps
the original `kind` and `data` and sets `error.stage: "wait"`. Human mode
prints daemon `ERR` messages. JSON mode prints one error envelope on stdout.

`kind: "intent"` means that the daemon acknowledged a request. The server
may reject the request or never apply it. Inspect subsequent state and server
events before claiming an outcome. `kind: "result"` returns data without
upgrading predicted or unknown facts to observations. `kind: "events"` returns
events. Read inspection fields in `data`, nearby entities in `data[]`, and
event fields in `events[]`.

Finite request example:

```json
{"command":"fight","kind":"intent","data":null,"events":[],"error":null}
```

An empty `nearby --json` returns `{"command":"nearby","kind":"result","data":[],"events":[],"error":null}`.
An empty `read --json` returns `{"command":"read","kind":"events","data":null,"events":[],"error":null}`.
Neither returns empty stdout. `spells` also stores its array in `data`.

Only `tail --json` is continuous JSONL. Parse one line at a time.
It prints one envelope per event and nothing for empty polls:

```json
{"command":"tail","kind":"events","data":null,"events":[{"type":"PARTY","sender":"PlayerName","message":"hello"}],"error":null}
```

`status --json` returns `data.socket` as `responsive` or `not_running`.
`start --json` returns `data.socket: "responsive"` and `data.started: true|false`.
These values describe the daemon socket, not world-session health.

Without `--json`, `cycling`, `recovery`, `inventory`, `experience`, and `loot` show human
summaries. Use `--json` for all fields and automated parsing. A human action
acknowledgment means that the daemon accepted a request. It does not confirm
that the server completed the action. `fight` and `cycle` reply when the
run ends, and human mode says that it ended; read `tactics` or `cycling` for
the outcome.

## Direct control

These commands move, face, or select.

    tuicraft control              # human text
    tuicraft control --json       # structured state
    tuicraft nearby [--all]       # nearby units and objects (nearest first; transports and >100yd require --all)
    tuicraft nearby [--all] --json
    tuicraft move forward         # 1000ms default
    tuicraft move left 400        # strafe 400ms
    tuicraft face 1.57            # radians
    tuicraft face-guid 0xabc      # turn toward a currently observed entity
    tuicraft walk-toward 3 0xabc # bounded direct leg toward one sampled pose
    tuicraft walk-toward 2 <grounded-x> <grounded-y> <grounded-z> # replace all three placeholders
    tuicraft target 0xf130003f520009e5
    tuicraft target 0             # clear target, do not attack
    tuicraft halt                 # stop motion, stay connected
    tuicraft stop                 # disconnect the daemon

Rules:

- `move` accepts only `forward`, `backward`, `left`, or `right`. The last two directions strafe.
- Duration is an integer from 1 through 10000 milliseconds. The default is 1000 milliseconds.
- Invalid duration sends no movement packet.
- Repeating the same direction extends an active manual lease without a stop.
- A manual command stops Jev or cycle before it takes control.
- `face` takes one finite radian number.
- `face-guid` needs a nonzero GUID with an observed position on the current map.
- Reject a missing GUID, an unsupported unit position, or a stale unit observation.
- `face-guid` samples a moving unit once. It does not track the unit.
- `walk-toward` needs a finite distance greater than 0 and at most 20 yards.
- Supply one observed GUID or three finite coordinates. The GUID position is sampled once.
- For a coordinate, the supplied height must match native ground height within 0.25 yards.
- The daemon walks no farther than the distance limit or the sampled target position.
- The daemon checks ground continuity and collision at each step of at most 0.5 yards.
- The daemon stops on unsafe ground, correction, client disconnect, manual takeover, or HALT.
- A 10-second safety lease renews only while the character makes progress.
- The daemon does not make a blind detour or retry automatically. It does not track a moving GUID.
- `walk-toward --json` puts the outcome in `data`: `status` (`completed`|`stopped`), `traveled`, `pose`, and `reason` on a stop. A stop also sets `error` (`walk stopped without completion`) and exits 1 but keeps `data`, so branch on `data.status` and `data.reason`. An `ERR` refusal has `kind=error` and `data=null`.
- `walk-toward` returns one JSON object with `status`, `traveled`, and `pose`.
- A stopped result also contains `reason` and makes the CLI exit with status 1.
- `completed` is a predicted endpoint. It is not server confirmation.
- Ground sampling requires compatible navigation data.
- `target` takes one unsigned 64-bit GUID in `0x` hexadecimal or decimal. `0` and `0x0` clear the target.
- Invalid direction, duration, facing, or GUID fails locally. The character does not move or retarget.
- A valid GUID can still be stale. `target` sends it without checking entity age. Refresh `nearby --json` before acting. `requestedTarget` is sent intent; `target` is the last server observation. Equal values do not prove a fresh acknowledgment.
- `halt` stops walking, casting, auto-attack, tactics, navigation, and cycle. On one IPC socket it interrupts pending work and drops older queued mutating control, recovery, quest, and loot commands, including `cycle`, plus older read waits. It retains state inspections, corpse and metadata queries, and newer requests. It cannot undo a sent request or disengage an attacking enemy. `status` remains CONNECTED.
- Daemon `ERR` replies for MOVE, FACE, TARGET, HALT, CAST, ATTACK, FIGHT, and GOTO exit the CLI with status 1. Human mode prints `ERR`; JSON mode returns an error envelope.
- A terminal `stopped` result from WALK_TOWARD also makes the CLI exit with status 1.

`control --json` fields in `data` you must not mix up:

| Field | Meaning |
| ----- | ------- |
| `pose` | Current control estimate. Read `source` and `updatedAt`; `predicted` is local, not server-confirmed. |
| `pose.source` | `server` means server-observed; `predicted` means locally estimated. |
| `serverPose` | Last server observation and its `updatedAt`. It stays unchanged during ordinary self movement until correction or relogin. |
| `target` | Last server-observed self target GUID (`0x…`); `0x0` is an observed clear, null means not observed yet. |
| `requestedTarget` | Last GUID this client sent with `target`; `0x0` is a clear request, null means none sent. It can differ from `target`. |
| `moving` | Whether a timed walk is active. |
| `direction` | `forward` / `backward` / `left` / `right`, or null. |
| `owner` | `manual` for direct movement. `jev` while Jev owns control, including stationary waits. `none` when unowned. |
| `nextStep` | Conservative guidance after a known ground refusal, or `null`. Keep `blockedReason` as the actual refusal. |

Self movement is not echoed by the server. After a walk, `pose` is predicted. Relog (`stop`, then connect again) and read `control` to see the server-accepted position.

Use `nearby --json` for relative geometry. Each entity in the envelope's
`data[]` array has 3D `distance` and XY `horizontalDistance` in yards,
`bearingRadians` for `face`, and `turnRadians` from current facing.
Angles are `null` when direction is unknown or XY displacement is zero.
For non-self rows, off-map or missing positions give `null` distances and angles.
The self row uses the control pose when available, or the last self-entity position.
Its 3D distance is zero even if neither position is known. Its XY
distance is `null` only if neither position is known. `originSource`
identifies `predicted`, `server`, or fallback `self_entity`;
`originUpdatedAt` is `null` for the fallback.
Other entities use last observed positions. The result does
not verify a route. Move in bounded legs and read a new observation.

IPC verbs on the daemon socket. The socket is `$XDG_RUNTIME_DIR/tuicraft/sock` when `XDG_RUNTIME_DIR` is set, else `${TMPDIR:-/tmp}/tuicraft-<uid>/sock`. The `nc` examples below use:

    SOCK=${XDG_RUNTIME_DIR:+$XDG_RUNTIME_DIR/tuicraft/sock}
    SOCK=${SOCK:-${TMPDIR:-/tmp}/tuicraft-$(id -u)/sock}

Verbs:

    CONTROL
    CONTROL_JSON
    MOVE <forward|backward|left|right> [milliseconds]
    FACE <radians>
    FACE_GUID <guid>
    WALK_TOWARD <yards> <guid>
    WALK_TOWARD <yards> <x> <y> <z>
    TARGET <guid>
    HALT
    NEARBY [all]
    NEARBY_JSON [all]
    STOP
    STATUS

Control events appear in `read --json` and `tail --json` under `events[]` with
`type: "CONTROL"`. Their `event` field is `movement_started`,
`movement_stopped`, `facing_changed`, `target_requested`, `target_observed`,
`server_correction`, `control_changed`, or `control_error`. The payload
includes the same state fields as `control --json` in `data`.

## Combat and tactics

These commands inspect or act. They do not invent a spell rotation.

    tuicraft combat [--json]
    tuicraft spells [--json]
    tuicraft cast <learned-spell-id> <observed-target-guid>
    tuicraft attack <observed-hostile-guid>
    tuicraft cancel-cast
    tuicraft stop-attack
    tuicraft fight [--framing none|minimal|mechanics] <observed-hostile-guid>
    tuicraft fight <observed-hostile-guid> conserve mana and stay alive
    tuicraft tactics [--json]
    tuicraft cycle <guid...> [--instruction ...] [--max N] [--json]
    tuicraft cycle --resume [--instruction ...] [--max N] [--json]
    tuicraft cycling [--json]
    tuicraft goto <grounded-x> <grounded-y> <grounded-z>
    tuicraft navigation [--json]

Rules:

- `cast` takes a positive integer spell id and one uint64 GUID. `0`/`0x0` is self/none.
- `fight` requires a GUID. Optional `--framing` (or `--framing=`) accepts `none`, `minimal`, or `mechanics`; the default is `WOW_JEV_FRAMING` from the CLI's environment, else `none`. A raw `FIGHT` socket command ignores `WOW_JEV_FRAMING`. Extra words are the instruction. If omitted, the instruction is to defeat the selected target while keeping the character alive.
- Use a current observed PvE opponent, not a GUID copied from an example or an old spawn position.
- The Jev spell kit requires observed normal form (`combat.self.shapeshiftForm=0`). Complete server CREATE defines omitted public fields as zero; absent entities and incomplete observations remain unknown. Unknown and nonzero forms disable supported spells, not necessarily melee.
- `fight` engages hostile and neutral creatures (neutral mobs such as Mana Wyrms need no pull spell). It refuses friendly creatures with `target_friendly`, players with `target_not_pve_creature`, and an unknown faction relation with `unverified_hostile_relation`; a creature currently attacking the character is always engageable. `tactics --json` shows `lastOutcome.observation.targetRelation`. Do not infer hostility from a creature name.
- `no_supported_combat_actions` blocks when there is no supported spell and no current melee or attack progress. Cooldowns and pending server responses remain waits; supported melee and facing remain available.
- For a blocked kit, inspect `tactics.lastOutcome.observation.unavailable`. A missing `lastRequest` means no Jev request was made; terminal observations are separate evidence.
- Jev may choose directional movement during a fight under a renewable lease (`wait` holds, `stop_moving` releases, standing-required spells halt first). The observation carries target separation and facing.
- Choose current creature GUIDs from `nearby --json` (`data[]`) and hand them to `cycle <guid...>` in order. The cycle never auto-acquires; at least one nonzero GUID is required. `--instruction` applies to all targets and defaults like `fight`; its spaced form takes every following word up to the next `--max`/`--instruction`/`--resume`, so put GUIDs first (or use `--instruction=text`). `cycle` has no `--framing`. `--max N` (or `--max=N`) caps tactics-loop starts (positive integer, default 10).
- A cycle target that dies, is unreachable, or fails to fight is skipped (not a loop stop) with a recorded cause; the loop advances to the next queued GUID. A mid-fight death runs bounded recovery: release, one corpse query, up to 40 `face` + `move forward` legs (heading from the pose each leg; a leg that gains less than 1 yd toward the corpse, for example one stopped at once by `height_unresolved`, retries at offsets of +/-0.3, 0.6, 0.9, 1.2, 1.5 rad) until the ghost is about 30 yd from the corpse, the reclaim-delay wait, `reclaim-corpse`, and a confirmed `alive`. Then the cycle records `lastRecovery` (`outcome` `reclaimed` with `detail` `pose`, `range`, `legs`, or `resurrected` after an accepted offer), emits a `recovered` CYCLE event, and continues with the next queued target; the target it died to is `skipped` with cause `died`. Life returns at partial health, possibly near the killer. A cycle started or resumed while dead or a ghost recovers first; a death on the last target is still recovered before `queue_exhausted`. The leg bound stops with `corpse_out_of_range`; exhausted offsets stop with `corpse_unreachable`.
- After a kill the cycle awaits the corpse death update. No lootable flag (or a despawn) records `loot: "none"` on that queue entry and the loop continues; `loot: "looted"` marks an opened corpse. No death update within the settle time stops with `target_death_unconfirmed`.
- Inspect `cycling --json` for `phase`, per-target `queue` status/cause/loot, `instruction`, `startsUsed`, `resumes`, `lastRecovery`, `stopCause`, `stopDetail`, and `lastLoot`. `stopCause` is an open string: examples are `queue_exhausted`, `max_starts_reached`, `halt`, `target_death_unconfirmed`, `loot_denied:*` (including `loot_denied:timeout` for an unanswered take), `loot_inventory_full`, `loot_denied:release_only`, `loot_release_unconfirmed`, and recovery causes. The loop waits for the server release acknowledgement after close before recording loot. Inspect `stopDetail`.
- `lastLoot.slotsTaken` records requested slots, `moneyTaken` records offered money, and before/after coinage is observed when known. None of these proves item storage. Check raw inventory slot/count changes before claiming a gain.
- `cycle --resume` continues a stopped cycle from the first target at or after `currentIndex` that is still `queued`: a fight halted mid-way is fought again, a `done` target (halt during loot) is not. `--instruction` replaces the instruction for the remaining targets (omit it to keep the old one); `--max` sets the cap for the resumed run, and `startsUsed` restarts at 0. It works after any stop cause, emits a `resumed` CYCLE event, increments `resumes`, and fails with `cycle_active` or `cycle_nothing_to_resume`. While dead or a ghost it recovers first even with no queued target left (then stops `queue_exhausted`), so a failed recovery on the last target can be resumed. It repairs nothing else: after a non-`halt` stop, check `nearby` and `recovery` before resuming.
- Starting a new `cycle` replaces any running cycle. `halt` stops it. CYCLE events in `read`/`tail` carry the same `CycleState` snapshot as `cycling --json`, in `data.state`.
- The fight instruction must be one line. CR or LF is rejected before IPC.
- `goto` takes three finite coordinates. It is not a named-place planner.
- `goto` needs one ground height at the start and the destination. Along the route it accepts surfaces overhead (more than 1.6 yards up) or below, and refuses surfaces within 1.6 yards above and steps over 1 yard.
- JSON GUIDs are `0x` hex. Predicted poses use `source=predicted`.
- `spells` requires spell data. `fight` requires spell/faction data and a Jev key. `goto` requires navigation data and its native library. Missing prerequisites return ERR; inspection errors also exit with status 1. Do not retry as if the request succeeded. With `--json`, the error is an envelope on stdout.
- `navigation --json` retains `blockedReason` and `refusal` and adds `nextStep`. After `obstructed`, choose another route. After `height_unresolved`, try a different short heading or known grounded waypoint. After `ambiguous ground column`, choose a destination with one ground height. Do not guess Z or repeat an unsafe heading. No hint proves the next route safe.
- Configure `spell_data_dir`, `navigation_data_dir`, and `navigation_library` in the account config as needed. Supply `TYPESAFE_API_KEY` through the daemon environment, never through config or logs. `JEV_ENDPOINT_URL` (fallback `TYPESAFE_ENDPOINT_URL`) overrides the Jev endpoint. `JEV_FAULT` (`delay:<ms>`, `http:<status>`, `transport`) injects test faults and shows as `fault` in `tactics --json`; never set it for real play. Restart the daemon after changes. See `docs/manual.md` for the required build-12340 tables and the environment variables.

IPC: COMBAT, COMBAT_JSON, SPELLS, SPELLS_JSON, CAST, ATTACK, CANCEL_CAST, STOP_ATTACK, FIGHT, TACTICS, TACTICS_JSON, CYCLE, CYCLE_RESUME, CYCLING, CYCLING_JSON, GOTO, NAVIGATION, NAVIGATION_JSON.

## Ordinary death recovery

    tuicraft recovery [--json]
    tuicraft query-corpse
    tuicraft release-spirit
    tuicraft reclaim-corpse
    tuicraft spirit-healer <guid>
    tuicraft resurrect accept
    tuicraft resurrect decline

Use this four-step corpse run. Inspect state between requests. An `OK` reply records intent, not an observed life change.

1. Inspect `recovery --json`. Read `life`, `epoch`, `query`, `corpse`, `reclaim`, and `request`. Ghost flags outrank positive health. A release request or graveyard marker does not prove ghost state. If `life=unknown`, stop and report it.
2. If `life=dead`, issue `release-spirit` once. Wait for observed `life=ghost`. If already ghost, skip release. Never retry an unanswered release request.
3. Check `query` before calling `query-corpse`. If it is `unanswered` or `stale`, wait for the reply or report the unresolved query. If `corpse.status=found` in this epoch, use it without another query. If `corpse.status=absent`, stop. Otherwise, query once and await a found corpse for the same `epoch`. `corpse.status=unknown` is not `absent`. A stale reply cannot authorize this death. `query-corpse` does not change control ownership.
   - Check `corpse.mapId` against `corpse.corpseMapId` before travel. The first is the displayed map; the second is the actual corpse map. Stop if they differ.
   - Check `reclaim.pose.mapId` against `corpse.corpseMapId`. Stop on a map mismatch or an unknown pose.
   - If out of range, use short `face` and `move forward` legs toward the queried position. Recompute the heading from the current pose after each leg. Read `recovery --json` again. Stop if movement makes no progress or ground is unsafe. Do not use `goto` from a ghost; the ground planner has refused ghost poses.
4. Before reclaim, require observed ghost and a found corpse from this epoch. Require matching displayed, actual, and pose maps. Require `reclaim.distance <= 39` yards in 3D. A known positive `remainingMs` blocks reclaim. Missing `remainingMs` means unknown timing, not zero. When other guards pass, `reclaim.canRequest=true` with `readiness=unverified` permits one explicit request. This does not prove readiness. A `predicted` pose is not server confirmation. Its source alone does not block the request.
   - Reclaim can restore life beside the killer at partial health. Check `nearby --all --json` before reclaim. Its distances use the current control pose when available, but creature positions are last observations. Compare killer coordinates with the current `reclaim.pose`. If the killer is near, choose a clear escape heading. If no clear heading is known, report the risk rather than repeat a death loop.
   - Issue `reclaim-corpse` once, without a GUID. If the killer is near, issue `face` and a short `move forward` away immediately after `OK`. Do not pause to cast or inspect state first. Then inspect `recovery --json` for observed `life=alive`. If life is not observed, report the unanswered outcome. Do not retry reclaim automatically.
A current unanswered resurrection offer is a separate choice. Answer `resurrect accept|decline` once only for that offer. A known future offer delay blocks accept, not decline. Confirm observed life after an accept request.

`spirit-healer <guid>` is the explicit spirit-healer path. It requires observed ghost state and one observed creature whose NPC flags carry the healer bit (0x4000). It rejects an unanswered duplicate request, never auto-activates, and never reports success on intent. Server spirit resurrection may incur durability loss. Gossip option 0 stays silent for this path. After `OK`, inspect `recovery --json` for observed `life=alive`.

Mutating recovery actions stop tactics and motion. `halt` drops older queued recovery mutations. It cannot reverse a sent request. Command and inspection errors print `ERR` and exit with status 1. Human mode prints `ERR`; JSON mode returns an error envelope.

IPC: RECOVERY, RECOVERY_JSON, QUERY_CORPSE, RELEASE_SPIRIT, RECLAIM_CORPSE, SPIRIT_HEALER <guid>, RESURRECT accept|decline.

## Session record

    tuicraft record                     # whole session log
    tuicraft record --since 1790382736199

- Prints one JSON object (not an envelope; no daemon needed; rejects `--json`) derived from the CYCLE, TACTICS and RECOVERY events in the session log at or after `--since` epoch ms.
- `cycles[]`: one entry per `cycle` start or `cycle --resume`, with `kind`, `instruction`, per-target `status`/`cause`/`outcome`/`loot`, `recoveries`, `startsUsed`, `stopCause`, `stopDetail`.
- Totals: `fights` (runs started, outcomes by status and reason, lone `fight` runs included), `completions` (`targetsDone`, `serverKillCredit`), `blocked` (`targetsSkipped`, `skipsByCause`, and `cycleStops` for any stop other than `queue_exhausted`, `max_starts_reached`, `halt`, `manual_override`), `recoveries` (`deaths`, `recovered`, `byOutcome`), `interventions[]` (`halt`, `manual_override`, `resume`, `instruction_change` with `at` and `scope`), `staleActions` (discarded Jev results by reason).
- `latency`: `loopRatePerSec` (requests per active tactics second, with `meanRequestMs` and `p95RequestMs`) and `decisionRatePerSec` (requests that offered any candidate other than `wait`/`cancel`, counted in `decisionRequests`, per active second; `appliedDecisions` and `appliedWaits` alongside). Quote both together; the loop rate alone is not the decision cadence.
- A target resumed across runs counts once. GM and chat commands are not in these events; record them yourself.

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
- Auto-accept quests enter the log on `select-quest` while their details stay open. Check the log first: `accept-quest` fails with `quest_already_in_log` for a quest already there.
- Log flags/counters are server quest facts, not inferred inventory item counts. Initial/recreated log state does not fabricate acceptance.
- Item objectives stay 0 in the log counters. Run `query-quest <id>` after accepting, then watch `quests --json` `items` (required vs carried) and QUEST `progress` events with source `inventory` (`lastProgress.kind` `collect`: item push total matched to the observed bags). `itemPushes` holds pushes the bags have not caught up with. Completion is still the log slot flag.
- Unanswered query metadata stays unknown, not missing. Querying does not select a quest or permit mutation.
- Reward indices are zero-based, at most 5, and must exist in the current offer. Use 0 when there are no selectable choices.
- A server quest-complete reward notification establishes a reward fact. It does not prove that a requested inventory item was gained.
- Prove a turn-in's actual gains by comparing `inventory --json` (items, `coinage`) and `experience --json` (`xp`, `level`) before and after. `lastXp` and `lastLevelUp` are notices, not field changes.
- Abandonment slots are zero-based 0–24. An unknown or empty slot cannot authorize abandonment. The log must later show removal.
- `cancel-interaction` revokes current authorization and requests close. The old pending intent stays in `unresolved` until the quest log or a reward packet settles it; later cancels never drop it.
- Pending cancel blocks another mutation until observed close or a confirmed world reset. A late error/menu is not sufficient.
- HALT drops older queued conversational mutations, abandonment and cancellation. It retains quest metadata queries and newer requests.
- HALT cannot undo an already-sent request and is not proof of dialog closure.
- `OK` always means intent, never accepted/completed/rewarded/removed state. Inspect actual log and server notifications for those facts.
- Quest action and inspection errors exit with status 1. Human mode prints `ERR`; JSON mode returns an error envelope.

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
- Once a take or money clearance leaves the window with no items and no money, tuicraft sends the release itself, as the real client does: `loot.phase` goes `closing`, then `closed` on the server's release. Taking a subset leaves it open.
- `release-loot` requests close of an open window and can replace an unanswered take with close intent. Wait for observed release before replacement. On a window that is already closing or closed it sends nothing and returns OK.
- A release notification during opening can precede a valid full response, so `loot.phase` stays opening for up to 3 seconds after it.
- If no full response follows within those 3 seconds, the open fails: `loot.phase` returns to `closed` and `lastOpenFailure.reason` is `release_only`. An opening whose corpse despawns or leaves view fails the same way with `loot_source_unavailable` (`self_unavailable` if you die or leave the world). `loot` prints `Last open failed:` with the reason. Open the next corpse normally; no reconnect is needed.
- `release-loot` cannot close an opening; wait for the full response or the failure.
- HALT drops older queued loot mutations but retains inspections and newer requests. It cannot undo an already-sent request.
- Mutations stop prior control ownership through the manual override path. Inspections are readonly.
- Action and inspection errors exit with status 1. Human mode prints `ERR`; JSON mode returns an error envelope.

IPC: INVENTORY, INVENTORY_JSON, LOOT, LOOT_JSON, OPEN_LOOT, TAKE_LOOT, TAKE_MONEY, RELEASE_LOOT.

## Sending Messages

    tuicraft send "message"               # say (nearby players)
    tuicraft send -s "message"            # say, explicit
    tuicraft send -y "message"            # yell (wider range)
    tuicraft send -p "message"            # party chat
    tuicraft send -g "message"            # guild chat
    tuicraft send -w PlayerName "message" # whisper to player

`-w`, `-y`, `-g` and `-p` also work without `send` (`tuicraft -p "message"`).

Slash commands work too. `/r`, `/raid`, `/<N>` channel messages, `/quit`,
`/tuicraft` and unknown commands are said as plain text through `send`, slash
included; they only work in the TUI:

    tuicraft send "/yell message"         # long forms: /say /yell /whisper /guild /party /emote
    tuicraft send "/e waves hello"        # text emote
    tuicraft send "/dnd busy right now"   # toggle DND status
    tuicraft send "/afk grabbing coffee"  # toggle AFK status
    tuicraft send "/roll"                  # roll 1-100
    tuicraft send "/roll 50"               # roll 1-50
    tuicraft send "/roll 10 20"            # roll 10-20
    tuicraft send "/who mage"             # who search

## Reading Events

    tuicraft read                  # buffered events since last read
    tuicraft read --wait 5         # same, waiting up to 5s for the first event
    tuicraft tail                  # continuous stream (blocks, consumes nothing)

`read`, `read --wait` and `send --wait` share one cursor: each event is
returned once, so a later `read` never repeats it. `send --wait N` returns
only events that arrived after its send, waiting up to N seconds for one;
older unread events stay for the next `read`.

Add `--json` for structured output. `read --json` returns one envelope with
all event objects in `events[]`, including `events: []` when empty.
`tail --json` returns one envelope per event. Example event in `events[]`:

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
| WHISPER_FROM          | Incoming whisper                                 |
| WHISPER_TO            | Outgoing whisper confirmation                    |
| CHANNEL               | Custom channel message                           |
| EMOTE                 | Player emote                                     |
| SYSTEM                | System messages and unimplemented packet notices |
| ROLL                  | Random roll result                               |
| SERVER_BROADCAST      | Server broadcast message                         |
| NOTIFICATION          | Server notification                              |
| MAIL                  | Mail notification                                |
| ENTITY_APPEAR         | NPC/player/object appeared nearby (--json only)  |
| ENTITY_DISAPPEAR      | Entity left range (--json only)                  |
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
| GUILD_*               | Other guild events (MOTD, joined, left, promotion, signed on/off) |
| GROUP_*               | Group invite, list, leader change, kick, disband, command result |
| PARTY_MEMBER_STATS    | Party member health and level                    |
| DUEL_*                | Duel requested, countdown, complete, winner, bounds |
| COMBAT                | Combat state change; payload in `data`           |
| TACTICS               | Jev tactics loop event; payload in `data`        |
| CYCLE                 | Encounter cycle snapshot; payload in `data`      |
| RECOVERY              | Death and recovery event; payload in `data`      |
| QUEST                 | Quest dialog or log event; payload in `data`     |
| REWARDS               | Loot, inventory or reward event; payload in `data` |
| PACKET                | Server packet the client failed to parse; `data` has `opcode` and `error` |

The `channel` field appears on CHANNEL events only.

Entity events include `guid`, `objectType`, `name`, and type-specific fields like `level`, `health`, `maxHealth`, `x`, `y`, `z`. Field updates are not emitted as events.

The six gameplay events (COMBAT, TACTICS, CYCLE, RECOVERY, QUEST, REWARDS) have the shape `{"type":"CYCLE","data":{...}}`; `data.type` names the specific event.

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

    tuicraft send "/friends"                # show friends list (/f also works)
    tuicraft send "/friend add PlayerName"  # add friend
    tuicraft send "/friend remove PlayerName" # remove friend

IPC verbs:

    echo "FRIENDS" | nc -U "$SOCK"
    echo "FRIENDS_JSON" | nc -U "$SOCK"
    echo "ADD_FRIEND PlayerName" | nc -U "$SOCK"
    echo "DEL_FRIEND PlayerName" | nc -U "$SOCK"

## Ignore List

    tuicraft send "/ignore PlayerName"    # add to ignore list
    tuicraft send "/unignore PlayerName"  # remove from ignore list
    tuicraft send "/ignorelist"           # show ignore list

Messages from ignored players are filtered from chat display and daemon read output.

IPC verbs:

    echo "IGNORED" | nc -U "$SOCK"
    echo "IGNORED_JSON" | nc -U "$SOCK"
    echo "ADD_IGNORE PlayerName" | nc -U "$SOCK"
    echo "DEL_IGNORE PlayerName" | nc -U "$SOCK"

## Guild Roster

    tuicraft send "/groster"              # show guild roster

Displays MOTD, guild info, and all members sorted by online status. Shows rank, level, class, zone, and notes for each member.

IPC verbs:

    echo "GUILD_ROSTER" | nc -U "$SOCK"
    echo "GUILD_ROSTER_JSON" | nc -U "$SOCK"

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

    echo "GINVITE PlayerName" | nc -U "$SOCK"
    echo "GKICK PlayerName" | nc -U "$SOCK"
    echo "GLEAVE" | nc -U "$SOCK"
    echo "GPROMOTE PlayerName" | nc -U "$SOCK"
    echo "GDEMOTE PlayerName" | nc -U "$SOCK"
    echo "GLEADER PlayerName" | nc -U "$SOCK"
    echo "GMOTD New MOTD" | nc -U "$SOCK"
    echo "GACCEPT" | nc -U "$SOCK"
    echo "GDECLINE" | nc -U "$SOCK"

`MAIL` (and `/mail`) answers `UNIMPLEMENTED Mail reading`. The full socket verb
list, including chat, group and event verbs, is in `docs/manual.md` (Socket
Protocol).

## Nearby entities

    tuicraft nearby [--all]
    tuicraft nearby [--all] --json

Rules:

- Output is ordered nearest first.
- The `self` row is included at distance `0`.
- By default, entities beyond 100 yards or on a different map are filtered out when player position is known.
- 100 yards is the server's own visibility range, `DEFAULT_VISIBILITY_DISTANCE` in AzerothCore `src/server/game/Entities/Object/ObjectDefines.h:39`, not an arbitrary choice. That constant is documented as the continent value and `Map::GetVisibilityRange()` is configurable per map (e.g. 170 yards in instances, 250 yards in battlegrounds and arenas), so the default may not match an instance or battleground.
- The server sends transports for the whole map at login regardless of distance, and never culls them. They are the bulk of what `--all` reveals. Use `--all` to see a zeppelin, boat or elevator before it is within visibility range.
- Pass `--all` to output all tracked entities without distance or map filtering.
- When player position is unestablished, distance filtering is suspended.
- Use `guid` with `tuicraft target`.

`nearby --json` fields in each `data[]` entity:

| Field | Meaning |
| ----- | ------- |
| `guid` | Hexadecimal entity GUID (`0x…`). |
| `type` | Entity category: `unit`, `player`, `gameobject`, or `object`. |
| `name` | Entity name, or null if unobserved. |
| `entry` | Database template ID. |
| `self` | `true` only for the observed player character entity, `false` otherwise. |
| `distance` | 3D distance in yards from the player, rounded to 2 decimal places. `0` for self, `null` if off-map or player position is unestablished. |
| `horizontalDistance` | XY distance in yards, rounded to 2 decimal places, or `null`. |
| `bearingRadians` | Absolute angle from +X toward +Y in [0, 2π), for `face`; `null` when direction is undefined. |
| `turnRadians` | Shortest signed turn from current facing in [-π, π); `null` when direction is undefined. |
| `originSource` | `predicted`, `server`, `self_entity`, or `null`. |
| `originUpdatedAt` | Update time of the control pose, or `null` for the fallback. |
| `level`, `health`, `maxHealth` | Unit and player rows only. |
| `target`, `unitFlags`, `npcFlags`, `factionTemplate` | Unit and player rows only. `target` is a hex GUID. |
| `x` | World X coordinate in yards. |
| `y` | World Y coordinate in yards. |
| `z` | World Z coordinate in yards. |
| `mapId` | The map **this client was on when the entity was parsed**, stamped onto every entity by `handleUpdateObject`. It is not a per-entity property the server states, so do not treat it as authority for where an entity is. It differs from the player's current map only for entities left over from a previous map. |
| `orientation` | Facing angle in radians. |
| `gameObjectType` | Numeric GameObject type (e.g. 11 transport, 19 mailbox), present on gameobjects. Initialized to `0` at create time until `CMSG_GAMEOBJECT_QUERY` resolves. |
| `remotePose` | Other players only, when movement was received. Last received pose, never extrapolated: `x`, `y`, `z`, `orientation`, `mapId`, exact `flags` and `extraFlags` (unknown bits kept, `null` if the block had none), `moverTime` (mover's clock), `receivedAt` (local ms), `ageMs`, `source` (`observer`, `create`, `update`), `motion` (`moving`, `stationary`, or `null`) and `invalid` (`null`, or why the pose is not usable ground movement: flag problems, transport/flying/falling/swimming/spline modes, `teleport`, `knockback`, `time_skipped`, `malformed`, `transfer`, `map_changed`, `dead`). The last five keep the old position and `receivedAt`. |

TUI: `/tuicraft entities on|off` toggles entity event display.

IPC:

    echo "NEARBY" | nc -U "$SOCK"
    echo "NEARBY all" | nc -U "$SOCK"
    echo "NEARBY_JSON" | nc -U "$SOCK"
    echo "NEARBY_JSON all" | nc -U "$SOCK"

## Openclaw Integration

Complete example: forward party chat to an openclaw agent, filtering out the
agent's own character to prevent feedback loops. Each agent turn runs in the
background so the pipeline doesn't block.

    tuicraft tail --json \
      | jq -r --unbuffered '
          .events[]
          | select((.type == "PARTY" or .type == "PARTY_LEADER")
            and .sender != "Xia")
          | "\(.sender): \(.message)"' \
      | while IFS= read -r line; do
          openclaw agent --agent x \
            --message "$line" \
            </dev/null >/dev/null 2>&1 &
        done

Replace `Xia` with the agent's WoW character name and `x` with the openclaw
agent id. The agent can respond in-game with `tuicraft send -p "message"`.

To watch different event types, change the jq `select` filter after `.events[]`:

| Filter                    | Events                         |
| ------------------------- | ------------------------------ |
| `.type == "WHISPER"`      | Incoming whispers only         |
| `.type == "GUILD"`        | Guild chat only                |
| `.type != "SYSTEM"`       | Everything except system noise |
