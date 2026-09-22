# Milestone 4 design: repeatable encounter cycles

Date: 2026-09-22. Status: draft, pending review.

This note supports the milestone 4 section in `docs/roadmap.md`, which is
canonical. Where the two disagree, the roadmap wins.

## Scope decisions

M4 consumes M3 movement as shipped. It changes no movement candidate, no
lease value, and no Jev movement judgment. Re-engagement logic,
kiting-that-returns, and latency or reflex work stay out. They belong to a
later milestone with M3's runaway measurement as input.

M4 proves the cycle itself, not just its parts. A loop command runs fight,
loot, and next target in order. Named trouble rules stop the loop or start
recovery. The operator does not step between fights.

## Loop unit

One CLI command owns the sequence. It holds one state at a time:
fighting, looting, recovering, or stopped.

It calls shipped primitives only: the tactics fight loop, the rewards loot
calls (`openLoot`, `takeLoot`, `takeLootMoney`, `releaseLoot`), and the
recovery calls (`releaseSpirit`, `queryCorpse`, `reclaimCorpse`,
`respondResurrection`). No new protocol, no new judgment model input.

Each transition keeps its raw records: the fight outcome, the loot offer
and takes, the recovery observations. Kill count alone never passes.

## LLM ergonomics (dogfooding)

The loop command is driven by an LLM through the same CLI daemon as
everything else. Its interface must read well from that side.

One state object answers what the loop is doing. It carries the phase,
the current target, the last outcome, the last loot deltas, the recovery
state, and the stop cause. It is pollable with `--json` and visible in
the event stream. No separate query per concern.

Targets stay explicit. The LLM resolves victims first with
`nearby --json`, then hands the loop a GUID queue with an optional shared
instruction (`cycle <guid...> [--instruction ...] [--max N]`, where N caps
tactics-loop starts). The loop never auto-acquires. Auto-acquire is new
judgment and stays out.

Per-target failure skips, it never aborts the queue. A lost target records
its cause against that GUID and the loop advances to the next one. Loot
denial and death are loop-level: the loop stops with its cause, or enters
recovery and resumes with the next GUID after observed life.

Loot stays automatic. The loop takes every offered slot plus money and
reports per-slot deltas against observed inventory and coinage. The LLM
never names slots. An empty offer closes the window and advances to the
next target. A denied offer stops the loop with its cause. A refused take
stops the loop with its cause, including full inventory. A release-only
denial stops the loop and reports that an explicit ordinary reconnect is
needed first; the loop never reconnects itself.

Recovery stays honest about travel. Corpse-run navigation belongs to
milestone 3a, so the loop does not promise it. It drives the same bounded
direct legs M3 used live: one `face` plus one short `move` lease toward
the queried corpse pose per leg, a single fixed-angle retry on refusal,
then stop with the corpse pose and range when ground still refuses. No
planner, no destination sampling, no arrival logic.

Reclaim delay waits bounded. The queried delay carries a known
remaining time; the loop waits that long plus a small margin, retries
once, then stops with its cause if still gated. A cross-map or
out-of-range corpse stops the loop with the corpse pose and range. It
never walks blind.

Resurrection offers are accepted when current. A current-epoch unanswered
offer is answered accept; it restores life without a corpse run.
Stale-epoch offers are ignored through the recovery epoch check. Release,
query, reclaim, and the resurrection answer use the shipped primitives.

`halt` from outside the loop always wins. The loop's own primitive calls
route through `override()` and must not stop the loop itself; only an
external `halt` stops it. The loop never retries silently, and never waits
without a bound and a reported cause.
## Trouble rules

Per-target failure skips to the next queued GUID; loot denial and death
are loop-level. No silent retries.

- Target lost: the fight outcome reports unreachable or the target
  disappears. The loop records the cause against that GUID and advances.
- Loot denied: the loot offer carries an error, or a take is refused. The
  loop stops and names the cause. An empty offer is not denial: the loop
  closes the window and advances.
- Death: tactics already stops on observed dead or ghost life. The loop
  starts the recovery primitive and tracks release, corpse query, corpse
  travel, reclaim, and observed life restoration. A current-epoch
  resurrection offer is answered accept; stale-epoch offers are ignored.

A full death cycle must run with no developer repair: actual death,
observed ghost, corpse map and range checks, reclaim intent, and observed
life. Repair-assisted runs are recorded as such and do not pass.

## Roadmap repair

The M4 section still says movement is not an offered action and calls
route planning a prerequisite (`docs/roadmap.md:600-607`). Both claims
predate M3. Part of this work is to rewrite that paragraph: M4 consumes
the M3 lease movement as is, and route planning lives under milestone 3a.

## Evidence

Live proof has two parts. First, a run of fights with loot: each fight
ends in a recorded outcome, each loot ends in observed inventory or
coinage change. Second, one full death cycle with no developer repair,
from death through observed life restoration. Denied, full, and empty
loot branches are reported as exercised or unexercised, never inferred.

## Explicitly out of scope

No changes to movement candidates, lease values, or Jev fight judgment.
No re-engagement or return-to-range logic. No latency or reflex layer. No
quest behavior. No second-account follow behavior.
