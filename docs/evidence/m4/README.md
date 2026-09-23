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

## Still open (per roadmap exit evidence)

- Sequences of encounters with rewards/loot verified (needs an alive
  character with hostiles in range — the ghost saw none all night).
- A complete death/ghost/reclaim/life cycle with no developer repair.
- Denied/full/empty loot and current-offer resurrection branches.
