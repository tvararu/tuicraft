# M2 evidence: a constrained Jev-controlled encounter

Milestone 2 needs five completed autonomous encounters plus four robustness
exercises. Attempt05 is treated as history rather than as evidence, because it
predates the probability renormalisation fix in `3e1f3aa`; all five counted
encounters run after it.

## Encounters

None completed yet.

| # | Result | Level | Creature | Decisions | Cadence /s | Variant |
|---|--------|-------|----------|-----------|------------|---------|

## Robustness exercises

| Exercise | Status | Record |
|----------|--------|--------|
| Cancellation after the correlated-failure repair | passed | [cancellation-reproof.json](cancellation-reproof.json) |
| Delayed response past the bound | not run | |
| Obsolete decision | not run | |
| Model unavailable | not run | |

The three outstanding faults cannot be produced by farming. Each one is
constructed at the Jev boundary during a real session against the real server.
A unit test does not satisfy the gate.

## Cancellation re-proof, 2026-09-21

Run `bfd20483-8968-4643-ac5f-388f47700acd`, level 10 Xiara against a level 7
Springpaw Stalker under the default standing instruction.

The loop made 16 decisions in 4603 ms before `halt` stopped it, a measured
cadence of 3.476 decisions per second. Request latency ranged from 229 to 596
ms. Every decision was applied; none was discarded and no transport error
occurred. Jev chose four distinct action kinds across the run: `face`, Mind
Blast, Smite and `wait`. The creature fell from 137 to 97 health and Xiara's
mana from 547 to 501, so the run was doing real work rather than idling.

`halt` stopped the run cleanly. Tactics reported `status: idle` with
`lastStopReason: halt`, and a Smite was in flight at the time.

Note that `cadence.perSecond` here is decisions over wall-clock time for the
whole run. It is not the reciprocal of request latency, and the two must never
be presented as the same measurement.

## What the cancellation run also exposed

**Halting a fight does not disengage the enemy.** After `halt` the Springpaw
Stalker kept attacking, Xiara had no tactical control, and she died. This is a
real limitation rather than a test artifact: cancellation currently stops the
character acting without ending the engagement or offering any escape. Anything
that halts a live fight must expect this.

**Recovery then completed with no developer repair.** The full cycle ran
through the already-working interface: observed death, `release-spirit`, ghost
at the Fairbreeze graveyard, `query-corpse` returning the corpse position,
movement back to it, `reclaim-corpse`, and observed restoration to life at
117/187 health. Milestone 4 states that a complete death, ghost, reclaim and
life cycle must use the working interface without repair, and that is what
happened here. This is recorded as an observation, not as a claim that
milestone 4 is met: loot, denied and empty cases, and resurrection offers were
not exercised.

**The route planner refuses to plan from a ghost.** `goto` toward the corpse
returned `position disagrees with ground height`, so the corpse run used the
milestone 1 `face` and `move` primitives instead. The ghost's Z does not match
the queried ground height at the graveyard. This belongs to the outstanding
planner verification work.

**A cold spell catalog reports every spell as unknown.** Immediately after
connecting, `combat --json` listed all 70 learned spells in `unknownLearned`,
which reads exactly like a broken catalog and would leave Jev with no
candidates. Running `spells` once warms the lazy catalog and `unknownLearned`
drops to zero. Check this before diagnosing a candidate failure.

## Reading a record

See [../README.md](../README.md).

## Limits carried in these records

The character levels during the farming run, so her spell kit, mana pool and the
relative difficulty of creatures all change. Encounters are therefore not
controlled comparisons, and no prompt variant may be described as measured
better on this evidence. The single exception is the standing-instruction
contrast pair, which runs back to back at one level against comparable
creatures.
