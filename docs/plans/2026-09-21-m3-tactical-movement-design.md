# Milestone 3 design: movement as a tactical action

Date: 2026-09-21. Condensed 2026-09-24; the full text, with the source line
citations of that date, is at `9c47b07`.

Status: implemented and accepted on 2026-09-22 with two gaps, recorded in the
milestone 3 section of [the roadmap](../roadmap.md), which is canonical. The
live records are in [docs/evidence/m3/](../evidence/m3/).

## What changed and why

Milestone 3 previously bundled ground navigation, remote movement reception and
character following. Theo's direction on 2026-09-21 was that navmesh route
planning cannot produce real kiting, and that Jev must eventually drive every
input several times per second. Milestone 3 became: **Jev gains directional
movement in its per-decision vocabulary during an encounter.** Route planning
(with the funnel-corner verification) and remote movement with following each
became their own milestone. The ground-query surface stays, because latched
movement resolves ground height on every integration step.

## The lease

Theo's design. A movement choice issues `move(direction, leaseMs)` against the
existing primitive. Every later decision naming the same direction refreshes
the lease, so movement continues only while Jev keeps confirming it. A
same-direction re-issue is a no-op and a direction change stops first, so no
new primitive is needed. A stale decision, timeout, transport failure, hang or
crash all resolve the same way: the lease lapses and movement stops.

**The lease is a safety bound, not a control semantic.** No candidate and no
movement state may encode the current round-trip time, because the same code
must be correct for a local model deciding every 16 ms.

**Sizing.** The measured M2 decision interval was 1.5 to 2.0 seconds. A 1500 ms
lease stutters; two to three times the interval lets an outage run the
character for up to six seconds. Start at 2500 ms and record the configured
value and achieved refresh rate in every encounter record.

## State transitions

Exactly three causes may change movement state:

1. A decision naming a different direction, or `stop_moving`.
2. Lease expiry.
3. A ground or safety refusal raised during integration (`obstructed`,
   `height_unresolved`, `ground_height_unavailable`).

Cause 3 is the Z-defect machinery from commit `6f30aaa` and outranks the lease.

## Vocabulary

Candidates `move_forward`, `move_backward`, `strafe_left`, `strafe_right`,
`face_target` and `stop_moving` map onto the existing movement directions. No
new protocol. `wait` **holds**: it refreshes the current lease and starts
nothing new. `stop_moving` is the explicit release.

## Candidate gating

Established from AzerothCore, `wow_messages` and the 3.3.5 DBCs; two claims were
verified independently against `Spell.cpp:4382-4391` and `Unit.cpp:4096-4104`.
The server enforces the movement rule outside the movement opcode handler:
cast-time spells are cancelled by polling in `Spell::update`, channels by
`AURA_INTERRUPT_FLAG_MOVE`, wand and auto-shoot by the realtime check in
`Unit::_UpdateAutoRepeatSpell`.

- A moving client that stays quiet still loses its cast. The loop must never
  depend on observing a client cancel.
- Instant-cast spells start and survive while moving. Cast-time spells and
  channels do not. Wand and auto-shoot cannot start or continue. Melee is
  unaffected.
- For the level 10 priest: Shadow Word: Pain, Power Word: Shield, Renew, Power
  Word: Fortitude and melee are movement-compatible; Smite, Lesser Heal and
  wand fire need a standstill. The expected pattern is an alternation, not
  continuous kiting.
- Choosing a standing-required action implicitly releases the lease.

## Observation and outcome

The observation gained target separation and facing, a prerequisite for any
meaningful movement choice.

`SMSG_CAST_FAILED` with `SPELL_FAILED_MOVING` (51) is the only
movement-specific signal, at cast start. After a cast begins, `Spell::cancel`
always reports `SPELL_FAILED_INTERRUPTED` (40), so a mid-cast movement cancel
is not observable and must not be claimed.

Ordinary movement does not echo the character's own position. Any evidence
claiming a confirmed position must say how it was obtained.

## Exit evidence

Theo's bar: good movement primitives, proven to work with Jev.

1. Jev selects movement candidates live and the character moves as chosen.
2. The lease holds under refresh and expires without one, shown separately.
3. A ground or safety refusal stops movement while a lease is live.
4. A standing-required action releases the lease and casts; a cast while
   moving is refused with `SPELL_FAILED_MOVING`.
5. Position confirmed against the server, with the method stated.
6. Recorded, not gated: decision rate, configured lease, refresh rate, and
   whether movement helped or hurt.

Two parts were not observed live and are the gaps in the roadmap decision:
the `SPELL_FAILED_MOVING` refusal in item 4, and a literal `wait` holding a
direction (the refresh was proven only through repeated `move_backward`).

## Explicitly out of scope

No local reflex layer, no stance abstraction, no parameterised or coordinate
movement (Jev returns one id from an enumerated set), no route planning to a
destination, no remote movement reception and no character following.
