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

## 2026-07-05 — engine, FFI, pathed movement, acceptance walk

- Movement engine (2802cdb): tick loop, goto/follow/face/halt, heartbeats,
  observed MSG_MOVE broadcasts feed the entity store. Live-verified:
  first goto landed at exact server-side coords; second-account
  observation showed steady 3.5 yd / 500 ms steps (7.0 yd/s — smooth,
  research Q4 answered); Xiara followed Deity 60 yd and parked 3.98 yd
  behind.
- FFI bridge (8552326): libnamigator.so linked from namigator's own PIC
  archives, no shim; stormlib bundles zlib/bz2 (Q5 answered). Fixture
  tests reproduce namigator-rs known-good values. Expansion01 probe:
  heights + zone/area match .gps exactly; 43-waypoint 1175 yd path in
  23 ms.
- Pathed movement (0ff24a0): navmesh corridors, follow re-pathing,
  on-demand ADT streaming (~150 ms/tile, cached), no_path stop reason.
- **Bug found live** (eead2de): 3D-distance legs stalled on Fairbreeze's
  stacked floors — find_height hopped levels, step collapsed to zero.
  Fix: navigate in 2D, snap z via find_heights closest to expected.
- **Acceptance walk**: Fairbreeze → Silvermoon City gates
  (9487.69, -7279.2, 14.29 — discovered via .tele SilvermoonCity), one
  command, 40 waypoints, 1076 yd. First attempt DIED in The Dead Scar:
  Scourge mobs rooted her (engine halted with reason "root", correctly)
  and killed the combat-less bot. Revived + .gm on to scope out mob
  interference; resumed walk arrived with ZERO coordinate error,
  confirmed by all three oracles (client MOVE_ARRIVED, server .gps,
  Deity's independent client seeing her at the gates).
- Design note for later: after FORCE_MOVE_UNROOT the engine stays idle
  by intent — the JSONL consumer decides whether to resume. Death is
  not yet detected (a dead client can still "walk"); combat-era work.

## 2026-07-05 — acceptance PASSED

Second live bug (cfeb009): the follow run ended standing exactly on the
target. On the steep descent the z-glue tolerance broke, interpolation
drift fed back into itself (z ~11 yd above ground), and follow's 3D
stop check could never reach 4 yd. Fixed by anchoring leg z at a fixed
leg-start (drift-free) and making follow decisions 2D. Regression test
added.

Final acceptance results, all live against t1:

1. One command, Fairbreeze → Silvermoon City gates (9487.69, -7279.2,
   14.29): 40-waypoint navmesh corridor, 1076 yd. Interrupted once by
   the Dead Scar (rooted + killed by Scourge — combat is out of scope;
   revived, .gm on, resumed). Arrived with ZERO coordinate error.
2. Smoothness: second account observed steady 3.5 yd / 500 ms steps.
3. MOVE_ARRIVED in the JSONL stream; server .gps exact match; Deity's
   independent client saw her standing at the gates.
4. Reverse journey: exact arrival back at Fairbreeze.
5. Follow: tracked Deity 155 yd down the descent, stopped 3.49 yd
   behind him (2D), .gps confirms.

Movement is done end to end: wire → acks → engine → namigator FFI →
pathed goto/follow, all live-verified with mock tests as the spec.

## 2026-07-05 — goal 2: combat + subagent grind

Goal set by Theo: implement combat and have a subagent grind 10 mobs
successfully — the acceptance doubles as proof that the CLI/JSONL
surface is genuinely agent-usable.

Facts at kickoff: Xiara is a level-10 Blood Elf PRIEST (classId 5) —
wand + Smite/SW:P/Renew kit, which lines up with the v5 healer-bot
trajectory. Springpaw Stalkers (lvl 6-7, 137 hp) around Fairbreeze are
the target prey. Research workflow launched over wow_messages /
AzerothCore / tuicraft / priest-grind domain knowledge, output to
research-combat.md. Slices: wire → state (spellbook/auras/cooldowns/
combat log) → engine (engage/loot/death recovery) → live vs Springpaws
→ subagent grind acceptance.
