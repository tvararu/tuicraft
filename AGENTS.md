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
- `mise typecheck [package]` — type-check the whole repo and then each
  package on its own (`tsc --noEmit`, then `tsc --noEmit -p packages/<p>`),
  or only the named package
- `mise format [path]` — check formatting (`biome format`, default `packages/`)
- `mise format:fix [path]` — fix formatting (`biome format --write`, default `packages/`)
- `mise lint [path]` — lint rules and assist actions (`biome check --formatter-enabled=false --error-on-warnings`)
- `mise lint:fix [path]` — apply safe lint fixes and assist actions
  (`biome check --write`, default `packages/`)
- `mise lint:docs` — check the docs agents read as current instructions
  for dated history and dead references (`bun packages/devtools/src/stale-docs.ts`)
- `mise ci` — `mise ci:checks` (`typecheck`, `test:coverage`, `format`,
  `lint`, `lint:docs`), then `gh signoff ci` posts a green `signoff/ci`
  status for HEAD.
  Signoff runs only after the checks pass and only for a HEAD that was clean
  throughout and is pushed to its upstream; otherwise it prints a note and
  exits 0. No remote CI
- `mise ci --publish` — used by the hk `pre-push` hook: pushes HEAD to a
  temporary `refs/signoff/<sha>` ref so the not-yet-pushed commit can be
  signed off, deletes that ref, and fails the push if signoff fails
- `mise test:live` — live server tests (`bun test ./packages/cli/test-support/live.ts
  ./packages/cli/test-support/live-quest.ts
  ./packages/cli/test-support/live-remote-motion.ts
  ./packages/cli/test-support/live-vendor.ts`); needs two game accounts via `WOW_*` (see Testing)
- `mise namigator:build` — build `libnamigator.so` from the pinned upstream
  commit plus the patches in `vendor/namigator/` (in `tmp/namigator/`) and
  install it at `~/.local/share/tuicraft/namigator/<key>/libnamigator.so`,
  keyed by `UPSTREAM`, `build.sh` and the patches; it skips the build when
  that file exists. `soap create` needs it
- `bun packages/factory/src/main.ts <precheck|status|landings|qa-changes|squash-message|same-patch|soap|reap|setup>` — the dev
  factory CLI (how it works: `docs/factory.md`).
  Automations and the reaper run it from the runner clone,
  `~/.local/share/tuicraft-factory/runner`, which follows `origin/main`
- `mise factory:pace [pause|default|max]` — show the factory pace and the
  live schedules, or set it (automation schedules in place, worker and
  review caps, reaper timer). Use `max` in quiet weeks with usage to spare
  and for overnight pushes. `pause` disables `work`, `review` and `merge`
  and leaves QA and the reaper running; `default` or `max` ends it. The
  design doc's Pace section has the table
- `mise build` — compile single binary (`bun build --compile`)
- `mise test:slowest` — show 10 slowest tests via junit XML
- `orca-ide worktree create --name <name> --parent-worktree active --comment
  "owner: <agent>, <purpose>" --agent omp` — create a worktree.
  Setup is `scripts.setup` in the committed `orca.yaml` (`mise trust -y &&
  mise bundle && mkdir -p tmp`) and the agent starts only after it
  finishes; no other flags needed, and a nested agent creating its own
  worktree inherits both setup and lineage. Automation worktrees skip
  setup unless the automation has "Run setup for each new workspace" on.
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

## Memory

- omp memory is on for this repo (`.omp/config.yml`: Mnemopi, shared bank
  `tuicraft`, no transcript auto-save, no LLM calls); factory runs turn it
  off through `packages/factory/src/omp-factory.yml`.
- Automatic recall only fires on a close match, so call `recall` with your
  task's topic when you start. Recalled memory is background; AGENTS.md and
  the maintainer's instructions win when they conflict.
- Use `learn` only for a verified, reusable lesson that isn't already in
  AGENTS.md or `docs/`. Never record the maintainer's rulings; the
  coordinator records those.
- Only the coordinator and the maintainer edit or forget memories
  (`memory_edit`); report a wrong memory instead of changing it.

## Code Style

- Strict TypeScript — `noUncheckedIndexedAccess`, `noUnusedLocals`,
  `noUnusedParameters`, all strict flags on (see `tsconfig.base.json`, which the root
  `tsconfig.json` and each package's `tsconfig.json` extend)
- Never write comments, so never use `biome-ignore`; rule exceptions live as
  path overrides in `biome.json` (protocol bit flags, wire-order literals in
  `packages/core/src/wow/**`, the opcode table, test files and
  `packages/*/test-support/**`)
- Files are capped at 500 non-blank lines (`noExcessiveLinesPerFile`, tests
  included). Split by responsibility into sibling modules before a file grows
  past it; shared test setup goes in
  `packages/<pkg>/test-support/<name>-fixtures.ts`. Only the
  central `opcodes.ts` table is exempt
- Fire-and-forget promises end in `.catch(ignoreFailure)` from
  `"#lib/ignore-failure"` in core or `"@tuicraft/core/lib/ignore-failure"`
  elsewhere, not an empty callback
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
  accounts of your own, never on anyone else's character. Run
  `mise namigator:build` first when the patch set changed; `soap create`
  refuses without it:
  `bun packages/factory/src/main.ts soap create fresh --gm 2` (account 1, GM level 2
  for the `.freeze` and `.tele` checks) and
  `bun packages/factory/src/main.ts soap create eversong10` (account 2). Set
  `WOW_ACCOUNT_1`, `WOW_PASSWORD_1`, `WOW_CHARACTER_1`, `WOW_ACCOUNT_2`,
  `WOW_PASSWORD_2` and `WOW_CHARACTER_2` from the JSON each prints
  (redirect it to a file under `tmp/` and read fields with `jq`, so the
  password never reaches a transcript; `soap list` omits passwords), run it
  as `XDG_CONFIG_HOME=<account 1 .dir>/config mise test:live` (the suite
  reads the navigation data paths from that config), and delete both with
  `soap delete <ACCOUNT>` afterwards. Unit, type, format, and coverage
  checks are not live evidence. Do not claim the live suite is passing
  without a successful run. If the suite fails for infrastructure reasons
  (server down, SOAP unreachable), defer to the user.
- Run the CLI as a `soap create` character only through the wrapper it
  writes, `tmp/tc-<ACCOUNT>` (the JSON's `.wrapper`), never by exporting
  `XDG_*` into your shell. The wrapper sets the account's own config,
  socket and session log, refuses to run if its daemon would log in another
  character, prints `tc-<ACCOUNT>: character <name>` on stderr and runs
  `bun packages/cli/src/main.ts "$@"`. `soap delete` removes it with the account's
  directories. `omp-factory` starts every omp in a tuicraft worktree other
  than the main checkout with per-run `XDG_*` directories (config and state
  in `factory-xdg/` in the worktree's git directory, runtime in
  `$XDG_RUNTIME_DIR/tuicraft-factory-<hash>`) that link everything in the
  real ones except `tuicraft`, so plain `bun packages/cli/src/main.ts` there finds no
  config: `status` says the daemon is not running, and `start` or any
  daemon command fails with "No config found" after 30 seconds.
- Tests are colocated: `foo.ts` → `foo.test.ts` in the same directory.
  A test that needs a shell's code lives in that shell's package instead:
  `party-store.test.ts` and `control-replan.test.ts` test core code but
  import CLI formatters, so they live in `packages/cli/src/ui`
- Import from `bun:test`: `import { test, expect, describe } from "bun:test"`
- Run with `mise test`
- `mise test packages/core/src/lib/errors.test.ts` runs a single file (args pass through to `bun test`)
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
- Tests that spawn git use `git()` or `gitEnv()` from `packages/factory/test-support/git.ts`, which
  strip `GIT_*`: an inherited `GIT_DIR` makes `git init` write `core.worktree`
  into another repository's config
- `mock.module()` leaks across test files in Bun, so `config/biome.grit` bans
  it. Use dependency injection: file locations come from a `Paths` value
  (`resolvePaths()` by default), and tests pass `pathsUnder(dir)` from
  `packages/core/test-support/temp-paths.ts`. Stdlib modules like `node:readline` are injected too
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

- Unreviewed work from the `vibe` branch lives in the tag `archive/vibe`
  (commit `5fbe7bf`); there is no `vibe` branch. `main` has reviewed
  replacements for its pieces (`packages/core/src/wow/navigation-native.ts` for the
  `bun:ffi` namigator bridge, `packages/core/src/wow/combat-actions-*`). Nobody reviewed
  the tag's code, and unreviewed code must not enter `main` disguised as
  progress. Read it freely for patterns (`git show archive/vibe:<path>`),
  never merge, rebase or cherry-pick it without the maintainer saying so,
  and never treat its journals as roadmap evidence.
- `main` has a GitHub `required_linear_history` rule and allows only
  squash merges, so **merge commits are rejected at push time**. Local
  merges, hooks and `mise ci` all pass first, and the push then fails with
  `GH013: Repository rule violations found` naming only a commit hash,
  which reads as an auth or branch-protection fault rather than a
  history-shape one. The maintainer's admin bypass is the only direct push
  to `main`; it integrates by cherry-picking commits in order, never by
  merging. Note that `git cherry-pick --continue` opens an editor, so pass
  `-c core.editor=true`.
- `tmp/` is ephemeral: keep nothing there that matters, and accept that
  it can be lost.

## Worktree lifecycle

The maintainer must never find stale worktrees or idle agents in Orca.

- Every worktree has exactly one owner, recorded in Orca lineage when it is
  created: pass `--parent-worktree active` and
  `--comment "owner: <agent>, <purpose>"`, never `--no-parent`. Factory run
  worktrees (`auto-*`) belong to the reaper, and ones the maintainer makes
  in the app belong to the maintainer. The main checkout is never removed.
- The owner removes its worktree and branch once the work has landed
  (`orca-ide worktree rm --worktree name:<name>`, then `git branch -D`).
  Commit and push before you stop.
- Factory runs never create worktrees; subagents work inside the run's own
  worktree.
- The reaper (`tuicraft-factory-reaper.timer`, every minute) is the
  backstop. It removes finished or over-time `auto-*` runs, and removes
  other worktrees only when they have landed on `main`, are clean, and have
  been idle for more than 12 hours. It never deletes a dirty tree: it
  archives a patch to `tmp/worktree-archive-<date>/` in the main checkout
  and keeps one draft card in Blocked on the project board titled
  `Reaper: <worktree> held (<reason>)` that says what to do. It deletes
  that card itself once the worktree is gone or no longer held, so a Reaper
  card in Blocked always needs action.

## Reference Codebases

- `../wow-chat-client` — Node.js WoW chat client, primary protocol reference
- `../azerothcore-wotlk-playerbots` — AzerothCore server source (C++). Key files:
  `../azerothcore-wotlk-playerbots/src/server/game/Entities/Object/Updates/UpdateFields.h` (complete field index
  for 3.3.5a build 12340), `../azerothcore-wotlk-playerbots/src/server/game/Handlers/SpellHandler.cpp`
  (CMSG_CAST_SPELL handling), `../azerothcore-wotlk-playerbots/src/server/game/Handlers/GroupHandler.cpp`
  (SMSG_PARTY_MEMBER_STATS construction)
- `../wowser` — browser-based WoW 3.3.5a client (ES2015/React/WebGL). Useful for
  cross-referencing opcodes, auth error codes, and realm parsing. Key files:
  `../wowser/src/lib/auth/` (challenge opcodes, reconnect),
  `../wowser/src/lib/game/opcode.js` (40+ world opcodes),
  `../wowser/src/lib/realms/handler.js` (realm list parsing),
  `../wowser/src/lib/crypto/srp.js` (SRP-6 reference — uses insecure Math.random, ours is
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
  reorder such keys; `useSortedKeys` is off for `packages/core/src/wow/**` for this reason

## Packages

- The code is a Bun workspace (`packages/*`): `@tuicraft/core`
  (`packages/core`: `packages/core/src/wow`, the runtime helpers in
  `packages/core/src/lib` and shared test support in
  `packages/core/test-support`), `@tuicraft/cli` (the CLI,
  daemon and TUI), `@tuicraft/factory`, `@tuicraft/devtools` and
  `@tuicraft/harness`. `bun install` (`mise bundle`) must run before
  any cross-package import resolves.
- Inside a package, import with its private `#` aliases from its
  `package.json` `imports` (`"#wow/client"`, `"#daemon/server"`,
  `"#test-support/must"`); relative imports are for siblings and non-code files.
- Other packages import core only through its `exports`:
  `"@tuicraft/core"` (the barrel, `packages/core/src/wow/index.ts`),
  `"@tuicraft/core/session"` for `worldSession` and auth,
  `"@tuicraft/core/lib/<module>"` for the listed helpers and, in tests
  only, `"@tuicraft/core/test-support/<module>"`. Any other subpath
  fails to resolve in Bun and tsc, and biome's `noRestrictedImports`
  rejects it too. The barrel exports no value that loads the session,
  so `"@tuicraft/core/session"` stays a lazy `import()` in
  `packages/cli/src/main.ts`. Export a new core symbol from the barrel
  (or add an `exports` entry) before another package uses it; a test
  that needs a core internal imports it from
  `"@tuicraft/core/test-support/internals"`.
- Core imports nothing from another workspace package, and core runtime
  code imports no test support. Only `packages/harness` may import
  `@earendil-works/*`. biome enforces both.

## WorldHandle

- `packages/core/test-support/mock-handle.ts` is the shared WorldHandle mock. The inline mock in
  `packages/cli/src/daemon/start.test.ts` spreads it and overrides only `closed` and
  `logout`, so add new WorldHandle methods to the shared mock only
- `SessionLog.append` expects `LogEntry` (type/sender/message) — non-chat
  events need `as LogEntry` cast
- `WorldHandle` `on*` hooks are multi-subscriber: each returns an
  unsubscribe function and all of them are backed by `conn.events`
  (`packages/core/src/wow/world-events.ts`, built on `#lib/emitter`). Emit through
  `conn.events.<name>.emit(...)`, never a setter. Every listener gets the
  event; a listener that throws during packet dispatch is reported through
  `onPacketError` with the dispatching opcode, and elsewhere the error is
  rethrown once delivery finishes
- `cleanupSession` clears `conn.events` before socket teardown —
  `entityStore.clear()` in the socket close handler fires disappear for every
  entity, so subscribers must be detached first
- All event handlers (chat, group, entity) must both push to the ring buffer
  and call `log.append()` — follow existing handlers when adding new event types

## Entity Fields

- `extractObjectFields` / `extractUnitFields` / `extractGameObjectFields` return
  `_changed: string[]` — destructure it out on the create path, use it on the
  values path to filter which fields to pass to `entityStore.update()`

## Documentation

- When adding user-visible features, update all four: `packages/cli/src/cli/help.ts`,
  `docs/manual.md`, `.claude/skills/tuicraft/SKILL.md`, and `README.md`
- Docs state the current rule or state in the present tense. History
  belongs in commit messages and `docs/plans/`: don't narrate when, why or
  at whose request a rule changed ("since <date>", "deleted on <date>"),
  and never point a reader at something that no longer exists or lives
  only in `tmp/`. Keep a date only where it is the fact a reader needs,
  such as when an evidence record was taken. `mise lint:docs` checks the
  common forms in the files agents read as current instructions (listed
  in `packages/devtools/src/stale-docs.ts`)

## Commits

Use [Conventional Commits](https://www.conventionalcommits.org/), then:

- Keep the subject line to 50 characters or fewer (including prefix)
- Capitalize the subject after the prefix: `feat: Add thing` not `feat: add thing`
- Pick the right prefix — `feat:` is only for application features visible to
  end users. Tooling and infra are `chore:`, README changes are `docs:`, CI
  changes are `ci:`. When a PR spans types, split it into separate PRs.
- Blank line, then 1-3 sentence description of "why" (wrap at 72 chars)
- No bullet points
- Check `git log -n 5` first to match existing style
- Never use `--oneline` — commit bodies carry important context
- These rules bind the squash commit that lands on `main`, which the PR
  title and body produce (see Shipping). The hk hooks still check every
  local commit; they let `fixup!`, `squash!` and `amend!` subjects through
  so autosquash works, but a PR's own history is never reviewed.

Shipping:

- Everything reaches `main` through a pull request that has green
  `signoff/ci`, `factory/ci` and `factory/review` statuses (the `main`
  ruleset). The maintainer's approval is not required right now
  (`required_approving_review_count: 0`, and `maintainerApproval = false` in
  `packages/factory/src/config.ts`). If it is turned back on, only an approval by
  `tvararu` on github.com counts: approvals clicked inside Orca are sent as
  `OpenHubris`, the PR author.
- The dev factory works issues whose card the maintainer has moved to
  Ready on the project board (tvararu/1): workers open PRs as `OpenHubris`
  from `factory/<issue>-<slug>` branches, reviewers post `factory/ci` and
  `factory/review`, and only the merger lands them, by squash merge. Do not
  land factory PRs or move their cards by hand. Moving the card to Ready is
  the whole release step.
- Work that doesn't come from the factory goes through the same review and
  merger, so give it what their prompts need. File an issue with a
  `## Acceptance criteria` section. Push the work to a branch named
  `factory/<N>-<slug>`, and open a PR whose body has `Fixes #N` and a
  `## Proof` section. Then run `bun packages/factory/src/main.ts status N in-review`.
  The reviewer posts the statuses and the merger lands it. Never post
  `factory/*` statuses on your own PR.
- Each PR lands as one squash commit. OpenHubris authors it because it
  performs the merge. Its subject is the PR title, so the title must be a
  Conventional Commit of 50 characters or fewer, capitalised after the
  prefix. Its body is the PR body's opening paragraph (1-3 sentences of
  why, before `Fixes #N` and any heading), then one trailer block:
  `Refs: #N` for each closed issue, `PR: #M`, and
  `Co-authored-by: Theodor Vararu <theo@vararu.org>` to credit the maintainer.
  `bun packages/factory/src/main.ts squash-message <M>` builds it and fails on a bad
  title or a missing why. Commits inside the PR may be as granular as
  helps; no history cleanup is needed.
- The merger lands only a PR whose current head has green `factory/ci` and
  `factory/review`. `precheck merger` comments on an In review issue whose
  head moved after a passing review, and moves it to Blocked on the third
  moved head since the card last entered In review; the merger's own
  rebases do not count. After a rebase, a PR whose zero-context patch
  (`same-patch`) still matches the reviewed head keeps its review; CI
  reruns on the new head.
- Stacked PRs: when an issue needs another open PR's code, link the child
  issue as blocked by the parent's issue, base the child PR on the parent's
  branch so its diff shows only the child, and put
  `Stacked-on: #<parent PR> <parent tip SHA>` in its body. Once the parent
  lands, GitHub retargets the child to `main` and it is rebased with
  `git rebase --onto origin/main <parent tip>`. Keep stacks 2-3 deep.
- `git add` the intended files, then `git commit` as a separate step. Do
  not stage unrelated work.
- Independent agents work in their own worktree and commit there freely.
  Never instruct a worker to leave its work uncommitted.
- Do not force-push, delete branches, or bypass hooks without permission.
  The exception is your own PR branch: force-push it with
  `--force-with-lease` after rebasing it.
- There are no releases; do not publish versions.
