# M4 evidence: repeatable encounter cycles

Live records against the real server via `./dist/tuicraft`, character Xiara
(0x3eb, level 10 priest, map 530). The M4 design
(`docs/plans/2026-09-22-m4-encounter-cycles-design.md`) wants two parts:
a run of fights with loot, then one full death cycle with no developer
repair. This directory holds what the live sessions actually produced —
blocked branches reported as blocked, never inferred.

## Records

- [recovery-blocked-2026-09-24.json](recovery-blocked-2026-09-24.json) —
  outcome `blocked`. A full ghost session (Healer pocket to south ridge,
  ~157yd mapped) in which both recovery prongs blocked with named causes:
  spirit-healer gossip select swallowed ×10 sessions (dialog opens, select
  never answered, bytes match spec), and corpse run stopped by
  wall-to-wall ambiguous ground with the corpse 140–250yd out of range.
  Corpse query round-trips (125/125), life observations (181), and
  ground-refusal stops (370 obstructed, 300 height_unresolved) all
  exercised. Fights, reclaim, resurrection accept, and corpse arrival
  unexercised — reported, not inferred. Raw detail: daemon session log
  (40710 lines) plus operator journal `tmp/m4-live/README.md` (gitignored).
- [encounter-cycles-positive-2026-09-23.json](encounter-cycles-positive-2026-09-23.json) —
  outcome `positive-partial`. Seven server kill credits with xp (distinct
  targets, ts>=1790118690822), six loot windows all opened->released with
  ack, one proved serial take-all ([0,1] with take->removed per slot),
  and six reclaims split by provenance: two clean no-repair cycles
  (gate 0.13yd / 0.00yd, ghost->alive observed) plus four repair-assisted
  (journal-recorded GM .go; log confirms gates and life transitions).
  Requested-vs-observed split explicit: server granted takes the loop
  refused to record on unconfirmed close. Money 0 in all six opens, so
  coinage proof unmet; denied/full/empty and current-offer resurrection
  unexercised. Raw source: append-only daemon session log (window-scoped
  timestamps; log totals drift as the daemon appends) crossed with
  operator journal `tmp/m4-live/README.md` (gitignored, read from the
  main-checkout disk copy — absent from a fresh worktree).

## Still open (per roadmap exit evidence)

- Multi-encounter run chaining fights back-to-back with per-window gain
  proof (one single-slot window shows kill->take->push->ack->inventory
  gain; the multi-slot take-all shows ordering + ack but no new-item gain,
  and money was 0 in all six opens).
- Denied/full/empty loot and current-offer resurrection branches.
