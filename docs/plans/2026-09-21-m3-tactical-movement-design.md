# Milestone 3 design: movement as a tactical action

Date: 2026-09-21. Status: design accepted, not implemented.

This note supports the milestone 3 section in `docs/roadmap.md`, which is
canonical. Where the two disagree, the roadmap wins.

## What changed and why

Milestone 3 previously bundled three subsystems: ground navigation, remote
movement reception, and character following. Theo's direction on 2026-09-21 was
that navmesh route planning cannot produce real kiting, and that Jev must
eventually drive every input several times per second. That direction selects
one of the three and discards the framing of the other two.

Milestone 3 is now: **Jev gains directional movement in its per-decision
vocabulary during an encounter.**

Remote movement reception and character following leave to their own milestone.
Nothing in tactical movement reads another character's pose, and every test of
following needs a second live account, which the old milestone's own opening
paragraph said to avoid.

Route planning to a destination also leaves, and takes the funnel-corner planner
verification with it as its natural evidence.

The ground-query surface in `src/wow/navigation.ts` stays. Latched movement
calls `findHeight` on every integration step (`src/wow/control.ts:726`), so the
code the Z-integration defect lived in is load-bearing here even though route
planning is not.

## The lease

Theo's design, 2026-09-21. A movement choice issues `move(direction, leaseMs)`
against the existing primitive (`src/wow/control.ts:339`). Every later decision
naming the same direction refreshes the lease. Movement therefore continues only
while Jev keeps confirming it.

This needs no new primitive. `control.ts:344` already no-ops a same-direction
re-issue, so a refresh is free, and a direction change already routes through
`stopMoving("direction_change")`.

It also removes the need for a held-state-on-fault policy. A stale decision, a
timeout, a transport failure, a daemon hang or a crash all resolve the same way:
the lease is not refreshed and movement stops. An explicit release on a known
fault is still worth doing because it is faster, but the lease is the backstop
that covers faults not yet enumerated.

**The lease is a safety bound, not a control semantic.** This distinction is
what keeps timing out of the vocabulary. A future local Jev deciding every 16ms
refreshes a 2500ms lease continuously and never observes it; the same code at
today's cadence is marginal. No part of the design may encode the current
round-trip time into what an action means — no `back_off_briefly` candidate, no
movement state that self-expires on a tuned timer.

**Sizing.** The measured M2 decision interval is 1.5 to 2.0 seconds, so a
1500ms lease expires between normal decisions and produces a stutter. Sizing at
two to three times the interval removes the stutter but lets a total Jev outage
run the character for up to six seconds, roughly forty yards. Start at 2500ms,
make it configurable, and record both the configured value and the achieved
refresh rate in every encounter record. Treat stutter at today's cadence as an
honest signal about the round-trip time rather than something to tune away.

## State transitions

Exactly three causes may change movement state:

1. A decision naming a different direction, or `stop_moving`.
2. Lease expiry.
3. A ground or safety refusal raised inside `integrate()`:
   `haltMovement("obstructed")`, `haltMovement("height_unresolved")`, or
   `abortUnsafe("ground_height_unavailable")` (`src/wow/control.ts:769-778`).

Cause 3 is the Z-defect machinery from commit `6f30aaa` and outranks the lease.
Jev cannot hold a direction into unresolved ground. An earlier draft of this
design stated that movement changes only on a decision; that was false against
the existing code and is corrected here.

## Vocabulary

Movement candidates are named directions mapping onto the existing
`MovementDirection` and `DIR_START` table (`src/wow/control.ts:117-121`):
`move_forward`, `move_backward`, `strafe_left`, `strafe_right`, plus
`face_target` and `stop_moving`. No new protocol.

`wait` must be redefined. Its current description, "Do not start a new action"
(`src/wow/tactics.ts:9`), is ambiguous under a lease: a model reading it cold
cannot tell whether it holds the direction or releases it. `wait` **holds** —
it refreshes the current lease and starts nothing new — and `stop_moving` is
the explicit release. That reading makes the two candidates non-redundant and
lets Jev express "keep backing up, cast nothing", which is the core kiting beat.
The description string must be rewritten to say so.

## Candidate gating

Established by reading AzerothCore, `wow_messages` and the 3.3.5 client DBCs;
the full evidence with file and line citations is in the research report that
produced this section. Two load-bearing claims were verified independently
against `Spell.cpp:4382-4391` and `Unit.cpp:4096-4104`.

The server enforces the movement rule, but **not** in the movement opcode
handler. `HandleMovementOpcodes` contains no interrupt call. Enforcement is:

- Cast-time spells are cancelled by polling in `Spell::update`
  (`Spell.cpp:4382-4391`) when the caster is a player, the timer is running, the
  caster is moving, and the spell carries `SPELL_INTERRUPT_FLAG_MOVEMENT`.
- Channels are interrupted through `Unit::UpdatePosition` raising
  `AURA_INTERRUPT_FLAG_MOVE`, consumed by `RemoveAurasWithInterruptFlags`.
- Wand and auto-shoot are stopped every server tick by the realtime check in
  `Unit::_UpdateAutoRepeatSpell` (`Unit.cpp:4096-4104`). Hunter Auto Shot is the
  only exemption.

Consequences for the design:

**A moving client that stays quiet still loses its cast.** No client cancel
opcode is required. `CMSG_CANCEL_CAST` exists and the server honours it, but
nothing on the movement path needs or waits for one, so the loop must never
depend on observing a client cancel.

**Category rules.** Instant-cast spells start and survive while moving, unless
they carry `AURA_INTERRUPT_FLAG_NOT_SEATED`. Cast-time spells can neither start
nor survive. Channels can start only with zero cast time and
`SPELL_ATTR5_ALLOW_ACTION_DURING_CHANNEL`, and do not survive movement.
Wand and auto-shoot can neither start nor continue. Melee auto-attack is
unaffected in either direction.

**For the level 10 priest test character**, from `Spell.dbc` and
`SpellCastTimes.dbc`: movement-compatible are Shadow Word: Pain, Power Word:
Shield, Renew, Power Word: Fortitude, and melee. Requiring a standstill are
Smite, Lesser Heal, and wand fire. She has no channelled ability in scope.

This reshapes the expected behaviour. Her only movement-compatible damage is
Shadow Word: Pain plus melee, so the demonstrable pattern is not continuous
kiting but an alternation: apply the instant damage while repositioning, stand
to cast Smite or fire the wand, back off when the creature closes. That is a
real and interesting tactical shape, and it is what the exit evidence should
look for.

**Gating rule.** Choosing a standing-required action implicitly releases the
movement lease. This keeps Jev's interface a single choice from a candidate set
and avoids inventing a compound action. The alternative — offering
standing-required actions only when already stationary — was rejected because it
hides the trade-off from the model. Jev should be able to choose to stop in
order to cast.

## The observation must gain distance

The observation assembled for Jev (`src/wow/combat-actions.ts:73-105`) carries
no distance to the target. `separation(state)` is computed at
`combat-actions.ts:273`, `364` and `429`, but only to gate candidates
internally; the value never reaches the model.

That is correct today, because every action is range-gated before Jev sees it
and the model never needs the number. It breaks under this milestone: a model
asked to choose a direction without knowing whether the creature is at two
yards or thirty is choosing blind, and no amount of candidate gating can supply
that judgement for it.

Movement decisions therefore require adding to the observation, at minimum, the
separation from the current target. Facing relative to the target is likely
needed too, since backing away from a creature the character is not facing moves
her somewhere other than away from it; establish this against the live evidence
rather than assuming it.

This is a prerequisite to any meaningful movement choice, not a refinement of
one. Implement it before the first live encounter, and treat a sudden change in
Jev's behaviour on the existing non-movement candidates as an expected
consequence of changing the observation, worth recording rather than suppressing.

## Observing the outcome

`SMSG_CAST_FAILED` carries `SPELL_FAILED_MOVING` (51) when a cast is refused at
start while moving. No other gate produces that code, so a start refusal is
movement-specific and directly observable.

After a cast has begun, the cause is **not** observable. `Spell::cancel` always
reports `SPELL_FAILED_INTERRUPTED` (40) regardless of cause, so a movement
cancel is wire-identical to a counterspell, a stun, or a self-cancel. Evidence
for the gating rules must therefore rest on the start refusal, not on
mid-cast interruptions. A design that tried to measure "how often movement
interrupted a cast" would be measuring something it cannot distinguish.

`MSG_CHANNEL_UPDATE` with time 0 is also sent on normal channel completion, so
it does not prove interruption on its own. Not in scope for this character.

## Position confirmation

Milestone 2 recorded an unmet gap: a short live approach with interruption and
server-position confirmation. It stays in milestone 3, and not for tidiness.
The Z-integration defect hid for three encounters because nothing compared
predicted pose against server truth. Latched movement makes that failure
continuous rather than occasional, so the check is infrastructure here.

Ordinary movement does not echo the character's own position back, so an
authoritative reading needs a relogin or another server update. Any evidence
claiming a confirmed position must say how it was obtained.

## Exit evidence

Theo's bar, 2026-09-21: good movement primitives, proven to work with Jev.
Nothing beyond that.

1. Jev selects movement candidates during a live encounter and the character
   moves as chosen, with the applied decisions in the encounter record.
2. The lease holds under refresh and expires without one. Demonstrate both: a
   sustained direction across several decisions, and a stop that follows from
   Jev going quiet rather than from an explicit choice.
3. A ground or safety refusal stops movement while a lease is live, proving
   cause 3 outranks the latch.
4. A standing-required action releases the lease and casts successfully; a
   cast attempted while moving is refused with `SPELL_FAILED_MOVING`.
5. Position confirmed against the server after a movement sequence, with the
   method of confirmation stated.
6. Recorded, not gated: the achieved decision rate, the configured lease, the
   refresh rate, and whether movement helped or hurt the encounters.

Item 6 is a required finding rather than a pass condition. If latched movement
at achievable cadence loses fights, that is the measurement milestone 4 needs in
order to decide between attacking the round-trip latency and splitting the
control loop into a slow stance and a fast local reflex layer. Neither decision
should be taken before that evidence exists.

## Explicitly out of scope

No local reflex layer. No stance abstraction. No parameterised or coordinate
movement — Jev returns one id from an enumerated candidate set
(`src/wow/jev.ts:33-39`) and this milestone does not change that interface.
No route planning to a destination. No remote movement reception, and no
character following.
