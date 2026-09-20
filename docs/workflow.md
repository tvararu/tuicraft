# AI development workflow

Updated: 2026-09-20

Originally written 2026-02-18 by Theodor Vararu as a human-authored sketch of
Claude Code usage. This revision records the current direct-to-main workflow.

## Developing

Use the current coding harness. [.claude/settings.json](../.claude/settings.json)
is Claude-specific convenience. Shared `AGENTS.md` and Git hooks apply across
agents. Superpowers still applies: brainstorm, write a plan, then execute in
isolated work.

Independent agents work in local or Orca worktrees. One integration owner lands
the combined tree. Keep increments small and reviewable. Do not mix unrelated
work into the same change.

After verification, agents may `git add` the intended files, then `git commit`
as a separate step, then push to `main`. No pull requests. Do not force-push or
delete branches without permission.

## Verification before push

Unit, type, format, and coverage checks are local. They are not live-behavior
evidence.

- `mise bundle` installs dependencies and git hooks (`hk install --mise`).
- `mise ci` runs `typecheck`, `test:coverage` (100% line/function threshold),
  and Biome `format`. It does not run `gh signoff` or remote CI.
- Pre-push runs a dirty-worktree guard, then `mise ci`, so CI sees the committed
  tree.
- After protocol or daemon changes, also run `mise test:live`. That suite needs
  two dedicated test accounts with their `WOW_*` credentials configured. Ordinary
  client config is not enough. Do not treat a missing second account, missing
  env vars, or an auth failure as a passing live run.

Local hooks are not server-side guarantees. They can be bypassed; do not bypass
them or force-push without permission. GitHub required PR and status checks are
already disabled. Do not change repository rulesets.

Review still matters: security, correctness, and simplification passes, plus
actual TUI verification when the surface changed. Agents can perform that
check; it is not a mandatory human test gate. Review is local, not a GitHub
PR step.

If the same agent mistake keeps happening, revise `CLAUDE.md` (the `AGENTS.md`
symlink shares it). Prefer `mise` tasks over raw `bun`, `bun run`, or `mise run`.

## Releases and Pages

Releases are paused. Do not run release-please or publish new versions. Existing
published versions and git history stay.

GitHub Pages still deploys on push to `main`. If a Pages run fails, inspect the
exact failed run and distinguish config issues from infrastructure failures.
Retry only when that is appropriate. Do not change Pages settings without
authorization.
