# M3a: goto refusals on Sunstrider Isle, and ground floors

Issue #138. The M5 quest run (PR #134) found `goto` refusing most of
Sunstrider Isle near the Sunspire and in the western Mana Wyrm area,
including the spawn point, with `ambiguous ground column` or
`pathfind_find_height failed (UNKNOWN_HEIGHT)`. This record classifies those
refusals against the native geometry, says which are correct and which are
not, describes the change, and gives grid counts and a live A/B run.

## Method

The M5 records (`docs/evidence/m5/`) hold 20 distinct `goto` destinations
on the isle. Most of their refusals carry no site: the M5 builds predate
the site in the message (`742de4f`, #122) and did not record the pose of
each attempt. So every destination was re-planned offline on `main` at
`492d0bd` from the three recorded poses: the spawn (10349.599609375,
-6357.2900390625, 33.4025993347168), the Marsilla waypoint (10382,
-6379.56, 37.6876) and the post-fight pose (10399.26, -6261.84, 27.43),
without Z and with the Z the M5 run used. Each plan ran with three
libraries, each in its own process:

- the installed library (namigator `54eae69`, unpatched);
- the default build of `mise namigator:build` (the corner-height and
  boundary-ray patches from #151);
- the default build plus the opt-in ADT patch.

Each library was rebuilt with an instrumented `Map::FindHeight` that logs
every failure with its stage, the raycast `t` and path count, and for every
success the navmesh height it passes to `FindNextZ` (the hint) and the
height that comes back. A wrapper around `openNativeMap`, passed through
`createNavigation`'s `openMap` parameter, recorded the native calls behind
each refusal. The ADT patch changed no result, so it is not listed below.

Stages in the installed library's `FindHeight`: 1 `findNearestPoly`,
2 `raycast`, 3 empty ray path, 4 `getPolyHeight` on the ray's last polygon,
5 tile lookup, 6 `FindNextZ`. In the patched build, stage 4 is a ray that
did not reach the target after the #151 continuation.

## What a floor is

A column from `findHeights` can hold a surface that nobody can stand on.
Recast drops a span whose headroom is less than `WalkableHeight` (1.6 yards)
(`rcFilterWalkableLowHeightSpans`), and #162 already uses that rule for route
samples. The same rule defines a floor here: a surface with no other
surface from 0.25 to 1.6 yards above it. Surfaces within 0.01 of each
other are one floor.

## Classes

| Class | Where | Verdict |
|---|---|---|
| Destination column with several floors | western Mana Wyrm area, the Sunspire | correct refusal; the floors were not reported and a caller could not pick one |
| Pose or destination on a platform over terrain less than 1.6 yards below | the Sunspire plaza and other platforms over terrain | wrong: the terrain under the platform is not a floor, so the column has one floor |
| `UNKNOWN_HEIGHT`, stage 4 with `t` = FLT_MAX or `t` = 0 | most routes from the post-fight pose and the waypoint | the #123 corner defect; fixed by the default build, which is not the installed library |
| `UNKNOWN_HEIGHT` left by the default build | the tile border y = −6333.333 | the ray along a tile-border edge that #151 left unfixed; blocked on a namigator patch |
| Route sample on a lower surface than the one the route is on | Sunspire stairs and platforms, with the default build | native: `FindNextZ` skips a surface just above the mesh hint; #314 |
| Low collision ray at a step down within `WalkableClimb` | platform edges, with the default build | planner gate; #315 |
| Route that drops more than 1 yard between samples | from the post-fight pose | correct (#162's wrong-floor rule) |
| Guessed Z not on the column | M5 `goto 10270 -6405 40` | correct refusal, but classified `wait` with no next step |

## Sample points

Columns are `findHeights` at the destination, rounded to 0.01 here and
exact in the probe output. "Installed" and "default" are the libraries.

| Destination | Column | From | `main`, installed | `main`, default | Verdict and this change |
|---|---|---|---|---|---|
| Spawn (10349.6, -6357.29) | [33.40] | spawn, waypoint | plans | plans | no refusal |
| Spawn | | post-fight | stage 4, `t` = FLT_MAX, (10378.320, -6283.571, 25.780) → (10377.977, -6283.928) | `ambiguous ground column at route` at (10371.918, -6300.145): hint 26.93, previous sample 29.22, column [29.32, 26.55] | #123, then a correct wrong-floor refusal |
| Spawn | | the plaza (10319.6, -6357.29, 29.834), column [29.834, 29.834, 29.395] | `ambiguous ground column at start` (live) | same | wrong: 29.395 is 0.44 under the plaza; now walked live |
| Spawn | | the ledge (10300.76, -6346.52, 25.455), column [25.46, 23.07] | `ambiguous ground column at start` (live) | same | wrong: the pose is on floor 25.46; now walked live |
| (10300.76, -6346.52), western Mana Wyrm | [25.46, 23.07] | spawn | `ambiguous ground column at destination` | same | two floors 2.39 apart: correct; now lists floors 25.46 and 23.07, and `goto … 25.46` walked live |
| (10300.3, -6353.6) | [50.68, 23.82, 25.27] | all three | `ambiguous … at destination` | same | floors 50.68 and 25.27 (23.82 is 1.45 under 25.27): correct, now listed |
| (10328, -6405), the Sunspire | [114.46, 57.93, 36.71, 37.20] | all three | `ambiguous … at destination` | same | floors 114.46, 57.93 and 37.20: correct, now listed. From the spawn, 114.46 and 57.93 give `UNKNOWN_PATH`; 37.20 refuses at (10331.840, -6396.899), where `FindNextZ` skips 38.297 above the hint 38.207 (#314) |
| (10319.6, -6357.29), the plaza | [29.834, 29.834, 29.395] | spawn | `ambiguous … at destination` (live) | same | wrong: one floor; now derives Z 29.834, walked live |
| (10220, -6340), western | [30.84, 29.67] | spawn | `ambiguous … at destination` | same | wrong: one floor, 30.84. Z is now derived; the route then fails at stage 4, `t` = FLT_MAX, (10317.150, -6364.183) → (10316.666, -6364.286) (#123), and with the default build at a step down (#315) |
| (10289, -6310) | [25.86] | spawn | stage 4, `t` = 0, (10341.368, -6353.870, 32.314) → (10340.978, -6353.582) | plans | #123: the ray stops at its source on a polygon boundary; live A/B below |
| (10380, -6320) | [33.53] | spawn | stage 4, `t` = 0, (10355.356, -6336.905, 30.837) → (10355.768, -6336.624) | plans | #123; walked live in [patched-namigator.md](patched-namigator.md) |
| (10296.4, -6303.8) | [25.57] | spawn, waypoint | stage 4, `t` = 0 at (10341.368, -6353.870) | stage 4, `t` = 0, (10317.869, -6333.333, 25.664) → (10317.565, -6333.334) | #123, then the tile-border ray #151 left unfixed: blocked on namigator |
| (10318.4, -6415.6) | [37.66] | spawn | stage 4, `t` = FLT_MAX, (10339.821, -6374.868, 35.545) → (10339.583, -6375.297) | `ambiguous … at route` at (10331.190, -6397.500): hint 38.196, returned 37.272, column [59.56, 59.56, 38.21, 37.27] | #123, then `FindNextZ` misses 38.209, 0.013 above the hint (#314) |
| (10330, -6370) | [33.42] | waypoint | stage 4, `t` = FLT_MAX, (10373.702, -6379.750, 37.273) → (10373.214, -6379.761) | `ground corridor collision` stepping 37.372 → 36.445 at (10356.12, -6372.83) | #123, then the low ray at a step down (#315) |
| (10270, -6405), Z 40 | [36.52] | spawn | `wait: position disagrees with ground height` | same | a guessed Z: correct, but `wait` sent the caller to wait; now `pick_destination` listing floor 36.52 |

## The change

In `src/wow/navigation.ts`:

- **Destination without Z.** The height is the one floor of the column.
  Terrain under a platform no longer makes the column ambiguous. Several
  floors refuse with `ambiguous ground column at destination (floors 25.46,
  23.07)`, highest first.
- **Destination with Z.** Z must be within 0.25 of a surface, with no
  surface from 0.25 to 1.6 above Z, so a caller picks a listed floor by
  passing it as Z. Otherwise it refuses with `destination is not on a ground
  floor (floors …)`. Both refusals are `pick_destination`; before, a
  mismatched Z was `position disagrees with ground height` and `wait`.
- **Start.** The observed pose must be within 0.25 of a surface (else
  `position disagrees with ground height`, `wait`, as before) with no
  surface from 0.25 to 1.6 above it (else `ambiguous ground column at
  start`). Before, the start column had to hold one surface. The route's
  first sample still has to find the pose's own height through the navmesh
  (`start is not on connected ground`), so a pose can only be the floor the
  mesh has there.
- `navigation --json` carries the listed floors as `floors`, and its
  `nextStep` says to repeat the `goto` with one of them as Z.

Nothing is substituted or jittered. The route's last point is still the
connected `findHeight` result and must lie within 0.25 of the chosen Z, and
every route sample keeps the #162 checks. A floor the route cannot reach is
refused. `navigation.height` and the step heights of manual legs still
require a unique column.

## Grid counts

The 41 × 41 `planGround` grid of #126 (±120 yards in 6-yard steps) from the
Fairbreeze origin (8709.46, -6671.76, 70.33597564697266) and the Sunstrider
spawn, with `vendor/namigator/measure.ts`, `main` against this branch:

| Result | Fairbreeze installed | default | Sunstrider installed | default |
|---|---:|---:|---:|---:|
| OK | 228 → 228 | 702 → 707 | 260 → 269 | 731 → 759 |
| `ambiguous ground column at destination` | 237 → 203 | 237 → 203 | 408 → 288 | 408 → 288 |
| `ambiguous ground column at route` | 0 → 0 | 413 → 419 | 0 → 0 | 215 → 234 |
| `ground corridor collision` | 0 → 0 | 214 → 217 | 25 → 25 | 274 → 335 |
| `pathfind_find_height failed (UNKNOWN_HEIGHT)` | 1201 → 1217 | 92 → 94 | 986 → 1093 | 51 → 59 |
| `end snapped off the requested ground position` | 14 → 32 | 14 → 32 | 2 → 5 | 2 → 5 |
| `path corner disagrees with connected ground` | 0 → 0 | 8 → 8 | 0 → 0 | 0 → 0 |
| `pathfind_find_path failed (UNKNOWN_PATH)` | 1 → 1 | 1 → 1 | 0 → 1 | 0 → 1 |

Every route that planned on `main` plans to hash-identical points on this
branch. Only destinations that were `ambiguous … at destination` change.
The 33 that now plan (both libraries, both sites) all have columns of two
surfaces 0.38 to 1.55 yards apart, and the route ends on the upper one. The
others now name the refusal further along the route, and 18 at Fairbreeze
have one floor that the mesh does not reach (`end snapped …`,
`unreachable`).

From a pose on a platform or upper level, `main` refuses all 1681
destinations with `ambiguous ground column at start`. With this branch:

| Origin | Column | OK, installed | OK, default |
|---|---|---:|---:|
| The Sunspire plaza (10319.599609375, -6357.2900390625, 29.83) | [29.834, 29.834, 29.395] | 301 | 559 |
| The western ledge (10300.76, -6346.52, 25.46) | [25.455, 23.068] | 265 | 620 |
| The Fairbreeze inn spawn (8714.14, -6650.33, 72.75) | [102.01, 93.44, 72.75, 70.37] | 0 | 99 |

## Live, 2026-09-26

Own `fresh` character Fgklhnccheh (0xb1d, account FAC6AB7D22747, deleted
after the run) at the Sunstrider spawn. A ran unchanged `main` from an
archive of it, B ran this branch; the daemon was restarted between them,
and each daemon's command line is in the transcript. The account used the
installed library, except in the last test. Transcript:
[sunstrider-floors-transcript.txt](sunstrider-floors-transcript.txt).

1. **Several floors, from the spawn.** A: `goto 10300.76 -6346.52`,
   `goto 10300.76 -6346.52 25.46` and `goto 10300.76 -6346.52 24` all gave
   `pick_destination: ambiguous ground column at destination`, and
   `nextStep` was "Choose a destination with one ground height. Do not
   guess Z." B: without Z,
   `pick_destination: ambiguous ground column at destination (floors 25.46,
   23.07)`, with `floors: [25.4552001953125, 23.067646026611328]` in
   `navigation --json`; Z 24 gave `pick_destination: destination is not on
   a ground floor (floors 25.46, 23.07)`. The pose kept its login
   `updatedAt` 1790431814844.
2. **A listed floor, walked.** B: `goto 10300.76 -6346.52 25.46` went
   `remaining` 41.60 → 32.49 → 24.06 → 14.94 → 6.52 → 0, `active: false`.
   CONTROL events: `facing_changed`, `movement_started`, `control_changed`,
   `movement_stopped` (`arrived`) and `control_changed` (`arrived`).
   Relogin pose (10300.759765625, -6346.52001953125, 25.45522689819336),
   `source: "server"`: the upper floor.
3. **Planning from the ledge.** A: `goto 10349.6 -6357.29` and
   `goto 10349.6 -6357.29 33.4` gave `stop: ambiguous ground column at
   start`. B: `goto 10349.6 -6357.29` derived Z 33.40286636352539 and went
   41.60 → 0, `arrived`. Relogin pose (10349.599609375,
   -6357.2900390625, 33.40286636352539).
4. **The plaza, as destination and start.** A, at the spawn:
   `goto 10319.6 -6357.29` and `goto 10319.6 -6357.29 29.83` gave
   `pick_destination: ambiguous ground column at destination`. B:
   `goto 10319.6 -6357.29` derived Z 29.833812713623047 and went 21.58 → 0,
   `arrived`; relogin pose (10319.599609375, -6357.2900390625,
   29.833812713623047). A, from there: `goto 10349.6 -6357.29` gave
   `stop: ambiguous ground column at start`. B: the same goto went
   21.59 → 0, `arrived`; relogin pose (10349.599609375,
   -6357.2900390625, 33.40286636352539).
5. **The #123 corner defect, by library.** B with the installed library
   (`/proc/<daemon>/maps` shows `/home/deity/wow-data/libnamigator.so`):
   `goto 10289 -6310` gave `stop: pathfind_find_height failed
   (UNKNOWN_HEIGHT)`, with `nextStep: null`. With the account's
   `navigation_library` pointed at the default build
   (`tmp/namigator/libnamigator.so`, not committed; the shared config was
   not changed): derived Z 25.860801696777344, `remaining` 71.22 → 0,
   `arrived`; relogin pose (10289, -6310, 25.860801696777344).

## What remains

- The #123 corner defect is fixed by the default `mise namigator:build`
  output, but `/home/deity/wow-data/libnamigator.so` is still the unpatched
  build, so on the default config these routes keep refusing with
  `UNKNOWN_HEIGHT`. Installing the build as the shared library is the
  maintainer's call.
- The tile-border ray at y = −6333.333 needs a tolerance in Detour's clip
  (see [patched-namigator.md](patched-namigator.md), "What remains").
- `FindNextZ` missing a surface just above the mesh hint (#314) is fixed
  by the default build's third patch
  ([findheight-surface-above-hint.md](findheight-surface-above-hint.md)).
  Past it, one Sunspire route stops at a stair riser the planner refuses
  (#350).
- The low collision ray at a step within `WalkableClimb` (#315) follows
  the higher floor on the native corridor
  ([step-edges.md](step-edges.md)).
- `UNKNOWN_HEIGHT` still has no `nextStep` (#275).
