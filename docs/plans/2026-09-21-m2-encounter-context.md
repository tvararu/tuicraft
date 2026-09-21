# M2 encounter context and working plan

Date: 2026-09-21

Output of a brainstorming session with Theo, then revised after independent
advice. This records decisions, their reasons, and the running checklist. It
avoids code specifics deliberately; those belong to the work itself.

## What M2 still needs

Milestone 2 wants five completed autonomous encounters plus four robustness
exercises: cancellation, delayed responses, obsolete decisions, and model
unavailability. Only cancellation is close to done.

Three of those four cannot be produced by farming. No number of killed creatures
creates a late response, a stale decision, or an unavailable provider. They need
constructed faults at the Jev boundary during a real session against the real
server. A unit test does not satisfy the gate.

## Order of work

Approach planning does not gate the encounters. The tactics loop takes a target
GUID and never consults navigation; reaching a creature uses movement already
proven in milestone 1. So the encounters run first, because Jev behaviour is the
real unknown, and the native height verification is the work most likely to
consume a day without producing gameplay.

1. Evidence format, decided and committed before the first fight.
2. Live cancellation re-proof after the correlated-failure repair.
3. Five encounters.
4. The three constructed fault exercises.
5. Route planner verification and the short live approach with interruption.
6. Roadmap correction.

## Decisions

**Evaluate prompt variants live, not offline.** An offline replay harness was
considered and rejected. It would score variants against frozen decision points,
which measures agreement with the coordinator's judgement rather than what wins
fights. Farm live and improve as we go. No fixture corpus, no replay tool.

**Five encounters after the renormalisation fix, not four.** Attempt05 predates
`3e1f3aa` and is treated as history rather than as evidence one of five. At its
fifteen second pace a fifth encounter costs almost nothing and removes a
question a reviewer would otherwise be right to raise.

**Let the character level, and say plainly what that costs.** Farming produces
experience, so level, mana pool and spell kit all move during the run. Encounter
twenty is not comparable to encounter three. The prompt-engineering work
therefore yields an informed opinion, not controlled evidence, and no report may
describe a variant as measured better.

Two consequences follow. Client spell metadata is not evidence that a spell is
learned or usable, so the learned spellbook is re-verified after every level-up
rather than once at the start. And creatures are chosen to keep the fight
contested: a much stronger character removing a weak creature in one action
produces an encounter where the choice did not matter, which is weak evidence
for a genuine encounter.

**One carve-out inside the uncontrolled farm.** M2 requires a demonstration that
changing the instruction changes behaviour. That comparison runs the two
standing instructions back to back, at the same level, against comparable
creatures. Everything else stays uncontrolled.

**Frame the situation minimally at first.** Jev is told it is a level 10 priest
in WoW 3.3.5a fighting a hostile creature, and nothing more; the observation and
candidate descriptions carry the rest. This is the cheapest framing and the
baseline the longer variants are judged against. It depends on Jev holding
useful WoW knowledge, which is unverified, and Jev is a judgment model rather
than a frontier chat model, so those priors may be thin. That is settled by
watching the first fights. If its choices look uninformed, the next rung states
the mechanics that matter without relying on the game being recognised.

**The coordinator selects targets. Jev owns everything inside the fight.** No
autonomous target selection is built. This keeps M2 inside its stated boundary
and keeps the record clear about who decided what. Letting Jev choose what to
engage is a wanted future mode and is deferred.

**A death is a recorded failure plus a manual recovery.** Milestone 4 is not
pulled forward.

**Cadence is measured, not derived.** Decisions per second actually achieved,
including execution time, instrumented from the first encounter. The round-trip
latency of a single request is a different number and must not be presented as
cadence.

## Evidence

Retained artifacts currently live only in `tmp/`, which is gitignored and pushed
nowhere. That is the failure mode AGENTS.md already flags for the worktree
archive, and M2's gate is an evidence requirement a reader must be able to
inspect. A compact per-encounter record is therefore committed, holding the
observation, the offered actions, the Jev choice, the execution outcome, the
measured latency and cadence, the character level and the creature level. Raw
dumps stay in `tmp/` as backing detail.

## Prompt variation

Theo asked for real prompt engineering rather than one text: shorter and longer
forms, and tuning of the content supplied. Minimal framing is rung one. Later
rungs add mechanical context, adjust how unavailable-action reasons are
presented, and vary how much recent outcome history is included. Each variant is
tried live and its record names the encounters that ran under it.

## Checklist

- [x] Decide and commit the per-encounter evidence format
- [x] Re-prove live cancellation after the correlated-failure repair
- [x] Encounter 1 of 5, with cadence instrumented
- [x] Encounters 2 to 5
- [x] Standing-instruction contrast pair, same level, comparable creatures
- [x] Roadmap correction: stale tolerance paragraph
- [x] Record loop rate separately from tactical decision rate
- [ ] Constructed fault: delayed response past the bound
- [ ] Constructed fault: obsolete decision
- [ ] Constructed fault: model unavailable
- [ ] Prompt variant ladder beyond minimal framing
- [ ] Route planner verification on the 20-yard case
- [ ] Short live approach with interruption and server-position confirmation
- [ ] Roadmap: record M2 outcomes and remaining limits
- [ ] `mise ci` and `mise test:live` run by the integrating agent

## Open items

Resolved since this was written:

- Both standing instructions are now pinned in `src/wow/standing-instructions.ts`
  and the duplicated default is gone.
- A ground-height query now runs during free movement, and an obstruction is
  reported as `blockedReason: "obstructed"` rather than a fatal error.
- The tactics loop stops with `target_unreachable` instead of spinning on an
  unreachable creature.
- Situation framing is selectable, defaulting to today's behaviour.
- Jev faults are injectable through `JEV_FAULT` and `JEV_DELAY_MS`.

Still open:

- The instruction rejects line breaks but has no length limit, so an overlong
  one reaches the request unbounded.
- The `party management` 30 second timeout from the M1 suite stays open and
  unexplained. It does not touch the encounter path.
- The client has no collision sensing. An obstruction is now reported honestly
  but nothing routes around it; the operator steers by hand.
- The client never chases, so a creature that leashes home cannot be finished.
- `serverPose` does not update for the character's own movement, so the
  `distance` column in `nearby` is stale after any walk.

## Constraints carried in

Workers are `agy` and the local qwen, with Sonnet 5 as escalation. Planner and
native geometry verification is a poor fit for `agy` and stays with the
coordinator or a Sonnet 5 escalation. Roadmap editing and the constant de-dup
are good worker tasks. Jev spend is roughly $4.89 of $5 and is not a practical
limit. Nobody else is playing the character.

## A noted future direction: movement as a tactical action

Theo's observation, 2026-09-21. There will be situations where cancelling a
cast and retreating is the better play.

Half of that already works. `cancel` is offered as a candidate whenever a cast
is in flight, and Jev weighs it: in the cancellation run it scored `cancel` at
0.06 against `wait` at 0.94, so the judgement is live, it simply chose not to.

The missing half is that no movement action is ever offered. Jev can stop
acting but cannot reposition, so retreat is not expressible in the current
candidate set. This is the same gap that made the leash failure unwinnable,
where a creature was driven to 2 health and the character had no way to close
the remaining distance.

The roadmap already anticipates this under milestone 4, which asks for tactics
such as kiting without letting one class's fixed rotation become the
architecture. Kiting is cancel plus reposition. The prerequisite is that
movement becomes an offered action rather than something only the supervising
agent performs, which in turn depends on the approach capability milestone 3
owns.

No work is scheduled against this. It is recorded so the connection between
the observed limitation and the existing milestone is not rediscovered later.

## Fix list, opened 2026-09-21 after the live session

Ordered by what blocks the most. Each item names who owns it.

1. **An attacking creature must be fightable.** A faction template 7 Crazed
   Dragonhawk killed the character four times while `fight` refused it with
   `unverified_hostile_relation`. The escape hatch at
   `src/wow/combat-actions.ts:407-408` exists but did not fire. Must not be
   fixed by forcing hostility, because wrongly attacking neutral creatures is
   worse than refusing. Owner: worker, in progress.

2. **The navmesh height query fails on legitimate ground.** `goto` to the
   server's own reported corpse position returned `pathfind_find_height failed
   (UNKNOWN_HEIGHT)`. This is not bad input: the server placed the corpse
   there. Until this works there is no usable pathfinding, and every approach
   and corpse run is hand-steered. Owner: worker, queued. This is the milestone
   2 navigation prerequisite that was deferred.

3. **The three constructed fault exercises.** Tooling is committed and works.
   Blocked only on keeping the character alive near a fightable creature, so
   item 1 gates it. Owner: coordinator, live.

4. **Corpse reclaim returns the character into danger.** Reclaiming restores
   her at the place she died, at partial health, beside whatever killed her.
   With an unfightable attacker present that is a loop, and it caused deaths
   three and four. Needs a supported way to recover elsewhere, or an observed
   warning before reclaiming. Owner: unassigned.

5. **No collision sensing and no routing around an obstruction.** Obstruction
   is now reported honestly as `blockedReason: "obstructed"`, which is a real
   improvement, but nothing acts on it. Hand steering failed twice in
   instructive ways: it drifted the character from 109 to 173 yards from the
   corpse by keeping whatever the last probe left, and it thrashed for twelve
   iterations at 114.6 yards because each cycle re-faced at the destination and
   walked back into the same structure. Largely subsumed by item 2. Owner:
   unassigned.

6. **Movement is never an offered action.** Recorded above as a future
   direction rather than a defect. Deferred to the kiting work in milestone 4.

## Navmesh routing is a stopgap, not the path to kiting

Theo's observation, 2026-09-21. Recorded as direction, not a design.

Navmesh route planning is the right tool for getting somewhere: plan a
corridor, walk it, arrive. It is the wrong shape for kiting. Kiting is a
continuous control problem, where the useful decision is which way to face and
whether to keep backing away right now, revised several times a second against
a creature that is also moving. Planning a route to a point and walking it
cannot express that, and a planner that refuses on ambiguous ground, as ours
correctly does, cannot be in the inner loop of a fight.

The direction is that Jev eventually drives every input directly, at several
decisions per second, rather than selecting from a small menu of prepared
actions. The TypeSafe Doom harness is the reference: a structured account of
the situation goes in, an input comes out, repeatedly and quickly.

This is not in conflict with the existing rule that Jev must not invent
coordinates. Driving inputs means choosing among directions and intents the
client validates, not emitting world positions. How that is expressed remains
open.

No work is scheduled against this and it is deliberately not solutionised here.
It is recorded so that the current hand-steering and the navmesh gates are not
mistaken for progress toward kiting.
