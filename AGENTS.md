# AGENTS.md

## Priorities and Ownership

- Working, protocol-correct gameplay is the goal. Agents own implementation,
  engineering decisions, review, and integration; the user is not a code-review
  gate. Keep existing conventions where useful, but do not pursue cosmetic
  refactors or coverage percentages instead of gameplay.
- Prioritize agent control and real-server outcomes. Human-facing usability and
  spatial TUI improvements follow user feedback; they are not prerequisites for
  the first agent-playable capabilities.
- Play as soon as a useful loop works, use failures to guide development, and
  continue normal gameplay and leveling on the user's server when the active
  goal allows it. Do not substitute server-data edits for client capabilities.
- Delegate multi-step live gameplay and gameplay debugging to one omp worker,
  even when the coordinator has CLI access.
- Assign one agent exclusive CLI ownership per character. The coordinator must
  not use that character's CLI while a worker owns it.
- Transfer ownership explicitly before another agent controls the character.
  If the coordinator lacks CLI access, delegate even one-off live commands.
- omp is the main harness. Orca worktrees spawn agents with `--agent omp`;
  "omp worktree" means `orca-ide worktree create --agent omp`.

## Commands

Use `mise` to run tasks (not `bun` directly, not `mise run`):

- `mise bundle` — install dependencies and git hooks (`bun install`, then `hk install --mise`)
- `mise test` — run all tests (`bun test`)
- `mise test:coverage` — tests with coverage reporting; no percentage gate
- `mise typecheck` — type-check (`tsc --noEmit`)
- `mise format` — check formatting (`biome format`)
- `mise format:fix` — fix formatting (`biome format --write`)
- `mise lint` — lint rules and assist actions (`biome check --formatter-enabled=false --error-on-warnings`)
- `mise lint:fix` — apply safe lint fixes and assist actions (`biome check --write`)
- `mise ci` — `mise ci:checks` (`typecheck`, `test:coverage`, `format`,
  `lint`), then `gh signoff ci` posts a green `signoff/ci` status for HEAD.
  Signoff runs only after the checks pass and only for a HEAD that was clean
  throughout and is pushed to its upstream; otherwise it prints a note and
  exits 0. No remote CI
- `mise ci --publish` — used by the hk `pre-push` hook: pushes HEAD to a
  temporary `refs/signoff/<sha>` ref so the not-yet-pushed commit can be
  signed off, deletes that ref, and fails the push if signoff fails
- `mise test:live` — live server tests (`bun test ./src/test/live.ts`); needs two game accounts via `WOW_*` (see Testing)
- `bun src/factory/main.ts <precheck|qa-changes|soap|reap|setup>` — the dev
  factory CLI (design: `docs/plans/2026-09-25-dev-factory-design.md`).
  Automations and the reaper run it from the runner clone,
  `~/.local/share/tuicraft-factory/runner`, which follows `origin/main`
- `mise build` — compile single binary (`bun build --compile`)
- `mise test:slowest` — show 10 slowest tests via junit XML
- `orca-ide worktree create --name <name> --parent-worktree active --comment
  "owner: <agent>, <purpose>" --agent omp` — create a worktree.
  Setup is `scripts.setup` in the committed `orca.yaml` (`mise trust -y &&
  mise bundle`) and the agent starts only after it finishes; no other flags
  needed, and a nested agent creating its own worktree inherits both setup
  and lineage. Automation worktrees skip setup unless the automation has
  "Run setup for each new workspace" on.
- `orca-ide worktree rm --worktree name:<name>` — remove a worktree and its
  branch. No `--run-hooks`: there is no archive hook and passing it only adds
  a way for removal to fail.

## Skills

- Skills and frameworks, including Superpowers, are optional aids. Choose the
  planning, delegation, and review process that best delivers and verifies the
  active goal; no framework-specific ceremony or routine human approval gate.
- Canonical Superpowers source is upstream `obra/superpowers` (this machine:
  `superpowers@6.4.1`, installed via `omp install
  git:github.com/obra/superpowers`). The Pi extension injects the
  `using-superpowers` bootstrap into the model context at session start and
  after compaction; it does not appear as a `skill://` entry or in saved
  transcripts, so verify with a no-tools prompt
  (`omp -p --no-session --no-tools "…"`) rather than `skill://` reads or
  session JSONL. Claude Code uses `superpowers@claude-plugins-official`
  (already enabled in `.claude/settings.json`).
- Use `/typescript-style` as a reference for existing code conventions.
- When designing or integrating Jev, read `.claude/skills/typesafe-ai` first. Keep the TypeSafe API key private.

## Code Style

- Strict TypeScript — `noUncheckedIndexedAccess`, `noUnusedLocals`,
  `noUnusedParameters`, all strict flags on (see tsconfig.json)
- Never write comments, so never use `biome-ignore`; rule exceptions live as
  path overrides in `biome.json` (protocol bit flags, wire-order literals in
  `src/wow/**`, the opcode table, test files and `src/test/**`)
- Files are capped at 500 non-blank lines (`noExcessiveLinesPerFile`, tests
  included). Split by responsibility into sibling modules before a file grows
  past it; shared test setup goes in `src/test/<name>-fixtures.ts`. Only the
  central `opcodes.ts` table is exempt
- Fire-and-forget promises end in `.catch(ignoreFailure)` from
  `lib/ignore-failure`, not an empty callback
- Use Bun APIs over Node.js equivalents (`Bun.file` over `node:fs`, `WebSocket`
  built-in, etc.)
- `node:os` (tmpdir/homedir), `node:fs/promises` (mkdir/appendFile) are fine — no
  Bun equivalents exist
- `Bun.write` has no permission mode option — use `writeFile` from
  `node:fs/promises` with `{ mode: 0o600 }` when writing files containing
  secrets
- `Bun.file().exists()` only works on regular files — use `fs.access()` for
  unix sockets and other special files
- Bun automatically loads `.env`, so don't use dotenv

## Testing

- Use coverage to find risk, not as a target or release gate. Keep meaningful
  tests for behavior, protocol boundaries, and failure recovery. Do not add
  tests or restructure code solely to reach a percentage.
- **Always run `mise test:live` yourself after protocol or
  daemon changes.** Do not ask the user to run it. Run it on two throwaway
  accounts of your own, never on anyone else's character:
  `bun src/factory/main.ts soap create fresh --gm 2` (account 1, GM level 2
  for the `.freeze` and `.tele` checks) and
  `bun src/factory/main.ts soap create eversong10` (account 2). Set
  `WOW_ACCOUNT_1`, `WOW_PASSWORD_1`, `WOW_CHARACTER_1`, `WOW_ACCOUNT_2`,
  `WOW_PASSWORD_2` and `WOW_CHARACTER_2` from the JSON each prints, and
  delete both with `soap delete <ACCOUNT>` afterwards. Unit, type, format,
  and coverage checks are not live evidence. Do not claim the live suite is
  passing without a successful run. If the suite fails for infrastructure
  reasons (server down, SOAP unreachable), defer to the user.
- Tests are colocated: `foo.ts` → `foo.test.ts` in the same directory
- Import from `bun:test`: `import { test, expect, describe } from "bun:test"`
- Run with `mise test`
- `mise test src/file.test.ts` runs a single file (args pass through to `bun test`)
- Use `jest.useFakeTimers()` / `advanceTimersByTime()` from `bun:test` for
  timer-dependent tests (wrap in `try/finally` with `jest.useRealTimers()`)
- Prefer promise-based waiting over `Bun.sleep()` — await the event, not a
  hardcoded delay
- Use `./tmp/` for scratch files, not `/tmp/` (gitignored)
- `bun test` scans `./tmp/` for test files — never leave `.test.ts` files there
- macOS `tmpdir()` returns `/var/folders/.../T/`, not `/tmp/` — don't hardcode
  `/tmp/` paths
- Live tests read `WOW_LANGUAGE` env var (default: 1/Orcish for Horde accounts)
- `Bun.connect()` returns a promise — connection errors escape `new Promise`
  constructors. Chain `.catch(reject)` on the returned promise, not try/catch
- `Bun.listen` server-side `socket.end()` doesn't reliably trigger client
  `close` — detect the protocol terminator in `data` handler instead
- Use unique socket paths per test (counter + timestamp) to avoid cleanup races
- `mock.module()` leaks across test files in Bun, so `config/biome.grit` bans
  it. Use dependency injection: file locations come from a `Paths` value
  (`resolvePaths()` by default), and tests pass `pathsUnder(dir)` from
  `src/test/temp-paths.ts`. Stdlib modules like `node:readline` are injected too
- `Bun.sleep(0)` yields one microtask tick (enough for `.then()` chains);
  `Bun.sleep(1)` yields one full event loop turn (needed for filesystem I/O like
  `unlink` to complete) — prefer the minimum needed in tests
- `bun test` suppresses per-test lines when piped — use `mise test:slowest` or
  `--reporter=junit --reporter-outfile=<file>` for timing data

## Mise Task Authoring

- Use `'''` (TOML literal strings) for tasks with regex/backslashes — `"""`
  processes escapes and breaks sed/awk patterns

## Plans and Design Docs

- The sole current roadmap is [docs/roadmap.md](docs/roadmap.md).
- Existing `docs/plans/` files are historical design/protocol references, not
  instructions to execute old tasks. When a durable design note is useful, use
  `docs/plans/YYYY-MM-DD-<topic>-{design,plan}.md`; not every change needs one.

## Branches and archives

- The `vibe` branch is **reference only and must never be merged**. Theo's
  ruling, 2026-09-21: Fable created it around June 2026, it was never
  reviewed, and unreviewed code must not enter `main` disguised as progress.
  Keep it, never delete it, read it freely for implementation patterns
  (protocol serialisation, the `bun:ffi` namigator bridge, movement maths).
  Its acceptance and live-verification journals are **not** roadmap evidence,
  because nobody reviewed them. Never merge, rebase or cherry-pick it without
  Theo saying so.
- `main` has a GitHub `required_linear_history` rule and allows only
  rebase merges, so **merge commits are rejected at push time**. Local
  merges, hooks and `mise ci` all pass first, and the push then fails with
  `GH013: Repository rule violations found` naming only a commit hash, which
  reads as an auth or branch-protection fault rather than a history-shape
  one. Theo's admin bypass is the only direct push to `main`; it integrates
  by cherry-picking commits in order, never by merging. Note that
  `git cherry-pick --continue` opens an editor, so pass
  `-c core.editor=true`.
- The ten `gameplay-*` worktrees from the Astra run were removed on
  2026-09-21, but their uncommitted work was archived first, to
  `tmp/worktree-archive-2026-09-21/`. `tmp/` is gitignored, so **that archive
  exists on disk only and is pushed nowhere**. It holds ten `<name>.patch`
  files plus `MANIFEST.txt` giving each one's base commit (`903c3a3` or
  `1e73c0b`). Some of it exists in no commit at all —
  `src/wow/remote-motion.test.ts`, 338 lines, lives only inside
  `gameplay-quests.patch`. Restore one with:

      git worktree add --detach <dir> <base-sha-from-manifest>
      git -C <dir> apply --binary tmp/worktree-archive-2026-09-21/<name>.patch

## Worktree lifecycle

Theo must never find stale worktrees or idle agents in Orca.

- Every worktree has exactly one owner, recorded in Orca lineage when it is
  created: pass `--parent-worktree active` and
  `--comment "owner: <agent>, <purpose>"`, never `--no-parent`. Factory run
  worktrees (`auto-*`) belong to the reaper, and ones Theo makes in the
  app belong to Theo. The main checkout is never removed.
- The owner removes its worktree and branch once the work has landed
  (`orca-ide worktree rm --worktree name:<name>`, then `git branch -D`).
  Commit and push before you stop.
- Factory runs never create worktrees; subagents work inside the run's own
  worktree.
- The reaper (`tuicraft-factory-reaper.timer`, every 10 minutes) is the
  backstop. It removes finished or over-time `auto-*` runs, and removes
  other worktrees only when they have landed on `main`, are clean, and have
  been idle for more than 12 hours. It never deletes a dirty tree: it
  archives a patch to `tmp/worktree-archive-<date>/` in the main checkout
  and opens one `Reaper: <worktree> held (<reason>)` issue with `needs:pm`
  that tells Theo what to do. It closes that issue itself once the
  worktree is gone or no longer held, so an open one always needs action.

## Reference Codebases

- `../wow-chat-client` — Node.js WoW chat client, primary protocol reference
- `../azerothcore-wotlk-playerbots` — AzerothCore server source (C++). Key files:
  `src/server/game/Entities/Object/Updates/UpdateFields.h` (complete field index
  for 3.3.5a build 12340), `src/server/game/Handlers/SpellHandler.cpp`
  (CMSG_CAST_SPELL handling), `src/server/game/Handlers/GroupHandler.cpp`
  (SMSG_PARTY_MEMBER_STATS construction)
- `../wowser` — browser-based WoW 3.3.5a client (ES2015/React/WebGL). Useful for
  cross-referencing opcodes, auth error codes, and realm parsing. Key files:
  `src/lib/auth/` (challenge opcodes, reconnect), `src/lib/game/opcode.js` (40+
  world opcodes), `src/lib/realms/handler.js` (realm list parsing),
  `src/lib/crypto/srp.js` (SRP-6 reference — uses insecure Math.random, ours is
  better)
- `../wow_messages` — auto-generated WoW protocol definitions in `.wowm` format
  (Rust crate source). Machine-readable spec for every opcode across Vanilla/TBC/
  WotLK. Key path: `wow_message_parser/wowm/world/` for world packet definitions
- `../namigator` — C++ pathfinding + line-of-sight library for WoW (Alpha through
  WotLK). Reads MPQ files, generates navmesh via Recast/Detour.
- `../namigator-rs` — Rust bindings for namigator. Clean API reference for the FFI
  wrapper we'll build: `find_path`, `line_of_sight`, `find_height`, `load_adt`
- wowdev.wiki is unnecessary — it 403s automated access and has no offline dump.
  wow_messages and AzerothCore source cover everything needed for protocol work

## Protocol Gotchas

- Server sends message lengths including the null terminator — strip trailing \0
  when decoding
- `drainWorldPackets` must catch handler errors — one bad packet breaks all
  subsequent processing
- Always run `mise test:live` after protocol changes —
  never claim something works without verifying against the real server
- Live-first testing: validate behavior against the real server, then encode it
  in mock integration tests as a living spec
- Chat messages must use a valid racial language (LANG_ORCISH=1 for Horde,
  LANG_COMMON=7 for Alliance) — server rejects LANG_UNIVERSAL (0) silently
- Object literals evaluate in key order, and parsers read packets inside them
  (`{ guid: r.packedGuidBig(), counter: r.uint32LE() }`). Never sort or
  reorder such keys; `useSortedKeys` is off for `src/wow/**` for this reason

## WorldHandle

- `src/test/mock-handle.ts` is the shared WorldHandle mock. The inline mock in
  `src/daemon/start.test.ts` spreads it and overrides only `closed` and
  `close`, so add new WorldHandle methods to the shared mock only
- `SessionLog.append` expects `LogEntry` (type/sender/message) — non-chat
  events need `as LogEntry` cast
- Clear event callbacks before socket teardown — `entityStore.clear()` in the
  socket close handler fires disappear for every entity, so `onEntityEvent`
  must be unset first
- All event handlers (chat, group, entity) must both push to the ring buffer
  and call `log.append()` — follow existing handlers when adding new event types

## Entity Fields

- `extractObjectFields` / `extractUnitFields` / `extractGameObjectFields` return
  `_changed: string[]` — destructure it out on the create path, use it on the
  values path to filter which fields to pass to `entityStore.update()`

## Documentation

- When adding user-visible features, update all four: `src/cli/help.ts`,
  `docs/manual.md`, `.claude/skills/tuicraft/SKILL.md`, and `README.md`

## Commits

Use [Conventional Commits](https://www.conventionalcommits.org/), then:

- Keep the subject line to 50 characters or fewer (including prefix)
- Capitalize the subject after the prefix: `feat: Add thing` not `feat: add thing`
- Pick the right prefix — `feat:` is only for application features visible to
  end users. Tooling and infra are `chore:`, README changes are `docs:`, CI
  changes are `ci:`. When a commit spans types, split into separate commits.
- Blank line, then 1-3 sentence description of "why" (wrap at 72 chars)
- No bullet points
- Check `git log -n 5` first to match existing style
- Never use `--oneline` — commit bodies carry important context

Shipping:

- Everything reaches `main` through a pull request that has green
  `signoff/ci`, `factory/ci` and `factory/review` statuses (the `main`
  ruleset). Theo's approval is not required right now
  (`required_approving_review_count: 0`, and `pmApproval = false` in
  `src/factory/config.ts`). If it is turned back on, only an approval by
  `tvararu` on github.com counts: approvals clicked inside Orca are sent as
  `OpenHubris`, the PR author.
- The dev factory works issues that Theo has labelled `ready`: workers open
  PRs as `OpenHubris` from `factory/<issue>-<slug>` branches, reviewers post
  `factory/ci` and `factory/review`, and only the merger lands them, by
  rebase-merge. Do not land or relabel factory PRs by hand.
- Work that doesn't come from the factory goes through the same review and
  merger, so give it what their prompts need. File an issue with a
  `## Acceptance criteria` section. Push the work to a branch named
  `factory/<N>-<slug>`, and open a PR whose body has `Fixes #N` and a
  `## Proof` section. Then add `agent:review` to the issue. The reviewer
  posts the statuses and the merger lands it. Never post `factory/*`
  statuses on your own PR.
- Rebase-merge lands every commit of a PR on `main` by itself. Each must be
  a Conventional Commit that passes the hooks and `mise ci` on its own:
  clean the history with `git commit --fixup` and
  `git rebase -i --autosquash` before review. No WIP or "address review"
  commits.
- `git add` the intended files, then `git commit` as a separate step. Do
  not stage unrelated work.
- Independent agents work in their own worktree and commit there freely.
  Never instruct a worker to leave its work uncommitted.
- Do not force-push, delete branches, or bypass hooks without permission.
  The exception is your own PR branch: force-push it with
  `--force-with-lease` after cleaning its history.
- Releases are paused; do not run release-please or publish versions.
