# Roadmap: a programmable, AI-playable WoW client

Date: 2026-09-20

Status: direction reviewed. This captures the intended ambition, not an
implementation plan or a claim that the capabilities below already exist.

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

### 4. Repeatable encounter cycles

Deliver this in bounded slices: encounter robustness, encounter completion and
loot, then death and recovery. Expand spell, aura, interruption, resource, and
threat handling as those scenarios need them. Support tactics such as kiting
without making the first class's fixed rotation the architecture.

**Exit evidence:** run sequences of encounters, verify rewards or loot where
relevant, respond to trouble, and recover or report a concrete blocking
condition. A rising kill count alone does not establish success. Death/recovery
scenarios must not depend on a developer secretly repairing the session.

### 5. A selected questing loop

Add the NPC interactions, quest state, inventory, and other capabilities required
for a chosen quest scenario. Present real interaction options as concrete
choices, with server-confirmed transitions.

**Exit evidence:** an agent can accept a quest, travel, perform its objectives,
return, and turn it in, with Jev handling the relevant moment-to-moment work.
Verify actual quest progress and completion. This does not require discovering
every quest chain or building a general-purpose planner.

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

The next gameplay goal is milestone 1. Select its concrete first scenario and
inspect the current implementation before deciding which changes it needs.

## Existing work and present evidence

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

No bulk merge of `vibe` or commitment to a natural-language planner, generic task
framework, or exact rendering implementation. Process policy and milestone
order are agreed; detailed capability contracts and acceptance scenarios still
need to be defined as each goal begins.

The README remains the concise public overview. This document holds the expanded
ambition while it is being aligned and refined.

## References

- [Earlier spatial TUI vision](plans/2026-02-20-tui-vision-design.md)
- [TypeSafe announcement and Doom discussion](https://typesafe.ai/blog/introducing-system-one-models-and-jev)
- [TypeSafe programming model](https://docs.typesafe.ai/concepts/how-to-build-with-system-one)
- [TypeSafe API](https://docs.typesafe.ai/api)
- [Jev model limitations](https://docs.typesafe.ai/model-jaggedness/jev-1.13)
