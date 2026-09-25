# Roadmap: a programmable, AI-playable WoW client

Date: 2026-09-20. Condensed 2026-09-24 after the post-roadmap review.

Status: milestones 2 and 3 are accepted with recorded gaps (Theo's call).
Milestone 4 exit evidence is recorded as met (`7da1f02`). Milestone 1 has live
evidence but no separate acceptance decision. Milestones 3a, 3b, 5 and 6
remain. The capabilities
below are not all implemented. Detailed histories live in the linked
evidence records and plan files.

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

The [Pi harness design](plans/2026-09-25-pi-harness-design.md) proposes the
intended shape: tuicraft embeds the Pi agent runtime under Bun, owns the
world session in-process, and renders live panels such as the map alongside
the agent conversation. The CLI and daemon remain as a second shell over the
same core.

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
Shipping is direct-to-main through one integration owner, as AGENTS.md
describes. Releases are paused.

Each increment should provide:

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

#### Outcome, 2026-09-20 and 2026-09-21

No separate acceptance decision is recorded for this milestone. Its evidence:

- Direct control ran live with Xiara, level 10, in Fairbreeze on map 530:
  movement leases, HALT, facing, requested versus observed target, target
  clearing and same-socket READ_WAIT cancellation. Relogin confirmed the server
  position `8713.5126953125, -6669.2939453125, 70.33599853515625`; the last
  prediction differed by about `0.000081` yards. The command records were
  written to `tmp/xiara-m1*.json`, which is gitignored and was never committed.
- Three fault paths ran live (`test: Prove fault paths on the live server`):
  a forced `.tele` over 100 yards, `.freeze`/`.unfreeze`, and a WHO pipelined
  with HALT. See
  [2026-09-21-fault-paths-live-plan.md](plans/2026-09-21-fault-paths-live-plan.md).
- The `0x4` authentication failures that looked like missing two-account
  credentials were a client defect: SRP values were serialised at variable
  width. `fix: Serialise SRP values at fixed byte width` fixed it. Six
  consecutive 12/12 live runs and 1000 isolated handshakes followed.
- Open, and not to be read as fixed: one earlier run failed `party management >
  invite, accept, leader transfer, leave` with a 30-second timeout and no auth
  error. The SRP fix cannot explain it. Treat it as unexplained.
- Deferred with reasons: transport boarding (the server boards a passenger
  only when the client sends `MOVEMENTFLAG_ONTRANSPORT`, which the client
  never sets), flight and knockback.

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

#### How it got there

The design context is
[2026-09-21-m2-encounter-context.md](plans/2026-09-21-m2-encounter-context.md).
Live attempts exposed and repaired, in order:

- Normal-form spells were blanket-rejected. The repair observes the high form
  byte of `UNIT_FIELD_BYTES_2` and supports form zero, per
  `SpellInfo::CheckShapeshift`. A complete CREATE defines omitted public unit
  fields as zero; incomplete or synthetic entities stay unknown.
- A structurally unsupported kit must stop with a concrete reason; cooldowns
  and in-flight responses stay waits.
- Jev responses whose probabilities summed to 0.99 were rejected. The cause was
  provider rounding to two decimals, not float drift. Commit `3e1f3aa`
  renormalises totals within 2e-2 and rejects anything further out.
- A mesh-backed approach was pulled forward from milestone 3: on-demand ADT
  loading and a checked ground corridor, with no endpoint-Z interpolation,
  invented heights or silent retries. A direct corridor is preferred only when
  every connected-height, ambiguity, collision and headroom check passes.

Attempt 03 stopped before inference on the missing form word. Attempt 04 cast
Mind Blast successfully, then a response failed validation and the character
died: zero credited wins. Attempt 05 was the first genuine autonomous win (kill
credit, 108 experience, zero interventions) but predates the repairs, so it is
history, not evidence. Attempt 06 failed on the 0.99 probability total.

#### Outcome, 2026-09-21

- Five autonomous encounters completed, each with server kill credit, after
  the probability renormalisation in `3e1f3aa` and the ground-height repair
  in `c406db9`. Records: [docs/evidence/m2/](evidence/m2/), one file
  per encounter, produced by `mise evidence:encounter`.
- Cadence is two numbers and must be quoted together: a loop rate of 3.76–3.88
  requests per second at 256–264 ms average latency, and a tactical decision
  rate of 0.49–0.67 per second. Between 64 and 86 per cent of decisions offered
  only `wait` and `cancel`. No report may present the loop rate alone as the
  decision cadence.
- The instruction contrast (encounters 04 and 05) is one unreplicated pair; the
  whole difference is one Mind Blast and one shield choice. The instruction
  texts are in the two records. They were pinned in
  `src/wow/standing-instructions.ts`, which the 2026-09-24 review deleted.
- Faults ran live: `stale_age` and `jev_timeout` discards, an obsolete decision
  discarded as `aborted`, `TypeSafe HTTP 503` and `fetch failed`, a 62-yard
  route with wrong-floor and obstructed rejections, and a halted approach
  confirmed against the relogin position to 0.0005 yards. Records:
  `docs/evidence/m2/fault-*.json` and the
  [fault runbook](evidence/m2/fault-runbook.md).
- One protocol defect was fixed: the client dropped every `SMSG_ATTACKSTART`
  where it was not the attacker. Defending against an observed incoming
  attacker is now permitted; faction hostility is not forced.
- Limits found live: the client does not chase a leashing creature and has no
  collision sensing. `goto` failed with `UNKNOWN_HEIGHT` in the tested area; the
  working hypothesis, a Detour `dtPointInPolygon` boundary defect in namigator,
  is a diagnosis from observations, not an upstream-confirmed fact.
- Two observations, neither blocking: `src/wow/jev.ts` validates
  `output_tokens` and then discards it, and the tactics age, interval and
  timeout bounds in `src/wow/tactics.ts` (now the named constants
  `DEFAULT_MAX_AGE_MS`, `DEFAULT_INTERVAL_MS`, `DEFAULT_TIMEOUT_MS`) still
  have no recorded derivation. Observed decision latency was about 258 ms
  against the 2000 ms age bound.

#### Decision: milestone 2 accepted with two gaps, 2026-09-21

Theo's call. Milestone 2 is accepted as done enough to move on, with both
unmet criteria recorded here rather than closed.

**Unmet: demonstrate behaviour change from instructions.** The exit evidence
asks for a demonstrated change in behaviour when the instruction changes. What
exists is one unreplicated pair, encounters 04 and 05, in which Jev stopped
choosing the two costly spells under the conserving instruction. An independent
review found that a single pair cannot carry the conclusion, and the claim was
downgraded rather than replicated. Closing it needs two or three more pairs at
comparable level against comparable creatures. That is farming, not new
capability.

**Unmet: planner verification on the funnel corner.** A 62-yard direct corridor
was verified along with wrong-floor and obstructed rejections. The 20-yard
funnel-corner case this milestone names was not reached, so the route-selection
repair remains unverified on the geometry that motivated it.

Neither gap is to be read as satisfied by the work recorded above. A later
reader deciding whether to trust the milestone should treat both as open.

### 3. Movement as a tactical action

Jev gains directional movement in its per-decision vocabulary during an
encounter. Movement is held under a renewable lease, and ground safety outranks
the lease.

Refined 2026-09-21. This milestone previously bundled ground navigation, remote
movement reception and character following. Theo's direction is that navmesh
route planning cannot produce real kiting, and that Jev must eventually drive
every input several times per second. Route planning to a destination, and
remote movement reception with character following, each become their own
milestone. The funnel-corner planner verification travels with route planning.

The design note is
[docs/plans/2026-09-21-m3-tactical-movement-design.md](plans/2026-09-21-m3-tactical-movement-design.md).
The live records are in [docs/evidence/m3/](evidence/m3/).

**The lease.** A movement choice issues `move(direction, leaseMs)` against the
existing primitive; every later decision naming the same direction refreshes it.
Movement continues only while Jev keeps confirming it, so a stale, timed-out,
failed or hung decision stops the character without needing a held-state policy.
The lease is a safety bound and never a control semantic: no candidate and no
movement state may encode the current round-trip time, because the same code
must be correct for a local model deciding every 16ms.

Exactly three causes may change movement state: a decision naming a different
direction or a stop, lease expiry, or a ground or safety refusal raised during
integration. The third is the Z-defect machinery from `6f30aaa` and outranks the
lease. Jev may not hold a direction into unresolved ground.

Route planning leaves this milestone but the ground-query surface stays, because
latched movement resolves ground height on every integration step.

**Candidate gating** follows from server behaviour established by source review.
Instant-cast spells start and survive while moving; cast-time spells, channels,
wand and auto-shoot do not; melee is unaffected. A moving client that stays
quiet still loses its cast, and no client cancel opcode is required, so the loop
must not depend on observing one. Choosing a standing-required action implicitly
releases the lease, which keeps the model's interface a single choice from an
enumerated set.

For the level 10 priest, movement-compatible damage is Shadow Word: Pain plus
melee; Smite and wand fire require a standstill. The demonstrable pattern is
therefore an alternation rather than continuous kiting.

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

#### Decision: milestone 3 accepted with two gaps, 2026-09-22

Theo's call. Milestone 3 is accepted as done enough to move on, with both
unmet criteria recorded here rather than closed.

**Unmet: cast refused with SPELL_FAILED_MOVING.** The exit evidence asks for
a cast attempted while moving to be refused with the movement-specific
signal. Two live attempts both succeeded instead: every cast path halts
before sending, and the stop and cast packets go out back-to-back on the
same connection, so the server processes the stop first and never sees the
caster as moving. Reproducing it needs a deliberately un-halted cast path
or worse network timing. The code citation stands; the packet was not
observed.

**Unmet: wait-as-hold exercised under its own id.** The refresh mechanic
`wait` shares with same-direction `move_*` was proven live through 85
refreshed `move_backward` decisions, never through a literal `wait` while
moving: encounter-01 never moved, encounter-02 never chose `wait`. Closing
it needs one run in which Jev holds direction via `wait`.

Neither gap is to be read as satisfied by the work recorded above. A later
reader deciding whether to trust the milestone should treat both as open.

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

### 3b. Remote movement and character following

Verify following a moving character as a separate capability rather than
coupling every navigation test to a second account.

Stale after the 2026-09-24 review: the earlier `follow` command and the unused
remote movement codec were deleted (commit `05ee035`), because no handler
received remote `MSG_MOVE_*` broadcasts and no accepted milestone used them.
This milestone starts from remote movement reception.

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

#### Outcome: milestone 4 exit evidence met, 2026-09-23 (`7da1f02`)

Exit evidence met: one `cycle --max 2` completed two Stalker
fights, two acknowledged loot windows, and raw item-stack gains. A later
Wretched Hooligan fight offered 10 money; an explicit take raised observed
coinage 6164->6174 and release was acknowledged. Two separate
death/ghost/reclaim/life cycles needed no developer repair. See
`docs/evidence/m4/`. Denied/full/empty loot and current-offer resurrection
were unexercised live; this milestone does not claim those branches pass.
Release-only opening denial still requires an ordinary reconnect.

Caveat found on 2026-09-25: `parseInitialSpells` trusted the server's
cooldown count. The server counts entries that it does not send, so the parser
read past the end of the packet and left the spellbook empty. It gave no
error. The session log has 20 `no_supported_combat_actions` skips with an
empty unavailable list inside the 2026-09-23 run window. Some skips recorded
there may therefore come from this defect, and are not real skips. `d2d5d27`
fixes the parser. After the fix, a `cycle --max 2` on `41077d1` completed two
kills with server kill credit and two loot windows
(`tmp/review-2026-09-24/fix.md`). The acceptance is not reopened.

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

The unmerged `vibe` branch contains movement, namigator navigation, combat, and
priest-hunting work, along with research notes and live-run journals. It is
reference material, not a merge candidate or the architecture to inherit.
Useful pieces may be reused after inspection and verification to the same
standard as new work. Its recorded successes are not proof of current readiness.

An initial TypeSafe experiment used six synthetic WoW scenarios with
`jev-1.13.0`. It demonstrated instruction-dependent action choices and measured
227–695 ms end-to-end calls from the development machine. It did not demonstrate
live gameplay, sustained 5 Hz operation, or domain-wide decision reliability.
It also showed that a forced choice can favor one of two equivalent actions
while a separate judgment correctly says there is no reason to prefer either.
Typed output guarantees the interface, not the truth or justification of a
decision.

## What this document does not authorize

No bulk merge of `vibe`, server-data modifications, or commitment to a
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
