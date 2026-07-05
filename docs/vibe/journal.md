# vibe journal

Working log for the autonomous `vibe` branch. Newest entries at the bottom.

## 2026-07-05 — kickoff: movement

Goal set: full movement support (see git history for the exact goal text).
Acceptance: Xiara walks Fairbreeze Village → Silvermoon City gates on a
navmesh path, observed smooth by a second account and `.gps` ground truth;
arrival event in JSONL; reverse journey; `follow` tracks a moving player
100+ yards.

State at kickoff:

- Research complete: `research-movement.md` (5-agent workflow over
  wow_messages, AzerothCore source, tuicraft, namigator). Key facts: no
  movement anticheat in AC; only kick = speed-ack above server value;
  teleport acks mandatory (movement dropped while pending); MSG_MOVE bodies
  are PackedGuid + MovementInfo both directions; fall damage avoidable.
- namigator built at `~/code/namigator/build` (static PIC archives incl.
  extern-C bindings; MapBuilder CLI validated on Deadmines: 17s, 36MB).
- Expansion01 (map 530) navmesh build started ~20:35 local, 12 threads,
  output `~/wow-data/nav`, log `~/wow-data/expansion01-build.log`. Build
  cost unknown — first measurement, record here when done. BVH `-b` pass
  queued sequentially after (same output dir, avoid races).
- Live server: AzerothCore playerbots @ t1, accounts DEITY/X both gmlevel 3.
  Xiara (lvl 10) parked in Fairbreeze Village, map 530
  (X 8702.7, Y -6638.8, Z 72.7). GM command replies arrive as SYSTEM events
  ~3-5s delayed.

Plan: wire serializers → own-state → acks → daemon engine (straight-line
goto first, live-verified) → FFI bridge → pathed goto/follow → acceptance.
