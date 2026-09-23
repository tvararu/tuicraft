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
- If the coordinator lacks CLI access, delegate execution to a capable agent.
  Keep one gameplay owner per character to prevent conflicting actions.
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
- `mise ci` — `typecheck`, `test:coverage`, and `format` (no `gh signoff`, no remote CI)
- `mise test:live` — live server tests (`bun test ./src/test/live.ts`); needs two dedicated test accounts
- `mise build` — compile single binary (`bun build --compile`)
- `mise test:slowest` — show 10 slowest tests via junit XML
- `orca-ide worktree create --name <name> --agent omp` — create a worktree.
  Setup runs by default; no other flags needed, and a nested agent creating
  its own worktree inherits both setup and lineage.
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
- Never write comments
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
  daemon changes.** Do not ask the user to run it. Live tests need two
  dedicated test accounts with their `WOW_*` credentials; ordinary client
  config is not enough. Unit, type, format, and coverage checks are not live
  evidence. Do not claim the live suite is passing without a successful run.
  If it fails for infrastructure reasons (server down, missing test accounts
  or env vars), defer to the user.
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
- `mock.module()` leaks across test files in Bun — only mock `"paths"` (safe via
  dynamic imports), never mock `"config"` or `"session-log"` in shared test runs.
  For stdlib modules like `node:readline`, use dependency injection instead
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
- `main` has a GitHub `required_linear_history` rule, so **merge commits are
  rejected at push time**. Local merges, hooks and `mise ci` all pass first,
  and the push then fails with `GH013: Repository rule violations found`
  naming only a commit hash, which reads as an auth or branch-protection
  fault rather than a history-shape one. Integrate worker branches by
  cherry-picking their commits in order, not by merging. Note that
  `git cherry-pick --continue` opens an editor, so pass `-c core.editor=true`.
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

## WorldHandle

- Two mocks exist: `src/test/mock-handle.ts` (shared) and an inline mock in
  `src/daemon/start.test.ts` — update both when adding WorldHandle methods
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
- No bullet points, NEVER add "Co-Authored-By" or other footers
- Check `git log -n 5` first to match existing style
- Never use `--oneline` — commit bodies carry important context

Shipping:

- One integration owner commits and pushes to `main`. No PRs.
- `git add` the intended files, then `git commit` as a separate step. Do
  not stage unrelated work.
- Independent agents work in their own worktree and commit there freely.
  Never instruct a worker to leave its work uncommitted.
- The integration owner commits each coherent unit as soon as it passes
  `mise ci`. Do not hold integrated work uncommitted until a milestone
  is verified.
- Do not force-push, delete branches, or bypass hooks without permission.
- Releases are paused; do not run release-please or publish versions.
- NEVER add a Claude Code attribution footer
