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
