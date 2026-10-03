# Pi harness

The Pi harness is an interactive terminal agent that plays one World of
Warcraft 3.3.5a character. A model (by default `openai-codex/gpt-6-luna`
at thinking `off`) acts through its game tools. A human watches the same
terminal and can type to the agent at any time. The harness is built on
`@peon/core` and is the only way to play Peon. The eval scenarios
that grade it are in [evals.md](evals.md).

## Run it

1. Log in to Codex once with omp (`omp`, provider `openai-codex`). The
   harness reads that login and never refreshes it.
2. Make a throwaway character. The command prints a JSON profile that
   holds a password, so keep the file private:

   ```
   umask 077
   mise factory soap create eversong10 > "$XDG_RUNTIME_DIR/char.json"
   ```

   The character connects to the `host` and `port` in
   `~/.config/peon/config.toml` ([Play your own
   character](#play-your-own-character)), or to `localhost:3724` without
   one. A soap ledger JSON as a profile does the same.

3. Start the harness from the repository root:

   ```
   mise harness --profile "$XDG_RUNTIME_DIR/char.json"
   ```

   `mise harness` runs `bun packages/harness/src/entry.ts` with the same
   flags. `mise harness --help` shows the mise task, not these flags.
4. Type a task, for example `Kill one Springpaw Stalker north of town.`
5. Quit with Ctrl-D on an empty editor, with `/quit`, or with two Ctrl-C
   within half a second. The harness prints `Work complete. Logging out
   of the game.` and exits when the server confirms the logout, in up to
   30 seconds.
   Do not press Ctrl-C while it waits: that ends the harness before the
   logout. Then delete the character with
   `mise factory soap delete <ACCOUNT>`.

To check the profile, the lock and the Codex login without a game
connection, add `--check`. The harness prints one line and exits.

## Play your own character

A Peon `config.toml` is a profile too. Write the character you play
into `~/.config/peon/config.toml` (mode 600, since it holds the
password):

```
account = "<account>"
password = "<password>"
character = "<character>"
```

`host` (default `localhost`), `port` (3724), `language` (1, Orcish; 7 for
Alliance), `timeout_minutes` (30), `spell_data_dir`,
`navigation_data_dir` and `navigation_library` are optional. Then run:

```
mise harness --profile ~/.config/peon/config.toml
```

The harness guard in [Credentials and safety](#credentials-and-safety)
still applies: it refuses the protected accounts and the character
`Xiara`, whatever the profile.

### DBC files

`spell_data_dir` is a flat directory of client DBC files. Without one, or
without a file in it, the harness degrades to ids: unknown spells and
factions show as numbers, unit relations read `unknown`, and locks and area
triggers are not decoded. When `spell_data_dir` is set, `--check` prints one
warning on stderr for each file of the table below that is missing, and
still exits 0. With no `spell_data_dir` it prints no warning.

| File | Holds | Client archive (build 12340, enUS) |
|---|---|---|
| `Spell.dbc` | spell definitions | `enUS/patch-enUS-3.MPQ` |
| `SpellRange.dbc` | spell ranges | `enUS/patch-enUS-3.MPQ` |
| `SpellDuration.dbc` | spell durations | `enUS/patch-enUS-3.MPQ` |
| `SpellCastTimes.dbc` | cast times | `enUS/patch-enUS-2.MPQ` |
| `SpellRadius.dbc` | spell radii | `enUS/patch-enUS.MPQ` |
| `FactionTemplate.dbc` | unit friend and foe masks | `enUS/patch-enUS-2.MPQ` |
| `Faction.dbc` | reputation factions | `enUS/patch-enUS-3.MPQ` |
| `Lock.dbc` | lock requirements | `enUS/patch-enUS-3.MPQ` |
| `AreaTrigger.dbc` | area trigger volumes | `enUS/patch-enUS-3.MPQ` |
| `TaxiNodes.dbc` | flight master node positions and names | `enUS/patch-enUS-3.MPQ` |
| `GameObjectDisplayInfo.dbc` | object display bounds for reach | `enUS/patch-enUS-3.MPQ` |
| `TaxiPath.dbc` | flight path edges with list prices | `enUS/patch-enUS-3.MPQ` |
| `AreaTable.dbc` | zone names in summon rows | the first archive that holds it, in the order below |
| `SkillLine.dbc` | profession and skill names | `enUS/patch-enUS-3.MPQ` |
| `Talent.dbc` | talent ranks and prerequisites | `enUS/patch-enUS-2.MPQ` |
| `TalentTab.dbc` | talent trees by class | `enUS/patch-enUS.MPQ` |
| `GlyphProperties.dbc` | glyph spells and slot types | `enUS/patch-enUS-2.MPQ` |
| `GlyphSlot.dbc` | glyph slot types | `enUS/locale-enUS.MPQ` |
| `TaxiPathNode.dbc` | transport path nodes | `enUS/patch-enUS-3.MPQ` |
| `TransportAnimation.dbc` | lift animation offsets | `enUS/patch-enUS-3.MPQ` |
| `TransportRotation.dbc` | lift animation rotations | `enUS/patch-enUS-3.MPQ` |

The client resolves each file from the first archive that holds it:
`enUS/patch-enUS-3.MPQ`, then `enUS/patch-enUS-2.MPQ`, then
`enUS/patch-enUS.MPQ`, then the remaining locale, patch and base
archives. Extract each `DBFilesClient\<name>` from the `Data` directory
with an MPQ tool such as StormLib, following that order, and copy the files
into `spell_data_dir` unchanged; a rebuild gives the same bytes. Keep the
directory outside the checkout, for example `~/wow-data/dbc` beside the
navigation data: `tmp/` is scratch space and may be cleared.

The navigation data directory holds maps 0 (Azeroth), 1 (Kalimdor), 530 (Expansion01), 571 (Northrend) and the Deadmines; walking refuses on other maps. It is built with namigator's MapBuilder at the commit in `vendor/namigator/UPSTREAM`: `MapBuilder -d <client Data dir> -m <map name> -o <out dir> -t 8 -l 1`, which writes `<Map>.map`, `Nav/<Map>/` and BVH files; adding a map to an existing directory copies those and merges `BVH/bvh.idx` as the union of its file entries keyed by MPQ path, sorted, keeping the existing obstacle list (the BVH file names are content hashes, so shared files are identical).

## Flags

| Flag | Default | What it does |
|---|---|---|
| `--profile <path>` | required | The character to play: a soap session JSON, a soap ledger JSON, or a Peon `config.toml`. There is no default profile. |
| `--run-dir <path>` | `~/.local/state/peon-harness/runs/<utc>-<character>` | Where the run files go. The harness refuses a directory that already has `gamelog.jsonl`. |
| `--model <provider/id>` | `openai-codex/gpt-6-luna` | The model from Pi's bundled catalog. |
| `--thinking <level>` | `off` | The Pi thinking level. |
| `--no-connect` | off | Start without a game connection. Use `/connect` later. |
| `--wake on\|off` | `on` | When off, game events do not start an agent turn. |
| `--glyphs nerd\|unicode\|ascii` | `nerd`, or `PEON_GLYPHS` | The glyph set of the human UI. The model text never has glyphs. |
| `--stop-reflex on\|off` | `on` | When on, a short human message that starts with stop, halt, freeze or hold stops every action before the model reads it. |
| `--now-per-call` | off | Adds the `[now]` line before every model call, not only at the start of a turn. |
| `--log-entities` | off | Writes raw entity rows to the game log. |
| `--packet-trace off\|headers\|bodies` | `off` | `headers` writes one row per game packet to `packets.jsonl`; `bodies` adds each packet body in hex, including whisper and chat text. The login packet never has a body. The eval grader runs every eval with `headers`. |
| `--extension <path>` | none | Loads a Pi extension file; repeat it for more. See [Extensions](#extensions). |
| `--check` | off | Checks the profile, the extension paths, the lock and the Codex login, and warns about DBC files missing from `spell_data_dir`, then exits with code 0. |

The harness reads no `WOW_*` variable. Only `--profile` selects the
character.

## Credentials and safety

- **Codex login.** The harness reads the newest `openai-codex` login from
  omp's database (`~/.omp/agent/agent.db`), read-only. At start it prints
  `Codex login: valid until <time> UTC (omp).` When there is no login, or
  when the login expires in less than 10 minutes, it prints what to do
  and stops with exit code 3. Run omp once so that it refreshes the
  login, then start the harness again. If the login expires during a
  session, the next model call fails with the same advice. `/login` and
  `/logout` do not change the login that the harness uses.
- **Fight helper.** `engage` uses Jev for split-second fight decisions. Jev
  needs `TYPESAFE_API_KEY` in the environment. Without it, `engage`
  refuses with `no_combat_helper` and the footer shows a red `no-jev`
  chip.
- **Protected characters.** The harness refuses the accounts `ADMIN`,
  `DEITY`, `X`, `Y`, `AUCTIONHOUSE`, `TCFACTORY`, `TCPRESETS`, every
  account that starts with `RNDBOT`, and the character `Xiara`. There is
  no flag to override this.
- **One owner per character.** A lock file
  `~/.local/state/peon-harness/locks/<ACCOUNT>-<character>.lock`
  stops a second harness. A lock from a dead process is replaced.
- **Secrets.** No log, run file or tool result holds the password. The
  `social` tool refuses chat text that contains the account name or the
  password.

## Tools

The model uses only these game tools. Each result starts with a status
word (`DONE`, `PARTLY`, `RUNNING`, `UNCONFIRMED`, `REFUSED`, `FAILED`).
A result that is not `DONE` ends with a `Next:` step.

| Tool | What it does |
|---|---|
| `look` | Self, place, target, the running action, and the nearest units with short ids like `u7`; `find: object` lists game objects as `o<n>` with kind and quest, locked and busy flags; `find: flight_master` lists flight masters, also one that left view. When every hostile in view is gray, a line names the levels that still give XP and points at `travel` explore. |
| `travel` | Walks to a unit (`to: o<n>` reaches a game object), the corpse or a point, uses the hearthstone (`to: hearth`), flies to a discovered flight destination (`to: fly Silvermoon City`), rides a boat or zeppelin to a named stop (`to: ride Thunder Bluff`), explores in a direction, or unsticks. An explore for hostiles that walks its full distance without finding a non-gray hostile names the levels that still give XP and points at exploring further the same way.  A route across swim-depth water swims: the planner follows the liquid surface and the follower sends `MSG_MOVE_START_SWIM` on entering and `MSG_MOVE_STOP_SWIM` on leaving. An explore leg refused for an ambiguous navmesh column first retries the same point on the floor nearest the walker, then other distances on the same bearing, and one exhausted bearing counts as a single obstruction. |
| `engage` | Chooses a target, walks to it, fights it with Jev and loots it; the result line gives damage dealt and taken, avoided swings and refused spells. An unnamed engage that only sees gray hostiles refuses, names the levels that still give XP, and its `Next:` step travels to explore for non-gray hostiles. A named engage that cannot reach its target names another reachable hostile in view, or explores when none is in view. Near Tranquillien, targets on ziggurat tiers and cliff faces refuse as unreachable because the navmesh marks their steep faces as walkable ground while the planner rejects climbs steeper than its walkable slope; the agent explores for a reachable target instead. |
| `loot` | Loots one corpse, one slot at a time. |
| `interact` | Talks to an NPC (`npc: o<n>` talks to a quest-giver object): quests, gossip, buy, sell junk, buyback, train, repair, bind at an inn, reset talents at a class trainer (pays only up to `max_cost`), bank with a banker (open, deposit, withdraw, buy a bag slot); talking to a flight master lists the known destinations with their list prices. |
| `rest` | Eats and drinks until health and mana reach a percent. |
| `recover` | Comes back to life: corpse run, spirit healer, a resurrection offer, or `self` with a Soulstone or Reincarnation. |
| `social` | One chat message or one group action. |
| `talents` | Shows talents and glyphs and spends talent points; puts glyphs in slots or clears them. |
| `vehicle` | Takes a seat on a vehicle by walking to a unit and clicking it (`board`), leaves the seat (`leave`), changes seats (`seat`), asks to ride with a player (`ride_with`) and removes a passenger (`eject`). A seat request the server does not answer is `UNCONFIRMED` with the reason `no_answer`. |
| `journal` | Quest log, bags and gear, bank contents, spells, reputation, or the game log. |
| `gear` | Wears, takes off, moves, splits, opens and reads items. `gear move` with `to: bank` deposits the named carried item when the bank is open, else refuses with the `interact` deposit call. |
| `stop` | Stops one action or everything. |
| `use` | Uses a game object: opens a locked chest or quest object and takes what is inside, reads a shrine, plaque or book, presses another usable object, or fishes (`do: fish` casts Fishing, uses the bobber on the bite and takes the catch). |
| `spell` | Casts a spell on itself or a unit (`do: cast`), cancels one of its own buffs (`cancel_aura`) or puts a spell or item on an action bar slot (`bar`), or gets on a ground mount and off again (`mount`, `dismount`). |
| `pet` | Checks its pet (`status`), calls, dismisses or revives it, attacks with it, moves it (`follow`, `stay`, `stop`) or sets its stance. |
| `dungeon` | Difficulty, saved instances, resets, the bind prompt and the dungeon finder queue, role answers, proposal answers, teleports and kick votes. |
| `group` | Shows the group roster, removes a member, or passes the lead. |
| `trade` | Gives items and gold to another player, answers a trade request, changes the offer, accepts, cancels or reads both offers. |
| `mail` | Reads the letters waiting in the inbox, collects gold and items from them, or sends a letter with gold or items at a mailbox within 10 yards. |

`travel`, `engage`, `rest` and `recover` start a run (`r1`, `r2`, …).
Only one run can be active. The tool waits for the run to end and
streams its progress. When the human types, or after 120 seconds, the
tool returns `RUNNING`, the run continues, and a `[game]` message tells
the agent when it ends.

`UNCONFIRMED` means the game did not answer in time, so the action may or
may not have happened. It never permits a blind resend: a quest accept or
turn-in, a buy or sale, a chat line or a group action that goes
unanswered carries the reason `no_answer`, and its `Next:` step reads the
result instead (`journal`, `look`) or waits. The harness refuses the same
call again until a `look` or `journal` has checked.

**One knowledge model.** The tools, the screen and Jev may present facts
differently but never know different things. A unit out of view is shown
as last seen, with the state it had then (`last seen 40 yd N 2 min ago,
then dead, lootable`), never as if it were current. A fact the client
never observed reaches Jev as `null`, not a missing key. Data the client
derives rather than observes, such as navmesh terrain, inferred aggro
radii or names from the game files, is labelled as reference data or an
inference whenever a surface shows it.

The system prompt is in `packages/harness/src/prompt/system-prompt.ts`.
Each tool is one module in `packages/harness/src/tools/` built with
`defineGameTool`: its name, kind, parameters, description and usage
lines, minimal valid call, renderers, fallback and run. The `GAME_TOOLS`
list in `packages/harness/src/tools/registry.ts` registers them, orders
the tool notes in the prompt and supplies the minimal valid call that a
tool result gets after two schema failures in a row. A new tool is one
module, one entry in that list and its name in `ToolName`.

## Stopping the agent

- Type `stop` (or `Stop!`, `halt`, `freeze`, `hold`, at most five words).
  The harness stops every run and halts the character before the model
  reads the message.
- `/stop` does the same.
- `F9` or `Ctrl+\` does the same from any screen, in PLAY too.
- `Esc` aborts the model's turn. The harness then stops every run and
  halts the character.

Other human text while the agent works goes to the agent at the next
step. Action tools refuse until the agent reads it.

## When chat wakes the agent

A whisper, a party, raid, guild or officer line, and open chat that
names the character always start an agent turn, however many arrive in
a row: chat wakes are exempt from the wake guard. Other wakes still
pass through it: non-chat wakes share a bucket of three, repeat lines
from one sender are held back for 20 seconds, and repeated combat hits
stay limited to one wake per attacker every 30 seconds. Lines that
arrive together reach the agent as one message.

## Who controls the character

One owner holds the character at a time, ranked human, agent, loop.
While the human holds it, action tools refuse with `human_driving`.

- **Human.** The stop reflex, `/stop`, `F9` and `Ctrl+\` claim the
  character, stop every run and halt it. They hand it back at once
  unless the human already held it. PLAY holds it until `Esc`
  ([Drive the character yourself](#drive-the-character-yourself)).
- **Agent.** An action tool claims the character when it starts; the
  agent keeps it, with the runs its tools start, until its turn ends.
- **Loop.** A run still going when the agent's turn ends belongs to the
  loop until that run ends; another run ending does not free it. Action tools still work beside it, and a new run
  is refused as `busy` until it ends or the agent stops it.

The rule lives in `packages/harness/src/runtime/control-owner.ts`; the
core client only moves and fights when told to.

## Drive the character yourself

The harness has two modes. In TALK, today's default, the editor owns
the keyboard and you type to the agent. `F1` or `Ctrl+]` switches to
PLAY from anywhere: the harness takes the character for you, stops
every run, aborts the agent's turn if one is running, and the agent's
action tools refuse with `human_driving` until you hand back. The
takeover lasts until `Esc`; keys never claim the character again.

| Key in PLAY | What it does |
|---|---|
| `W` / `S` (or up / down) | Move forward / back while held |
| `A` / `D` (or left / right) | Turn left / right while held |
| `Q` / `E` | Strafe left / right while held |
| `Space` | Jump |
| `Tab` | Target the nearest living hostile in view; again for the next nearest |
| `1`–`0`, `-`, `=` | Use that slot of the character's action bar: a spell on the target, or on yourself when the spell does not aim at an enemy; an item from the bags. Other slot types are refused. |
| `F` | Talk to the target, or loot it when it is lootable |
| `Enter` | Back to TALK to type a message; you stop moving but keep the character, and `F1` resumes PLAY |
| `Esc` | Hand the character back to the agent |
| `F9`, `Ctrl+\` | Stop everything; you keep the character |

Held keys combine, so `W` with `A` walks in a curve. A terminal that
reports key releases (the kitty keyboard protocol) stops a key when you
let go. Other terminals only repeat a held key, so the harness keeps it
held for 0.6 s after the first press and 0.25 s after each repeat; the
indicator above the editor then marks the held keys `(estimated)`.
PLAY keys take no Ctrl, Alt or function-key combination except `F1`,
`Ctrl+]`, `F9` and `Ctrl+\`, so Pi's own keys such as Ctrl-C and
Ctrl-D keep working.

On `Esc` the agent gets one `[human]` note, shown in the session: how
long you drove, how far the character moved and whether that end pose
came from the server or the client's prediction, the targets you
picked, the slots and interactions you used, the game-log lines while
you drove (runs your takeover stopped, casts, kills, loot, quests,
chat), and the current HP, mana and target. Spell names there
and on the indicator come from the game files and say so, next to the
spell id. If the game connection closes while you drive, or the
harness quits, the takeover ends at once: the held keys are dropped,
the character is freed and the note says why. After a reconnect you
are in TALK and the agent holds nothing until someone claims it. The
note does not start a turn; the agent reads it on its next one. The mode is an ordinary Pi
extension in `packages/harness/src/drive/` that uses the world service
below.

## Extensions

The harness loads Pi extension files (`.ts` or `.js`, default export
`(pi: ExtensionAPI) => void`) besides its own. List them in the profile
as `extensions = ["..."]` in a `config.toml`, or as a top-level
`"extensions"` array in a soap session or ledger JSON, and add more with
`--extension <path>`. The profile's come first, then the flags', in
order. A relative path resolves against the directory of the profile
that lists it, or against the current directory for a flag. The
harness refuses to start when a path does not exist, and reads no
`extensions` from `~/.config/peon/config.toml` under a ledger profile.
Pi reports an extension that fails to load on screen.

An extension reaches the game through the world service, which the
harness's `world` extension publishes on `pi.events`:

```ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { WorldService } from "@peon/harness/world";

export default function (pi: ExtensionAPI) {
  let world: WorldService | undefined;
  const take = (data: unknown) => {
    world ??= data as WorldService;
  };
  pi.events.on("peon:world/1:ready", take);
  pi.events.emit("peon:world/1:request", take);
}
```

`peon:world/1:ready` carries the service when the harness loads it;
`peon:world/1:request` takes a callback and calls it with the service.
Subscribe, then request, and the service arrives whichever loads first.
Code inside the repository can call `onWorld(pi, use)` from
`@peon/harness/world`, which does the same. The service has
`version: 1`, and the types live in
`packages/harness/src/world/service.ts`.

- **Reads.** `world.current()` is the live session or `undefined`
  offline. `world.onSession(attach)` calls `attach(session)` now if
  online and again after every `/connect` or reconnect; the cleanup it
  returns runs when that connection closes. `session.reads` has the
  core state getters (`getControlState`, `getPlaceState`,
  `queryNearby`, `getActionBar`, ...). `session.events` has the core
  event subscriptions; they end on their own when the connection
  closes. Every read, event payload and game-log entry is a detached,
  frozen copy: changing it throws, and the game's own state never
  changes through it. A session reaches no writer, `close` or `logout`.
  `session.areas.<area>` has `state()`, a frozen copy of that code
  area's state, and `onEvent(cb)`, which also ends when the connection
  closes.
- **Writes.** Only a claim acts: `world.claim(owner, reason)` asks the
  control rule in [Who controls the character](#who-controls-the-character)
  for `human`, `agent` or `loop`, and returns `undefined` when a higher
  owner holds the character. `claim.act` has `move`, `drive`, `jump`, `face`, `faceGuid`,
  `stopMoving`, `selectTarget`, `cast`, `attack`, `stopAttack`,
  `cancelCast`, `useItem`, `talk`, the loot calls, `sendSay` and
  `sendWhisper`; each returns a promise. `claim.areas.<area>` has only the
  acts that the area's harness module lists in `worldActs`, under the
  same rules. Each claim is its own grant.
  A later claim by any owner at the same or a higher rank takes the
  character from it and stops every run, so the claim is lost for good:
  every send rejects with `not_owner`, and `claim.onLost` fires. A send
  while the connection is not online rejects with `offline`.
  `claim.release()` frees the character only while that claim still
  holds it, and ending the Pi session releases and loses every claim.
- **Also.** `world.connection()` and `world.onConnection`,
  `world.control.owner()` and `onOwner`, and `world.log.recent(n)` and
  `subscribe` for the game log.

## Commands

| Command | What it does |
|---|---|
| `/now` | Shows the last `[now]` line exactly as the model got it. |
| `/log [filter]` | Shows the last 20 game-log rows, filtered by words, `from:Name` or `domain:<name>`. |
| `/stop` | Stops every run and halts the character. |
| `/connect` | Connects to the game after `--no-connect` or a lost connection. |
| `/disconnect` | Logs the character out and keeps the harness open. |
| `/s` `/say <text>` | Says the text near the character. |
| `/y` `/yell <text>` | Yells the text. |
| `/p` `/party <text>` | Writes to the party. |
| `/g` `/guild <text>` | Writes to the guild. |
| `/o` `/officer <text>` | Writes to the guild officers. |
| `/ra` `/raid <text>` | Writes to the raid. |
| `/e` `/em` `/me` `/emote <text>` | Does a custom emote, such as `/me waves`. |
| `/w` `/whisper` `/t` `/tell <name> <text>` | Whispers a player. |
| `/r` `/reply <text>` | Whispers the last player who whispered the character. |
| `/1` `/2` `/3` `/4` `/5` `/6` `/7` `/8` `/9 <text>` | Writes to the joined channel with that number. |
| `/wake on\|off` | Turns game-event wakes on or off. |
| `/snapshot <label>` | Writes the current world state to `snapshots/<label>.json` in the run directory. |

The chat commands use the game's slash names. With no text, a chat
command shows its usage. `/r` says so when nobody has whispered the
character yet, and guild or officer chat from a character with no guild
shows the game's `You are not in a guild.` line instead of sending.

Pi's own commands (`/new`, `/resume`, `/fork`, `/reload`, `/model`, …)
also work. The game connection stays open across `/new`, `/resume`,
`/fork` and `/reload`.

## Screen

- **Footer (4 rows).** Your unit frame, the target, place and money, and
  a chrome row: model, thinking, context, wake, glyph set, log rows,
  unread whispers, and red chips for a missing helper (`no-jev`,
  `no-nav`, `no-factions`, `no-spells`). The footer shows the same facts as the
  `[now]` line.
- **Ticker (6 rows, above the editor).** The live run, then the newest
  game events, also the ones that do not wake the agent. Emote notices
  the core does not parse yet are left out.
- **Event cards.** Each `[game]` message is one line per event with a
  glyph, the time and the text, oldest first. Kills, XP and loot inside
  an `engage` run that ends `DONE` or `PARTLY` are reported by its
  result, not as separate lines.
- **Human-only lines.** Packet errors, server corrections and not-yet-built
  notices. The model never sees them.
- **Tool rows.** Each tool call shows one call line and a short result.
  Press `ctrl+o` to expand a result. Run tools redraw their progress
  while they work.
- **Title and working line.** The tab title shows danger, for example
  `AGGRO`. The working line shows the run in game words, or `Work,
  work…` while the agent works with no run.
- **Voice lines.** `/connect` answers `Ready to work!`. These lines, the
  title and the working line are for the human; the model never sees
  them.

Use a terminal font with Nerd Font glyphs for `--glyphs nerd`. Use
`unicode` or `ascii` in other terminals.

A proposed redesign of the screen lives at
[docs/plans/2026-09-27-terminal-ui-design.md](plans/2026-09-27-terminal-ui-design.md).

## Run directory

| File | Content |
|---|---|
| `meta.json` | Version, git sha, account and character (no password), model, thinking, glyph set, flags, start and end, exit reason, capabilities. Every exit writes `endedAt` and `exitReason`: `quit` (Ctrl-D, `/quit`, two Ctrl-C), `sigterm`, `sighup`, `sigint` (Ctrl-C during the logout) or `fatal_error`. Only a SIGKILL leaves both empty. |
| `gamelog.jsonl` | Every game event as one typed row (`domain/event`). |
| `jev.jsonl` | Every Jev call and every fight-loop event; see [Jev log](#jev-log). |
| `session.jsonl` | A link to the current Pi session file in `pi-sessions/`. |
| `tools.json` | Calls, status words, validation errors, repeat refusals and timings per tool. |
| `runs.jsonl` | One row per run when it ends. |
| `status.json` | Agent state, active run and last progress, written every second. |
| `packets.json` | Packet counts by opcode name (`seen` and `unhandled` from the server, `sent` by the client) summed over every game session, and `sessions`. Written when each session closes, whatever `--packet-trace` says. |
| `packets.jsonl` | With `--packet-trace headers` or `bodies`: one row per packet with `at`, `dir` (`in` or `out`), `opcode` (name, or hex when unnamed), `size` (body bytes), `outcome` for `in` rows (`handled`, `unhandled`, `error`, or `skipped` for a dropped inner move), `via: "compressed"` for a packet inside `SMSG_COMPRESSED_MOVES`, and `body` with `bodies`. Rows are appended at most once a second. |
| `snapshots/` | Files from `/snapshot`. |
| `workspace/` | The empty working directory of Pi. |

## Jev log

`jev.jsonl` is a complete record of every Jev call, on in every run. Use
it to debug one bad decision: see the state Jev was shown, what it
answered and what happened next, then replay that call.

Every row has `type`, `runId` (one fight loop) and `ts`. The rows of one
call also share `call`, which counts from 1 in each `runId`.

| `type` | Content |
|---|---|
| `started`, `activated`, `stopped` | A fight loop's target, instruction, framing and fault marker, then its start and end reason. |
| `request` | `call`, `observation` (the state Jev sees, `unavailable` included), `candidates`, `instruction`, `framing`, `characterClass`, `sentAtMs`. |
| `exchange` | `call`, `model`, `instructions` (Jev's question), `framing` (the sentence sent, if any), `status`, `elapsedMs`, and `response` (the parsed body, or its text when it isn't JSON) or `error` when no answer came back. |
| `result` | `call`, `choice`, `probabilities`, `confidence`, `model`, `inputTokens`, `elapsedMs`. |
| `applied`, `discarded` | `call` and the action taken, or why it wasn't (`stale_age`, `unavailable`, `aborted`, ...). |
| `transport` | A failed call or loop: the `error` (`jev_timeout`, `TypeSafe HTTP 503`, ...), with `call` when it was one call. |
| `outcome` | How the fight ended, with the last `observation`. |

A call that times out still gets its `exchange` row, and its `result`
and `discarded` rows, when the answer arrives late. No row holds the API
key, an auth header or the endpoint URL. One call's rows take about
13 KB, nearly all of it the `request` row. A fight makes about 4 calls a
second, so an hour of nonstop fighting writes about 180 MB; time out of
a fight writes nothing.

To replay one call, give its `runId` and `call`. The body is the one
Peon sent:

```sh
jq -c --arg run "$RUN" --argjson call "$CALL" -s '
  map(select(.runId == $run and .call == $call))
  | (.[] | select(.type == "request")) as $q | (.[] | select(.type == "exchange")) as $x
  | {model: $x.model,
     questions: {action: {criteria: ($q.candidates | map({(.id): .description}) | add),
                          instructions: $x.instructions, type: "choice"}},
     state: ($q.observation + {standingInstruction: $q.instruction}
             + if $x.framing then {framing: $x.framing} else {} end)}' jev.jsonl \
| curl -s https://api.typesafe.ai/v1/systemone -H "Authorization: Bearer $TYPESAFE_API_KEY" \
    -H 'Content-Type: application/json' -d @-
```

## Exit codes

| Code | Cause |
|---|---|
| 0 | Normal exit, or `--check` passed. |
| 2 | Bad flags, a bad or protected profile, or a held lock. |
| 3 | No Codex login, or the login expires in less than 10 minutes. |
| 1 | A fatal error. `meta.json` says `fatal_error`. |
| 130 | SIGINT, for example Ctrl-C while the harness waits for the logout. `meta.json` says `sigint`. |
| 129, 143 | SIGHUP or SIGTERM before Pi has started. After Pi starts, both log out and exit 0. |

## Live smoke: the 120-second yield

Check that a run tool which lasts more than 120 seconds gives control
back to the agent. Use a throwaway character that stands far from its
goal, for example `eversong10`.

1. Start the harness as in [Run it](#run-it).
2. Type a task that walks for more than two minutes: a travel to
   coordinates at least 900 yards away on ground the character can
   reach, for example `Travel to <x>, <y>.` `travel` does not take
   place names. `rest` stops after 30 seconds, so it cannot show the
   yield.
3. Do not type while the run goes on. After 120 seconds the tool result
   starts with `RUNNING r<n>:` and gives HP, mana and position. Its
   next step is `end your turn; a [game] message comes when r<n> ends.
   Or stop(run: "r<n>").`
4. The agent ends its turn. When the run ends, a `[game]` message
   wakes it.
5. `gamelog.jsonl` has `nav/route_start` and `nav/route_end` rows (or
   `nav/refused`) with the run id, and `runs.jsonl` has the run.
