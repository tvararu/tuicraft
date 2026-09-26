# M3a: `FindHeight` and the surface just above the mesh

Issue #314, found by #138 ([sunstrider-floors.md](sunstrider-floors.md)).
`mise namigator:build` applies
[`vendor/namigator/surface-above-hint.patch`](../../../vendor/namigator/surface-above-hint.patch)
as its third default patch, after the corner-height and boundary-ray
patches of [patched-namigator.md](patched-namigator.md). It changes only how
`Map::FindHeight` turns the navmesh height into a model or terrain height.

## The defect

`Map::FindHeight` raycasts along the navmesh to the target, takes the detail
mesh height there as a hint, and passes it to `FindNextZ`. That casts a ray
down from the hint (`math::Ray {{x, y, zHint}, {x, y, tile min Z}}`) and
returns the first model surface it hits, merged with the ADT height. The
detail mesh is only an approximation of the ground:

- Recast voxelizes the geometry into spans `CellHeight` (0.25) tall;
- `rcBuildPolyMeshDetail` keeps the detail mesh within
  `DetailSampleMaxError` (0.25) of that heightfield, and only at its sample
  points, 3 yards apart (`DetailSampleDistance`); between them, on stairs
  and uneven floors, the mesh cuts under the treads.

When the mesh lies below the real surface, the ray starts under it and
returns the next surface down: the terrain under a platform, or the tread
below a stair. The planner then refuses the route as
`ambiguous ground column at route`, correctly for the height it was given.

## The fix

`FindNextZ` gains an overload with a `band`. With a positive band it first
casts from `zHint + band`. If that ray hits a surface above `zHint`, that
surface is the result, the highest one if the band holds several. Otherwise
it casts from `zHint` exactly as before, so a call with no surface in
`(zHint, zHint + band]` computes the same ray, the same ADT merge and the
same bits. `FindHeight` passes `CellHeight + DetailSampleMaxError`
(0.5), the two quantization steps between the ground and the mesh. The ADT
merge still compares against the mesh hint. `FindHeights`, the only other
caller of `FindNextZ`, keeps the old overload, as do `FindPath`,
`LineOfSight` and `ZoneAndArea`.

A surface in that band cannot be a ceiling over the mesh polygon: Recast
discards walkable spans with less than `WalkableHeight` (1.6) of clearance
(`rcFilterWalkableLowHeightSpans`), so a surface within 0.5 above the mesh
is the ground the mesh stands for, not an overhang above it.

`DetailSampleMaxError` alone (0.25) was built and measured first. It planned
four of the six routes below; waypoint → (10318.4, -6415.6) still refused at
(10336.446, -6391.804), where the mesh hint is 38.181 and the tread is
38.5275, 0.346 above it. A band of 1.0 (`WalkableClimb`) planned and
refused the same six routes as 0.5, so the smaller band is carried.

## The six routes of the issue

Spawn (10349.599609375, -6357.2900390625, 33.4025993347168), waypoint
(10382, -6379.56, 37.6876), map 530, `planGround` without Z. "Default" is
the corner and boundary-ray patches, "patched" adds this patch. Each library
ran in its own process. A sample is non-anchor unless it is the start, the
end or a native path corner.

| Route | Default | Patched |
|---|---|---|
| spawn → (10318.4, -6415.6) | `ambiguous … at route` | 152 points, 72.83 yd, start exact, 137 non-anchor samples |
| waypoint → (10315.4, -6387.2) | `ambiguous … at route` | 150 points, 72.34 yd, start exact, 139 non-anchor samples |
| waypoint → (10270, -6405) | `ambiguous … at route` | 248 points, 120.76 yd, start exact, 233 non-anchor samples |
| waypoint → (10318.4, -6415.6) | `ambiguous … at route` | 176 points, 85.00 yd, start exact, 160 non-anchor samples |
| waypoint → (10334.4, -6375.3) | `ambiguous … at route` | `ambiguous … at route`, further along (below) |
| spawn → (10270, -6405) | `ambiguous … at route` | 199 points, 98.03 yd, start exact, 194 non-anchor samples |

Every non-anchor sample of the five planned routes is on a surface of its
`findHeights` column: 8, 39, 39, 45 and 23 of them differ from it in the
last bits, by at most 8.2e-5 yards, and the rest are bit-exact. That is
float rounding of the model ray hit, whose Z depends on where the ray
starts (`FindHeights` casts from the tile top and then from each surface it
finds). The default build shows it at the same points: replaying its own
`findHeight` at the samples of four of these routes puts 9, 39, 42 and 22
values off the column by the same maxima.

The patch changes only the samples the issue lists and their neighbours on
the same treads. Replayed against the default build, the samples differ at
1, 9, 4 and 2 points of those four routes, each time from a surface below
the hint to the one just above it, such as (10331.190, -6397.500): 37.272 →
38.209, and (10294.832, -6394.038): 27.381 → 29.788.

### The route that still refuses

waypoint → (10334.4, -6375.3) now passes the issue's sample
(10363.035, -6378.749) and refuses at (10358.446, -6379.105). The previous
sample is (10358.928, -6379.166, 37.399); the next is 0.48 yards on, where
the mesh hint is 38.524 and the first surface below it is the next stair
tread, 38.442. The column there is [58.188, 38.442, 37.002]. The rise,
1.043, is more than `WalkableClimb` (1.0), and the column holds another
surface, so the planner's wrong-floor rule (#162) refuses it. `findHeight`
is right; the refusal is the planner's step limit on a Sunspire stair riser
that Recast connected, filed as #350.

## What else it changes

Grid method: `vendor/namigator/measure.ts`, the 41 × 41 `planGround` grid of
#126 (±120 yards in 6-yard steps) from the Fairbreeze origin
(8709.46, -6671.76, 70.33597564697266) and the Sunstrider spawn, on `main`
at `2526d83`. "+ ADT" adds the opt-in `adt-edges.patch` to both builds.

| Result, Fairbreeze | installed | default → patched | + ADT |
|---|---:|---:|---:|
| OK | 228 | 707 → 796 | 756 → 858 |
| `ambiguous ground column at route` | 0 | 419 → 194 | 419 → 195 |
| `pathfind_find_height failed (UNKNOWN_HEIGHT)` | 1217 | 94 → 193 | 45 → 130 |
| `ground corridor changes surface` | 0 | 0 → 37 | 0 → 37 |
| `ground corridor collision` | 0 | 217 → 217 | 217 → 217 |
| `ambiguous ground column at destination` | 203 | 203 → 203 | 203 → 203 |
| `end snapped off the requested ground position` | 32 | 32 → 32 | 32 → 32 |
| `path corner disagrees with connected ground` | 0 | 8 → 8 | 8 → 8 |
| `pathfind_find_path failed (UNKNOWN_PATH)` | 1 | 1 → 1 | 1 → 1 |

| Result, Sunstrider | installed | default → patched | + ADT |
|---|---:|---:|---:|
| OK | 269 | 759 → 888 | 772 → 905 |
| `ambiguous ground column at route` | 0 | 234 → 87 | 234 → 87 |
| `pathfind_find_height failed (UNKNOWN_HEIGHT)` | 1093 | 59 → 79 | 44 → 60 |
| `ground corridor collision` | 25 | 335 → 333 | 335 → 333 |
| `ambiguous ground column at destination` | 288 | 288 → 288 | 288 → 288 |
| `end snapped off the requested ground position` | 5 | 5 → 5 | 5 → 5 |
| `path corner disagrees with connected ground` | 0 | 0 → 0 | 2 → 2 |
| `pathfind_find_path failed (UNKNOWN_PATH)` | 1 | 1 → 1 | 1 → 1 |

- **Routes that planned before.** All 707 Fairbreeze and 759 Sunstrider
  routes that planned with the default build plan to hash-identical point
  lists with the patch, and so do all 756 and 772 with the ADT patch, and
  the installed library's 228 and 269.
- **New routes.** 89 Fairbreeze and 129 Sunstrider destinations move to OK
  (127 and 2 of the Sunstrider ones from `ambiguous … at route` and
  `ground corridor collision`). All 218 keep their start exactly. Of their
  46,775 non-anchor samples, 43,027 are bit-exact on a `findHeights`
  surface and the rest are within 8.2e-5 of one.
- **Other changed refusals.** The other 136 Fairbreeze and 20 Sunstrider
  destinations that change were already refused. Instrumented with a
  `findHeight` counter, each one now makes more successful `findHeight`
  calls before it refuses, so each gets further along its route. The new
  `UNKNOWN_HEIGHT` refusals start from sources on tile borders, such as
  (8700.000, -6650.017) for 77 of them and (10366.666, -6382.142) for 15:
  the rays along tile-border edges that #151 left unfixed
  ([patched-namigator.md](patched-namigator.md), "What remains"). The 37
  `ground corridor changes surface` refusals all step off the platform
  edge at (8700.25, -6695.73): the mesh hint there is 72.863, the column
  only [70.721], and the step back returns 70.675, not the 72.984 the
  route came from.
- **`findHeight` values.** `findHeight` from each origin to every point of
  a 1-yard grid, ±120 yards (58,081 points each), compared bit for bit: no
  call gains or loses a result, and 3 of 8,642 Fairbreeze and 39 of 12,419
  Sunstrider results change. An instrumented build logged the mesh hint of
  each. In all 42, the old value is 0.25 to 2.57 below the hint, the new
  one 0.003 to 0.329 above it, and the new one is nearer the hint. The old
  value is 0.40 to 2.58 below the new one. In 38 of the 42 that is within
  1.6, so by the planner's floor rule (#138) the old value was not a floor.
  In the other 4 the old value was a floor 1.73 to 2.58 below the surface
  just above the hint: (10293.6, -6394.29), for example, goes from 26.878
  (hint 29.447) to 29.458.
- `findHeights`, `findPath` and `lineOfSight` are not touched.

## Live, 2026-09-26

Own `fresh` character Fgklhpopmib (0xb6c, account FAC6AB7FEFC81, deleted
after the run) at the Sunstrider spawn, CLI on this branch through the
account's `tmp/tc-<ACCOUNT>` wrapper. The account's `navigation_library`
pointed at a copy of each build in `tmp/`, and the daemon was restarted
between them; `/proc/<daemon>/maps` shows which one it had loaded. The
shared library and config were not changed. Transcript:
[findheight-surface-above-hint-transcript.txt](findheight-surface-above-hint-transcript.txt).

- **A, default build** (`tmp/libnm-default.so`, sha256 prefix
  `0b677f84f970985b`): `goto 10318.4 -6415.6` →
  `stop: ambiguous ground column at route`, `refusal: "stop"`, and the
  pose kept its login `updatedAt` 1790443266928.
- **B, patched build** (`tmp/libnm-patched.so`, sha256 prefix
  `c1ba7820ea4711a3`): the same goto returned `intent` with derived Z
  37.663055419921875. `remaining` went 55.29 → 37.07 → 19.54 → 1.30 → 0,
  ending `active: false` after `traveled` 72.83 in 10.4 s, one plan and no
  interruptions. CONTROL events: `facing_changed`, `movement_started`,
  `control_changed`, `movement_stopped` (`arrived`) and `control_changed`
  (`arrived`).
- **Relogin pose** after `stop`/`start`: (10318.400390625,
  -6415.60009765625, 37.663055419921875), `source: "server"`, the
  destination at f32 precision, on the one floor of its column.
