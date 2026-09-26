# Roadmap: a programmable, AI-playable WoW client

Date: 2026-09-20. Condensed 2026-09-24. Audited 2026-09-26 against `main` at
`90c148a`, the committed records in [docs/evidence/](evidence/) and git
history ([#110](https://github.com/tvararu/tuicraft/issues/110)).

## Status

Acceptance is the maintainer's call. The verdicts below state what the
committed evidence supports; they accept nothing. Detail lives in each
milestone section and in the linked records.

| Milestone | Verdict on committed evidence | Recorded decision |
|-----------|-------------------------------|-------------------|
| [1. Evidence baseline and direct control](#1-evidence-baseline-and-direct-control) | Partly met: no committed record of target selection and clearing | None |
| [2. A constrained Jev-controlled encounter](#2-a-constrained-jev-controlled-encounter) | Partly met: two exit criteria unmet | Accepted with two gaps, `609f814` |
| [3. Movement as a tactical action](#3-movement-as-a-tactical-action) | Partly met: two exit criteria unmet | Accepted with two gaps, `001882d` |
| [3a. Reliable local navigation](#3a-reliable-local-navigation) | Partly met: one route walked, refusals and a clean halt recorded; repeated traversal, redirection, unreachable reporting, ground-derived destinations, the funnel corner and bounded replanning missing | None |
| [3b. Remote movement and character following](#3b-remote-movement-and-character-following) | Not started; follow was deleted in `05ee035` | None |
| [4. Repeatable encounter cycles](#4-repeatable-encounter-cycles) | Evidence recorded as met, awaiting the maintainer's acceptance | `7da1f02` ("Accept M4 exit evidence"); its roadmap text was hedged to "met" in `13ca530` |
| [5. A selected questing loop](#5-a-selected-questing-loop) | Not started; quest protocol code is on `main`, with no live record | None |
| [6. Sustained supervised play](#6-sustained-supervised-play) | Not started | None |

The next slices for 3a, 3b, 5 and 6 are listed in their sections as
live-verifiable work, ready to become issues. The
[Pi harness](#candidate-epic-the-pi-harness) is a candidate epic, not a
milestone.

## The ambition

Grow tuicraft from a terminal chat and world-observation client into a fully
working, programmable WoW 3.3.5a client that a player or an LLM can use to play
the game.

The control interface does not have to be conversational or especially high
level. Keybindings, target selection, slash commands, and structured CLI or IPC
commands could all work. A player might select a mob and invoke an action, steer
directly, or enable a bounded Jev-assisted behavior.

The ambition is to make the game playable and let Jev handle useful
moment-to-moment decisions, not to require a natural-language planner. Commands
such as "kill that mob" or "go to Silvermoon" illustrate possible intentions;
supporting those exact phrases or automatically decomposing arbitrary requests
is not a prerequisite. The appropriate level of manual control and automation
remains to be designed.

This requires much broader protocol support: movement, combat, spells, auras,
loot, death and recovery, NPC interactions, quests, inventory, and the other
capabilities needed to actually play. These are not merely opcode checkboxes.
They must work together, against the real server, to a standard worth merging
into tuicraft.

## Current priorities and ownership

Agents own implementation, engineering decisions, review and integration.
Success means the client can actually play WoW and respects the protocol, not
that the user has read and approved the code. Agent-playable capabilities come
first; human-facing usability and the spatial TUI follow user feedback. Play as
soon as a useful capability exists, and let real gameplay expose gaps. Only one
agent controls a given character at a time. The working rules live in
[AGENTS.md](../AGENTS.md).

## The new ingredient: TypeSafe and Jev

TypeSafe's Jev provides fast, typed judgments over application state rather than
generating a conversational response. Code supplies observations and questions;
Jev returns choices, probabilities, and scores that code can use directly.

That makes a different control model plausible:

- A player or LLM supplies actions, targets, modes, or objectives through an
  appropriate interface; natural-language instructions are one possibility.
- Tuicraft maintains the world model and turns the current control context into
  observations, available actions, and questions suitable for Jev.
- Jev makes frequent tactical decisions, targeting roughly 1–5 decisions per
  second: move, cast, kite, interact, accept a quest, or take another available
  action appropriate to the objective.
- Tuicraft executes those decisions and observes what actually happened.

The Doom demonstration is the conceptual reference: a harness gives Jev a
structured account of what the player sees, and Jev can play through repeated
bounded decisions. Tuicraft can obtain its observations directly from the WoW
protocol rather than interpreting screenshots.

Jev is intended to be a meaningful part of gameplay control, not an ornamental
classifier attached to an otherwise hardcoded bot. We should not build a fixed
priest grinding script and then use Jev only to approve its decisions.

## A spatial terminal client

Tuicraft is still a TUI, not just an automation service with a chat box. The
earlier [TUI vision](plans/2026-02-20-tui-vision-design.md) explores a top-down,
Dwarf Fortress-inspired world display. A Dwarf Fortress or NetHack-like view
remains a useful direction: make nearby entities, spatial relationships, and
character state legible in the terminal.

That view could support keyboard navigation, inspection, target selection, and
actions alongside chat or slash commands. Direct control and Jev-assisted
behavior should fit into the same client; a natural-language command layer is
not required to make it useful.

The older document is design context, not a commitment to its exact rendering
approach, map scale, or implementation sequence. Presentation details and
controls remain open. The spatial TUI and programmatic interface should share
the underlying world state and action capabilities without requiring an LLM to
interpret the rendered screen.

The [Pi harness design](plans/2026-09-25-pi-harness-design.md) proposes one
shape for this: tuicraft embeds the Pi agent runtime under Bun, owns the
world session in-process, and renders live panels such as the map alongside
the agent conversation. The CLI and daemon stay as a second shell over the
same core. It is a candidate epic, not an approved milestone; see
[below](#candidate-epic-the-pi-harness).

## Proposed runtime boundaries

These boundaries express the architecture we are aligning on. Exact interfaces,
task representations, and scheduling policies remain to be designed.

### Protocol and authoritative world state

Decode server messages, send valid client messages, and maintain enough state to
understand entities, movement, spells, combat, interactions, and task progress.

Keep observed facts distinct from predictions and missing information. Sending a
packet does not prove that movement completed, a spell succeeded, loot was
received, or a quest was accepted. Server responses and resulting state changes
must establish those outcomes.

### Action capabilities

Expose reliable operations for movement, facing, targeting, casting, interacting,
and the other supported activities. Direct player commands and automation should
use the same underlying capabilities.

Actions need understandable outcomes, failure behavior, and cancellation. Some
are instantaneous; others continue over time. Repeatedly choosing to move should
not require repeatedly restarting the same movement operation.

### Observations for decisions

Provide compact, relevant snapshots containing the active objective, nearby
actors, relationships, threats, resources, current actions, and recent outcomes.
Make the available action choices explicit.

Keep exact work in code: distance calculations, cooldowns, resource costs,
protocol encoding, and navigation geometry. Jev supplies contextual judgment,
not arithmetic or invented coordinates, spell IDs, or entity identifiers.

### Control state and the tactical loop

Retain the context needed for the chosen control mode: a selected target,
current action, enabled behavior, or objective. Where automation runs across
multiple decisions, track its progress and completion or failure rather than
treating each observation as an unrelated prompt.

Jev should be able to change tactics as circumstances change. The same action
capabilities should support different behavior under different controls or
instructions, without adding a bespoke state-machine branch for every
preference. Manual actions and bounded automation are valid starting points.

We have not selected a task language, workflow compiler, or internal planning
framework, and none is a prerequisite for this ambition. A richer high-level
interface can be considered if it proves useful.

### Execution, interruption, and supervision

The 1–5 Hz ambition applies to tactical decisions, not necessarily to network
packets, movement updates, or local control loops. Those can operate on their own
cadence while Jev decides what to do next.

Before applying a result, check that it still belongs to the active task and is
valid in the current world. A target may have died, a cast may have started, or
the player may have changed instructions while the request was in flight.

Human stop and override must not wait for inference. Late responses, service
failures, and uncertain choices need explicit behavior. Navigation, execution,
and protocol correctness must not depend on Jev always responding quickly or
choosing correctly.

## The other problem: making this work landable

The project slowed down largely because human review time was scarce. Producing
another large branch of plausible agent-written code would not solve that.

### How work lands

Every change reaches `main` through a pull request with green `signoff/ci`,
`factory/ci` and `factory/review` statuses, and lands as one squash commit. The
[dev factory](factory.md) takes issues the maintainer moves to Ready on the
project board through a worker, a reviewer and a merger. Work from outside
the factory goes through the same reviewer and merger: an issue with
`## Acceptance criteria`, a `factory/<N>-<slug>` branch, a PR with `Fixes #N`
and a `## Proof` section, then the issue's card in In review. The procedure is in
[AGENTS.md](../AGENTS.md) under Commits. There are no releases. A merged PR does
not accept a milestone; that stays the maintainer's call.

### What an increment provides

- A bounded behavior contract grounded in protocol definitions and server code.
- An implementation that uses existing conventions without gratuitous refactors.
- Focused regression coverage for meaningful behavior and failure cases, plus
  the project's type-checking, formatting, and test gates.
- Live-server verification of the claimed behavior, with inspectable evidence.
- Independent review against the contract, not just a general request to look
  for bugs.
- A compact account of what changed, what was exercised, and what remains
  unsupported, packaged as a landed change.

For example, "cast a spell and correctly observe success, rejection,
interruption, and resource changes" is a capability. "Added several opcodes and
the tests pass" is not enough to establish it.

Protocol correctness and decision quality need separate evidence. Captured
observations and outcomes can support reproducible protocol regressions and Jev
scenario evaluations. Live runs establish whether the pieces actually work
together. Neither high code coverage nor multiple agents agreeing is sufficient
proof on its own. Committed evidence lives in [docs/evidence/](evidence/);
evidence that exists only in `tmp/` is gitignored and satisfies nothing.

## Milestones

These are the agreed high-level milestones. Each contains smaller,
independently reviewable increments. Define concrete scenarios and acceptance
criteria before starting an increment, then preserve useful scenarios as
capabilities grow.

The key sequencing decision was to prove a real Jev-controlled encounter before
completing general navigation. Do not implement the entire protocol surface
before testing whether the observation/action boundaries support the intended
control loop.

A "next slice" below is a proposal for an issue, not a new acceptance
criterion. Each names its live scenario and the observable, server-confirmed
evidence that would close it. Closing every slice in a section does not by
itself accept the milestone.

### 1. Evidence baseline and direct control

Establish repeatable live scenarios and a compact record of what was verified.
Build reliable player/entity observations, basic movement and facing, target
selection, and immediate cancellation through the programmatic interface.
Retain a way to inspect state and stop actions; a new spatial display and
polished human controls are not required.

Confirm early that compatible game, ability, and navigation data can be obtained
and used reproducibly for the chosen scenarios. Full terrain rendering and
general pathfinding are not prerequisites here.

**Exit evidence:** an agent can move through a small known area, select entities,
stop, and confirm the resulting state. Demonstrate who owns control, how an
external stop overrides it, and how action outcomes are established. Local
checks, live evidence, and independent review remain distinct.

Missing two-account test credentials block scenarios needing those accounts, not
unrelated single-character capabilities. Never substitute a normal login for
evidence that the two-account suite passes.

#### Status: partly met on committed evidence, no acceptance decision

- The 2026-09-20 direct-control run with Xiara (movement leases, HALT,
  facing, requested versus observed target, target clearing, same-socket
  READ_WAIT cancellation, relogin pose within about `0.000081` yards) is
  described in the roadmap at `1e73c0b`, with an independent review recorded
  there. Its command records were written to `tmp/xiara-m1*.json`, which is
  gitignored, so by this document's own rule they satisfy nothing.
- Later committed records cover the movement, stop and confirmation strands:
  [m3/lease-expiry-and-cli-refresh-caveat.json](evidence/m3/lease-expiry-and-cli-refresh-caveat.json),
  [m3/position-confirmation.json](evidence/m3/position-confirmation.json)
  (relogin pose within about 0.0003 yards) and
  [m2/cancellation-reproof.json](evidence/m2/cancellation-reproof.json)
  (external `halt` stopping a Jev loop).
- Fault paths run as committed live tests in `src/test/live.ts`
  (`1c06e0b`): forced `.tele`, `.freeze`/`.unfreeze`, and WHO pipelined with
  HALT on one socket. See
  [2026-09-21-fault-paths-live-plan.md](plans/2026-09-21-fault-paths-live-plan.md).
- The `0x4` authentication failures were a client defect, fixed in
  `486da85` (`fix: Serialise SRP values at fixed byte width`).
- **Missing:** a committed record of requested versus observed target
  selection and clearing. No file under `docs/evidence/` records it.
- Open and unexplained: one run failed `party management > invite, accept,
  leader transfer, leave` with a 30-second timeout and no auth error. It
  passed in the later run recorded in the
  [M2 evidence](evidence/m2/README.md); one pass does not close it.
- Deferred with reasons: transport boarding (the client never sets
  `MOVEMENTFLAG_ONTRANSPORT`), flight and knockback.

### 2. A constrained Jev-controlled encounter

Implement enough combat for a genuine encounter in a small, known area with a
narrow ability set. An external agent selects a target or enables a behavior;
Jev repeatedly chooses among meaningful tactical actions using current
observations. Tuicraft executes and observes the results.

**Exit evidence:** complete repeated live encounters without tactical commands
from the supervising agent. Change instructions or circumstances and demonstrate
appropriate changes in behavior. Exercise cancellation, delayed responses,
obsolete decisions, and model unavailability. Record the actual decision cadence
rather than assuming sustained 5 Hz.

Choosing attack once and waiting for a hardcoded rotation to finish is not this
milestone. Conversely, a complete combat system, every class, and general route
planning are not required. Explicitly stopping on an unsupported outcome is
acceptable here if that boundary is part of the agreed scenario.

The first encounter increment will record at least five completed encounters in
the selected Eversong area, including server-confirmed kill credit or experience.
Use at least two standing instructions and retain observations, offered actions,
Jev choices, execution outcomes, and measured request latency. The supervising
agent may select encounters, but must not supply tactical commands during them.
Failed attempts and interventions remain part of the record.

#### Status: accepted with two gaps (Theo, `609f814`)

The design context is
[2026-09-21-m2-encounter-context.md](plans/2026-09-21-m2-encounter-context.md);
the records and their analysis are in [docs/evidence/m2/](evidence/m2/README.md).

- Five autonomous encounters with server kill credit, after the probability
  renormalisation in `3e1f3aa` and the ground-height repair in `c406db9`.
  Earlier failed attempts are kept in the same directory.
- Cadence is two numbers, quoted together: a loop rate of 3.76–3.88 requests
  per second at 256–264 ms average latency, and a tactical decision rate of
  0.49–0.67 per second. Between 64 and 86 per cent of decisions offered only
  `wait` and `cancel`. No report may present the loop rate alone as the
  decision cadence.
- Faults ran live: `stale_age` and `jev_timeout` discards, an obsolete
  decision discarded as `aborted`, `TypeSafe HTTP 503` and `fetch failed`.
  See the [fault runbook](evidence/m2/fault-runbook.md).
- Limits found live: halting a fight does not disengage the enemy; the client
  does not chase a leashing creature and has no collision sensing; an
  aggressive Crazed Dragonhawk (faction template 7) is refused as
  `unverified_hostile_relation` and killed the character repeatedly. `goto`
  failed with `UNKNOWN_HEIGHT`; the Detour `dtPointInPolygon` explanation is
  a hypothesis from observations, not an upstream-confirmed fact.
- Not blocking: `src/wow/jev.ts` validates `output_tokens` and then discards
  it, and the tactics bounds `DEFAULT_MAX_AGE_MS`, `DEFAULT_INTERVAL_MS` and
  `DEFAULT_TIMEOUT_MS` in `src/wow/tactics.ts` have no recorded derivation.

**Unmet: demonstrate behaviour change from instructions.** Encounters 04 and 05
are one unreplicated pair; the whole difference is one Mind Blast and one
shield choice. Closing it needs two or three more pairs at comparable level
against comparable creatures. The instruction texts are in the two records;
the file that pinned them, `src/wow/standing-instructions.ts`, was deleted in
the 2026-09-24 review.

**Unmet: planner verification on the funnel corner.** A 62-yard direct
corridor was verified with wrong-floor and obstructed rejections. The 20-yard
funnel corner was not reached. This criterion moved to milestone 3a.

Neither gap is to be read as satisfied. A later reader deciding whether to
trust the milestone should treat both as open.

### 3. Movement as a tactical action

Jev gains directional movement in its per-decision vocabulary during an
encounter. Movement is held under a renewable lease, and ground safety outranks
the lease. Route planning to a destination (3a), and remote movement reception
with character following (3b), were split out on 2026-09-21. The design is
[2026-09-21-m3-tactical-movement-design.md](plans/2026-09-21-m3-tactical-movement-design.md).

The contract later milestones consume: a movement choice issues
`move(direction, leaseMs)` and every later decision naming the same direction
refreshes it. The lease is a safety bound, never a control semantic: no
candidate and no movement state may encode the current round-trip time.
Exactly three causes may change movement state: a decision naming a different
direction or a stop, lease expiry, or a ground or safety refusal raised during
integration, which outranks the lease. Instant casts and melee survive
movement; cast-time spells, channels, wand and auto-shoot do not, and choosing
a standing-required action releases the lease.

**Exit evidence:** Jev selects movement candidates in a live encounter and the
character moves as chosen. The lease both holds under refresh and expires
without one, demonstrated separately. A ground or safety refusal stops movement
while a lease is live. A standing-required action releases the lease and casts,
and a cast attempted while moving is refused with `SPELL_FAILED_MOVING`, which
is the only movement-specific signal available — after a cast begins the server
reports a generic interruption, so mid-cast cause is not observable and must not
be claimed. Position is confirmed against the server after a movement sequence,
with the method of confirmation stated.

Recorded as required findings rather than pass conditions: the achieved decision
rate, the configured lease, the refresh rate, and whether movement helped or hurt
the encounters. If latched movement at achievable cadence loses fights, that
measurement is what milestone 4 needs in order to choose between attacking the
round-trip latency and splitting the loop into a slow stance with a fast local
reflex layer. Neither is decided in advance.

Out of scope: any local reflex layer, any stance abstraction, parameterised or
coordinate movement, route planning to a destination, remote movement reception,
and character following.

#### Status: accepted with two gaps (Theo, `001882d`)

Records: [docs/evidence/m3/](evidence/m3/README.md). Movement candidates,
lease refresh and expiry, three kinds of ground refusal, standing-cast
release and relogin position confirmation were exercised live. Configured
lease 2500 ms, refresh interval about 236 ms. Movement hurt the one encounter
that used it: under a kiting instruction Jev backed away for the whole run and
dealt no damage.

**Unmet: cast refused with SPELL_FAILED_MOVING.** Every cast path halts before
sending, so both live attempts succeeded instead. Reproducing it needs a
deliberately un-halted cast path or worse network timing. The code citation
stands; the packet was not observed.

**Unmet: wait-as-hold exercised under its own id.** The shared refresh mechanic
was proven through 85 refreshed `move_backward` decisions, never through a
literal `wait` while moving. Closing it needs one run in which Jev holds
direction via `wait`.

Neither gap is to be read as satisfied. A later reader deciding whether to
trust the milestone should treat both as open.

### 3a. Reliable local navigation

Route planning to a destination, obstacle handling, arrival and failure
reporting, and server correction and interruption handling.

**Exit evidence:** repeatedly traverse known routes, stop or change course
cleanly, and report unreachable destinations or lost targets instead of silently
retrying forever. Confirm positions from observed state. Selected destinations
or explicit coordinates are sufficient; named-place language understanding is
not required. Verify native ground-derived destinations and the repaired route
planner on the observed 20-yard funnel corner, with non-anchor samples checked
against the real native height query, exact preservation of the original start
point, and rejection of wrong-floor and obstructed cases.

Independent navigation review approved deriving destination Z from a unique
native column, retaining the existing route gates, and stopping and integrating
old motion before sampling a fresh replan origin. Replans require meaningful
observed displacement and have explicit time, distance and plan-count limits.
Quiet or unsupported targets may stop conservatively with a reason, not trigger
automatic retries.

#### Status: partly met on committed evidence

On `main`: `goto <x> <y> <z>` and `navigation` (`src/daemon/commands.ts`),
the route planner in `src/wow/navigation.ts` (validated direct corridor, else
native funnel corridor; `rejectSnap` start preservation; per-step ground and
collision gates) from `27124fe`, `6f30aaa` and `802b91f`, and route aborts on
server correction, teleport and knockback in `src/wow/control-sync.ts`.
`walk-toward` and `face-guid` add bounded direct legs (`43ac81b`).

Live so far, all in [the M2 records](evidence/m2/README.md): one 62-yard route
walked to `remaining: 0` with the start preserved by `rejectSnap`, an
ambiguous four-floor column refused at `pick_destination` and a double-floor
span stopped with `UNKNOWN_HEIGHT`, each with nothing walked and no retry,
and a halted route confirmed by relogin to about 0.0005 yards. These meet part
of "stop … cleanly", "report unreachable destinations … instead of silently
retrying", "confirm positions from observed state" and "rejection of
wrong-floor and obstructed cases".
[m3/ground-refusal.json](evidence/m3/ground-refusal.json) adds more
`ambiguous ground column` refusals.

Missing against the exit evidence:

- Repeated traversal: one route, walked once.
- Change of course mid-route: only `halt` was exercised.
- Unreachable destinations and lost targets: failures surface raw native
  strings (`UNKNOWN_HEIGHT`, `UNKNOWN_PATH`) with `refusal: stop`; there is no
  distinct unreachable report, and `goto` takes coordinates only, so there is
  no target to lose.
- Native ground-derived destinations: `planGround` derives Z from a unique
  column, but only tests call it; `goto` requires an explicit Z.
- The funnel corner: not reached. [m3a/funnel-corner.md](evidence/m3a/funnel-corner.md)
  (`90c148a`) identifies the failing native stage offline: namigator's
  `getPolyHeight` rejects a corridor corner vertex that `raycast` accepts,
  inside the planner's reverse continuity check in `groundPoint`. The fix
  belongs upstream; the proposed patch was tested offline only. With it, the
  recorded route still refuses on two planner-policy checks
  (`path corner disagrees with connected ground`, `ambiguous ground column at
  route`). The live refusals in that record used a Z-less `goto <x> <y>`,
  which is not on `main` (`src/cli/args.ts` requires Z).
- Bounded replanning: no replan path exists in `src/`.
- Known live defect: `goto` from a ghost fails with
  `position disagrees with ground height` or `UNKNOWN_HEIGHT` (M2 and M3
  records), so corpse runs use direct legs.

#### Next slices

1. **Ground-derived `goto`.** `goto <x> <y>` without Z plans through
   `planGround`. Live: one unique-column destination walked to
   `active: false, remaining: 0`, and one ambiguous column refused at
   `pick_destination` with nothing walked. Evidence: `navigation --json`
   transitions and a relogin pose.
2. **Funnel corner.** The native stage is found
   ([m3a/funnel-corner.md](evidence/m3a/funnel-corner.md)). Land the
   namigator `getPolyHeight` change upstream and install it, then decide the
   two planner-policy refusals by a recorded decision, not to get one route
   through; no coordinate jitter or height substitution. Live: a route
   through the corner near (8722.99, -6666.06) on map 530 accepted and
   walked, with non-anchor samples checked against `findHeights`, the start
   point preserved exactly, and a relogin pose. A refusal is recorded as a
   blocked attempt and keeps the gap open.
3. **Bounded replanning.** Stop, integrate old motion, sample a fresh origin,
   and replan only after meaningful observed displacement, within explicit
   time, distance and plan-count limits. Live: a route that meets a ground
   refusal mid-walk either replans within the limits and arrives, or stops
   with a terminal reason and the counts. Evidence: navigation events with
   plan counts; no unbounded retry.
4. **Repeat and redirect.** Walk one known route at least three times, and
   redirect once mid-route to a new destination. Evidence: arrival for each
   run, the `navigation_replaced` transition, and a relogin pose after each.
5. **Unreachable and lost.** A distinct unreachable report for destinations
   the mesh cannot reach, and a creature destination that stops with a lost
   reason when the creature disappears. Live: a known off-mesh point and a
   creature that leaves range. Evidence: stop reasons, nothing retried.

### 3b. Remote movement and character following

Verify following a moving character as a separate capability rather than
coupling every navigation test to a second account.

Follow ownership must be distinct from Jev and manual control; stale cleanup
must not stop a newer owner. Verify an actual moving character with standoff
pause and resume, and exercise HALT and manual takeover, loss, unsupported
motion, correction and failed planning. Remote player movement reception is a
prerequisite to the character-follow claim; NPC-only or predicted-endpoint
demonstrations do not substitute.

Independent protocol review requires exact flag authority on both ordinary
observer movement and CREATE/UPDATE_OBJECT movement. Preserve flags and extra
flags, including unknown bits; absence is not zero evidence. Ground movement must
reject contradictory direction/root flags and unsupported modes. Remote poses
remain non-extrapolated observations with receive time separate from mover time.
Time-skipped and malformed known-GUID bodies invalidate prior motion without
refreshing pose age. Teleport, knockback, unsafe motion, disappearance, replacement
and death must immediately stop matching follow ownership, even if a safe packet
arrives in the same event-loop turn. Keep validated NPC splines a separate path
and gate map/transfer lifetime. Prove these boundaries before live player follow.

#### Status: not started

The earlier `follow` command was deleted in `05ee035` because no handler
received remote `MSG_MOVE_*` broadcasts and no accepted milestone used it. On
`main`:

- No handler for other players' `MSG_MOVE_*` broadcasts
  (`src/wow/movement-handlers.ts` registers teleport, root, knockback and
  speed changes only). `SMSG_COMPRESSED_MOVES` is a stub and
  `MSG_MOVE_TIME_SKIPPED` has no handler.
- `readLiving` in `src/wow/protocol/movement-block.ts` keeps movement flags
  but drops extra flags and mover time from CREATE/UPDATE movement blocks.
- `src/wow/motion-store.ts` stores receive time only, and extrapolates
  `SMSG_MONSTER_MOVE` splines. NPC splines and remote placements share it.
- `ControlOwner` in `src/wow/control.ts` is `none`, `manual` or `jev`; there
  is no follow owner.

There is no 3b record under `docs/evidence/`. The deleted design is gone: its
only copy, an uncommitted worktree archive, was deleted on 2026-09-26.

#### Next slices

Slices 1–3 are the protocol boundaries the review requires before live player
follow. All use two SOAP accounts of our own.

1. **Remote movement reception.** Handle `MSG_MOVE_*` broadcasts for other
   players, keeping flags, extra flags with unknown bits, mover time and
   receive time, with no extrapolation. Live: account 2 walks, strafes, stops
   and turns while account 1 observes. Evidence: account 1's observed poses
   and flags against account 2's own `.gps`.
2. **Flag authority on CREATE/UPDATE.** Keep extra flags and mover time from
   movement blocks, reject contradictory direction/root flags, and mark
   swimming, flying, falling and transport as unsupported. Live: account 1
   observes account 2 entering view while moving, while frozen (`.freeze`)
   and while swimming. Evidence: the recorded flags and the unsupported mark.
3. **Invalidation.** Time-skipped and malformed bodies, teleport, knockback,
   disappearance, replacement, death and map transfer invalidate prior remote
   motion without refreshing pose age; NPC splines stay separate. Live:
   account 2 teleports (`.tele`) and dies, then leaves range. Evidence: the
   invalidation event and a pose age that does not reset.
4. **Follow ownership.** A `follow <name>` owner distinct from `manual` and
   `jev`, with a standoff distance. Live: account 2 walks, pauses and resumes;
   account 1 keeps the standoff, pauses and resumes. HALT and a manual `move`
   each end follow. Evidence: owner transitions and account 1's relogin pose
   against account 2's `.gps`.
5. **Follow fault paths.** Loss, unsupported motion, correction and failed
   planning each end follow with a reason. Live: account 2 teleports away,
   dies, swims, and walks where the planner refuses. Evidence: each stop
   reason, and no movement after it. Failed planning depends on 3a slices 1
   and 3.

### 4. Repeatable encounter cycles

Deliver this in bounded slices: encounter robustness, encounter completion and
loot, then death and recovery. Expand spell, aura, interruption, resource, and
threat handling as those scenarios need them. Support tactics such as kiting
without making the first class's fixed rotation the architecture.

**Exit evidence:** run sequences of encounters, verify rewards or loot where
relevant, respond to trouble, and recover or report a concrete blocking
condition. A rising kill count alone does not establish success. Death/recovery
scenarios must not depend on a developer secretly repairing the session.

The design and plan are
[2026-09-22-m4-encounter-cycles-design.md](plans/2026-09-22-m4-encounter-cycles-design.md)
and [2026-09-22-m4-encounter-cycles-plan.md](plans/2026-09-22-m4-encounter-cycles-plan.md).
The contract, in short:

- Movement is consumed as milestone 3 left it: `move_forward`,
  `move_backward`, `strafe_left`, `strafe_right` and `stop_moving`,
  under a 2500 ms renewable lease, ground safety outranking the lease. Corpse
  travel uses bounded direct legs only, with no planner.
- Loot tracks request versus observation. Windows use offered slot permissions
  and a release acknowledgement barrier; slot removal is not inventory gain.
  Gains are proved by raw slot/count and coinage changes.
- Recovery observes ghost flags before health and invalidates stale death-epoch
  offers and queries. Graveyard markers and sent requests never prove release
  or resurrection. No server edits or hidden session repair.
- A release-only opening denial, including ordinary out-of-range denial,
  requires an explicit ordinary reconnect. This is a functional limitation,
  not completed denial/retry support.
- The first rescue after M2 attempt 04 was repair-assisted and does not count
  toward the clean recovery criterion.

#### Status: evidence recorded as met (`7da1f02`), awaiting the maintainer's acceptance

Records: [docs/evidence/m4/](evidence/m4/README.md). One `cycle --max 2`
completed two fights with kill credit, two acknowledged loot windows and raw
item-stack gains. A Wretched Hooligan window proved coinage 6164->6174 after an
explicit take and release acknowledgement. Two death, ghost, reclaim and life
cycles needed no developer repair.

- Unexercised live, and not claimed: denied, full and empty loot, and
  current-offer resurrection. The spirit-healer select went unanswered in ten
  sessions ([recovery-blocked-2026-09-24.json](evidence/m4/recovery-blocked-2026-09-24.json)).
  Release-only opening denial still needs an ordinary reconnect.
- Caveat found on 2026-09-25: `parseInitialSpells` trusted the server's
  cooldown count, read past the end of the packet and left the spellbook
  empty without an error. Some of the 20 `no_supported_combat_actions` skips
  in the 2026-09-23 run window may come from this defect. `d2d5d27` fixes the
  parser. The post-fix `cycle --max 2` on `41077d1` (two kills, two loot
  windows) is recorded only in `tmp/review-2026-09-24/fix.md`, which is
  gitignored.
- Landed after the records, with no committed live record: in-cycle corpse
  runs (`1fbe0f2`, `723be6b`) and loot-open waits (`41077d1`, `f5386e9`). A
  death inside `cycle` still ends the run with `reclaimed` rather than
  continuing the queue (`src/wow/encounter-cycle.ts`).

### 5. A selected questing loop

Add the NPC interactions, quest state, inventory, and other capabilities required
for a chosen quest scenario. Present real interaction options as concrete
choices, with server-confirmed transitions.

**Exit evidence:** an agent can accept a quest, travel, perform its objectives,
return, and turn it in, with Jev handling the relevant moment-to-moment work.
Verify actual quest progress and completion. This does not require discovering
every quest chain or building a general-purpose planner.

Independent quest review requires CREATE-time visibility provenance: quest ID
fields can be hidden under an outsider controller even for authenticated self.
Do not infer earlier zero IDs retrospectively after control changes. Observe the
quest log after complete update packets and after world removal; initial or
replacement baselines are not acceptance. Dialog actions require current offered
giver/menu/quest state. Cancellation sends the protocol request but cannot
silently clear an unresolved correlation barrier. Preserve optional gossip codes
as JSON strings or null through IPC, including empty strings and line breaks.
Live proof must distinguish acceptance, objective progress, completion, reward
notification and actual inventory/experience changes.

#### Status: not started; quest protocol code on main

The quest runtime landed in `7d05721` and was split in the 2026-09-24 review
(`f1def23`, `641bfe9`, `44c7f18`). On `main`: gossip hello and option select,
questgiver query, accept, complete, request-reward, choose-reward, cancel and
abandon, gated on the offered dialog (`src/wow/quests.ts`,
`src/wow/quests-requests.ts`); quest-log slots with CREATE-time visibility
(`src/wow/quest-slots.ts`); `SMSG_QUESTUPDATE_ADD_KILL`, `ADD_ITEM` and
`COMPLETE` handling; carried inventory and coinage (`src/wow/inventory.ts`);
and the matching CLI verbs (`src/cli/help.ts`). Gossip codes pass through IPC
as string or null (`src/daemon/commands-quest-loot.test.ts`).

None of it has a live record, and there is no `docs/evidence/m5/`. Not on
`main`: `CMSG_QUESTGIVER_HELLO` and `CMSG_QUESTGIVER_STATUS_QUERY` are never
sent, NPC text is unparsed, and vendor opcodes are listed or stubbed only. Jev
has no quest role.

#### Next slices

1. **Scenario and giver dialog.** Choose one quest near Fairbreeze for a
   character of our own: giver, objectives, turn-in NPC and reward, with the
   server database as offline reference only. Live: `talk` to the giver shows
   the quest offered. Evidence: the dialog as observed, and the scenario
   written to `docs/evidence/m5/`. If the giver does not answer gossip hello,
   send `CMSG_QUESTGIVER_HELLO` [INFERENCE: not yet observed either way].
2. **Accept with provenance.** Live: accept the quest. Evidence: the quest
   appears in the log after a complete update packet, not in the login
   baseline, with its CREATE-time visibility recorded.
3. **Objective progress.** Live: perform the objectives (kills through
   `tactics` or `cycle`, or item collection). Evidence: each
   `SMSG_QUESTUPDATE_*` counter against the quest-log counter, and raw slot
   and count changes for items.
4. **Turn-in and reward.** Live: return and turn in. Evidence: the completion
   and reward notification, recorded separately from raw experience,
   coinage and item-slot changes.
5. **Cancellation.** Live: cancel an open dialog while a request is
   unanswered. Evidence: the cancel request sent and the correlation barrier
   still reported as unresolved.
6. **The loop with Jev.** Live: the full scenario with the supervising agent
   giving only the objective, travel by `goto` or bounded legs, and Jev
   choosing among the offered fight and dialog actions. Evidence: a record of
   observations, offered actions, choices and outcomes, with interventions
   counted. Travel depends on 3a slice 1 where the route needs a planner.

### 6. Sustained supervised play

Combine the capabilities into longer sessions where an agent can inspect
progress, change objectives, intervene, and resume. Human-facing presentation can
be refined separately after user feedback.

**Exit evidence:** varied sessions across enemies, routes, abilities, and
interruptions, without developer repairs between encounters. Report attempts as
well as successes: completions, blocked runs, recoveries, human interventions,
stale-action handling, and observed latency. Failures must be reconstructable
from observations, questions, decisions, actions, and outcomes.

The spatial TUI can develop alongside these milestones when it helps gameplay
or user feedback calls for it; it does not gate agent-playable capabilities.
Opcode coverage grows through the capabilities that need it.

#### Status: not started

No milestone 6 record exists. On `main`, `cycle <guid...> [--instruction]
[--max]` runs an explicit target queue (`src/wow/encounter-cycle.ts`), HALT and
manual actions pre-empt it (`src/wow/runtime.ts`, `src/daemon/server.ts`),
tactics events carry observation, instruction and latency into the session
log, and `mise evidence:encounter` (`src/tools/distil-encounter.ts`) distils
one encounter. Missing:

- Changing objectives mid-session: the instruction is fixed per `cycle`
  start; changing it means stopping and starting again.
- Resume: no verb resumes a stopped queue; a death ends the run.
- Variety: two creature types (Springpaw Stalker, Wretched Hooligan), one
  character, one class, one area.
- A session-level record: the distiller covers one encounter, not a session
  with its blocks, recoveries and interventions.

#### Next slices

1. **Intervene and resume.** Live: HALT a running cycle, then resume the
   remaining queue. Evidence: the halt stop cause, then the resumed run's
   kill credits for the remaining targets, with no repair between.
2. **Continue after death.** Live: a death inside a cycle is recovered and the
   queue continues, or the run stops with the blocking condition. Evidence:
   death, ghost, reclaim and life observations inside one cycle record.
3. **Change the objective mid-session.** Live: change the standing
   instruction during a session and record the behaviour on each side, in
   replicated pairs. This also closes milestone 2's instruction gap.
4. **Session record.** Extend `mise evidence:encounter` to a session:
   completions, blocked runs, recoveries, interventions, stale-action
   discards and latency. Live: one session with at least one block and one
   recovery. Evidence: a committed record from which each failure can be
   reconstructed.
5. **Unexercised M4 branches.** Live: denied, full and empty loot, and a
   current-offer resurrection. Evidence: each stop cause or advance as
   observed. This needs the unanswered spirit-healer select diagnosed first.
6. **Trouble the loop cannot fight.** Live: an attacker refused as
   `unverified_hostile_relation`, such as the Crazed Dragonhawk, yields a
   concrete response or a reported blocking condition instead of repeated
   deaths. Evidence: the refusal, the response and the outcome.
7. **Variety.** Live: sessions across at least two creature types, two areas
   joined by a planned route (3a) and a second ability set on another SOAP
   character. Evidence: session records from slice 4.

## Candidate epic: the Pi harness

[2026-09-25-pi-harness-design.md](plans/2026-09-25-pi-harness-design.md)
records a spike and Theo's choice of stock Pi as the base for an in-process
agent harness, with its own proposed milestones (core event bus, harness
skeleton, credentials, tool surface, game logs, spatial panel, hosting the Jev
tactical loop). It is a candidate epic, not an approved milestone. Nothing in
this roadmap waits for it, and its milestones are not roadmap milestones until
a recorded decision says so.

## Working through the milestones

Milestones are progress and evidence checkpoints, not a requirement for the
user to read code. Use whichever tools and process best deliver the active
goal; frameworks are optional aids. For each goal, state the behavior,
scenario, non-goals and completion evidence; keep one integration owner; verify
the actual changed surface live; and leave a concise completion record with
landed commits, commands and outcomes, known limits and the next slice.
Escalate missing prerequisites or materially different user-facing scope.
Never quietly weaken behavioral acceptance criteria. Passing tests, model
confidence, and agent agreement are not substitutes for demonstrated gameplay.
Material changes to the plan require independent advice, a recorded decision,
and concrete live-verifiable acceptance criteria.

## Other context

Build-12340 spell tables were extracted with client MPQ patch precedence and
recorded in `tmp/gameplay-data/provenance.json` (gitignored). The matching
Expansion01 navigation data and native library are present; their presence
alone does not prove navigation.

The unmerged `vibe` work (tag `archive/vibe`) contains movement, namigator
navigation, combat, and priest-hunting work, along with research notes and
live-run journals. It is reference material, not a merge candidate or the
architecture to inherit. Useful pieces may be reused after inspection and
verification to the same standard as new work. Its recorded successes are not
proof of current readiness.

An initial TypeSafe experiment used six synthetic WoW scenarios with
`jev-1.13.0`. It demonstrated instruction-dependent action choices and measured
227–695 ms end-to-end calls from the development machine. It did not demonstrate
live gameplay, sustained 5 Hz operation, or domain-wide decision reliability.
It also showed that a forced choice can favor one of two equivalent actions
while a separate judgment correctly says there is no reason to prefer either.
Typed output guarantees the interface, not the truth or justification of a
decision.

## What this document does not authorize

No bulk merge of `archive/vibe`, server-data modifications, or commitment to a
natural-language planner, generic task framework, or exact rendering
implementation. The active goal permits useful capability additions and
sequencing changes after independent consultation and a recorded decision.
Detailed capability contracts and acceptance scenarios remain required.

The README remains the concise public overview. This document holds the expanded
ambition while it is being aligned and refined.

## References

- [Earlier spatial TUI vision](plans/2026-02-20-tui-vision-design.md)
- [TypeSafe announcement and Doom discussion](https://typesafe.ai/blog/introducing-system-one-models-and-jev)
- [TypeSafe programming model](https://docs.typesafe.ai/concepts/how-to-build-with-system-one)
- [TypeSafe API](https://docs.typesafe.ai/api)
- [Jev model limitations](https://docs.typesafe.ai/model-jaggedness/jev-1.13)
