# M3a slice 2: funnel corner, blocked on a namigator change

Issue #123, 2026-09-26. **Status: blocked. The gap stays open.** No route
through the funnel corner near (8722.99, -6666.06) on map 530 was accepted
or walked. The failing native stage is identified below. Fixing it needs a
change in namigator, and even with that change the recorded route still
fails later on two planner-policy checks. No coordinate jitter, height
substitution or planner patch was added.

## Live refusal, 2026-09-26

On an own `eversong10` SOAP character (Fgklhanhbel, 0xa02, map 530). The
transcript is [funnel-corner-transcript.txt](funnel-corner-transcript.txt).

- `goto 8709.46 -6671.76` walked from (8764.71, -6683.07) to the recorded
  origin and ended with `active: false, remaining: 0`.
- `goto 8801.13 -6550.23` (the recorded destination) refused with
  `stop: pathfind_find_height failed (UNKNOWN_HEIGHT)`. `navigation --json`
  showed `refusal: "stop"`. The pose was unchanged
  (`updatedAt: 1790381991241`) and `moving: false`.
- After `stop` and `start`, the relogin pose was
  (8709.4599609375, -6671.759765625, 70.33597564697266) with
  `source: "server"`.

A second live refusal happened earlier the same day, from (8723.14,
-6665.85): `goto 8764.71 -6648.63` also refused with UNKNOWN_HEIGHT. It is
recorded in the slice 1 transcript.

## The failing native stage

The trace below was taken offline with the installed
`/home/deity/wow-data/libnamigator.so`.

- **Library revision.** The library matches namigator
  `54eae6957753c3ca47b73402df9f8d1d52a2721e`, which is upstream master,
  with recastnavigation at `455a019`.
- **Build check.** The installed `pathfind::Map::FindHeight` has the same
  98-instruction sequence as the source build's `liblibpathfind.a`.
- **Rebuilt copies.** An unmodified rebuild from that revision reproduces
  every result. So does an instrumented copy that logs each stage, which is
  what produced [funnel-corner-trace.txt](funnel-corner-trace.txt).

The failing call is the planner's **reverse** continuity check in
`groundPoint` (`src/wow/navigation.ts`). It runs from the first 0.5-yard
sample after native path corner c1 back to c1:

```
findHeight from (8722.991129557291, -6666.0596110026045, 70.25395965576172)
           to   (8722.619140625, -6666.36962890625)      -> UNKNOWN_HEIGHT
```

`pathfind_find_height` returns UNKNOWN_HEIGHT (84) whenever
`Map::FindHeight` (`pathfind/Map.cpp:817-863`) returns false. That can
happen at six stages: `findNearestPoly`, `raycast`, an empty ray path,
`getPolyHeight`, the tile lookup, and `FindNextZ`. For this call the
instrumented build shows:

```
stage1 findNearestPoly status=0x40000000 startRef=281475104638347 overPoly=1
stage2 raycast status=0x40000000 t=3.40282347e+38 pathCount=1 hitEdgeIndex=-1
path[0] ref=281475104638347 nv=6 pointInPolygon(target)=0
  v5 wow=(8722.61914,-6666.36963,70.4768982)   <- target XY, bit for bit
stage4 getPolyHeight(path[last]) status=0x80000008
FAIL stage4 getPolyHeight
diag findNearestPoly(target) ref=281475104637870
diag targetPoly ref=281475104637870 pointInPolygon(target)=1
diag getPolyHeight(targetPoly) status=0x40000000 z=70.4768982
```

**Stage 4, `dtNavMeshQuery::getPolyHeight` at `pathfind/Map.cpp:849-851`,
fails.** Native path corners are polygon portal vertices, so the target
lies exactly on a vertex of the start polygon. Two Detour tests disagree
about that boundary:

- `raycast` uses the boundary-inclusive `dtIntersectSegmentPoly2D`. It
  reports that the ray ends inside the start polygon: `t = FLT_MAX`, no
  hit edge.
- `getPolyHeight` is gated by the half-open `dtPointInPolygon`
  (`DetourNavMesh.cpp:692-693`). That test gives a shared vertex to at most
  one polygon, and here that is the neighbouring polygon 637870, not
  638347.

The failure is not caused by f32 conversion, float noise, ADT or tile
loading, or `moveAlongSurface`.

It is systematic, not a one-off. In the whole-plan trace, the reverse check
toward every interior corner the planner reached, c1 to c4, hit this case.
Any route that falls back from the direct line to the native corridor
therefore fails at its first corner whose outgoing polygon does not own the
vertex.

The earlier `firstDirectSampleFailure`, from (8717.27, -6661.40), is a
different and correct failure. The raycast hits a navmesh wall at
t = 0.97, and the target lies 0.011 yards outside the eroded mesh border.
That rejection is why the planner falls back to the corridor.

## Why the TypeScript caller cannot fix it

- **f32-exact coordinates do not help.** The corner comes straight from
  `findPath`, and it is already bit-identical to vertex v5. That exactness
  is what puts the target on the vertex.
- **A different origin does not help.** The incoming and outgoing polygons
  differ at a funnel corner, and the half-open rule gives the vertex to at
  most one of them. A query back to a sample before the corner cuts across
  the corner, off the corridor.
- **No other exported call fits.** `pathfind_find_heights` gives the column
  without connectivity. `pathfind_find_path` gives polymesh Z, not a precise
  connected height. Using either in place of the reverse check changes what
  the check means.
- **Dropping the reverse check at corners** is a safety-policy change, not a
  fix.

## Required namigator change

[namigator-findheight-boundary.patch](namigator-findheight-boundary.patch)
applies to `pathfind/Map.cpp` at `54eae69`. When `getPolyHeight` fails, it
checks whether the raycast reached the target (`hit.t == FLT_MAX`) and
whether `closestPointOnPoly` on the same polygon lies within 0.001 yards
of the target in 2D. If both hold, it takes Z from that closest point as the
hint for the unchanged `FindNextZ` pass. Wall hits and off-mesh targets
still fail. Upstream recastnavigation `main` still has the same gate, so
this belongs in namigator's use of the API.

The patched build was tested offline only and was never installed or used
live:

- The recorded call returns 70.25194549560547, which is that spot's unique
  column.
- Calls 1 to 116 of the plan are byte-identical to the installed library,
  including the correct direct-line failure.
- `GroundRoute` over origin → c1 → c2 → c3, unmodified, plans 56 points.
  The start is preserved exactly, and 0 of 55 non-anchor samples differ from
  their unique `findHeights` column. The installed library fails the same
  prefix with UNKNOWN_HEIGHT.

## Remaining refusals after the native fix

With the patched library, the full recorded route
(8709.46, -6671.76) → (8801.13, -6550.23) still does not plan. It stops on
two current safety checks, neither of which is a native failure:

1. **`path corner disagrees with connected ground` at c4
   (8733.333, -6656.846).** The native corner Z is 71.2269, a polymesh
   height quantised to 0.25 that can sit up to `WalkableClimb` above the
   ground. The sampled ground there is 70.4121, 0.81 yards below, against
   a 0.25 tolerance.
2. **`ambiguous ground column at route` just past c4.** The route steps 0.6
   yards up onto a structure whose column is `[71.026, 70.426]`. If that
   check is bypassed for diagnosis, the step then fails as a ground
   corridor collision.

Changing these checks is a planner-policy decision. It is out of scope for
this slice and should not be made to get one route through.

## Consequence for slice 3 (bounded replanning)

This finding changes slice 3. Replans from arbitrary observed origins will
often need the native corridor rather than a direct line, and every
corridor corner hits this boundary case. Until the namigator change lands,
most replans that must turn a corner will refuse with UNKNOWN_HEIGHT, and
the corner-Z tolerance will reject many of the rest. Slice 3 should:

- treat UNKNOWN_HEIGHT as a terminal `stop` that counts toward its plan
  limit, never as a reason to retry;
- be verified on routes that plan directly today, as the slice 1 and
  slice 4 routes do;
- or take the namigator patch as a stated prerequisite before claiming
  that it routes around corners.
