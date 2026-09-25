# Milestone 4 design: repeatable encounter cycles

Date: 2026-09-22. Condensed 2026-09-24; the full text is at `9c47b07`.

Status: implemented; exit evidence accepted on 2026-09-23. The milestone 4
section of [the roadmap](../roadmap.md) is canonical, and the live records are
in [docs/evidence/m4/](../evidence/m4/).

## Scope decisions

M4 consumes M3 movement as shipped. It changes no movement candidate, lease
value or Jev movement judgment. Re-engagement, kiting-that-returns, and latency
or reflex work stay out.

M4 proves the cycle itself. One command runs fight, loot and next target in
order. Named trouble rules stop the loop or start recovery. The operator does
not step between fights. The loop calls shipped primitives only: the tactics
fight loop, the loot calls and the recovery calls. No new protocol and no new
judgment input. Each transition keeps its raw records; kill count alone never
passes.

## LLM ergonomics

- One state object answers what the loop is doing: phase, queue with
  per-target status and cause, starts used, last loot, stop cause and detail.
  It is pollable with `cycling --json` and carried by `CYCLE` events.
- Targets stay explicit. The LLM resolves them with `nearby --json`, then runs
  `cycle <guid...> [--instruction ...] [--max N]`. The loop never
  auto-acquires.
- Per-target failure skips; it never aborts the queue. Loot denial and death
  are loop-level.
- Loot is automatic: every offered slot plus money. An empty offer closes and
  advances. A denied offer, a refused take (including full inventory) or a
  release-only denial stops the loop with its cause. The loop never
  reconnects itself.
- Recovery is honest about travel: one `face` plus one short `move` lease per
  leg toward the queried corpse, one fixed-angle retry on refusal, then stop
  with the corpse pose and range. No planner.
- A known reclaim delay waits its remaining time plus a margin, retries once,
  then stops. A cross-map or out-of-range corpse stops the loop.
- A current-epoch unanswered resurrection offer is accepted; stale-epoch
  offers are ignored.
- An external `halt` always wins. The loop never retries silently and never
  waits without a bound and a reported cause.

As built: `startCycle` takes control through the manual override once, and the
loop then calls the inner tactics, loot, recovery and control runtimes
directly, so its own calls never stop it.

## Trouble rules

- Target lost: record the cause against that GUID and advance.
- Loot denied: stop and name the cause. An empty offer is not denial.
- Death: run the recovery sequence through observed life, then resume with
  the next GUID.

A full death cycle must run with no developer repair: actual death, observed
ghost, corpse map and range checks, reclaim intent and observed life.
Repair-assisted runs are recorded as such and do not pass.

## Evidence

Live proof has two parts: a run of fights with loot, each ending in observed
inventory or coinage change, and one full death cycle with no developer repair.
Denied, full and empty loot are reported as exercised or unexercised, never
inferred. The accepted evidence left denied/full/empty loot and current-offer
resurrection unexercised.

## Explicitly out of scope

No changes to movement candidates, lease values or Jev fight judgment. No
re-engagement or return-to-range logic. No latency or reflex layer. No quest
behavior. No second-account follow behavior.
