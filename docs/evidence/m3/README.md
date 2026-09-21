# M3 evidence: tactical movement, verified live

Live-verified against the real server via `./dist/tuicraft`, character Xiara
(0x3eb, level 10 priest, map 530), 2026-09-21. TypeSafe/Jev model
`jev-1.13.0`. Configured lease: 2500ms (`DEFAULT_MOVE_LEASE_MS`,
`src/wow/combat-actions.ts:79`).

## Starting state and recovery

Xiara started this run as a **ghost** at (8709.46, -6671.76, 70.34), corpse
153 yards away at (8801.13, -6550.23, 53.19), reclaim blocked
(`corpse_out_of_range`). Ground-route `goto` toward the corpse failed
immediately (`pathfind_find_height failed (UNKNOWN_HEIGHT)`), consistent with
the M2 finding that the route planner refuses to plan from a ghost, so the
corpse run used `face`/`move` directly, in short legs with heading
recalculation and lateral detours around refusals. She reached the corpse,
reclaimed, and was alive with full HP after the first cycle.

**She died five more times during this session**, all attributable to the
same unfightable "Crazed Dragonhawk" documented in
`docs/evidence/m2/README.md` ("A creature that kills the character but cannot
be fought") wandering the same territory as the fightable Springpaw
Stalkers used for the encounters below. Full detail, death-by-death, is in
[hazard-crazed-dragonhawk.json](hazard-crazed-dragonhawk.json). Each time,
release-spirit -> corpse travel -> reclaim -> immediate flee (no pause to
check state or cast) recovered her cleanly, and health regenerated to full
within seconds once clear of that x/y band.

**Final state: Xiara is alive, 187/187 health**, confirmed via a daemon
restart (relogin) — see item 5 below and
[position-confirmation.json](position-confirmation.json).

## Exit-evidence items, one by one

### 1. Jev selects movement candidates during a live encounter and the character moves as chosen — EXERCISED, live

[encounter-02-kite-blocked.json](encounter-02-kite-blocked.json), run
`3773ab72-1d8d-454b-8bab-d1f4f5c64aba`, instruction told Jev to kite the
target. Every one of 86 requested decisions offered `move_forward`,
`move_backward`, `strafe_left`, `strafe_right`, `stop_moving` and `wait`
alongside spells; Jev chose `move_backward` on decision 1 (confidence 0.81)
and on all 85 subsequently-applied decisions. `lastDecision` reports
`{"actionId": "move_backward", "disposition": "applied", "reason": "ok"}`,
and the character's own reported pose in the observation stream recedes
continuously (separation from target grows from 2.26 to 83.12 yards across
the run) — the character moved as chosen, not just "chose" on paper.

[encounter-01.json](encounter-01.json) (kill-credit run, no kiting
instruction) additionally confirms the observation carries what the design's
"observation must gain distance" section required:
`separation: 3.4995...` and `facingTarget: true` were present in the live
`tactics --json` observation object (also visible mid-fight in
encounter-02's raw request records). This was a design prerequisite, not
previously demonstrated live, and it is now.

### 2. The lease holds under refresh and expires without one — BOTH HALVES EXERCISED, with a methodology caveat

**Expiry without a refresh**, via the direct CLI primitive:
[lease-expiry-and-cli-refresh-caveat.json](lease-expiry-and-cli-refresh-caveat.json).
A single `move forward 4000` held `moving: true` continuously (position
advancing smoothly) through t=3.38s with no further command issued, then
stopped on its own with `reason: "lease"` — "a stop that follows from Jev
going quiet rather than an explicit choice," exactly as the exit criterion
asks.

**Sustained direction across several decisions (refresh)**, live, via Jev:
the same encounter-02 record above. 85 applied `move_backward` decisions in
a row, mean inter-decision latency 236ms (min 204ms, max 288ms), each
routed through `ControlRuntime.move("backward", 2500)` — the same
same-direction call the design's refresh branch handles
(`control.ts:344-347`, `guardMove` + `armLease` only, no stop). The lease
was refreshed roughly every quarter-second against a 2500ms lease, a ~10x
safety margin against a stutter.

**Methodology finding, not a defect**: the CLI `move` command cannot be
used to demonstrate silent refresh directly. `src/wow/client.ts:1279-1283`
wraps every exposed manual action (`move`, `face`, `cast`, `target`, ...) in
`override()`, which unconditionally calls `rawHalt()` first — including on
a same-direction re-issue. Two consecutive CLI `move forward` calls at the
same heading therefore show `movement_stopped("halt")` immediately followed
by a fresh `movement_started`, not a silent lease extension. Jev's own
tactics loop calls `control.move()` directly
(`src/wow/combat-actions.ts:168,189`), bypassing `override()`, so the true
refresh mechanic could only be verified through a live Jev encounter, not
through the CLI `move` primitive as originally assumed. This is correct
behaviour for manual preemption, not a bug, and it is recorded here because
it changes what "direct CLI commands exercise the same primitives" means in
practice for this exact mechanic.

### 3. A ground or safety refusal stops movement while a lease is live — EXERCISED, live, three ways

[ground-refusal.json](ground-refusal.json). All three refusal reasons named
in the M3 design were observed live, each pre-empting an active lease:

- `height_unresolved` — a 3000ms lease, live only 1.5s, halted mid-flight;
  retrying the identical heading halted again instantly at the identical
  point (a persistent boundary, not a lazy-load hiccup).
- `obstructed` — during a later approach, a different lease halted with
  this reason instead.
- `ambiguous ground column` (`src/wow/navigation.ts` `pick_destination`) —
  seven `goto` probes within ~15 yards of the `height_unresolved` boundary
  all refused this way, independently corroborating a genuinely
  multi-surface pocket of terrain (matches the M2 README's own "four-floor
  column" note nearby).

A short lateral detour (30-90 degrees off heading, one lease) reliably
escaped each pocket. `abortUnsafe("ground_height_unavailable")` was not
observed live this session; the two `haltMovement()` reasons were.

### 4. Standing-required action releases the lease and casts successfully; cast while moving refused with SPELL_FAILED_MOVING — HALF EXERCISED

[standing-cast-release.json](standing-cast-release.json).

**Positive half — exercised, live, twice.** `move forward` immediately
followed (no delay) by `cast <spellId> <target>` produced
`movement_stopped(reason="halt")` then `cast_started`/`cast_succeeded` both
times: the standing-required cast released the lease and succeeded. This
matches `src/wow/combat-actions.ts:203-204`'s gating rule, exercised via the
same halt-then-cast pattern both the CLI wrapper and Jev's own tactics loop
use.

**Negative half — NOT exercised live.** Two direct attempts to cast while
still moving (issuing `move` then `cast` back-to-back with zero deliberate
delay) both succeeded rather than failing with `SPELL_FAILED_MOVING`.
Reasoning, not just an excuse: every cast path in this codebase halts
*before* sending the cast, and the stop and cast packets go out back-to-back
on the same TCP connection in the same tick, so the server almost always
processes the stop first and never sees the caster as moving at cast time.
`SPELL_FAILED_MOVING` is a genuine, server-enforced, uniquely-attributable
code per the design's own research citations
(`Spell.cpp:4382-4391`, `SharedDefines.h`), but reproducing it live would
require either a deliberately un-halted cast (not exposed by any current
command) or a network-timing race this client's design specifically
minimises. **This exit-evidence half rests on code citations, not an
observed packet, and should not be reported as passing.**

### 5. Position confirmed against the server after a movement sequence — EXERCISED, live

[position-confirmation.json](position-confirmation.json). Method: the
daemon process was killed (`SIGTERM`) and restarted with `tuicraft start`,
forcing a fresh server login — ordinary movement never echoes the
character's own position back to the same client, so a relogin is the only
way to read an authoritative pose after moving (same method M2 used).
Predicted pose after a compound movement/flee sequence:
`(8733.095015636705, -6603.170830822355, 70.71809387207031)`. Server pose
after relogin: `(8733.0947265625, -6603.1708984375, 70.71809387207031)`.
Difference: ~0.0003 yards in x, ~0.00007 yards in y, 0 in z,
~1.3e-7 radians in orientation — within float32 rounding.

### 6. Recorded findings — decision rate, lease, refresh, helped/hurt

Not a pass condition; recorded as asked.

| Run | Decisions | Elapsed | Loop rate | Choice pattern | Outcome |
|---|---|---|---|---|---|
| [encounter-01](encounter-01.json) | 57 | 14271ms | 3.994/s | 1 face_target, 1 attack, 1 Power Word: Shield, 1 Renew, 4 Smite, 49 wait; **no movement candidate chosen** | `completed` / `server_kill_credit` |
| [encounter-02-kite-blocked](encounter-02-kite-blocked.json) | 86 | 20455ms | 4.204/s | 86 move_backward (85 applied) | `blocked` / `target_unreachable` |

Configured lease: **2500ms** (`DEFAULT_MOVE_LEASE_MS`). Achieved refresh
interval in the one run that used movement: mean 236ms, min 204ms, max
288ms — roughly ten refreshes per lease window, a wide margin against a
stutter at this loop rate.

Decomposing encounter-01 by the M2 methodology: 38 of 57 decisions (66.7%)
were forced (`wait`/`cancel` only offered); the rest included at least one
of spell, attack, face, or move.

**Whether movement helped or hurt, honestly**: in encounter-01, Jev never
chose a movement candidate at all — the target stayed in melee range on its
own, so movement was neither used nor needed, and the kill succeeded without
it. In encounter-02, under an explicit kiting instruction, Jev chose
`move_backward` on every single decision for the full 20-second run,
opening separation from 2.26 to 83+ yards with no re-engagement, until the
target went unreachable and the encounter ended with **zero damage dealt to
either side**. In this session, movement, once actually used, directly
**hurt** the one encounter it appeared in: a repetition-only kiting
instruction with no situational return-to-range logic burned an entire
encounter for no outcome. This is consistent with the design's own
prediction that a runaway loop is possible and is the measurement milestone
4 needs, not a defect in the lease mechanism itself — the lease and the
ground-refusal gate both worked exactly as designed throughout; the failure
mode was Jev's own tactical choice, correctly executed.

Separately, and worth carrying forward: an unfightable, wandering hostile
mob (Crazed Dragonhawk) killed Xiara five times in this same territory
independent of any tactical-movement decision — see
[hazard-crazed-dragonhawk.json](hazard-crazed-dragonhawk.json). Nothing in
the current candidate set gives Jev, or a human issuing manual `move`
commands, any awareness of that hazard.

## Gaps remaining

- **`SPELL_FAILED_MOVING` was not observed live** (item 4, negative half).
  Two attempts both raced in the server's favour (stop processed before
  cast). Reproducing this deterministically would need either a
  deliberately un-halted cast path (not currently exposed) or repeated
  attempts under worse network conditions.
- **`wait`-as-hold was not exercised live against an already-moving
  character.** Both live encounters either never moved (encounter-01) or
  never chose `wait` while moving (encounter-02 chose `move_backward` on
  every decision). The refresh mechanic `wait` shares with same-direction
  `move_*` (`src/wow/combat-actions.ts:165-169`) was proven live through the
  latter path, not the literal `wait` action id.
- **`abortUnsafe("ground_height_unavailable")` was not observed live**;
  only the two `haltMovement()` ground-refusal reasons were (see item 3).
- Loot, quest, and follow-adjacent interactions were out of scope for this
  run and untouched.
