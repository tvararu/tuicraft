# M3a: a patched namigator for corner heights

Issue #151, 2026-09-26. It follows #123 / PR #126, which traced goto's
`UNKNOWN_HEIGHT` refusals at path corners to namigator `Map::FindHeight`.
This record covers the patch, how to build it, offline before/after counts
and live walks. The shared library in `/home/deity/wow-data` and the shared
config were not changed. Only the configs of my own SOAP accounts pointed at
the patched build.

## The patch

[`vendor/namigator/corner-height.patch`](../../../vendor/namigator/corner-height.patch)
applies to upstream namigator `54eae6957753c3ca47b73402df9f8d1d52a2721e`
([`UPSTREAM`](../../../vendor/namigator/UPSTREAM)), the revision that the
installed library was built from. Only `pathfind/Map.cpp`
(`Map::FindHeight`) changes.
`mise namigator:build` (`vendor/namigator/build.sh`) clones upstream into
`tmp/namigator/src`, checks out that commit with the `recastnavigation` and
`stormlib` submodules, applies the patch, builds the `libpathfind`,
`utility`, `Detour` and `Recast` targets with CMake in Release, links
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

## Offline measurement

Method: `vendor/namigator/measure.ts`, the same grid as #126: `planGround`
on map 530 from an origin to every point of a 41 × 41 grid, ±120 yards in
6-yard steps. Each library ran in its own process.

```
bun vendor/namigator/measure.ts <lib> 8709.46,-6671.76,70.33597564697266 grid 120 6   # Fairbreeze, #126 origin
bun vendor/namigator/measure.ts <lib> 10349.599609375,-6357.2900390625,33.4025993347168 grid 120 6   # Sunstrider spawn
```

An unpatched rebuild of `54eae69` gave exactly the installed library's
Fairbreeze counts.

| Refusal class | Fairbreeze installed | Fairbreeze patched | Sunstrider installed | Sunstrider patched |
|---|---:|---:|---:|---:|
| OK | 212 | 266 | 139 | 174 |
| `pathfind_find_height failed (UNKNOWN_HEIGHT)` | 1153 | 74 | 827 | 19 |
| `path corner disagrees with connected ground` | 15 | 638 | 133 | 697 |
| `ambiguous ground column`, at the destination | 237 | 237 | 408 | 408 |
| `ambiguous ground column`, elsewhere on the route | 49 | 451 | 172 | 381 |
| `end snapped off the requested ground position` | 14 | 14 | 2 | 2 |
| `pathfind_find_path failed (UNKNOWN_PATH)` | 1 | 1 | 0 | 0 |
| total | 1681 | 1681 | 1681 | 1681 |

The ambiguous class is split by whether the destination's own column is
ambiguous (`height` without an origin). Transitions from the installed to
the patched library: at Fairbreeze, 54 UNKNOWN_HEIGHT → OK, 402 → ambiguous,
623 → corner disagreement and 74 stay. At Sunstrider, 35 → OK, 209 →
ambiguous, 564 → corner disagreement and 19 stay. No other class changed.

**The patch removes 93.6% (Fairbreeze) and 97.7% (Sunstrider) of the
UNKNOWN_HEIGHT refusals, but most of those routes now stop on two planner
checks.** They are the ones #126 predicted at c4:

- `path corner disagrees with connected ground`: the native corner Z is
  polymesh height, which can sit up to `WalkableClimb` above the ground,
  and it is checked against a 0.25-yard tolerance.
- ambiguous columns along the route.

These are planner-policy gates in `src/wow/navigation.ts`, and this issue
does not change them.

### Remaining UNKNOWN_HEIGHT

An instrumented copy of the patched build logged the failing native call
for each remaining refusal (Fairbreeze 74, Sunstrider 19). They come from 8
distinct native calls:

- Stage 4 wall hit with the target off the navmesh (`findNearestPoly`
  reports it is not over any polygon): 50 + 8 Fairbreeze destinations. The
  largest is a ray that hits a solid edge exactly at a vertex at
  t = 0.77, toward a target outside the eroded border. These refusals are
  correct.
- Stage 4 wall hit where the ray grazes a solid boundary vertex at
  t = 0.33 with the target on the mesh: 15 Sunstrider destinations, one
  call. Detour's raycast counts touching a boundary corner as a hit. That
  is conservative, and I left it alone.
- Stage 3, empty raycast path: the ray runs along a polygon edge from a
  source that `dtIntersectSegmentPoly2D`'s parallel-edge test places
  outside its start polygon. 12 Fairbreeze and 2 Sunstrider destinations,
  one call each. This is a different boundary case, a sample on an edge
  rather than a vertex.
- One target within 1e-6 of a wall edge (t = 0.99999917): 1 Fairbreeze
  destination.
- Stage 6, `FindNextZ` found no surface near the mesh hint: 3 Fairbreeze
  destinations.

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
