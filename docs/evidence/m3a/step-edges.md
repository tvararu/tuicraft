# M3a: step edges and the low collision ray

Issue #315, 2026-09-26. Found by #138 at Sunstrider Isle: `goto` refused
routes that step on or off a platform with `ground corridor collision`,
although the drop is within `WalkableClimb` (1.0), which the navmesh
connects. This record classifies the collision refusals on the #162 grids,
records the rule the low ray now follows at such a step, and gives grid
counts and live walks.

## Method

The #126 grid (`vendor/namigator/measure.ts`, 41 × 41 destinations,
±120 yards in 6-yard steps) from the Fairbreeze origin (8709.46, -6671.76,
70.33597564697266) and the Sunstrider spawn (10349.599609375,
-6357.2900390625, 33.4025993347168), on `main` at `f2f363d`, with the
installed library (`/home/deity/wow-data/libnamigator.so`) and the default
`mise namigator:build`.

`vendor/namigator/collisions.ts` takes the same arguments as `measure.ts`
and re-plans every destination refused with `ground corridor collision`.
The refused step is the last forward `findHeight` call before the refusal,
from the route's last sample to the next one. For that step it casts, with
the native `lineOfSight`:

- the sloped low ray, 0.25 yards above both samples;
- the head-height ray (1.6 yards) and the vertical ray at the second sample;
- the stepped low path: for a step down, a level ray at the higher sample's
  height + 0.25 to above the lower sample; for a step up, a vertical ray at
  the lower sample up to the higher sample's height + 0.25, then a level ray
  to above the higher sample.

It also reads `findHeights` at 0, 25, 50, 75 and 100% of the step. A
refusal is a **step edge** when only the sloped low ray is blocked, the
rise or drop is at most 1 yard, and the stepped low path is clear.
Anything else is an **obstruction**.

## Classification

| Grid, library | Refusals | Step down | Step up | Obstruction | Distinct steps (down, up, obstruction) |
|---|---:|---:|---:|---:|---|
| Fairbreeze, default | 217 | 39 | 177 | 1 | 3, 6, 1 |
| Sunstrider, default | 333 | 145 | 187 | 1 | 25, 32, 1 |
| Sunstrider, installed | 25 | 25 | 0 | 0 | 1, 0, 0 |
| Fairbreeze, installed | 0 | | | | |

In every step edge the head-height and vertical rays are clear. The rise
or drop is 0.45 to 0.66 yards at Fairbreeze and 0.20 to 0.95 yards at
Sunstrider. The columns show the same shape each time: the higher floor
continues for part of the step and ends at an edge, and the sloped ray,
which descends from above one sample to above the other, passes under that
edge.

In route order, the steps in the issue's table are step ups onto a
platform: the issue lists each pair the other way round, as the reverse
`findHeight` sees it.

### Step edges

| Step | Rise | Columns at 0, 25, 50, 75, 100% |
|---|---:|---|
| Sunstrider (10396.090, -6339.643, 36.245) → (10396.557, -6339.465, 35.558), walked live below | −0.687 | [36.245, 36.245, 35.555], [36.289, 36.289, 35.555], [36.334, 36.334, 35.556], [35.557], [35.558] |
| Sunstrider (10327.381, -6346.132, 29.203) → (10326.885, -6346.082, 29.834), onto the Sunspire plaza; issue row 1, walked live below | +0.631 | [29.203], [29.834, 29.834, 29.165], [29.834, 29.834, 29.127], [29.834, 29.834, 29.090], [29.834, 29.834, 29.052] |
| Sunstrider (10356.547, -6372.916, 36.445) → (10356.122, -6372.831, 37.372), from the waypoint; issue row 2 | +0.927 | [36.445], [36.438], [37.410, 36.432], [37.390, 36.424], [37.372, 37.372, 36.416] |
| Sunstrider (10254.106, -6349.822, 30.842) → (10253.630, -6349.782, 31.681); issue row 3 | +0.839 | [30.842, 30.841, 30.237], [31.309, 30.841, 30.238], [31.650, 30.841, 30.243], [31.681, 30.841, 30.249], [31.681, 30.841, 30.255] |
| Sunstrider, installed library (10355.846, -6371.410, 36.516) → (10356.048, -6371.865, 36.309) | −0.208 | [36.516, 36.249], [36.600, 36.600, 36.264], [36.684, 36.279], [36.294], [36.309]: the higher floor rises to 36.684 before its edge |
| Fairbreeze (8704.018, -6687.648, 71.114) → (8703.869, -6688.095, 70.453) | −0.660 | [71.114, 70.463], [71.158, 70.460], [70.458], [70.257, 70.456], [70.299, 70.453] |
| Fairbreeze (8733.333, -6656.846, 70.412) → (8733.336, -6656.355, 71.011) | +0.599 | [70.412], [70.833, 70.832, 70.416], [70.977, …, 70.420], [71.009, 70.424], [71.011, 70.427] |

### Obstructions

| Step | Rise | Rays blocked | Columns at 0, 25, 50, 75, 100% | Reading |
|---|---:|---|---|---|
| Fairbreeze (8824.702, -6591.071, 53.956) → (8825.000, -6590.922, 53.982) | +0.026 | low, head height, stepped | [53.956], [53.962], [53.969], [55.592, 53.975], [53.982] | level ground with an object whose top is 1.6 yards up across the step |
| Sunstrider (10412.871, -6277.752, 30.350) → (10412.797, -6277.380, 30.427) | +0.078 | low, stepped | [30.350, 29.952], [30.486, 29.927], [30.621, 29.902], [30.757, 29.877], [30.427, 29.851] | a surface rises to 30.757 between two samples at 30.35 and 30.43, above both low paths |

## The rule

In `src/wow/navigation-collision.ts`, `collisionFree` takes a `climb`. When
the sloped low ray is blocked and the step's rise or drop is non-zero and
at most `climb`, the low ray follows the higher floor across the step:

- **Step down**: a level ray from 0.25 above the higher sample to 0.25
  above the higher sample's height at the lower sample's XY. The vertical
  ray at the lower sample, which runs from 0.25 to 1.6 above it, already
  covers the drop, since the level ray's end is at most 1.25 above the
  lower sample.
- **Step up**: a vertical ray at the lower sample from 0.25 above it to
  0.25 above the higher sample's height, then a level ray at that height
  to above the higher sample.

The head-height and vertical rays are unchanged, and a blocked stepped path
still refuses. The route's points are the same `findHeight` results as
before: no coordinate is moved and no height is replaced. The rule only
changes which rays a step must clear.

`GroundRoute` carries the `climb` it was planned with, and `sample` uses it
as well. `planRoute` still tries the direct line first with `climb` 0, and
only the native corridor uses `WalkableClimb` (1.0), because Recast
connects neighbouring spans within that height and the corridor follows the
navmesh. Allowing the step on the direct line as well was measured: it
changed 5 Fairbreeze and 6 Sunstrider routes that already planned, because
the direct line then replaced the corridor. Manual moves
(`src/wow/control-motion.ts`) keep `climb` 0.

## Grid counts

`main` → this branch:

| Result | Fairbreeze installed | default | Sunstrider installed | default |
|---|---:|---:|---:|---:|
| OK | 228 → 228 | 796 → 801 | 269 → 269 | 888 → 1169 |
| `ground corridor collision` | 0 → 0 | 217 → 3 | 25 → 0 | 333 → 1 |
| `path corner disagrees with connected ground` | 0 → 0 | 8 → 177 | 0 → 0 | 0 → 0 |
| `ground corridor changes surface` | 0 → 0 | 37 → 74 | 0 → 0 | 0 → 0 |
| `ambiguous ground column at route` | 0 → 0 | 194 → 196 | 0 → 0 | 87 → 93 |
| `pathfind_find_height failed (UNKNOWN_HEIGHT)` | 1217 → 1217 | 193 → 194 | 1093 → 1118 | 79 → 124 |
| `ambiguous ground column at destination` | 203 → 203 | 203 → 203 | 288 → 288 | 288 → 288 |
| `end snapped off the requested ground position` | 32 → 32 | 32 → 32 | 5 → 5 | 5 → 5 |
| `pathfind_find_path failed (UNKNOWN_PATH)` | 1 → 1 | 1 → 1 | 1 → 1 | 1 → 1 |

Every route that planned on `main` plans to hash-identical points on this
branch, with both libraries at both sites. Only collision refusals change:

- **Sunstrider, default**: 281 now plan, 45 refuse later with
  `UNKNOWN_HEIGHT`, 6 with `ambiguous ground column at route`, and 1
  obstruction stays.
- **Fairbreeze, default**: 5 now plan. 169 reach one native corner,
  (8733.58, -6654.37), where the walked ground is 71.155 over a column
  [71.155, 70.482], and refuse there with `path corner disagrees with
  connected ground`. 37 refuse with `ground corridor changes surface`, 2
  with `ambiguous ground column at route` and 1 with `UNKNOWN_HEIGHT`.
  Three collisions stay: the obstruction above, and two destinations
  whose routes now get past the step up at (8733.333, -6656.846) and stop
  at (8733.387, -6655.523, 70.452) → (8733.406, -6655.082, 70.465), a
  level step on single-surface columns where the low ray is blocked by
  geometry that has no surface in the column.
- **Sunstrider, installed**: all 25 get past the step and then stop on the
  #123 corner defect (`UNKNOWN_HEIGHT`).

### The issue's routes

With the default build:

| Route | `main` | this branch |
|---|---|---|
| spawn → (10280, -6340) | collision | plans, 154 points |
| spawn → (10300, -6330) | collision | plans, 132 points |
| spawn → (10220, -6340) | collision | plans, 275 points |
| waypoint (10382, -6379.56, 37.6876) → (10280, -6340) | collision | plans, 235 points |
| waypoint → (10300, -6330) | collision | plans, 211 points |
| waypoint → (10330, -6370) | collision | plans, 115 points |
| waypoint → (10220, -6340) | collision | `ground corridor changes surface` |

Waypoint → (10220, -6340) gets past the step and then refuses where the
route crosses the tile border y = −6366.667: the sample (10300.000,
-6366.666, 27.392) is on the column [27.392], and the reverse `findHeight`
from it to the previous sample (10300.414, -6366.925, 27.610), column
[27.610, 27.610, 25.727], returns 25.727, the surface 1.88 yards below. The
planner refuses a step whose reverse height lands on another surface, as it
should; the native reverse query is the fault, not this rule.

## Live, 2026-09-26

Own `fresh` character Fgkliaelohk (0xb7c, account FAC6AB804BE7A, deleted
after the run) at the Sunstrider spawn. The account config pointed
`navigation_library` at the default build (`tmp/namigator/libnamigator.so`,
not committed), and `/proc/<daemon>/maps` shows it loaded. A ran `main` at
`f2f363d` with this branch's changes stashed, B ran this branch; the
daemon was restarted between them. Transcript:
[step-edges-transcript.txt](step-edges-transcript.txt).

1. **A step down, A/B.** A: `goto 10397.599609375 -6339.2900390625` →
   `stop: ground corridor collision`, `refusal: "stop"`, and the pose stayed
   at the spawn. B: the same goto derived Z 35.56693649291992 and went
   `remaining` 37.29 → 22.56 → 8.53 → 0, `active: false`, crossing the step
   down at (10396.090, -6339.643), 36.245 → 35.558. Relogin pose
   (10397.599609375, -6339.2900390625, 35.56693649291992),
   `source: "server"`.
2. **The same edge as a step up.** B: `goto 10349.599609375
   -6357.2900390625` from there went 41.46 → 26.73 → 12.70 → 0, ending at
   (10349.599609375, -6357.2900390625, 33.40286636352539).
3. **The issue's first route.** B: `goto 10280 -6340` from the spawn went
   60.21 → 45.49 → 31.47 → 16.76 → 2.74 → 0, crossing the step onto the
   plaza at (10327.381, -6346.132). Relogin pose (10280, -6340,
   23.04463005065918), `source: "server"`.
