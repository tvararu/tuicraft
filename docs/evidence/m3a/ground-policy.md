# M3a: false corner and column refusals in goto

Issue #162, 2026-09-26. With the corner-height namigator patch from #151,
goto's corner `UNKNOWN_HEIGHT` refusals mostly disappear. Most of those
routes then stop on two tuicraft checks in `src/wow/navigation.ts`:
`path corner disagrees with connected ground` and `ambiguous ground column`
along the route. This record classifies those refusals against the native
geometry, describes what changed and what did not, and gives grid counts
and a live walk.

The namigator settings quoted below are from `Common.hpp`
(`MeshSettings`) at `54eae69`, the revision the installed library was built
from: `CellHeight` 0.25, `WalkableHeight` 1.6 (the agent height),
`WalkableClimb` 1.0 and `DetailSampleMaxError` 0.25.

## Method

The same 41 × 41 `planGround` grid as #126 and #151 (±120 yards in 6-yard
steps, map 530), from the Fairbreeze origin (8709.46, -6671.76,
70.33597564697266) and the Sunstrider spawn (10349.599609375,
-6357.2900390625, 33.4025993347168), with the patched library offline. A
throwaway wrapper around `openNativeMap`, passed through `createNavigation`'s
`openMap` parameter, recorded the native calls behind each refusal:

- for a corner refusal: the native `findPath` corner, the connected ground
  sampled at its XY, and that XY's `findHeights` column;
- for a route-ambiguity refusal: the sample's connected height, the
  previous sample's height, and the column. Refusals whose destination
  column is itself ambiguous are excluded, because that is a separate
  class (below).

## Corner refusals: all false

Every corner refusal in both grids (638 Fairbreeze, 697 Sunstrider; 17 and
21 distinct corners) has the same shape:

- The column at the corner holds **exactly one surface**. The corner
  sample already passes the one-surface check, so there is no other floor
  at that XY the route could be on.
- The native corner Z is **above** that surface by 0.254 to 1.119 yards.
  It is never below.

| Site | Corner | Native Z | Ground | Rise | Column |
|---|---|---:|---:|---:|---|
| Fairbreeze | 8733.33, -6656.85 (the #126 c4) | 71.227 | 70.412 | 0.815 | [70.412] |
| Fairbreeze | 8698.51, -6684.82 | 71.421 | 71.143 | 0.278 | [71.143] |
| Fairbreeze | 8701.19, -6683.63 | 72.110 | 70.991 | 1.119 | [70.991] |
| Fairbreeze | 8700.00, -6685.12 | 72.016 | 70.922 | 1.094 | [70.922] |
| Fairbreeze | 8716.67, -6704.17 | 74.338 | 74.081 | 0.257 | [74.081] |
| Fairbreeze | 8734.23, -6656.85 | 70.806 | 70.384 | 0.421 | [70.384] |
| Fairbreeze | 8760.12, -6744.05 | 83.637 | 83.137 | 0.500 | [83.137] |
| Fairbreeze | 8744.34, -6714.88 | 74.637 | 74.238 | 0.399 | [74.238] |
| Fairbreeze | 8783.33, -6711.31 | 76.823 | 76.418 | 0.405 | [76.418] |
| Fairbreeze | 8756.55, -6747.62 | 78.137 | 77.600 | 0.537 | [77.600] |
| Sunstrider | 10352.68, -6356.25 | 33.558 | 33.261 | 0.298 | [33.261] |
| Sunstrider | 10336.31, -6333.33 | 30.058 | 29.774 | 0.284 | [29.774] |
| Sunstrider | 10355.95, -6316.96 | 30.058 | 29.498 | 0.560 | [29.498] |
| Sunstrider | 10364.58, -6376.49 | 37.308 | 37.044 | 0.265 | [37.044] |
| Sunstrider | 10328.27, -6345.54 | 29.983 | 29.343 | 0.639 | [29.343] |
| Sunstrider | 10340.18, -6375.30 | 36.058 | 35.637 | 0.421 | [35.637] |
| Sunstrider | 10328.87, -6344.64 | 29.983 | 29.313 | 0.670 | [29.313] |
| Sunstrider | 10300.59, -6401.19 | 32.206 | 31.846 | 0.360 | [31.846] |
| Sunstrider | 10341.07, -6375.00 | 36.058 | 35.725 | 0.333 | [35.725] |
| Sunstrider | 10399.40, -6350.60 | 35.956 | 35.629 | 0.327 | [35.629] |

The rise comes from how the navmesh is built. A native path corner is a
polygon vertex returned by `findStraightPath`. Its height is the polymesh
vertex height, which the detail mesh keeps unchanged, unlike the detail
samples inside a polygon, which stay within `DetailSampleMaxError`. Recast
sets that height in `getCornerHeight` (`RecastContour.cpp`) to the
**highest** floor of the spans that meet at the corner. Neighbouring spans
connect when their floors differ by up to `WalkableClimb`, and span tops
are rounded up to the next `CellHeight`. So a corner can sit up to
`WalkableClimb + CellHeight` = 1.25 yards above the ground at its XY. All
observed rises are inside that bound. A fixed 0.25-yard tolerance is
tighter than the mesh can deliver at vertices, so these refusals are false.

## Route-ambiguity refusals

`groundHeights` refused any route sample whose column held surfaces more
than 0.01 yards apart. The distinct columns, with offsets of the other
surfaces from the sample's connected height z (the first 10 by frequency
at each site; `step` is z minus the previous sample's z):

| Site | Sample | z | step | Other surfaces, relative to z | Verdict |
|---|---|---:|---:|---|---|
| Fairbreeze | 8710.71, -6663.10 | 70.336 | 0.000 | +23.08, −3.73 | false: canopy overhead, floor below |
| Fairbreeze | 8765.30, -6681.50 | 69.621 | 0.034 | −2.90 | false: lower floor |
| Fairbreeze | 8710.83, -6662.98 | 70.336 | 0.000 | +23.08, −3.39 | false |
| Fairbreeze | 8704.73, -6686.81 | 70.487 | −0.033 | −0.04 | false: within ground tolerance |
| Fairbreeze | 8704.32, -6686.76 | 70.760 | 0.225 | −0.25 | false: within ground tolerance |
| Fairbreeze | 8777.56, -6642.91 | 64.060 | −0.086 | −9.31 | false: lower floor |
| Fairbreeze | 8785.42, -6652.38 | 62.121 | −0.094 | +14.34 | false: overhead |
| Fairbreeze | 8728.52, -6682.27 | 70.232 | 0.052 | +2.92 | false: overhead, clears agent |
| Fairbreeze | 8722.62, -6665.48 | 70.294 | 0.014 | −0.01 | false: within ground tolerance |
| Fairbreeze | 8776.57, -6693.40 | 75.127 | 0.017 | −9.95 | false: lower floor |
| Sunstrider | 10333.56, -6392.41 | 37.035 | 0.024 | −1.04 | false: no headroom under z |
| Sunstrider | 10320.24, -6364.28 | 30.696 | −0.077 | +29.84 | false: overhead |
| Sunstrider | 10363.69, -6378.27 | 37.138 | 0.031 | −0.98 | false: no headroom under z |
| Sunstrider | 10355.44, -6370.50 | 36.123 | 0.070 | −0.28 | false: no headroom under z |
| Sunstrider | 10300.06, -6402.71 | 32.160 | −0.019 | +24.09 | false: overhead |
| Sunstrider | 10406.60, -6289.33 | 31.764 | −0.019 | +24.21 | false: overhead |
| Sunstrider | 10363.45, -6378.33 | 37.136 | 0.034 | +20.69, −0.64 | false |
| Sunstrider | 10401.67, -6393.82 | 39.915 | 0.065 | +11.91, +11.91 | false: overhead |
| Sunstrider | 10408.82, -6366.37 | 35.834 | 0.124 | −0.13 | false: within ground tolerance |
| Sunstrider | 10407.67, -6289.77 | 32.187 | −0.014 | +27.02 | false: overhead |

What decides the verdict:

- **Surfaces more than `WalkableHeight` (1.6) above z** are overhead:
  canopies, roofs, bridges. The agent fits beneath them. The route's
  collision check already casts rays at z + 0.25 and z + 1.6 and a vertical
  ray between them, so nothing in the agent's own space is hidden.
- **Surfaces below z** cannot be the floor the route is on. A surface less
  than 1.6 yards below has no headroom under z, so it cannot be a floor.
  Recast drops such spans (`rcFilterWalkableLowHeightSpans`), which is why
  the connected height, taken from the mesh, lands on z. A surface 1.6 or
  more below is a separate lower floor.
- **Surfaces within `GROUND_ERROR` (0.25) of z** are the same floor at the
  planner's own precision. The existing position check already accepts any
  height within 0.25.
- **A surface between z + 0.25 and z + 1.6** means the agent at z would be
  inside geometry, or that z is not a standable floor. That refusal is
  correct, and it stays. So does the #126 step onto a structure, column
  [71.026, 70.426] from 70.426: a surface 0.6 above.
- **A connected trace that changes height by more than `WalkableClimb`
  between 0.5-yard samples** has left the floor it was on. That is the
  wrong-floor case, and it is refused.

## The change

Only route samples and interior native corners change. The start and
destination checks are unchanged: `checkGround` still requires one ground
height at both ends, and `planGround`'s unique destination column is
unchanged.

- **Route samples** (`checkRouteGround` in `groundPoint`): at least one
  column surface must be within 0.25 of the connected height, as before.
  Other surfaces are allowed only if every one of them is below z or more
  than 1.6 above it, and the sample's height is within 1.0 of the previous
  sample's. Otherwise the refusal is still `ambiguous ground column`.
- **Interior native corners** (`meshCornerOnGround` in `stepCorner`): the
  native corner Z may be from 0.25 below to 1.25 above the connected ground,
  and no other column surface may be closer to the native Z than the ground
  is. The corner that ends a route is the destination itself, not a mesh
  vertex, so it keeps the 0.25 check.

Nothing is substituted or jittered. Every route point is still the
connected `findHeight` result, and the back-check, collision and headroom
rays are unchanged.

New unit tests, in `navigation.test.ts`:

- a route under overhead geometry;
- a surface 1.5 above a route sample, refused;
- a connected trace that drops 5 yards to a lower floor while the back-check
  and line of sight pass, refused (removing the step bound makes it fail);
- mesh corners at +1.25 (accepted), +1.3 and −0.3 (refused), and +1.2 with
  another surface nearer (refused).

The detour test's ambiguous direct column changed from [0, 10] to [0, 1],
because a surface 10 yards up is now overhead.

## Grid counts, patched library

| Result | Fairbreeze before | Fairbreeze after | Sunstrider before | Sunstrider after |
|---|---:|---:|---:|---:|
| OK | 266 | **556** | 174 | **649** |
| `path corner disagrees with connected ground` | 638 | 7 | 697 | 0 |
| `ambiguous ground column`, at the destination | 237 | 237 | 408 | 408 |
| `ambiguous ground column`, elsewhere on the route | 451 | 160 | 381 | 215 |
| `ground corridor collision` | 0 | 214 | 0 | 271 |
| `pathfind_find_height failed (UNKNOWN_HEIGHT)` | 74 | 492 | 19 | 136 |
| `end snapped off the requested ground position` | 14 | 14 | 2 | 2 |
| `pathfind_find_path failed (UNKNOWN_PATH)` | 1 | 1 | 0 | 0 |

With the installed, unpatched library the change moves OK from 212 to 228
(Fairbreeze) and from 139 to 260 (Sunstrider).

Every route that planned before plans to the same points, with one
exception at Fairbreeze, (8763.46, -6647.76). Its direct line used to be
refused for an overhead column and fall back to the native corridor. Now
the direct line passes every check, so the planner takes it, as it always
prefers a fully checked direct line.

The refusals that remain are the correct kinds:

- **Corners, 7 at Fairbreeze.** They rise 1.282 and 1.321 above
  single-surface ground, beyond the 1.25 bound. They could be two
  climb-steps of span connection, but I left them refused.
- **Route ambiguity.** The samples drop 1.25 to 5.13 yards from the
  previous sample, with a surface 1.3 to 5.1 above: the trace stepped off
  a ledge onto the floor below. Or they climb 1.05 in one sample, or stand
  1.2 under a surface.
- **Collisions.** Routes now get past the corner and column checks and
  reach obstructions, which the collision rays reject (214 and 271). Each
  of these routes was refused before this change too, for another reason.
- **UNKNOWN_HEIGHT.** Routes also now reach later native height queries
  that fail: 40 distinct native calls at Fairbreeze and 34 at Sunstrider.
  Some start or end at a native corner, so they are native cases the #151
  patch does not cover (wall hits at vertices, off-mesh targets, rays along
  polygon edges, as #151 listed). They are not changed here.

## Live, 2026-09-26

On my own `fresh` SOAP character Fgklhbpbfld (0xa1f), from the Sunstrider
spawn (10349.599609375, -6357.2900390625, 33.4025993347168), server pose.
Each route is an A/B on the code. A ran unchanged `origin/main` from an
archive of it. B ran this branch. The daemon was restarted between them,
and `/proc/<daemon>/maps` recorded the library it loaded. Transcript:
[ground-policy-transcript.txt](ground-policy-transcript.txt).

**Route 1, overhead geometry, installed library** (the account's default
`/home/deity/wow-data/libnamigator.so`, no patch). Six route columns hold
surfaces 29 to 33 yards above the walked ground.

- A, main: `goto 10313.599609375 -6369.2900390625 30.193817138671875` →
  `pick_destination: ambiguous ground column`, and the pose did not change.
- B, this branch: `intent`, then `remaining` 26.73 → 16.23 → 5.71 → 0,
  ending `active: false`.
- Relogin pose: (10313.599609375, -6369.2900390625, 30.193817138671875),
  `source: "server"`, exactly the destination.
- Offline: the start point is preserved exactly, and all 75 non-anchor
  samples sit on a surface of their `findHeights` column, with a maximum
  difference of 0.
- The return goto to the spawn planned and arrived.

**Route 2, mesh corner, patched library.** This account's config pointed at
the #151 build, `tmp/namigator/libnamigator.so`. The shared config was not
changed. The route has 3 native corners and no multi-surface columns.

- A, main: `goto 10367.599609375 -6339.2900390625 32.02139663696289` →
  `stop: path corner disagrees with connected ground`, and the pose did not
  change.
- B, this branch: `intent`, then `remaining` 15.45 → 4.24 → 0, ending
  `active: false`.
- Relogin pose: (10367.599609375, -6339.2900390625, 32.02139663696289),
  `source: "server"`.
- Offline: the start point is preserved exactly, and 0 of 51 non-anchor
  samples differ from their unique `findHeights` column.
