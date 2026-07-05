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

## 2026-07-05 — wire, own-state, acks landed; navmesh built

- **Expansion01 navmesh: 634 s on 12 cores** (204,800 tiles, 800 ADT .nav
  files, ~3.5 GB). BVH pass: 163 models, 172 MB. The "hours per continent"
  community lore is dead on modern hardware. Research doc §4.5 updated.
- Wire serializers (`protocol/movement.ts`), own-state tracking, and all
  ack handlers (`movement-handlers.ts`) landed with mock-injection tests
  (e51dbff, bb455be, 61e93be).
- **Live-verified the full teleport matrix** with GM commands on Xiara:
  near tele (Fairbreeze → Ruins of Silvermoon, handshake completed, .gps
  position matches our adopted dest exactly), far tele 530→1 (.tele
  Orgrimmar: TRANSFER_PENDING → NEW_WORLD → our WORLDPORT_ACK accepted,
  server flooded new-world init packets), far tele 1→530 back to
  Fairbreeze via .go xyz. Entity store resets cleanly across maps.
- Gotchas learned:
  - **Rebuild before every live test** — ran one live round against a
    stale binary; the wedged teleport it caused was accidental proof of
    the no-ack failure mode the research predicted.
  - `.tele` into Ruins of Silvermoon aggro'd Wretched mobs; server
    refuses teleport while fighting → `.combatstop` first. A combat-less
    client needs GM escape hatches.
  - GM command replies take 3-5 s; `read --wait 8` minimum. Grep session
    log (`~/.local/state/tuicraft/session.log`) as ground truth.
