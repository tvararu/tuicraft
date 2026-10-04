# Evals

An eval runs one scripted scenario against the live server: a throwaway
character, the [Pi harness](harness.md) in an Orca pane, a task typed to
the agent, and a grade from server-confirmed state. Evals are the live
proof for gameplay changes in core and the harness. The full design and
the whole catalogue are in
[the eval suite design](archive/2026-09-26-pi-harness-epic/eval-suite.md).

## Grading rules

**Server-confirmed checks only.** A check passes on server truth
(`soap truth`, the saved character row), a witness character's
observation, a server packet in the harness game log (a kill credit, an
item push, a quest-log counter), a verifier login, or, as a fallback, a
read-only GM console command at the end of the run. Never on the agent's
claim, a tool `DONE` or an intent result. When the task is a question, the
answer is graded against truth at the time of the answer, not at the end.

**Four verdicts.**

| Verdict | When |
|---|---|
| `pass` | Every check is met. |
| `fail` | A check is unmet, or the run shows a new failure. Only `fail` makes builder work. |
| `blocked` | A check is unmet because of a gap the scenario already names, a playerbot interference the grader quotes, or a game-log event that does not exist yet. |
| `aborted` | Infrastructure: SOAP or the realm service down, `soap create` or setup failed, a stale final truth, the game server down, an expired Codex login, model rate limits that stall the agent for more than 2 minutes, Jev down for the whole run, a pane or harness launch failure, or grader contamination. Never a product finding. |

**Efficiency.** Tool calls, agent turns, wall time from the task to the
accepted answer, time to the first action, and tokens, each also as a
ratio to the scenario budget. The budget's minutes are a hard stop; its
turns and tools are soft caps, so going over them is an efficiency
finding, not a fail.

**Friction.** What the agent struggled with, even on a pass. Each item
has a category (for example `wrong-tool`, `poll-loop`,
`false-success-claim`, `ignored-steer`), a severity (`blocker`, `major`,
`minor`), a verbatim quote with a reference, and an area (`tool`,
`event`, `prompt`, `panel`, `core`, `eval`). The categories are the
`friction` enum in `packages/harness/src/grader/eval-result.schema.json`.

**The grader is a human stand-in, not a coach.** It types only the task
and the scenario's scripted steers. One generic rescue nudge is allowed
when the run is stuck, and counts as an intervention. Any other help makes
the run `aborted` with the cause `grader_contamination`.

**Safety.** Eval characters are throwaway `soap create` characters that
never get a GM level. After the baseline, no service write, console
command or harness restart touches the character unless the scenario is
about it. The one console command the grader runs by itself is a `console`
check's read, after the final truth. Passwords never reach a transcript or
a result file.

## Run a scenario

Run evals from an eval worktree: an Orca worktree of the commit under
test, with Orca, the realm service, a Codex login and `TYPESAFE_API_KEY`
available. From its root:

```
mise eval run <id> --round <n>
```

`mise eval scenario` lists the round-1 scenario ids;
`mise eval scenario <id>` prints one scenario. The scenario files are in
`packages/harness/src/grader/scenarios/`. The run creates the accounts, sets them up, takes
the baseline truth, opens the harness in a pane with its default model and
thinking level, types the task and the
steers, ends on done, budget, stuck or abort, takes the final truth,
deletes the accounts and scans the run directory for a leaked password. Done means the agent answered and stayed quiet for 30 s with no harness run active; a turn that ends while a run is still RUNNING waits for the run to end or the scenario budget instead.
It waits up to 20 minutes while another run holds the same field;
`--no-wait` exits 1 at once instead. Add `--replica <n>` to run the same
scenario more than once in a round.

Each run writes `tmp/evals/<round>/<scenario>-<replica>/`:

| File | Content |
|---|---|
| `run.json` | The scenario, round, replica, head sha, start time and bot count. |
| `baseline.json`, `final.json` | Server truth before the login and after the logout. |
| `partner-baseline.json`, `partner-final.json`, `partner<N>-baseline.json`, `partner<N>-final.json` | Each second character's server truth before its start and after its stop; with `partners`, partner `N` writes `partner<N>-...`. A final truth that stays stale or online writes no file and adds a note. |
| `gamelog.jsonl` | The harness game log: every game event, one typed row. |
| `console.jsonl` | One row per `console` check: its `id`, whose character (`who`) and `account`, the read `verb` and `arg`, the exit `code` and the reply `text`. |
| `session.jsonl`, `tools.json`, `runs.jsonl` | The Pi session, tool calls and harness runs, as in [harness.md](harness.md#run-directory). |
| `packets.jsonl`, `packets.json` | Every game packet's header row and the counts by opcode: the grader starts the harness with `--packet-trace headers` ([harness.md](harness.md#run-directory)). |
| `steers.jsonl`, `triggers.jsonl`, `progress.json` | The steers sent, the triggers that fired and the watcher's view of the run. |
| `witness.jsonl`, `partner-read.jsonl`, `partner<N>-read.jsonl` | What the second character saw and read, when the scenario has one; with `partners`, partner `N` reads into `partner<N>-read.jsonl`. |
| `frames/` | Screen frames of the pane. |
| `grader/draft.json` | The measured draft: checks with what the run observed, efficiency, attempts and the run conditions, with no verdict. |
| `result.json` | The graded result. |

When the run ends `aborted` or `blocked` it writes `result.json` itself.
Otherwise the grader reads the draft and the evidence, decides each
check, the friction and the verdict against this document, and writes the
result with `mise eval result <run-dir> <file>`, which validates it
against the schema.

The run conditions list what else can make two results differ: the
model, the thinking level and the harness commit from the harness's
`meta.json`, the Jev models that answered in `jev.jsonl`, and a hash of
the scenario. Compare two results only when their conditions match, or
when the one condition that differs is the thing under test.

## Add a scenario

A scenario is one JSON file in `packages/harness/src/grader/scenarios/`,
named after its `id`. The grader loads every file there and validates it
against `packages/harness/src/grader/scenario.schema.json`; an invalid
file stops the grader with its file name and the schema errors. To add a
scenario, drop the file in and add its id to `ROUND_1` in
`packages/harness/src/grader/scenarios.ts`. A test fails while a file
sits in no round or a round names an id with no file. A scenario that
needs more than one second character sets `partners` instead of
`partner` ([The second character](#the-second-character)).

Each check has an `id`, a `source` and an `expect` text, which is for the
grader to read. The draft fills the check's `observed` from its typed
`evidence` or its `measure`, never from `expect`:

| `evidence` field | For | The draft shows |
|---|---|---|
| `truth` | `truth` checks | Baseline and final of the listed fields: `alive` (with `deathState`), `inventory`, `equipment` (the `inventory` rows of `bag` 255 and `slot` 0-18), `bank` (the rows of `bag` -1 and of `bag` 255 `slot` 39-73), `spells` (sorted), `level`, `money`, `quests` (with `rewardedQuests`), `totalXp` (with `level` and `xp`), `hearth` (`map`, `zone`, `x`, `y`, `z`), `reputation` (`faction`, `standing`, `flags` rows, sorted by faction), `mail` (`id`, `subject`, `money`, `items` rows, sorted by id; `items` is the attached item count) and `durability`. With `inventory`, `equipment` or `bank`, `durability` adds `durability` and `maxDurability` to their rows; alone, it lists the rows whose `maxDurability` is above 0. `hearth`, `reputation` and `mail` are `null` when the truth reply has no such field. With no `truth`, `items` or `point`, the whole truth summary. |
| `delta` | `truth` checks | Final minus baseline of `money` or `totalXp`. |
| `items` | `truth` checks | Baseline, final and delta counts, summed over every row, of each listed item id and of every item whose count changed. |
| `point` | `truth` checks | An `{ "x", "y" }` point: the final position and its 2D distance to the point, instead of the other truth fields. |
| `events` | `game_log` checks | The game-log rows of these events (`domain/name`; a trailing `*` matches a prefix): the count, the first and last match, the first 10 rows and the last row of the same domains. |
| `ids` | `game_log` checks | Only the rows of those events whose data holds one of these numbers. |
| `window` | `game_log` checks | A window `{ "steer"?, "after"?, "afterMs"?, "untilSteer"? | "forMs"?, "exceptNames"?, "max"? }`, with exactly one of `steer` or `after`: `steer` is the index into the scenario's `steers` where the window starts, while `after: { "event", "data"? }` starts the window just after the first game-log row of that event whose data holds every listed key and value (for example the `raid/roster` row with `change: leader` once the agent leads the group). `afterMs` is an offset in milliseconds after a steer start (ignored on an event anchor), `untilSteer` a later steer index that ends the window, `forMs` a duration after the start instead, `exceptNames` spell names to drop from `combat/cast` rows, and `max` the most matching rows the window may hold. A check with `max` drafts `met` when the window holds at most that many rows; without `max` the draft reports the window rows for the grader to judge. |
| `console` | `console` checks | A `{ "read", "arg", "match" }` read: after the final truth the grader runs `soap gm <ACCOUNT> read <read> [arg]` (`read` is one of `group`, `mail`, `pet`, `titles`, `reputation`, `pinfo`, `guild`, `arena`; `guild` needs the guild name and `arena` the team id as `arg`, and the others take none) and records the reply in `console.jsonl`. `match` is a regular expression, with `^` and `$` at line ends, over the reply text. The draft shows the verb, the exit code, the text and whether `match` matched; the check is met when it matched and the command exited 0. A missing row shows a `reason`. The grader never runs a verb other than `read`. Console text follows the server's strings, so use this source only when no truth field and no game-log row can grade the check. |
| `who` | `truth` and `console` checks | Whose character the other fields read: `agent` (the default), `partner` for the single partner, or `partner1` to `partner4` with `partners`. The scenario must have that character. When its baseline or final truth file is missing, a `truth` check adds a `reason` that names the missing file. |

A `measure` names a computed measure in
`packages/harness/src/grader/draft-measure.ts` (for example `kill_xp` or
`max_attackers`); on a check whose source is not `truth` it replaces
`evidence`.
A check with neither leaves `observed` null for the grader to fill.

`t6-selfstate-res` runs on the `eversong1-shaman` preset, a level-1 Orc
shaman. Its setup teaches Reincarnation (20608) and adds one Ankh
(17030), because the server only keeps a stored Reincarnation row for a
shaman and the spell needs the Ankh as its reagent. Its `alive` check
grades the first self-resurrection from the game log: it is met when a
`life/alive` row follows the first `life/dead` row with no `life/released`
between them. A later death, which the single Ankh cannot cover, does not
unmeet it.

## The second character

Scenarios with a `partner` or a witness (`t2-whisper-reply`,
`t0-who-is-near`) use a second throwaway character driven by the puppet,
a headless login with no model. `soap create` writes a launcher for each
account, `tmp/puppet-<ACCOUNT>`, and names it in the `.wrapper` field of
its JSON. The launcher sets the account's own config and runtime
directories and runs the puppet with its arguments. The grader drives it
by itself; a person can run the same commands through the launcher.

A scenario sets `partner` (`"partner"`, `"witness"` or `null`) for one
second character on the scenario's preset, or sets `partner` to `null`
and lists up to four `partners` as `{ "role": "partner" | "witness",
"preset": "<preset>" }`. The grader creates them in order as `partner1`
to `partner4` (`partner<N>-names.json`), puts them all on the partner start
point when the run has one, starts each one with `--packet-trace headers` and stops and
deletes every one at the end. The first `witness` is the one sampled
into `witness.jsonl`. A partner action runs on the partner its `actor`
names (1-based; the default is the single partner or partner 1), and its
`argv` replaces `<AGENT>` with the agent's character, `<PARTNER1>` to
`<PARTNER4>` with each partner's character and `<PARTNER>` with the
first. The grader reads each partner that has an action with `read
--json` while the actions run and once at the end. A partner `call` that waits on the agent (`tradeRequest`, `tradeRequestQuiet`, `tradeAnswer`, `tradeAccept`, `tradeAcceptOffered`) gets a timeout past the puppet's own wait for that method; other actions keep the default. A partner action that fails because the agent never answered (`unanswered`, `no_request`, `no_offer`, or an agent-waiting call killed by its own timeout) lands in `steers.jsonl` with `agentSilent: true` and the run grades on its checks, as do the trade calls that fail on the resulting missing trade for the same partner; any other partner failure aborts the run. A scenario lists
optional `partnerSetup` steps as `{ "actor" (default 1), "endpoint",
"body" }`; after the start point is placed, each step runs through
`soap setup` on its partner's account, so a partner can start with a
quest, an item or a level the agent's own `setup` cannot give it.

| Command | Used by | Behaviour |
|---|---|---|
| `start --json [--packet-trace off\|headers\|bodies]` | partner, witness (the grader passes `--packet-trace headers`) | Starts the puppet process and returns once the character is in the world. A trace other than `off` (the default) writes `packets.jsonl` and `packets.json` to the account's state directory, `tmp/factory-account-<ACCOUNT>/state/peon/`, which `soap delete` removes; `packets.jsonl` appends across starts. When a puppet is already running, the reply has `started: false` and the flag has no effect. |
| `send -w <name> <text>` | the `t2-whisper-reply` partner action | Whispers, and exits 0 on success. |
| `read --json` | partner, after the run (`partner-read.jsonl`) | Prints one JSON envelope whose `events` array holds the chat events since start, then drains them. |
| `nearby --json` | witness, sampled into `witness.jsonl` | Prints one JSON envelope whose `data` array holds the nearby unit rows. |
| `events --json` | area workers, to read what a partner was told | Prints one JSON envelope whose `events` array holds the game events since the last `events` as `{ at, event, hook }` rows, then drains them. `hook` is `group`, `guild`, `duel`, `notice`, `packetError` or `area`; an area row's `event` is `{ area, event }`, a packet error's is `{ error, opcode }`, and a bigint is a decimal string. Keeps the newest 1000 rows. Chat stays with `read`. |
| `call <method> [json-array]` | area workers, to drive a partner | Calls one allow-listed `WorldHandle` method from `puppet/calls.ts` with the JSON array as its arguments (a guid is a decimal string). Prints a result envelope naming the method, or exits 1 when the method throws, rejects, or returns an outcome whose `status` is not `ok` or `done`. |
| `raw <OPCODE> [hex]` | area workers, to send a client opcode that no handle method sends | Sends one packet: `OPCODE` is a `CMSG_` or `MSG_` name or `0x` hex, and `hex` an even-length body (empty by default). Needs a puppet started with `--packet-trace`. Prints a result envelope with the opcode name and body `size`. |
| `stop` | the run's finish | Logs out, waits for the server logout, and the process exits. |

## Which scenarios to run

For a change to gameplay behaviour in core or the harness, run the one or
two scenarios closest to it. Every scenario appears in at least one row.

| Change area | Scenarios |
|---|---|
| Navigation and movement (`travel`, routes, namigator) | `t1-walk-to-npc` |
| Combat and Jev (`engage`, spells) | `t3-ghostlands-kill`, `t7-halt-resume` |
| Quest marks, objective regions, greetings and sharing (look, journal, interact, group) | `t4-quests-find-giver`, `t4-quests-poi-walk`, `t1-quests-read-greeting`, `t1-quests-guard-directions`, `t8-quests-share`, `t8-quests-accept-shared` |
 | Quests (`interact` quest dialogs, quest log, rewards) | `t4-quest-first`, `t4-alliance-first`, `t4-quests-level-five` |
| Vendors and money | `t5-vendor-buy-goldshire` |
| Economy (`interact` buyback, bank, auction; `trade`; `mail`) | `t5-buyback-vendor`, `t9-trade-give`, `t9-trade-receive`, `t9-trade-swap`, `t9-trade-cancel`, `t9-bank-deposit`, `t9-bank-withdraw`, `t9-bank-slot`, `t9-mail-read`, `t9-mail-collect`, `t9-mail-send` |
| Chat and whispers (`social`, pushed chat events) | `t2-whisper-reply` |
| Social verbs (`social` emote, channels, inspect) | `t2-emotes-partner` |
| Nearby units and relations (`look`, entity state) | `t0-who-is-near`, `t0-hostiles` |
| Self state (level, money, bags, `journal`) | `t0-self-state` |
| Death and recovery (`recover`) | `t6-die-and-recover` |
| Self-state (recover how:self; spell mount/dismount) | `t6-selfstate-res`, `t9-selfstate-mount` |
| Stopping and steering (`stop`, the stop reflex, human messages while a tool runs) | `t7-halt-resume`, `t7-question-while-acting` |
| Alliance characters and map 0 | `t4-alliance-first`, `t5-vendor-buy-goldshire` |
| Login, the world session and the harness shell | `t0-self-state` |
| Items and gear (`gear`, `journal` bags) | `t8-items-equip-upgrade`, `t8-items-unequip`, `t8-items-move`, `t8-items-split`, `t8-items-open`, `t8-items-read`, `t8-items-ammo`, `t8-items-socket` |
| Game objects (`use`) | `t0-objects-read-shrine` |
| Game objects (area triggers) | `t4-objects-explore-fargodeep` |
| Spells (spell tool, stop on channels) | `t4-spells-cancel-aura`, `t4-spells-action-bar`, `t4-spells-stop-channel`, `t4-spells-unlearn-profession` |
| Reputation and hostility (journal reputation, reputation rows, unit relations) | `t4-reputation-gain`, `t0-hostiles` |
| Travel (`interact` bind, `travel` hearth and fly) | `t8-travel-bind-inn`, `t8-travel-hearth-home`, `t8-travel-fly` |
| Pets (pet, interact stable) | `t8-pets-command`, `t8-pets-spells`, `t8-pets-rename`, `t8-pets-abandon`, `t8-pets-stable`, `t8-pets-talent` |
| Talents (`talents`) | `t8-talents-spend`, `t8-talents-reset`, `t8-talents-glyph` |
| Vehicles (`vehicle`, `travel ride`) | `t8-vehicles-board`, `t8-vehicles-zeppelin`, `t8-vehicles-drive` |
| Instances and dungeon finder (`dungeon`) | `t9-instances-difficulty`, `t9-lfg-queue`, `t9-lfg-run` |
| Groups and raids (`group` tool) | `t9-raid-kick`, `t9-raid-convert`, `t9-raid-master-loot`, `t9-raid-ready`, `t9-raid-answer`, `t9-raid-summon`, `t9-raid-mark` |
