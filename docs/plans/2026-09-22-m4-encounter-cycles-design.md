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
`nearby --json`, then hands the loop a GUID list with an optional shared
instruction (`cycle <guid...> [--instruction ...] [--max N]`). The loop
never auto-acquires. Auto-acquire is new judgment and stays out.

Loot stays automatic. The loop takes every offered slot plus money and
reports per-slot deltas against observed inventory and coinage. The LLM
never names slots. A denied offer or a refused take stops the loop with
its cause, including the known release-only-denial reconnect limit.

Recovery stays honest about travel. Corpse-run navigation belongs to
milestone 3a, so the loop does not promise it. It drives the same bounded
direct legs M3 used live (`face` plus short `move` leases toward the
queried corpse pose, lateral detour on refusal) and stops with the corpse
pose and range when ground refuses. Release, query, reclaim, and the
resurrection answer use the shipped primitives.

`halt` always wins. The loop never traps it, never retries silently, and
never waits without a bound and a reported cause.

## Trouble rules

Three named stops, each reported with its cause. No silent retries.

- Target lost: the fight outcome reports unreachable or the target
  disappears. The loop stops and names the cause.
- Loot denied: the loot offer carries an error, or a take is refused. The
  loop stops and names the cause.
- Death: tactics already stops on observed dead or ghost life. The loop
  starts the recovery primitive and tracks release, corpse query, corpse
  travel, reclaim, and observed life restoration.

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
