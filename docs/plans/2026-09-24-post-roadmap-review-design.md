# Post-Roadmap Review Design

Theo approved this design on 2026-09-24. The run is one Claude Code
`Workflow` with Opus 5.5 agents only. It does not use omp, Orca or a goal
loop. This is a one-time exception to the harness rules in AGENTS.md.

## Goal

The code merged in `009434b..9c47b07` was written by several agents with
different habits. This run reviews that code and refactors it until it
matches the pre-roadmap patterns. The patterns are defined in
`docs/plans/2026-09-24-pattern-charter.md`. Every accepted milestone must
still work against the live server.

## Decisions

- **Latitude:** agents have full latitude. They can change interfaces, CLI
  output and JSON shapes, and they can delete features.
- **Gate:** `mise ci` and `mise test:live` run after each refactor stage. A
  final live smoke run covers the exit criteria of M1–M4.
- **Landing:** the run is fully automatic. It fast-forwards `main` and pushes
  only after verification passes.
- **Docs in scope:** tests, the four user-facing doc places, and a hygiene
  pass on `docs/roadmap.md` and the evidence records.

## Shape

The review runs in parallel and is read-only. The refactor runs in series,
in dependency order, on one branch. This prevents conflicts in the shared
files: `client.ts`, `daemon/commands.ts`, `cli/args.ts`, `main.ts` and both
WorldHandle mocks.

The run uses at most 10 agents:

1. Reviewers 1–3 run in parallel. Their clusters are protocol and data,
   world runtime, and autonomy with the surface. Each writes findings to
   `tmp/review-2026-09-24/review-<cluster>.md`.
2. Refactorers 4–7 run one at a time on `review/2026-09-24` in the worktree
   `../tuicraft-review`. The order is protocol and data, then world
   runtime, then autonomy, then the surface.
3. Agent 8 does docs hygiene.
4. Agent 9 runs `mise ci`, then `mise test:live`, then a live smoke run of
   the M1–M4 exit criteria.
5. Agent 10 is the fixer. It runs only when agent 9 fails, and it gets one
   attempt.

If the result passes, `main` fast-forwards to the branch and is pushed. If it
fails, the branch is pushed, `main` does not change, and the report explains
why.

Only one agent uses the live server at a time. The final report goes to
`tmp/review-2026-09-24/REPORT.md`.
