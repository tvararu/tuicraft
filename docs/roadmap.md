# Roadmap: a programmable, AI-playable WoW client

Date: 2026-09-20

Status: the active goal spans all six milestones. Work lands in independently
reviewed, verified increments; the capabilities below are not all implemented.

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

The user delegates implementation, engineering decisions, code review, and
integration to agents. Success means the client can actually play WoW and
respects the protocol, not that the user has read and approved the code.

Agent-playable capabilities come first. Human-facing usability and the spatial
TUI remain worthwhile directions, to refine after user feedback rather than
requiring them before the first gameplay loop.

Keep sensible conventions and meaningful tests, but do not chase 100% coverage
or undertake cosmetic refactors at the expense of working gameplay. Coverage
is diagnostic information, not a percentage gate. Protocol correctness and
observed server outcomes remain essential.

Play as soon as a useful capability exists; finishing every milestone is not a
prerequisite. Use real gameplay to expose gaps, improve the client, and continue
normal play and leveling on the user's server within the active goal. If the
coordinator lacks CLI access, delegate execution to a capable agent. Only one
agent should control a given character at a time.

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

Shipping is direct-to-main: independent agents use
local or Orca worktrees; one integration owner verifies the combined tree, then
commits and pushes to `main`. Agents may commit and push automatically after
that verification. Increments stay small and reviewable. Releases are paused.

The development process must let agents implement and verify capabilities
without requiring the user to inspect code. Produce compact, inspectable
gameplay evidence and retain the user's control over objectives and priorities.

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
proof on its own.

The factory should evolve alongside working capabilities. A minimal evidence
format and repeatable scenarios come first; a sophisticated orchestration system
is not a prerequisite for gameplay.

## Milestones

These are the agreed high-level milestones, not claims of completion or detailed
implementation specifications. Each contains smaller, independently reviewable
increments. Define concrete scenarios and acceptance criteria before starting an
increment, then preserve useful scenarios as capabilities grow.

The key sequencing decision is to prove a real Jev-controlled encounter before
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

Before those encounters, verify the learned spellbook, actual casts, resource
changes, and server rejections. Client spell metadata is not evidence that a
spell is learned or currently usable. Moving creatures need current movement
observations; their initial spawn positions are not sufficient.

Live spellbook validation exposed blanket rejection of ordinary normal-form
spells and an active loop with no supported actions. Independent review of
`SpellInfo::CheckShapeshift` confirmed the repair: observe the high form byte
of `UNIT_FIELD_BYTES_2`, support form zero, and apply the normal-form allowance
flag to nonzero stance masks. Do not invent form state from class or whitelist
spell IDs. Other forms and unsupported mechanics remain explicit limits.

Verify actual learned spells become candidates, and revalidate form before
execution. A structurally unsupported kit must stop with a concrete reason,
including permanently unsupported hostile ranges. Temporary cooldowns and
in-flight responses must remain waits, and viable facing/melee must remain
available. Repeat live cancellation after the correlated-failure repair before
counting the remaining autonomous encounters.
Retain the actual terminal observation even when a block occurs before any Jev
request; do not fabricate request or timing evidence for that case.

The rebuilt client confirmed cancellation through START, CAST_FAILED40 and
SPELL_FAILURE40 without losing the cancel outcome or mana. Encounter attempt03
then stopped before inference because the real self CREATE omitted the zero
packed form word. Independent protocol review confirmed that complete CREATE
omits zero visible fields. Record that network provenance per entity lifetime:
PUBLIC unit fields omitted from a complete CREATE are zero; incomplete or
synthetic entities remain unknown. Preserve this authority through sparse VALUES
and reset it on destruction or replacement CREATE. Bound power-field offsets to
the seven public power slots. Nonself form is client-visible state and can be
masked by cross-faction grouping; it is not proof of another player's actual form.
The next login confirmed self form zero and a usable candidate kit.

Attempt04 selected Mind Blast through Jev and the server confirmed a successful
cast: target health120→80 and mana547→501. Five further requests succeeded; the
next response failed validation after2.55 seconds. The character subsequently
died without tactical intervention, then the server automatically released the
ghost. This remains a failed encounter: zero of five autonomous wins credited.
The rejected body was not retained. Forty-one controlled replays did not
reproduce the failure. Independent provider review approved field-specific
diagnostics with raw exceptions retained only as causes; acceptance predicates,
probability-total tolerance and transport behavior remain unchanged. Resume live
encounters with those diagnostics rather than claiming an unproven provider fix.

Attempt05 then completed the first genuine autonomous encounter: server kill
credit, 108 experience, 14.8 seconds, zero interventions. Attempt06 failed
immediately after, because a well-formed response summed to 0.99. The cause
was provider rounding to two decimal places rather than floating-point drift:
the observed deviation of 1e-2 was four orders of magnitude outside the
earlier 1e-6 window at `src/wow/jev.ts:149`. The regression that appeared to
cover this path, `src/wow/jev.test.ts:336-351`, exercised only a 1e-8 deviation
and sat comfortably inside tolerance, satisfying the letter of the
no-exact-equality requirement without testing the case that actually occurred.
The failed request is retained at `tmp/jev-mass-request.json`. The resolution
was to renormalise a near-unit total and reject anything further out:
`src/wow/jev.ts:149-156` renormalises deviations between 1e-6 and 2e-2 by
dividing each probability by the total, while rejecting any total deviating
more than the 2e-2 tolerance at `src/wow/jev.ts:150`.

Two further observations from the same audit, neither blocking. `src/wow/jev.ts`
reads and type-validates `output_tokens` and then discards it, since
`JevActionResult` has no field for it. `src/wow/tactics.ts` hardcodes its result
age, interval and timeout bounds as bare literals with no recorded derivation,
although the design note required a bound chosen from measured round-trip time;
observed decision latency was about 258 ms against a 2000 ms bound.

A narrow mesh-backed approach capability is pulled forward from milestone 3 to
reach the first encounter safely. Independent data review identified the existing
Expansion01 mesh and native path/height APIs. The decision is to load relevant
ADTs on demand and follow a checked ground corridor, not to complete general
navigation first. Reject the suggested endpoint-Z interpolation fallback: two
observed endpoints do not establish intermediate terrain or obstacle clearance.

This prerequisite must first pass a native-library/data smoke check and a short
live approach with immediate interruption and server-position confirmation.
Missing paths, ambiguous floors, unsupported movement, or corrections must stop
the approach with a reason. No invented ground heights, bulk ADT loading, GM
shortcuts, or silent retry loop. Following, general route robustness, and the
remaining navigation evidence stay in milestone 3.

Native execution exposed a funnel corner with no queryable height even though a
fully checked direct ground corridor was usable. Independent geometry review
recommended retaining native-path success and original endpoint/floor/snap gates,
then preferring a direct corridor only when all connected-height, reverse-height,
ambiguity, collision, and headroom checks pass. The equally checked funnel route
is the alternative for expected geometry rejection; native ABI, lifecycle, and
invalid-domain errors still fail. This is the adopted route-selection repair,
not coordinate jitter, a relaxed tolerance, or a height fallback.

Verify the repaired public planner on the observed 20-yard case, including
non-anchor samples against the real native height query, exact original-start
preservation, and rejection of wrong-floor and obstructed cases. The short live
approach and interruption evidence above remain required. Ray checks and the
native library's incomplete stacked-floor enumeration do not establish general
capsule collision or multi-floor support.

#### Outcome, 2026-09-21

Five autonomous encounters completed, every one with server kill credit, all
after the probability renormalisation in `3e1f3aa` and the ground-height repair
in `c406db9`. Attempt05 is treated as history rather than as evidence because it
predates the first of those. The records are in `docs/evidence/m2/`, one file
per encounter, distilled from the session log by `mise evidence:encounter`.

Cadence is recorded as two numbers together, because quoting one overstates the
other. The loop rate is 3.76 to 3.88 requests per second, at average request
latency 256 to 264 ms. The tactical decision rate counts only decisions whose
offered set included a spell, attack, or face option: 0.49 to 0.67 per second
across the five encounters. Between 64 and 86 per cent of decisions offered
only `wait` and `cancel`, because a cast was in flight or the global cooldown
was running, and Jev answered `wait` on those turns; whether waiting was the
right call in each case is not in the records. Both numbers are in the
evidence README with per-encounter figures recomputed from the JSON. No
report may present the loop rate alone as the decision cadence.

The instruction contrast is a suggestive unreplicated pair, not a
demonstration. Encounters 04 and 05 ran back to back at one character level
against creatures of the same level under the two texts now pinned in
`src/wow/standing-instructions.ts`. Under the conserving instruction Jev
chose neither Mind Blast nor Power Word: Shield and used the cheapest damage
rank plus melee more often — but the whole difference is one Mind Blast
choice and one shield choice, a noise-shaped margin for a stochastic judge
over a single run per condition against different creature individuals. The
operator reports no code differed between the runs; the records cannot
verify that. Replication is still needed before the behaviour change
milestone 2 asks for can be called demonstrated; the rest of the farm is
uncontrolled and the prompt work yields an informed opinion, not evidence.

Cancellation is proven live. The five outstanding items ran live on 2026-09-21:
delayed responses past the age bound (`stale_age` discards) and past the
request timeout (`jev_timeout`), an obsolete decision discarded as `aborted`,
model unavailability as both `TypeSafe HTTP 503` and `fetch failed`, a 62-yard
planned route walked to completion with wrong-floor (`ambiguous ground
column`) and obstructed (`UNKNOWN_HEIGHT`) rejections stopping with reasons,
and a short live approach halted mid-route with the halt pose confirmed
against the server relogin position to 0.0005 yards. Records are in
`docs/evidence/m2/fault-*.json`; injection tooling and the operator runbook
remain at `docs/evidence/m2/fault-runbook.md`.

One gap remains inside that. The planner verification above ran a 62-yard
direct corridor, not the observed 20-yard funnel-corner case this milestone
names. The behaviours that case was meant to exercise are evidenced, including
non-anchor samples against the native height query, preservation of the
original start, and rejection of wrong-floor and obstructed routes. The funnel
corner itself was not reached, so the route-selection repair recorded above is
not yet verified on the geometry that motivated it.

Limits found live and not yet resolved. The client never chases, so a creature
that leashes home cannot be finished; one was driven to 2 health and reset. It
has no collision sensing, so walking into a structure is indistinguishable from
a failed height query, and every approach and corpse run this session was
steered by hand. Route planning is unusable in the tested area: `goto` to the
server's own reported corpse position fails with `UNKNOWN_HEIGHT`. The working
hypothesis, consistent with the observations, is an upstream defect in
`namigator` rather than a data gap: Detour's `dtPointInPolygon` rejecting
points lying exactly on a polygon boundary, with the corridor corners returned
by `findPath` being polygon vertices, the tile present, and the column query
returning one unambiguous height. That is a diagnosis from these observations,
not an upstream-confirmed fact.

One protocol defect was found and fixed. The client discarded every
`SMSG_ATTACKSTART` in which it was not the attacker, so it never observed that
a creature had begun attacking it. A creature of faction template 7, which the
loaded data does not mark hostile, killed the character four times while
`fight` refused it with `unverified_hostile_relation`. Whether template 7 is
genuinely neutral to all here is unverified — the faction data may simply not
mark the relation hostile — so the record calls the creature unfightable
under the current verification, not neutral. Defending against an observed
incoming attacker is now permitted; faction hostility is not forced, because
forcing it risks attacking bystanders, a judgement about the untried fix
rather than an observed outcome.

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

### 3. Reliable local navigation

Extend basic movement with route planning, obstacle handling, arrival/failure
reporting, and server correction and interruption handling. Verify following a
moving character as a separate capability rather than coupling every navigation
test to a second account.

**Exit evidence:** repeatedly traverse known routes, stop or change course
cleanly, and report unreachable destinations or lost targets instead of silently
retrying forever. Confirm positions from observed state. Selected destinations
or explicit coordinates are sufficient; named-place language understanding is
not required.

Independent navigation review approved bounded, ground-only following: derive
destination Z from a unique native column, retain the existing route gates, and
stop/integrate old motion before sampling a fresh replan origin. Follow ownership
must be distinct from Jev/manual control; stale cleanup must not stop a newer
owner. Replans require meaningful observed displacement and have explicit time,
distance and plan-count limits. Quiet or unsupported targets may stop
conservatively with a reason, not trigger automatic retries.

Verify native ground-derived destinations, repeated known routes with observed
positions, and an actual moving character with standoff pause/resume. Exercise
HALT/manual takeover, loss, unsupported motion, correction and failed planning.
Remote player movement reception is a prerequisite to that character-follow
claim; NPC-only or predicted-endpoint demonstrations do not substitute.

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

Movement is not currently an offered action. Jev can cancel a cast but cannot
reposition, so retreating is not expressible and kiting is unreachable. The
slice that unblocks it is to offer bounded movement intents as candidates
alongside spells, validated and routed by the client. Jev must not emit
coordinates; it selects among intents the client has already established are
legal, exactly as it does for spells today. Route planning is a prerequisite and
is not sufficient on its own: planning a corridor and walking it cannot express
continuous repositioning against a moving creature.

Independent state review approved explicit request-versus-observation tracking.
Loot windows use offered slot permissions and a release acknowledgement barrier;
slot removal alone is not personal inventory gain. Reconcile own item pushes and
coinage with observed inventory slots/counts. Only authenticated self/owned-item
visibility and complete-CREATE provenance can establish omitted zero fields.

Recovery observes ghost flags before health, invalidates stale death-epoch
offers/queries, and keeps unresolved response correlation across timeouts.
Graveyard markers and sent requests never prove release or resurrection. Verify
actual death, observed ghost, corpse map/range/delay constraints, reclaim intent,
and observed life restoration without server edits or hidden session repair.
Include denied/full/empty loot and current-offer resurrection behavior; report
unexercised branches rather than infer success from codecs or fixtures.

The first rescue after attempt04 requires adding supported recovery controls and
reconnecting. Record it as repair-assisted; it does not satisfy the clean recovery
criterion above. A later complete death/ghost/reclaim/life cycle must use the
already-working interface without developer repair. A rejected native preflight
is not movement or a corpse query; actual corpse observations determine the
destination and reclaim range.

Independent loot review found that release packets do not uniquely acknowledge
an explicit close or prove cleared server loot ownership. A same-GUID reopen can
receive a preliminary release before its actual offer. Keep an opening request
unanswered until a matching full response. A release-only opening denial,
including ordinary out-of-range denial, currently requires an explicit ordinary
reconnect; this is a functional limitation, not completed denial/retry support.
Prove offered-item storage with raw slot/count changes, money with raw coinage,
and another valid window after closure. Retain the unanswered boundary in reports.

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

Use whichever tools and process best deliver the active goal. A multi-agent
`/vibe` session is one option, not a requirement. Superpowers and other
frameworks are optional aids, not mandatory execution sequences.

Milestones are progress and evidence checkpoints. A `/goal` can cover a single
milestone or an explicitly bounded objective spanning several. If the goal spans
milestones, continue through them without waiting for routine human approval.
Keep concrete completion criteria and verified increments rather than treating
an unbounded feature list as a definition of done.

For each goal:

- State the behavior, scenario, dependencies, non-goals, and completion evidence.
- Establish shared interfaces before dispatching independent work. Give agents
  explicit ownership; use local or Orca worktrees where isolation is needed.
- Keep one integration owner responsible for the combined result. Run final
  checks after concurrent edits settle, not against an incomplete mixed tree.
- Verify the actual changed surface: terminal interaction, server behavior, and
  Jev decisions where applicable. Review independently against the contract.
- Commit and push verified increments to `main` automatically, without PRs or
  releases. Repository rules live in [AGENTS.md](../AGENTS.md).
- Leave a concise completion record: landed commits, commands/scenarios and
  outcomes, known limits, blockers, and the next actionable slice.

A milestone gate is an evidence requirement, not a requirement for the user to
read code. Agents own routine engineering decisions and continue autonomously
within the active goal. Escalate missing prerequisites or materially different
user-facing scope, not implementation choices the agent can resolve. Never
quietly weaken behavioral acceptance criteria. Passing tests, model confidence,
and agent agreement are not substitutes for demonstrated gameplay.

The active goal continues through all six milestones without routine approval
gates. Direct control is the first landing checkpoint; combat and Jev integration
follow it. Material changes to the plan require independent advice, a recorded
decision, and concrete live-verifiable acceptance criteria.

## Existing work and present evidence

The current direct-control scenario uses Xiara, level 10, in Fairbreeze on
protocol map 530. Live checks exercised finite movement leases, explicit HALT,
facing, requested versus observed target selection, target clearing, and
same-socket READ_WAIT cancellation with coalesced and split command delivery.
Health remained 187/187.

Ordinary relogin confirmed server position
`8713.5126953125, -6669.2939453125, 70.33599853515625` and orientation
`0.5465620160102844`. The last predicted XY position differed by approximately
`0.000081` yards. Prediction and server observation remain separate: ordinary
movement did not echo the player's new position back to that same client.
Local command/response records are in `tmp/xiara-m1b-report.json`,
`tmp/xiara-m1b-evidence.json`, and `tmp/xiara-m1b-relogin.json`.

An isolated IPC-server smoke check exercised the actual CLI's nonzero exit on a
daemon `ERR` response. It did not establish that Xiara was rooted. Forced
movement, denied control and held remote-query cancellation now have live
evidence of their own, recorded below. Transport and flight remain covered only
by protocol or daemon regressions; the ordinary live walk does not prove them.
Independent review found and resolved cancellation and movement-envelope defects.
Final local checks passed 1306 tests, type checking, formatting, and the binary
build. The final rebuilt CLI also preserved STATUS after same-socket HALT and
confirmed target selection/clearing without displacement; evidence is in
`tmp/xiara-m1-final-report.json` and `tmp/xiara-m1-final-smoke.json`.

The `0x4` authentication failure recorded above was never a missing-credentials
problem. It was a client defect in `src/wow/crypto/srp.ts`, fixed by
`fix: Serialise SRP values at fixed byte width`. Salt, A, B and S were
serialised with a variable-width big-endian helper that drops leading zero
bytes, so whenever one of those random 256-bit values had a zero top byte the
client sent a 31-byte field. The server then computed a different proof and
answered `WOW_FAIL_UNKNOWN_ACCOUNT` (0x4), which reads as a bad account rather
than as a malformed packet. For A the short encoding also shortened the logon
proof packet itself, shifting every field after it. At roughly one in fifty
handshakes this failed about a third of full suite runs, and the misreading of
0x4 is what caused two-account scenarios to be recorded as blocked on absent
credentials. They were never blocked.

The suite is now stable: six consecutive clean 12/12 runs on 2026-09-21, four
from the investigating agent and two run directly by the integrating agent,
plus 1000 isolated auth handshakes with zero rejections. A regression test
pins the degenerate case by choosing an ephemeral exponent that makes A equal
the one-byte value 7, which the old encoder truncated.

One issue stays open and must not be read as fixed. An earlier run failed
`party management > invite, accept, leader transfer, leave` with a 30 second
timeout and no auth error, which is a different signature from the sub-second
0x4 rejections. The SRP fix touched only the auth path, so it cannot explain
that timeout, and six clean runs do not prove a rare fault absent. Treat it as
unexplained.

Three fault paths were proven live on 2026-09-21 and are committed as
`test: Prove fault paths on the live server`. They passed in every full run
made that day, including the runs where the auth defect above failed another
test, so they were never implicated in it. A forced `.tele` relocated the
character over 100 yards and the client recovered with no control error, a
clean STATUS and a working MOVE. A `.freeze` denied movement with under 1.5
yards of drift and `.unfreeze` restored it. A WHO pipelined with HALT on one
socket returned both responses sanely and left the session usable. Design and
acceptance are in `docs/plans/2026-09-21-fault-paths-live-plan.md`.

Transport is deferred with a verified reason rather than unproven.
`MovementHandler.cpp:419` boards a passenger only when the client itself sends
`MOVEMENTFLAG_ONTRANSPORT` with the transport GUID, and `ControlRuntime` never
sets it, so no fixture reaches the scenario. Boarding is a movement capability
for a milestone that owns it. Flight and knockback stay deferred for their
recorded reasons.

That run also exposed suite hygiene worth keeping: the two proximity tests
assert on SAY range and the visibility grid but never positioned the
characters, so they inherited whatever a previous run left behind and were
observed failing 1661 yards apart. They now position themselves, and the
teleport scenario restores its starting position.

Actual build-12340 spell tables were extracted with client MPQ patch precedence
and recorded in `tmp/gameplay-data/provenance.json`. The matching Expansion01
navigation data and native library are present, but their presence alone does
not prove navigation. Combat codecs, a lazy spell catalog, and a Jev transport
adapter are being prepared separately; they do not yet establish a combat loop.

The unmerged `vibe` branch contains movement, namigator navigation, combat, and
priest-hunting work, along with research notes and live-run journals. It is
reference material, not a merge candidate or the architecture to inherit.
Useful pieces may be reused after inspection and verification to the same
standard as new work. Its recorded successes are not proof of current readiness.

An initial TypeSafe experiment used six synthetic WoW scenarios with
`jev-1.13.0`. It demonstrated instruction-dependent action choices and measured
227–695 ms end-to-end calls from the development machine. It did not demonstrate
live gameplay, sustained 5 Hz operation, or domain-wide decision reliability.

The experiment also exposed an important distinction: a forced choice can favor
one of two equivalent actions while a separate judgment correctly says there is
no reason to prefer either. Typed output guarantees the interface, not the truth
or justification of a decision. Candidate design, uncertainty handling, and
scenario evaluation remain necessary.

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
