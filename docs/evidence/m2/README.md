# M2 evidence: a constrained Jev-controlled encounter

Milestone 2 needs five completed autonomous encounters plus four robustness
exercises. Attempt05 is treated as history rather than as evidence, because it
predates the probability renormalisation fix in `3e1f3aa`; all five counted
encounters run after it.

## Encounters

Five completed, all with server kill credit, all after the renormalisation fix
in `3e1f3aa` and the ground-height repair in `c406db9`.

| # | Result | Char vs creature | Decisions | Loop /s | Tactical /s | Avg latency | Instruction |
|---|--------|------------------|-----------|------------|-------------|-------------|-------------|
| [01](encounter-01.json) | kill credit | 10 v 7 | 54 | 3.817 | 0.49 | 260 ms | default |
| [02](encounter-02.json) | kill credit | 10 v 7 | 50 | 3.764 | 0.60 | 264 ms | default |
| [03](encounter-03.json) | kill credit | 10 v 7 | 54 | 3.834 | 0.64 | 259 ms | default |
| [04](encounter-04.json) | kill credit | 10 v 6 | 51 | 3.817 | 0.67 | 260 ms | default |
| [05](encounter-05.json) | kill credit | 10 v 6 | 65 | 3.879 | 0.54 | 256 ms | conserve mana |

The loop column is requests per second over wall-clock time. The tactical
column counts only decisions where the offered set included a spell, attack,
or face option, per elapsed second. Neither column alone is the decision
cadence; both are reported together every time a cadence figure appears.

Encounter 03 was run live while the user watched in their own client, as
reported by the operator; the record itself cannot show who was watching.

Measured loop rate sits between 3.76 and 3.88 requests per second across all
five, inside the 1 to 5 Hz ambition. Request latency averages 256 to 264
ms. The operator reports that no tactical command was given during any
encounter and the supervising agent only selected and approached the
creature; the records cannot show a negative, so this rests on the
operator's account, not on the JSON.

### Loop rate is not tactical decision rate

The loop column above is the loop rate: how often a decision was requested
and applied. It is real, but it counts turns where the client offered no
genuine choice. While a cast is in flight or the global cooldown is running,
the candidate set collapses to `wait` and `cancel`, and Jev answers `wait`.
Whether that answer is correct in each case is an inference; the records
show only that it was chosen, not that waiting was the right call.

Definitions, applied uniformly to all five records. A decision is forced
when the offered set is exactly `wait` and `cancel`. A decision is full-kit
genuine when the offered set includes a spell, attack, or face option. Rows
offering only `wait` and `stop_attack` are neither: stopping melee is a
minor choice, so they are listed separately rather than folded into either
column. Every row falls in exactly one of the three buckets, recomputed
from the JSON:

| # | Decisions | Forced (wait/cancel) | wait/stop_attack only | Full-kit genuine |
|---|-----------|----------------------|-----------------------|------------------|
| 01 | 54 | 42 (77.8%) | 5 | 7 |
| 02 | 50 | 32 (64.0%) | 10 | 8 |
| 03 | 54 | 38 (70.4%) | 7 | 9 |
| 04 | 51 | 37 (72.5%) | 5 | 9 |
| 05 | 65 | 56 (86.2%) | 0 | 9 |

So 64 to 86 per cent of decisions are forced, and the tactical decision
rate (full-kit genuine decisions per elapsed second) is 0.49 to 0.67 per
second rather than 3.8. Both numbers are worth keeping, but a report that
quotes only the loop rate overstates how much judgement is being exercised.
Milestone 2 asks for the actual cadence rather than an assumed 5 Hz, and
these two numbers together are that answer.

The genuine choices are where the instruction contrast below appears.

### The standing-instruction contrast (suggestive single pair, unreplicated)

Encounters 04 and 05 ran back to back, at the same character level, against
creatures of the same level, under the two pinned instructions in
`src/wow/standing-instructions.ts`.

| Action | 04, default | 05, conserve mana |
|--------|-------------|-------------------|
| Mind Blast, 8092, costly | 1 | 0 |
| Power Word: Shield, 17 | 1 | 0 |
| Smite Rank 1, 585, cheapest | 5 | 7 |
| Melee attack | 1 | 1 |

Under the conserving instruction Jev chose neither costly spell and used the
cheapest damage rank plus melee more often. The operator reports that nothing
in the code changed between the two runs and only the instruction text
differed; the records cannot verify that, they show only the choices.

This is one run per condition against different creature individuals with a
stochastic judge, and the whole difference is a single Mind Blast choice and
a single Power Word: Shield choice. That shape is consistent with noise, so
this pair is suggestive, not a demonstration of instruction-driven behaviour.
Replication (further runs per instruction) is still needed before the
behaviour change milestone 2 asks for can be called demonstrated.

A replication follows in the next section. The counts in the table above are
chosen decisions. Counted as applied, the pair differs by one Power Word:
Shield only; see [instruction-pairs.md](instruction-pairs.md).

### Replication: six more instruction pairs, 2026-09-26

[instruction-pairs.md](instruction-pairs.md) adds six counterbalanced pairs.
That is twelve encounters, recorded as `pair-01-a.json` to `pair-06-b.json`:
one new level 10 priest against level 6 and 7 Springpaw Stalkers, with the
same two instruction texts. All twelve completed with server kill credit.

Across all six pairs, the conserving instruction gave:

- No Power Word: Shield (5 of 6 default runs used it).
- Smite Rank 1 applied more than Rank 2 in every conserving run, and the
  reverse in every default run.
- Melee at least as often as its paired default run: 5 of 6 conserving
  runs against 2 of 6 default runs, tied in three pairs.

It also gave a new pattern: repeatedly starting a cast and then cancelling
it.

Mind Blast use and total mana on applied choices were mixed. Every
conserving run was slower and cost more health than its paired default run.
With n = 6 pairs and a stochastic judge, this is not a significance result.
Neither the analysis nor this README treats it as acceptance of the
milestone.

## Robustness exercises

All four run live against the real server; no kill was needed or sought.
Proof field per exercise is named in the last column.

| Exercise | Status | Record | Proof |
|----------|--------|--------|-------|
| Cancellation after the correlated-failure repair | passed | [cancellation-reproof.json](cancellation-reproof.json) | `halt` reported `status: idle`, `lastStopReason: halt` |
| Delayed response past the age bound | passed | [fault-delayed-stale.json](fault-delayed-stale.json) | `discarded` holds two `{reason: stale_age}`, `fault: delay:2500ms` |
| Delayed response past the request timeout | passed | [fault-delayed-timeout.json](fault-delayed-timeout.json) | `transportErrors: [jev_timeout]`, `outcome: failed/jev_timeout`, `fault: delay:6000ms` |
| Obsolete decision | passed | [fault-obsolete.json](fault-obsolete.json) | `discarded` holds `{reason: aborted}`, `fault: delay:2500ms` |
| Model unavailable, HTTP status | passed | [fault-unavailable-http.json](fault-unavailable-http.json) | `transportErrors: [TypeSafe HTTP 503]`, `outcome: failed`, `fault: http:503` |
| Model unavailable, transport | passed | [fault-unavailable-transport.json](fault-unavailable-transport.json) | `transportErrors: [fetch failed]`, `outcome: failed`, `fault: transport:network` |

Each fault was constructed at the Jev boundary during a real session via
`JEV_FAULT`, with a daemon restart per fault, against template-38 Springpaw
Stalkers near (8731, -6568). A unit test does not satisfy the gate, and none
is offered here.

## Route planner verification and short live approach, 2026-09-21

Both outstanding navigation prerequisites ran live the same day, on ground
near (8758, -6528) to (8758, -6590), with native column queries from
`findHeights` confirming each endpoint before commanding it.

A 62-yard planned route from (8758, -6528) to (8758, -6590) was accepted and
walked to completion: `navigation` reported `remaining` falling 47.979
through 33.965, 19.951 and 5.237 to 0 with `active: false` at the end.
Independent column queries along the corridor show one continuous surface
from 57.8 to 64.7, consistent with the accepted plan; the planner's own
per-step forward and reverse height checks and collision rays are enforced
in code (`src/wow/navigation.ts`, `groundPoint`), and no divergence was
observed. Start preservation is enforced by `rejectSnap` on the native path
endpoints in the same file; both live plans began at the observed start
with no snap error.

Rejections stop with a reason and walk nothing. A destination rounded to
64.4 over a true column of 64.656 (difference 0.256 against the 0.25
`GROUND_ERROR` gate) was refused with `position disagrees with ground
height` — the operator's rounding error, and the gate working as designed.
A four-floor column at (8713.8, -6625.3) was refused with `ambiguous ground
column` at `pick_destination`. A route across a double-floor span toward
(8742.7, -6608.5) stopped with `pathfind_find_height failed
(UNKNOWN_HEIGHT)` at stage `stop`. No silent retry in any case.

The short live approach with interruption ran on the same ground: `goto`
(8758, -6550) from (8758, -6590), halted mid-route. Navigation reported the
stop with `blockedReason: halt`, `remaining: 3.57`, and the predicted pose
at halt was (8758.567, -6553.524, 61.396). A daemon restart (relogin) then
returned the authoritative server pose as (8758.566, -6553.524, 61.396), a
difference of about 0.0005 yards. Server position came from the relogin,
not from the predicted pose, because ordinary movement does not echo the
character's own position back to the same client.

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

## Three live attempts at encounter one, and why each failed

These three attempts all predate the ground-height repair in `c406db9`. They
are kept because failed attempts are part of the evidence, and because together
they located the defect that the five completed encounters above depended on.

**[failed-01-out-of-range.json](failed-01-out-of-range.json)** — 18 decisions
over 118 seconds. Every offensive spell reported `out_of_range` because the
creature wandered off, and the client never chases by design. The loop did not
stop. It spun for two minutes choosing `wait` eleven times and self-buffs six
times, and it only ended because the operator halted it. A structurally
unreachable target must stop the run with a concrete reason; instead it burns
Jev requests indefinitely.

**[failed-02-leash-reset.json](failed-02-leash-reset.json)** — 161 decisions
over 79.4 seconds, a loop rate of 2.03 requests per second at an average
request latency of 261 ms. The tactical rate on the same run is 0.26 full-kit
decisions per second (21 of 161 offers included a spell, attack, or face
option), the lowest of any recorded run: the loop count is inflated by 140
`wait` answers, so the 2.03 figure must not be read as decision cadence. Jev
chose twenty real offensive casts. The
creature fell from 137 health to 2, then reset to full, because the client
cannot follow it and the server leashed it home. Xiara's own health never moved
from 217, so the creature was never engaging her in melee. Mana ran out at 13 of
547.

**[failed-03-not-infront.json](failed-03-not-infront.json)** — 3 decisions,
stopped with `server_action_rejected:134`. That code is
`SPELL_FAILED_UNIT_NOT_INFRONT` in `SharedDefines.h`: the server refused the
Smite because, on the reconstructed positions, Xiara was not facing the
creature, although the operator had faced her at it immediately before
engaging. Whether the refusal was correct depends on that reconstruction;
the code is observed, the correctness is inferred. One facing rejection ends
the whole run rather than re-facing and retrying.

### The confirmed cause

The suspicion was a wrong Z, and it was confirmed rather than left open.

At the moment of the third rejection the character and the creature were
**0.0004 yards apart horizontally and 6.17 yards apart vertically**. She was
standing directly above the creature. An angle between two points at the same x
and y is numerical noise, so the `face` action the loop itself chose produced a
meaningless orientation and the server answered
`SPELL_FAILED_UNIT_NOT_INFRONT`, consistent with that reconstruction.

Position drift was ruled out by measurement. A relogin taken immediately
afterwards returned an authoritative server pose matching the predicted pose
exactly: zero difference in x, y, z and orientation. Client and server agreed,
on a height that was wrong for the world, because this client reports its own
position and the server accepts it.

The mechanism was that free movement never integrated `z`:
`src/wow/control.ts` advanced x and y only. The character kept the Fairbreeze
graveyard height of 70.336 across a walk of roughly 140 yards and arrived inside
the creature's airspace instead of beside it at ground level. `c406db9` repaired
the integration by querying real ground height, and the five completed
encounters followed immediately.

Two related observations stand. `serverPose` never updates for the character's
own ordinary movement, so the `distance` column in `nearby` is computed from a
stale position: it read 25.3 yards while the predicted separation was 9.6. And
the route planner refuses to plan from a ghost, returning `position disagrees
with ground height`, which is the same Z problem seen from the other side.

### A gap the repair exposed

The client has no collision sensing. Walking into a tree produced
`ground_height_unavailable`, indistinguishable from a genuine height-query
failure, and the distance to the target stayed at exactly 46.5 yards across
twenty consecutive move commands. The operator reached the creature only by
trying heading offsets by hand and keeping whichever reduced the distance.
Honest reporting of an obstruction, and the approach capability itself, remain
outstanding.

## Reading a record

See [../README.md](../README.md).

## Limits carried in these records

The character levels during the farming run, so her spell kit, mana pool and the
relative difficulty of creatures all change. Encounters are therefore not
controlled comparisons, and no prompt variant may be described as measured
better on this evidence. The standing-instruction contrast pair runs back to
back at one level against comparable creatures, which makes it the closest to
a controlled comparison in the set, but it is still one unreplicated pair and
carries the same restriction.

## A creature that kills the character but cannot be fought, 2026-09-21

Xiara died four times in one area after the five encounters were recorded. The
deaths were not caused by the tactics loop and none happened during an
encounter.

The only aggressive creature in range each time was a **Crazed Dragonhawk,
faction template 7**. `tuicraft fight` against it is refused with
`unverified_hostile_relation`, both while it was idle and while it was actively
attacking her. The fourth death happened while she was walking away from it.

Springpaw Stalkers, faction template 38, engage normally, which is what all
five completed encounters were fought against.

The refusal comes from `src/wow/combat-actions.ts:409-417`, which requires the
loaded faction data to report the relation as hostile. An escape hatch already
exists immediately above at lines 407-408: a target whose own `target` field is
the character's GUID and which carries unit flag `0x80000` is allowed. That path
did not rescue the situation and the reason is not yet established.

This is recorded as a capability gap rather than a diagnosis. The faction data
may genuinely not mark that relation hostile, in which case forcing it would be
wrong: wrongly attacking a neutral creature is worse than refusing. What is not
acceptable is the present outcome, where the character dies repeatedly with no
way to respond. The investigation is in progress.

A second observation from the same sequence. Reclaiming a corpse returns the
character to the spot where she died, at partial health, next to whatever killed
her. With an unfightable attacker present this is a recovery loop rather than a
recovery, and it is what produced deaths three and four.

## Live suite after the protocol change, 2026-09-21

`mise test:live` was run by the integrating agent on the tree containing
`65bb5dc`, which changes `SMSG_ATTACKSTART` handling and is therefore a
protocol change requiring a live run rather than unit evidence.

Result: 12 pass, 0 fail, 252 assertions, 67.88 seconds.

`party management > invite, accept, leader transfer, leave` passed in this run.
That test carries the unexplained 30 second timeout recorded in the roadmap,
seen once and never reproduced. One clean run does not establish that a rare
fault is absent, so it stays open.
