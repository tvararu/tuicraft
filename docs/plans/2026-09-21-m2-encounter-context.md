# M2 encounter context and working plan

Date: 2026-09-21. Condensed 2026-09-24; the full text is at `9c47b07`.

Output of a brainstorming session with Theo, revised after independent
advice. It records decisions and their reasons. The outcome and the accepted
gaps are in the milestone 2 section of [the roadmap](../roadmap.md), and the
records are in [docs/evidence/m2/](../evidence/m2/).

## What M2 needed

Five completed autonomous encounters plus four robustness exercises:
cancellation, delayed responses, obsolete decisions and model unavailability.
Three of those cannot be produced by farming. They need constructed faults at
the Jev boundary during a real session against the real server. A unit test
does not satisfy the gate.

Encounters ran first because Jev behaviour was the real unknown; the tactics
loop takes a target GUID and never consults navigation.

## Decisions

- **Evaluate prompt variants live, not offline.** An offline replay harness
  would measure agreement with the coordinator's judgement, not what wins
  fights.
- **Five encounters after the renormalisation fix.** Attempt05 predates
  `3e1f3aa` and is history, not evidence.
- **Let the character level, and say what that costs.** Level, mana and kit
  move during a farm, so encounters are not comparable. Prompt work yields an
  informed opinion, not controlled evidence; no report may describe a variant
  as measured better. The learned spellbook is re-verified after each
  level-up, and creatures are chosen to keep the fight contested.
- **One controlled carve-out.** The instruction contrast runs the two standing
  instructions back to back at one level against comparable creatures.
- **Minimal framing first.** Jev is told it is a level 10 priest in WoW 3.3.5a
  fighting a hostile creature; observation and candidates carry the rest.
  Whether Jev holds useful WoW priors is unverified.
- **The coordinator selects targets; Jev owns everything inside the fight.**
- **A death is a recorded failure plus a manual recovery.** Milestone 4 is not
  pulled forward.
- **Cadence is measured, not derived.** Decisions per second including
  execution; a single request's latency is a different number.
- **Evidence is committed.** A compact per-encounter record holds the
  observation, offered actions, Jev choice, execution outcome, latency,
  cadence, and character and creature level. `tmp/` is gitignored and
  satisfies nothing.

## Checklist, as of the 2026-09-24 condensation

Done, per the roadmap outcome and commit `4ed0745`
(`test: Run the five outstanding M2 items live`):

- Evidence format; live cancellation re-proof; encounters 1 to 5; loop rate
  recorded apart from decision rate.
- The instruction contrast pair ran, but it is one unreplicated pair.
- Constructed faults: delayed past the age bound and past the timeout,
  obsolete decision, model unavailable (HTTP 503 and transport).
- A 62-yard route with wrong-floor and obstructed rejections, and a short
  approach halted mid-route with the pose confirmed on relogin.
- Roadmap outcome and limits recorded.

Not done:

- A demonstrated behaviour change from instructions. One pair cannot carry
  the claim; this is an accepted gap.
- Route planner verification on the 20-yard funnel corner (an accepted gap).
- The prompt variant ladder beyond minimal framing. Framing variants
  `none`, `minimal` and `mechanics` exist; I could not determine whether the
  ladder was evaluated live.

## Open items

Resolved:

- The standing instructions were pinned in `src/wow/standing-instructions.ts`.
  The 2026-09-24 review deleted that file; the texts are in
  `docs/evidence/m2/encounter-04.json` and `encounter-05.json`.
- Free movement runs a ground-height query and reports
  `blockedReason: "obstructed"`.
- The tactics loop stops with `target_unreachable` instead of spinning.
- Situation framing is selectable.
- Jev faults are injectable through `JEV_FAULT`. Stale after the 2026-09-24
  review: `JEV_DELAY_MS` is gone, and `JEV_FAULT` accepts only `delay:<ms>`,
  `http:<status>` and `transport` (see the
  [fault runbook](../evidence/m2/fault-runbook.md)).
- A creature attacking the character is now fightable. The client dropped
  every `SMSG_ATTACKSTART` where it was not the attacker; an observed incoming
  attacker now verifies hostility. Hostility is not forced.
- Movement became an offered action in milestone 3.

Still open when condensed:

- The instruction rejects line breaks but has no length limit.
- The `party management` 30-second timeout from the M1 suite is unexplained.
- No collision sensing; nothing routes around an obstruction.
- The client never chases, so a leashing creature cannot be finished.
- Corpse reclaim restores the character beside its killer at partial health.
- `goto` to the server's own corpse position failed with `UNKNOWN_HEIGHT`. The
  namigator boundary hypothesis in the roadmap is a diagnosis, not a
  confirmed fact.

## Recorded directions

Theo's observations, 2026-09-21, recorded as direction, not design:

- Cancelling a cast and retreating is sometimes the better play. `cancel` was
  already weighed live (0.06 against `wait` at 0.94). Repositioning needed
  movement as an offered action, which milestone 3 delivered.
- Navmesh routing is the tool for getting somewhere, not for kiting. Kiting is
  continuous control revised several times a second. The direction is that
  Jev eventually drives every input, choosing among directions and intents
  the client validates, never emitting world positions.
