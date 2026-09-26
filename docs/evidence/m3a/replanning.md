# M3a slice 3: bounded replanning, verified live

Issue #227, 2026-09-26. Character: an own `eversong10` SOAP character
(Fgklheeaodi, 0xa6f, account FAC6AB7440E38), with a second own character
(Fgklheeaopg, account FAC6AB7440EF6, GM level 2) used only to summon it out
of the inn at the start. Both accounts were deleted afterwards. Map 530,
open ground south of Fairbreeze.

Files:

- [replanning-runs.txt](replanning-runs.txt): one line per `goto` run, with
  its library, final navigation state and relogin pose.
- [replanning-transcript.txt](replanning-transcript.txt): the compacted CLI
  transcript. It keeps every command, the CONTROL events and each change of
  navigation state.

Every run was followed by `stop`, `start` and `control --json`, and every
relogin pose below has `source: "server"`.

## Libraries

Each run's header in the transcript names the configured library.

- **installed**: `/home/deity/wow-data/libnamigator.so`, namigator `54eae69`
  unpatched (sha256 prefix `dbca3cf29dc1ec15`).
- **patched-155**: built from PR #155's `vendor/namigator` (both
  `corner-height.patch` and `boundary-rays.patch` on `54eae69`) with its own
  `build.sh`, into this worktree's `tmp/namigator-155/libnamigator.so`
  (sha256 prefix `44e62f4d4c5c22f6`). I pointed only this character's own
  config at it. No shared library or config changed.

Neither run used PR #172's planner policy change. This branch is based on
`main`.

## Routes

- B = (8764.71, -6683.07, 69.789)
- C = (8689.71, -6713.07, 71.718), 80.8 yards from B
- D = (8664.71, -6723.07, 78.410), 107.7 yards from B

A mid-walk ground refusal is a `GroundRoute.sample` failure between the
route's validated 0.5-yard points. It depends on where the 100 ms heartbeats
land along the route, so whether a given run meets one varies. The
exception is C→B, which met one at the same place every time (below).

## Results

| Library     | Runs | Arrived, 1 plan | Replanned and arrived | Terminal stop                                         |
| ----------- | ---- | --------------- | --------------------- | ----------------------------------------------------- |
| installed   | 30   | 22              | 1                     | 5 `replan_no_progress`, 2 planner refusals after a stop |
| patched-155 | 22   | 17              | 0                     | 5 `replan_refused: pathfind_find_height failed (UNKNOWN_HEIGHT)` |

The two installed-library planner refusals (`installed-back-2` and
`installed-back-3`) ran on the first build of this branch. That build
reported a refused replan with the bare planner reason. The naming then
changed to `replan_refused: <reason>`, and the patched-155 C→B runs show
the final form.

### Replanned and arrived (installed library, run `installed2-6`, D→B)

`goto 8764.71 -6683.07 69.78932189941406` from D:

1. The route walked to `remaining` 18.005. A route sample then failed with
   `pathfind_find_height failed (UNKNOWN_HEIGHT)` at
   (8747.993, -6689.757, 69.634). The events were `movement_stopped` and
   `control_error` with that reason.
2. `navigation --json` then read `active: false`,
   `replan.pending: true`, `plans: 1`, `traveled: 89.698`,
   `elapsedMs: 12916`, and the next step "Replanning from the stopped pose.
   Wait …".
3. After 250 ms came `control_changed` reason `replanned`, followed by
   `facing_changed` and `movement_started`, all at the stopped pose.
   Navigation read `active: true`, `plans: 2`.
4. `movement_stopped` reason `arrived` at (8764.71, -6683.07, 69.789). The
   final state was `active: false, remaining: 0, blockedReason: null`,
   `plans: 2`, `traveled: 107.703`, `elapsedMs: 15741`,
   `interruptions: ["pathfind_find_height failed (UNKNOWN_HEIGHT)"]`.
5. The relogin pose was (8764.7099609375, -6683.06982421875,
   69.78932189941406).

### Terminal stop: no progress (installed library)

Take `installed2-4`, D→B. The first route stopped with UNKNOWN_HEIGHT at
(8747.999, -6689.754) and replanned (`plans: 2`). The new route's first
samples failed again at the same pose, so the second interruption was
0 yards from the new plan origin. That is under the 2-yard minimum, so it
ended with `blockedReason: "replan_no_progress"`, `plans: 2`, two
interruptions and `remaining` 18.00. No third plan was attempted. The
relogin pose was (8747.9990234375, -6689.75439453125, 69.6336441040039).
`installed-out-1`, `installed-4`, `installed2-2` and `installed2-3` ended
the same way.

### Terminal stop: refused replan (patched-155 library)

C→B (`patchedBC-1` to `patchedBC-5`) met a mid-walk UNKNOWN_HEIGHT at the
same place in all five runs, after 12.614 yards at (8701.42, -6708.39).
Offline, the route's samples fail from 13.04 to 13.32 yards on both
libraries. The replan from the stopped pose was refused by the planner
itself (`plan` from (8701.421875, -6708.38525390625, 72.5335) throws
UNKNOWN_HEIGHT on both libraries). Each run ended with
`blockedReason: "replan_refused: pathfind_find_height failed (UNKNOWN_HEIGHT)"`,
`plans: 1`, one interruption and `remaining` 68.16, and the relogin pose
was (8701.421875, -6708.38525390625, 72.53353118896484). The
installed-library runs of the same leg ended the same way. So the #155
patch does not remove this refusal. It is a different native case from the
funnel-corner vertex that #155 addresses, and I did not diagnose its native
stage here.

### Arrival on the patched library

D→B met no mid-walk refusal in 12 patched-155 runs, and all 12 arrived
with one plan. On the installed library, the same leg needed a replan in 5
of 12 runs. No patched-155 run replanned, so I have no live
replan-and-arrive on that library.

## Limits in force

From `REPLAN_LIMITS` in `src/wow/route-session.ts`. `navigation --json`
reports them under `replan.limits`.

- At most 4 plans per `goto`.
- At most 60 s since the `goto`.
- Less than `max(20, 2 × first route length)` yards walked.
- At least 2 yards between a new plan origin and the previous one.
- A 250 ms delay between the stop and the replan.

The live runs reached only the no-progress limit. The plan-count, time and
distance limits are covered by unit tests in
`src/wow/control-replan.test.ts`.
