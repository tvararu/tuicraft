# M3a evidence: reliable local navigation, verified live

Live runs against the real server through `bun src/main.ts` from the
branch under test. Character: an own `eversong10` SOAP character
(Fgklhanhbel, 0xa02, level 10, account FAC6AB70D714B, deleted after the
run), spawned inside the Fairbreeze Village inn on map 530. Native data:
`/home/deity/wow-data/nav` with `/home/deity/wow-data/libnamigator.so`.
Raw command transcripts are kept beside this file; every quoted value below
comes from them.

## Slice 1: ground-derived `goto` (issue #120), 2026-09-26

Transcript: [ground-goto-transcript.txt](ground-goto-transcript.txt).

### Start refused inside a multi-floor column

At spawn, (8714.14, -6650.33, 72.75), the native column is
`[102.01, 93.44, 72.75, 70.37]`: inn floor, upper floors and the terrain
beneath. `goto 8755.71 -6687.55` refused with
`stop: ambiguous ground column at start` and `navigation --json` reported
`refusal: "stop"`, not `pick_destination`: a different destination cannot
help while the character stands in that column. Before this change the same
refusal was the bare `ambiguous ground column`, classified
`pick_destination`, which would have sent an agent picking destination
after destination from inside the building.

The character left the inn by a `walk-toward` leg east along the floor and
a `face 4.7124` + `move forward 1500` leg down the ramp, ending at predicted
(8723.14, -6665.85, 70.26).

### Unique column walked to arrival

From there, `goto 8764.71 -6648.63` refused with
`stop: pathfind_find_height failed (UNKNOWN_HEIGHT)`; that is the funnel
corner gap (slice 2), not a slice 1 fault, and it moved nothing.

`goto 8764.71 -6683.07` (no Z) returned `kind: "intent"`. The daemon took
Z from the unique native column, 69.78932189941406, and `navigation --json`
polled about every 1.2 s read:

| active | remaining (yd) |
| ------ | -------------- |
| true   | 36.58          |
| true   | 28.17          |
| true   | 19.05          |
| true   | 10.65          |
| true   | 1.54           |
| false  | 0              |

The last state had `blockedReason: null` and `refusal: null`, with
`destination {x: 8764.71, y: -6683.07, z: 69.78932189941406}`. The control
pose was predicted (8764.71, -6683.07, 69.789).

### Ambiguous column refused with nothing walked

`goto 8714.14 -6650.33` (the inn column) returned
`pick_destination: ambiguous ground column at destination`.
`navigation --json` held `destination {x: 8714.14, y: -6650.33}` with no Z,
`refusal: "pick_destination"` and the next step "Choose a destination with
one ground height. Do not guess Z." The control pose before and after was
the same object, `updatedAt: 1790381666269`, `moving: false`. The only
event was one `control_error` event; there was no `movement_started`.

### Relogin pose

`stop`, then `start`. The server login pose was
(8764.7099609375, -6683.06982421875, 69.78932189941406) with
`source: "server"`. That is the ground-derived destination at f32
precision.

### Re-proof on main's ground policy (2026-09-26)

After #122 was rebased onto `main` with #172's route ground policy
(`checkRouteGround`, which now reports `ambiguous ground column at route`),
I repeated the slice 1 run on a new own eversong10 character, Fgklhjaildd
on account FAC6AB7908B33, deleted afterwards. The transcript is
[ground-goto-reproof-transcript.txt](ground-goto-reproof-transcript.txt).

- At spawn inside the inn, `goto 8755.71 -6687.55` refused
  `stop: ambiguous ground column at start`.
- After two `walk-toward` legs and `move forward` out of the inn, the
  character stood at (8723.14, -6669.55), where the column holds a single
  height of 70.149.
- From there, `goto 8764.71 -6683.07` walked with no Z supplied. It started
  at `remaining` 36.71 with the derived Z 69.78932189941406 and ended at
  `active: false, remaining: 0`. The CONTROL events were `movement_started`
  and then `movement_stopped` (`arrived`).
- `goto 8714.14 -6650.33` refused
  `pick_destination: ambiguous ground column at destination` and nothing
  moved: the pose `updatedAt` stayed 1790415017995 and the only event was
  `control_error`.
- After relogin, the server pose was
  (8764.7099609375, -6683.06982421875, 69.78932189941406).

## Slice 4: repeat and redirect (issue #124), 2026-09-26

Transcript: [repeat-redirect-transcript.txt](repeat-redirect-transcript.txt).
Every `goto` below omitted Z (slice 1). After each arrival the daemon was
stopped and started again, and `control --json` read the server login pose.

### One known route, three times

The route runs from A = (8709.46, -6671.76) to B = (8764.71, -6683.07),
56.4 yards over open ground south of the Fairbreeze inn. Between runs the
character walked back from B to A along the same route, and those returns
also arrived and were relogged. Each run ended with `navigation --json`
reading `active: false, remaining: 0, blockedReason: null`. Its CONTROL
events were exactly `facing_changed`, `movement_started`,
`control_changed`, `movement_stopped` (reason `arrived`) and
`control_changed` (`arrived`).

| Run    | Relogin pose after arrival (server)                    |
| ------ | ------------------------------------------------------ |
| 1 A→B  | (8764.7099609375, -6683.06982421875, 69.78932189941406) |
| 1 B→A  | (8709.4599609375, -6671.759765625, 70.33597564697266)   |
| 2 A→B  | (8764.7099609375, -6683.06982421875, 69.78932189941406) |
| 2 B→A  | (8709.4599609375, -6671.759765625, 70.33597564697266)   |
| 3 A→B  | (8764.7099609375, -6683.06982421875, 69.78932189941406) |
| 3 B→A  | (8709.4599609375, -6671.759765625, 70.33597564697266)   |

The `remaining` values fell by about 7 yards per 1-second poll in every
run. That matches the observed run speed of 7.

### Redirect mid-route

From A, `goto 8764.71 -6683.07` started toward B. `navigation --json`
read `remaining` 45.87 and then 35.35. Then
`goto 8744.35 -6687.06` replaced it. The CONTROL events, with the pose in
each event, were:

| Event              | Reason                | Pose                              |
| ------------------ | --------------------- | --------------------------------- |
| `movement_started` |                       | (8709.46, -6671.76, 70.34)        |
| `movement_stopped` | `navigation_replaced` | (8730.5065, -6676.0682, 69.7542)  |
| `facing_changed`   |                       | (8730.5065, -6676.0682, 69.7542)  |
| `movement_started` |                       | (8730.5065, -6676.0682, 69.7542)  |
| `movement_stopped` | `arrived`             | (8744.35, -6687.06, 69.9506)      |

The new route started from the stopped pose. Its first `remaining`,
17.6766, equals the horizontal distance from (8730.5065, -6676.0682) to
the new destination. The run then read `remaining` 10.67 and 3.66, then
`active: false, remaining: 0`. The relogin pose was
(8744.349609375, -6687.06005859375, 69.95060729980469), `source: "server"`.

## Slice 5: unreachable and lost destinations (issue #130), 2026-09-26

Transcript: [unreachable-lost-transcript.txt](unreachable-lost-transcript.txt).
It includes the GM commands used to set the scene. They came from the second
own SOAP character, Fgklhanhcei, on account FAC6AB70D7248 (GM level 2).
This branch also carries the #136 fix: `goto <guid>` samples a creature's
current position, and an idle creature is no longer refused as stale.

### Unreachable, nothing walked, nothing retried

From (8749.18, -6688.34, 69.49), open ground south of the Fairbreeze inn:

- `goto 8667.46 -6773.76` returned
  `unreachable: pathfind_find_path failed (UNKNOWN_PATH)`. The ground column
  there is a unique `[94.0002]`, about 24 yards above the start. The native
  mesh has no path to it.
- `goto 8727.46 -6683.76` returned
  `unreachable: end snapped off the requested ground position`. The native
  path ends at (8727.381, -6683.760), 0.08 yards from the requested point.
  That point sits just outside the eroded mesh edge beside an obstacle.

Both left `navigation --json` at `active: false, refusal: "unreachable"`
with the next step "The navigation mesh cannot reach this destination.
Choose another destination; do not retry this one." Five seconds later the
state was unchanged. The pose still had its login `updatedAt`
(1790382989719) and `moving: false`, and the only CONTROL events were the
two `control_error` events.

### Creature lost mid-route, not replanned

The GM summoned the eversong character to (8787.43, -6733.45, 58.70), next
to the Springpaw Stalkers. Its route in:

1. `nearby --json` listed Springpaw Stalker `0xf130003d2305552c` at
   58.47 yards.
2. `goto 0xf130003d2305552c` returned `intent`. `navigation --json` read
   `active: true`, `target: "0xf130003d2305552c"`,
   `destination {x: 8822.03, y: -6784.36, z: 43.29}` and `remaining` 61.55.
   That destination is the stalker's current position on its wander path,
   with the ground height under it.
3. After about 1.5 s, `remaining` read 51.04.
4. The GM targeted the stalker and ran `.npc tame`. The server despawns the
   tamed world creature (`Player::CreatePet` calls `DespawnOrUnsummon`), so
   the client received `ENTITY_DISAPPEAR` for `0xf130003d2305552c`.
5. `navigation --json` then read `active: false`,
   `blockedReason: "target_lost"`, `refusal: "stop"` and `remaining` 50.00,
   with the next step "The destination creature is no longer observed.
   Choose a currently observed target; the route was not retried."

The CONTROL events were `facing_changed`, `movement_started`,
`control_changed`, `movement_stopped` (`target_lost`) and `control_changed`
(`target_lost`). Five seconds later the pose was still predicted
(8793.92, -6743.01, 53.13) with `moving: false`, and the navigation state
was identical, so nothing had replanned. After relogin, the server pose was
(8793.921875, -6743.00634765625, 53.13190841674805).

### Creature leaves the character's view (rework, 2026-09-26)

Transcript: [unreachable-lost-rework-transcript.txt](unreachable-lost-rework-transcript.txt).
Run on fresh own SOAP characters: Fgklheeaodi (eversong10, account
FAC6AB7440E38) navigating, and Fgklheeaopg (GM 2, account FAC6AB7440EF6).
The daemon ran this branch's code.

**Phase-out stops the route.** From (8787.80, -6732.96):

1. `nearby --json` listed Springpaw Stalker `0xf130003d23078f6a` at
   63.03 yards.
2. `goto 0xf130003d23078f6a` started with `remaining` 62.43,
   `target: "0xf130003d23078f6a"`, and `remaining` was 51.92 after about
   1.5 s.
3. The GM, with the stalker selected, ran `.modify phase 2`. This changes
   the creature's phase in memory only; it writes no world data. The stalker
   left the navigator's view.
4. The route stopped with `movement_stopped` (`target_lost`),
   `blockedReason: "target_lost"`, `refusal: "stop"` and `remaining`
   51.42. Five seconds later the state and the predicted pose
   (8793.37, -6742.47, 53.46) were unchanged. Nothing replanned.

**How the loss reached the client.** A throwaway probe traced
`EntityStore.destroy` for the same stalker while the GM toggled its phase.
The call came from `handleDestroyObject`, so a phase change arrives as
`SMSG_DESTROY_OBJECT`, like the despawn above. It is not an out-of-range
block. The probe's third command restored the stalker to phase 1.

**First out-of-range attempt.** The review suggested `.npc move` to carry a
creature out of range. I did not use it: `HandleNpcMoveCommand` writes the
creature's spawn position to the world database
(`WORLD_UPD_CREATURE_POSITION`, `cs_npc.cpp:914-921`), and the agent rules
forbid server-data edits. I then had Velan Brightoak `.npc follow` the GM
away, but the character walked 89.4 yards and arrived before the gap passed
the visibility range. The follow was stopped with Velan 3.7 yards from his
spawn point.

### Creature leaves range through the out-of-range update (second rework)

Transcript:
[unreachable-lost-out-of-range-transcript.txt](unreachable-lost-out-of-range-transcript.txt).
This run used new own accounts: Fgklhhjhiio (eversong10, 0xaad, account
FAC6AB779788E) navigating, and Fgklhhjhilh (GM 2, account FAC6AB77978B7).
The daemon ran this branch.

Setup, all in memory:

- The GM summoned the navigator to (8789.13, -6735.92, 56.61).
- The GM selected the navigator and ran `.modify speed 0.2`.
  `HandleModifyASpeedCommand` sets the speed in memory only. The daemon
  applied the `SMSG_FORCE_RUN_SPEED_CHANGE`: `control --json` read `speed`
  1.4 before the run, and `remaining` fell about 1.4 yards per second.
- The GM took Springpaw Stalker `0xf130003d23028af3` on `.npc follow`.

The daemon ran with a throwaway preload that logs the caller of every
`EntityStore.destroy` to `tmp/`.

1. `goto 0xf130003d23028af3` returned `intent`. `navigation --json` read
   `active: true`, `target: "0xf130003d23028af3"`, `remaining` 79.75 and
   `destination (8794.18, -6815.51, 53.30)`, the stalker's position at the
   time.
2. The GM walked south and the stalker followed. `remaining` fell from
   78.35 to 72.45 over about five seconds.
3. The stalker left the navigator's visibility range. The client received
   `ENTITY_DISAPPEAR` for `0xf130003d23028af3`. The destroy trace shows it
   came through the out-of-range update entry:
   `destroy 0xf130003d23028af3 at applyEntry (world-handlers-entity.ts:46)
   <- at handleUpdateObject (world-handlers-entity.ts:30)`. Line 46 is the
   `outOfRange` case.
4. The route stopped with `movement_stopped` (`target_lost`).
   `navigation --json` read `active: false`, `blockedReason: "target_lost"`,
   `refusal: "stop"` and `remaining` 71.26.
5. Five seconds later the navigation state was identical and the pose was
   predicted (8789.67, -6744.40, 55.35) with `moving: false`. Nothing
   replanned.

Afterwards the GM ran `.npc follow stop`, restored the navigator with
`.modify speed 1` (`speed` read 7 again) and ran `.gm off`. After relogin
the server pose was (8789.6708984375, -6744.39990234375, 55.35465621948242),
equal to the stopped pose. These accounts were deleted after the run and not
reused.

The mock-world test in `src/wow/gameplay-lifecycle.test.ts` encodes the same
path. It injects an `SMSG_UPDATE_OBJECT` out-of-range block during an active
`goto <guid>` and expects `target_lost`. The test fails if the
`observeDisappear` hook is removed.
