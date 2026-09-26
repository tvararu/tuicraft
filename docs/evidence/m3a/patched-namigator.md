# M3a: a patched namigator for corner heights

Issue #151, 2026-09-26. Two patches are applied by default, in order: the
corner-height patch below, then the boundary-ray patch (section "Second
patch"), which was added after the planner-policy work in #162 exposed the
remaining native refusals. A third, opt-in patch for ADT heights on quad
edges (section "Opt-in third patch") changes results of calls that already
succeed, so the default build leaves it out. It follows #123 / PR #126,
which traced goto's `UNKNOWN_HEIGHT` refusals at path corners to namigator
`Map::FindHeight`. This record covers the patches, how to build them,
offline before/after counts and live walks. The shared library in
`/home/deity/wow-data` and the shared config were not changed. Only the
configs of my own SOAP accounts pointed at the patched build.

## The patch

[`vendor/namigator/corner-height.patch`](../../../vendor/namigator/corner-height.patch)
and then
[`vendor/namigator/boundary-rays.patch`](../../../vendor/namigator/boundary-rays.patch)
apply to upstream namigator `54eae6957753c3ca47b73402df9f8d1d52a2721e`
([`UPSTREAM`](../../../vendor/namigator/UPSTREAM)), the revision that the
installed library was built from. Both change only `Map::FindHeight` in
`pathfind/Map.cpp`. The opt-in
[`vendor/namigator/adt-edges.patch`](../../../vendor/namigator/adt-edges.patch)
goes on top and changes `Map::GetADTHeight`.
`mise namigator:build` (`vendor/namigator/build.sh`) clones upstream into
`tmp/namigator/src`, checks out that commit with the `recastnavigation` and
`stormlib` submodules, applies the two default patches (and the third with
`NAMIGATOR_ADT_EDGES=1`), builds the `libpathfind`, `utility`, `Detour`
and `Recast` targets with CMake in Release, links
`tmp/namigator/libnamigator.so` from those archives, and checks that
`pathfind_find_height` is exported. Set `NAMIGATOR_REPO` to clone from a
local mirror instead.

### The defect, in Detour terms

A native path corner from `findPath` is a navmesh polygon vertex, and it is
bit-exact (PR #126). Several polygons share that vertex, and Detour decides
boundary membership in two ways:

- `dtNavMeshQuery::raycast` clips the segment against each polygon with
  `dtIntersectSegmentPoly2D`, which is boundary-inclusive. It reports
  `t == FLT_MAX` ("the ray ends inside this polygon", `segMax == -1`)
  exactly when no edge is left before the end of the segment, including an
  end point that lies on an edge or vertex.
- `dtNavMesh::getPolyHeight` first gates on `dtPointInPolygon`, a
  half-open crossing test. A shared vertex or edge belongs to at most one
  of the polygons around it.
- `findNearestPoly` returns one of the polygons that share a vertex. It
  can only prefer the one that `dtPointInPolygon` accepts, and otherwise
  it picks the nearest, which is a tie at distance 0.

This causes two failures, one at each end of the ray:

1. **Target on a corner** (the #126 trace). The ray from a sample reaches
   the corner inside polygon A (`t == FLT_MAX`), but `getPolyHeight(A,
   corner)` fails because the half-open test gives the vertex to
   neighbour B. `FindHeight` returns false at stage 4.
2. **Source on a corner.** `findNearestPoly(corner)` returns polygon A, but
   the next sample lies across the corner in a polygon that meets A only at
   that vertex. The ray leaves A through an edge at the source, `t == 0`,
   and `FindHeight` fails at stage 4 as if a wall had been hit.

An instrumented build logged the failing native call for each refusal.
Unpatched, the call behind 1059 of Fairbreeze's 1153 refusals is case 1.
With only case 1 fixed, 156 still refuse, and 153 of those are stage-4
wall hits at a polygon vertex. Fixing case 2 as well removes 82 more.

### The fix

- **Case 1.** If `getPolyHeight` fails but the ray reached the target
  (`hit.t == FLT_MAX`), take the height from
  `closestPointOnPoly(endRef, target)`. That falls back to
  `closestPointOnDetailEdges<true>`, the closest point on the polygon's
  detail boundary edges. For a target on the boundary, that point is the
  target itself, and its height is the detail-mesh height there. It is the
  same value `getPolyHeight` computes for points inside, and the same
  on-edge fallback it uses when its triangle test misses. There is no
  distance threshold. `raycast` has already accepted the target with its
  inclusive test (an edge parallel to the ray can let the end point sit
  up to about 1e-6/|edge| yards outside), so the fix makes the height
  query agree with the raycast rather than adding a tolerance. The result
  is only a hint for the unchanged `FindNextZ` pass, which returns the
  precise ADT/WMO height, as before.
- **Case 2.** If the ray stopped at `t == 0` and the source is exactly (in
  bits, x and z) a vertex of the start polygon, restart the ray from each
  other polygon in the `findNearestPoly` query box that has the same
  vertex, compared as the exact x, y and z coordinates. It keeps the first
  ray that reaches the target (`t == FLT_MAX`). If none does, the original
  failure stands. Exact vertex identity, including the vertex height, keeps
  it to polygons that really share the corner, not a floor above or below.
  The second patch replaces this retry with the general continuation
  described below.

### What else it can affect

`Map::FindHeight` is reached through `pathfind_find_height` (the C API that
tuicraft uses), the Python binding and MapViewer. `FindPath`,
`FindHeights`, `LineOfSight` and `FindRandomPointAroundCircle` are
untouched. Both branches start only on paths where the unpatched function
already returned false. Case 1 runs only after `getPolyHeight` has failed.
Case 2 runs only when `t == 0` from a source on a start-polygon vertex, and
then the old code always failed stage 4 because the target lies outside the
convex start polygon. So no call that succeeded before changes its result.
The offline runs confirm this: all 212 Fairbreeze routes and 139 Sunstrider
routes that planned with the installed library plan to hash-identical point
lists with the patch.

One behaviour change is intended: a height query toward a corner can now
succeed where it used to refuse. The planner still checks every such
result against the connected ground, ambiguity, collision and headroom
gates, and those gates now make most of the remaining refusals (below).

## Second patch: boundary rays

With the #162 planner, routes reach much further, and 492 Fairbreeze and 135
Sunstrider destinations still refused with UNKNOWN_HEIGHT under the corner
patch alone. An instrumented copy of that build logged, for the failing call
behind each refusal: the `FindHeight` stage, the raycast `t`, path length and
hit edge, the hit edge's neighbour flags, whether the hit normal was set,
where the source sits relative to its start polygon, which clip test failed
(re-running `dtIntersectSegmentPoly2D` step by step), whether the target is
over any polygon, and for stage 6 the `FindNextZ` hint and the target's
`FindHeights` column. The calls fall into these classes:

| Class | Fairbreeze dest (calls) | Sunstrider dest (calls) | Verdict |
|---|---:|---:|---|
| A. `FindNextZ` finds no surface: the target is on a tile or ADT quad edge and its terrain column comes back empty | 41 (8) | 12 (6) | defect, fixed only by the opt-in third patch |
| B. ray from a native path corner stops at its source (`t == 0`, or an empty path) | 179 (8) | 31 (5) | defect, mostly fixed |
| C. ray from a point on a polygon edge stops at its source | 111 (8) | 20 (11) | defect, mostly fixed |
| D. source is not on its start polygon: 0.04 to 1.0 yards outside it, and the polygon under it is 1.6 to 1.9 yards away vertically | 3 (3) | 8 (6) | correct |
| E. target on a portal edge: the ray reaches it through a portal, and the neighbour's clip is empty (`t` 0.99999…, hit normal zero) | 11 (7) | 10 (3) | defect, fixed |
| F. ray passes exactly through a vertex where a solid edge meets a portal, and the tie picks the solid edge | 101 (5) | 51 (3) | defect, fixed |
| F′. as F, with the target off the mesh | 46 (1) | 4 (1) | correct |

### What goes wrong

- **B, C, E, F.** These are the same boundary problem as the first patch,
  one step further. `raycast` follows one link per exit edge and stops if the
  neighbour's clip is empty, and `findNearestPoly` picks one start polygon.
  When the segment starts on, or passes exactly through, a vertex or edge
  shared by several polygons, the polygon it tries next depends on edge
  order and float rounding. It can:
  - leave through the solid edge of a tied vertex (F);
  - try a neighbour that the segment only touches (E);
  - start in a polygon the source only touches, for example a corner whose
    polymesh vertex sits up to 1.25 yards higher, so `findNearestPoly`
    prefers a polygon 0.3 yards away (B).

  In every case another polygon at the stop point holds the continuation of
  the segment.
- **A.** Path corners often sit on tile borders, because tile-border
  vertices are portal vertices. `GetADTHeight` picks the quad by truncating
  the point's offset from the tile corner. It then requires
  `dtClosestHeightPointTriangle`, which has no tolerance, to place the point
  inside one of the quad's four triangles. On a quad or tile edge, rounding
  can put the point just outside all four, so the terrain height is lost.
  With no WMO there either, `FindHeights` returns an empty column and
  `FindNextZ` fails. At the tile's own south or east edge, the truncation
  gives index 8 and reads past the 8 × 8 quad arrays (an out-of-bounds read;
  the `assert` is compiled out in Release).

### The fix (`boundary-rays.patch`)

- **Continue a ray that stopped at a shared boundary** (`ContinueRaycast`,
  replacing the first patch's shared-vertex retry). It runs only when the
  unpatched code would fail: the ray did not reach the target, and there is
  no start polygon or `getPolyHeight` rejects the target. It looks at the
  polygons in the same query box around the stop point, and resumes the ray
  from one that either:
  - has the stop point as an exact vertex; or
  - has a boundary-inclusive `dtIntersectSegmentPoly2D` clip of the segment
    that covers the stop parameter and extends past it.

  That candidate's surface at the stop point must be within `WalkableClimb`
  (1.0) of the polygon the ray stopped in, which is the limit Recast uses to
  connect neighbouring spans, so a floor above or below cannot take over.
  The continued ray replaces the original only if it reaches the target
  (`t == FLT_MAX`). Otherwise the original failure stands. Membership comes
  from Detour's own inclusive clip and exact vertex identity. No distance
  threshold is added.

### What else it can affect

- `ContinueRaycast` only turns a `FindHeight` failure into a success, and
  only when a raycast from a polygon at the stop reaches the target.
  `FindPath`, `FindHeights`, `LineOfSight` and `ZoneAndArea` are untouched.
- Offline, with the #162 planner, all routes that planned with the
  installed library still plan identically (tables below), and no
  `findHeight` value or `findHeights` column on any ADT quad edge changes
  (section "Quad-edge points").
- Every route newly planned by the second patch under the planner before
  #162 (14 at Fairbreeze, 2 at Sunstrider, measured when this patch still
  contained the ADT change) keeps its start exactly, and all of its
  non-anchor samples sit on a unique `findHeights` column, with a maximum
  difference of 0.

### What remains

Under the #162 planner, with the two default patches, 92 Fairbreeze
destinations and 51 Sunstrider destinations still refuse:

- **A, terrain lost on a quad or tile edge** (49 and 15 destinations). The
  opt-in third patch fixes these.
- **D, source not on the navmesh** (8 and 6 destinations). The source point
  is up to a yard outside its start polygon, and the polygon under it is
  1.6 to 1.9 yards away vertically, so it stands on geometry the navmesh
  does not cover at that height. That refusal is correct.
- **Rays lying along a polygon edge** (B and C, 35 and 29 destinations, 6
  and 3 calls). Most of these rays run along a tile-border edge, where the
  link is a partial portal: Sunstrider (10317.87 → 10317.57, y = −6333.333)
  covers 26 destinations and Fairbreeze (8666.666 → 8666.667) covers 8. The
  others run along a solid border edge that starts at a path corner. The
  segment lies on the edge to within rounding, but Detour's
  parallel-edge test (`fabsf(d) < EPS` and `n < 0`) or the partial-link
  range check puts it outside every polygon, so no polygon covers the stop
  and continuation cannot help. Accepting these needs an explicit tolerance
  in Detour's clip, which I did not add. They are float degeneracies of the
  same boundary family, so they are defects left unfixed, and they refuse
  conservatively.
- One Sunstrider call ends 0.001 yards from a tile-border partial link at
  t = 0.9975, with the target off the mesh.

## Opt-in third patch: ADT edges

`adt-edges.patch` fixes class A in `GetADTHeight`. The quad index is
clamped to 7. When none of the four triangles holds the point, the height
comes from the plane of the triangle whose wedge around the quad centre
holds the point: `|dz| ≥ |dx|` picks the north or south triangle, otherwise
east or west. The four triangles share their edges, so neighbouring planes
agree on them. Points that one of the triangles already held keep exactly
their old value, and holes still return none.

**It deviates from the #151 acceptance criterion that only failing
`FindHeight` calls change, so the default build leaves it out.** Every
caller of `GetADTHeight` sees the new heights: `FindHeight`, `FindHeights`,
`FindNextZ` and `ZoneAndArea`. `FindNextZ` merges the ADT height with the
BVH hit, so a `findHeight` that already succeeded can return a different
value, and a `findHeights` column that was already non-empty can gain an
entry (section "Quad-edge points"). The PR #155 review found the new values
match points 0.02 yards away, so this is a real fix of an edge
discontinuity. Build it with `NAMIGATOR_ADT_EDGES=1 mise namigator:build`.

Gating the ADT fallback to `FindHeight`'s own failure path, so that
`FindHeights` stays unchanged, was built and measured too. It gives
`findHeight` the edge height, but the planner then refuses the same
destinations as `ground height unavailable`, because the `findHeights`
column there is still empty. It planned no extra route, so it is not
carried.

## Offline measurement

Method: `vendor/namigator/measure.ts`, the same grid as #126: `planGround`
on map 530 from an origin to every point of a 41 × 41 grid, ±120 yards in
6-yard steps. Each library ran in its own process.

```
NAV_DATA=<nav dir> bun vendor/namigator/measure.ts <lib> 8709.46,-6671.76,70.33597564697266 grid 120 6   # Fairbreeze, #126 origin
NAV_DATA=<nav dir> bun vendor/namigator/measure.ts <lib> 10349.599609375,-6357.2900390625,33.4025993347168 grid 120 6   # Sunstrider spawn
```

An unpatched rebuild of `54eae69` gave exactly the installed library's
Fairbreeze counts.

With the planner before #162 (then on `main`). "Corner" is the
corner-height patch alone, "both" adds the boundary-ray patch as it was then,
with the ADT change that is now the opt-in third patch:

| Refusal class | Fairbreeze installed | corner | both | Sunstrider installed | corner | both |
|---|---:|---:|---:|---:|---:|---:|
| OK | 212 | 266 | 280 | 139 | 174 | 176 |
| `pathfind_find_height failed (UNKNOWN_HEIGHT)` | 1153 | 74 | **8** | 827 | 19 | **2** |
| `path corner disagrees with connected ground` | 15 | 638 | 688 | 133 | 697 | 712 |
| `ambiguous ground column`, at the destination | 237 | 237 | 237 | 408 | 408 | 408 |
| `ambiguous ground column`, elsewhere on the route | 49 | 451 | 453 | 172 | 381 | 381 |
| `end snapped off the requested ground position` | 14 | 14 | 14 | 2 | 2 | 2 |
| `pathfind_find_path failed (UNKNOWN_PATH)` | 1 | 1 | 1 | 0 | 0 | 0 |
| total | 1681 | 1681 | 1681 | 1681 | 1681 | 1681 |

With the #162 planner (PR #172, now on `main`), which accepts mesh corners
and overhead columns and so reaches much further along each route,
re-measured on `main` at `682a605`. "Default" is what `mise namigator:build`
produces (corner and boundary-ray patches), "+ ADT" adds the opt-in third
patch:

| Result | Fairbreeze installed | corner | default | + ADT | Sunstrider installed | corner | default | + ADT |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| OK | 228 | 556 | **702** | 751 | 260 | 649 | **731** | 744 |
| `pathfind_find_height failed (UNKNOWN_HEIGHT)` | 1201 | 492 | **92** | 43 | 986 | 136 | **51** | 36 |
| `ambiguous ground column` | 237 | 397 | 650 | 650 | 408 | 623 | 623 | 623 |
| `ground corridor collision` | 0 | 214 | 214 | 214 | 25 | 271 | 274 | 274 |
| `path corner disagrees with connected ground` | 0 | 7 | 8 | 8 | 0 | 0 | 0 | 2 |
| `end snapped off the requested ground position` | 14 | 14 | 14 | 14 | 2 | 2 | 2 | 2 |
| `pathfind_find_path failed (UNKNOWN_PATH)` | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 |

PR #172 reported 649 OK and 136 UNKNOWN_HEIGHT for Sunstrider with the
corner patch, which `main` reproduces. That branch's planner gave 650 and
135 with the same build.

Every route that planned with the installed library plans to hash-identical
points with every build measured, under both planners.
Every route that planned with the corner patch alone plans identically with
the default build, except one under the #162 planner, Fairbreeze (8751.46,
-6779.76): its direct line used to fail a height query and fall back to the
corridor, and now the direct line passes every check. Adding the ADT patch
to the default build changes no route that already planned and no
ambiguity verdict. It only moves destinations out of UNKNOWN_HEIGHT: 49 to
OK at Fairbreeze, and 13 to OK and 2 to the corner check at Sunstrider.

The ambiguous class is split by whether the destination's own column is
ambiguous (`height` without an origin). Transitions from the installed
library to the corner patch alone: at Fairbreeze, 54 UNKNOWN_HEIGHT → OK, 402 → ambiguous,
623 → corner disagreement and 74 stay. At Sunstrider, 35 → OK, 209 →
ambiguous, 564 → corner disagreement and 19 stay. No other class changed.

**The corner patch removes 93.6% (Fairbreeze) and 97.7% (Sunstrider) of
the UNKNOWN_HEIGHT refusals, but most of those routes now stop on two
planner checks.** They are the ones #126 predicted at c4:

- `path corner disagrees with connected ground`: the native corner Z is
  polymesh height, which can sit up to `WalkableClimb` above the ground,
  and it is checked against a 0.25-yard tolerance.
- ambiguous columns along the route.

These are planner-policy gates in `src/wow/navigation.ts`, and this issue
does not change them. #162 does.

### Quad-edge points

The 6-yard grid never lands on an ADT quad edge, so this samples them
directly: within ±120 yards of each origin, every quad-edge line in x and in
y at 0.5-yard steps, plus both diagonals of every quad at 1/8-quad steps
(116,348 points at Fairbreeze, 114,823 at Sunstrider). Each point gets
`findHeight` from the origin and `findHeights`, compared bit for bit with
the installed library:

| Build | changed `findHeight` | lost | gained | changed `findHeights` columns (already non-empty) |
|---|---:|---:|---:|---:|
| Fairbreeze default | 0 | 0 | 428 | 0 (0) |
| Fairbreeze + ADT | 2 | 0 | 731 | 2020 (302) |
| Sunstrider default | 0 | 0 | 828 | 0 (0) |
| Sunstrider + ADT | 4 | 0 | 1214 | 1924 (547) |

With the ADT patch, for example, `findHeight` at (8779.167, -6637.760) goes
from 58.316 to 64.641, and at (10412.5, -6366.79) from 35.007 to 35.641.

### Sunstrider Isle points from #138

The M5 quest run's goto attempts (PR #134 journals), each re-planned from
the recorded spawn (10349.6, -6357.29, 33.4026), from the waypoint
(10382, -6379.56, 37.6876) and from the post-fight pose (10399.26,
-6261.84, 27.43):

| Destination | spawn: installed → patched | waypoint: installed → patched | post-fight: installed → patched |
|---|---|---|---|
| 10380, -6320 | UNKNOWN_HEIGHT → **OK** | OK → OK | UNKNOWN_HEIGHT → ambiguous |
| 10315.4, -6387.2 | OK → OK | UNKNOWN_HEIGHT → ambiguous | UNKNOWN_HEIGHT → corner disagrees |
| 10300.3, -6353.6 | ambiguous → ambiguous | ambiguous → ambiguous | ambiguous → ambiguous |
| spawn 10349.6, -6357.29 | OK → OK | OK → OK | UNKNOWN_HEIGHT → corner disagrees |
| 10330, -6370 | OK → OK | UNKNOWN_HEIGHT → ambiguous | ambiguous → ambiguous |
| 10220, -6340 | ambiguous → ambiguous | ambiguous → ambiguous | ambiguous → ambiguous |
| 10250, -6350 | ambiguous → ambiguous | ambiguous → ambiguous | ambiguous → ambiguous |
| 10300, -6360 | ambiguous → ambiguous | ambiguous → ambiguous | ambiguous → ambiguous |
| 10280, -6340 | UNKNOWN_HEIGHT → corner disagrees | UNKNOWN_HEIGHT → UNKNOWN_HEIGHT | ambiguous → ambiguous |
| 10382, -6379.56 | OK → OK | OK → OK | UNKNOWN_HEIGHT → ambiguous |
| 10355, -6362 | OK → OK | OK → OK | UNKNOWN_HEIGHT → corner disagrees |

With both patches (then including the ADT change) the table is the same,
except from the waypoint to (10280, -6340), which moves from UNKNOWN_HEIGHT
to the corner-Z check. Under the #162 planner on `main`, the default build
and the build with the ADT patch give identical results for all 33 plans.

The western Mana Wyrm points (10220–10300) refuse the same way before and
after the patch, so for them #138 is not the corner defect. That is
destination-column ambiguity, which may be correct, since #138 asks for the
candidate floors. As a destination, the spawn point plans from the spawn and
the waypoint with both libraries. From the post-fight pose it moves from
UNKNOWN_HEIGHT to the corner-Z check.

### Live routes checked offline

Plan with each library, then compare every non-anchor
sample (not the start, the end, or a native corner) with the unique
`findHeights` column at its XY.

| Route | installed | patched |
|---|---|---|
| (8709.46, -6671.76, 70.33598) → (8730, -6660), funnel corner c1 | UNKNOWN_HEIGHT | 50 points, 23.97 yd, start exact, 0 of 47 non-anchor samples differ (max 0) |
| (10349.6, -6357.29, 33.4026) → (10380, -6320) | UNKNOWN_HEIGHT | 104 points, 51.07 yd, start exact, 0 of 101 differ (max 0) |

## Live, 2026-09-26

The CLI ran from this branch, on main's `goto <x> <y> <z>`, on my own SOAP
characters. Each walk is an A/B. For A, the account config pointed at the
installed library. For B, it pointed at the patched build. The daemon was
restarted between them, and `/proc/<daemon>/maps` shows which
`libnamigator.so` it had loaded. Each destination Z is the unique
`findHeights` column (the M5 run's `33.6` for Sunstrider). Transcripts:
[patched-namigator-eversong.txt](patched-namigator-eversong.txt) and
[patched-namigator-sunstrider.txt](patched-namigator-sunstrider.txt).

### Funnel corner, eversong10 character Fgklhbkkdcp (0xa1b, map 530)

The character walked from spawn to the #126 origin with direct legs and
`goto 8709.46 -6671.76 70.33597564697266`. Relogin pose:
(8709.4599609375, -6671.759765625, 70.33597564697266), `source: "server"`.

- **A, installed** (`/home/deity/wow-data/libnamigator.so` mapped):
  `goto 8730 -6660 70.38529968261719` →
  `stop: pathfind_find_height failed (UNKNOWN_HEIGHT)`,
  `navigation.refusal: "stop"`, and the pose did not change.
- **B, patched** (`tmp/namigator/libnamigator.so` mapped): the same goto
  returned `intent`. `remaining` went 23.97 → 13.46 → 2.25 → 0, ending
  `active: false`. The planned route's start is the origin exactly, and 0 of
  its 47 non-anchor samples differ from `findHeights` (offline table above).
- **Relogin pose** after `stop`/`start`: (8730, -6660, 70.38529968261719),
  `source: "server"`, exactly the destination.
- A second run was not possible. The return goto to the origin refuses
  `pick_destination: ambiguous ground column` with both libraries, offline
  and live, so the character could not get back to the start.

### Sunstrider Isle, fresh character Fgklhbkkjgp (0xa1c), from the spawn point

This is the refusal the M5 quest run hit (#138): spawn (10349.599609375,
-6357.2900390625, 33.4025993347168), `source: "server"`.

- **A, installed**: `goto 10380 -6320 33.6` →
  `stop: pathfind_find_height failed (UNKNOWN_HEIGHT)`, and the pose did
  not change.
- **B, patched**: the same goto returned `intent`. `remaining` went
  51.07 → 40.56 → 29.35 → 18.84 → 8.33 → 0, ending `active: false`. The
  route's start is the spawn exactly, and 0 of 101 non-anchor samples
  differ from `findHeights`.
- **Relogin pose**: (10380, -6320, 33.53354263305664), `source: "server"`.
  Z is the ground column. The route ends on connected ground rather than at
  the requested 33.6, which the 0.25-yard destination check accepts.

### Second patch, Sunstrider, fresh character Fgklhcffnek (0xa32)

From the spawn (10349.599609375, -6357.2900390625, 33.4025993347168), with
the `main` planner. For A, this account's config pointed at the
corner-height patch alone (`tmp/libnm-v1.so`). For B, it pointed at both
patches (`tmp/namigator/libnamigator.so`), when the second patch still
contained the ADT change. That build's source is identical to today's
default build with `NAMIGATOR_ADT_EDGES=1`. The default build refuses this
destination offline as UNKNOWN_HEIGHT, so this walk is evidence for the
opt-in ADT patch.
`/proc/<daemon>/maps` shows each.
Transcript:
[patched-namigator-boundary.txt](patched-namigator-boundary.txt).

- **A, corner patch**: `goto 10367.599609375 -6333.2900390625
  31.585554122924805` → `stop: pathfind_find_height failed
  (UNKNOWN_HEIGHT)`, and the pose did not change. The installed library
  refuses it the same way offline.
- **B, both patches**: `intent`, then `remaining` 22.74 → 12.23 → 1.00 → 0,
  ending `active: false`.
- **Relogin pose**: (10367.599609375, -6333.2900390625, 31.585554122924805),
  `source: "server"`.
- Offline: the start is preserved exactly, and 0 of 66 non-anchor samples
  differ from their unique `findHeights` column.
- The earlier live routes plan to the same points with both patches, and
  with the default build: (8730, -6660) from the funnel origin and
  (10380, -6320) from the spawn.
